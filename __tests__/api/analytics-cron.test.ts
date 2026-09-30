import { beforeEach, describe, expect, it, vi } from 'vitest'

const loadDueAnalyticsBindings = vi.hoisted(() => vi.fn())
const syncAnalyticsBinding = vi.hoisted(() => vi.fn())
const startCronRun = vi.hoisted(() => vi.fn())
const finishCronRun = vi.hoisted(() => vi.fn())
const listWebStreams = vi.hoisted(() => vi.fn())
const listKeyEvents = vi.hoisted(() => vi.fn())
const runKeyEventReport = vi.hoisted(() => vi.fn())
const consoleErrors = vi.hoisted(() => [] as unknown[][])

vi.mock('@/lib/integrations/analytics/store', () => ({
  loadDueAnalyticsBindings, replaceDailyWindow: vi.fn(), recordAnalyticsRun: vi.fn(),
}))
// The connection secret and its status flip belong to the Google connection, which
// both products share, so they come from the Search Console store.
vi.mock('@/lib/integrations/search-console/store', () => ({
  loadConnectionSecret: vi.fn(), markConnection: vi.fn(),
}))
vi.mock('@/lib/integrations/analytics/sync', () => ({ syncAnalyticsBinding }))
vi.mock('@/lib/integrations/analytics/client', () => ({ listWebStreams, listKeyEvents, runKeyEventReport }))
vi.mock('@/lib/cron/recordRun', () => ({ startCronRun, finishCronRun }))

const call = async (auth = 'Bearer cron-secret-0123456789') => {
  const { GET } = await import('@/app/api/cron/analytics/route')
  return GET(new Request('https://app.test/api/cron/analytics', { headers: { authorization: auth } }))
}

const due = (clientId: string) => ({ accountId: 'acct', clientId })

beforeEach(() => {
  Object.assign(process.env, {
    CRON_SECRET: 'cron-secret-0123456789', FEATURE_ANALYTICS: '1',
    GOOGLE_OAUTH_CLIENT_ID: 'c', GOOGLE_OAUTH_CLIENT_SECRET: 's',
    GOOGLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  })
  loadDueAnalyticsBindings.mockReset().mockResolvedValue([])
  syncAnalyticsBinding.mockReset()
  startCronRun.mockReset().mockResolvedValue('run')
  finishCronRun.mockReset()
  listWebStreams.mockReset()
  consoleErrors.length = 0
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { consoleErrors.push(args) })
})

describe('GET /api/cron/analytics', () => {
  it('rejects a wrong secret', async () => {
    expect((await call('Bearer nope')).status).toBe(401)
  })

  it('is 500 when CRON_SECRET is too short to be one', async () => {
    process.env.CRON_SECRET = 'short'
    expect((await call('Bearer short')).status).toBe(500)
  })

  it('skips cleanly with the flag off, never looking like an outage', async () => {
    delete process.env.FEATURE_ANALYTICS
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ skipped: 'flag_off' })
    expect(loadDueAnalyticsBindings).not.toHaveBeenCalled()
    expect(startCronRun).not.toHaveBeenCalled()
  })

  it('is 500 when Google OAuth is not configured', async () => {
    delete process.env.GOOGLE_OAUTH_CLIENT_ID
    expect((await call()).status).toBe(500)
    expect(loadDueAnalyticsBindings).not.toHaveBeenCalled()
  })

  it('is 500 when the token vault key is missing', async () => {
    delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY
    expect((await call()).status).toBe(500)
    expect(loadDueAnalyticsBindings).not.toHaveBeenCalled()
  })

  it('counts outcomes and records the run as ok, exactly once', async () => {
    loadDueAnalyticsBindings.mockResolvedValueOnce([due('a'), due('b')]).mockResolvedValue([])
    syncAnalyticsBinding.mockResolvedValueOnce('ok').mockResolvedValueOnce('quota')
    const res = await call()
    expect(res.status).toBe(200)
    expect((await res.json()).outcomes).toEqual({ ok: 1, quota: 1 })
    expect(finishCronRun).toHaveBeenCalledTimes(1)
    expect(finishCronRun).toHaveBeenCalledWith('run', 'ok', { outcomes: { ok: 1, quota: 1 } })
    expect(startCronRun).toHaveBeenCalledWith('/api/cron/analytics')
  })

  it('gives every sync a deadline 45 s after the run started', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    try {
      loadDueAnalyticsBindings.mockResolvedValueOnce([due('a')]).mockResolvedValue([])
      syncAnalyticsBinding.mockResolvedValue('ok')
      await call()
      expect(syncAnalyticsBinding).toHaveBeenCalledWith(due('a'), expect.objectContaining({ deadline: 1_045_000 }))
    } finally {
      now.mockRestore()
    }
  })

  it('takes no new binding once 40 s have passed', async () => {
    let clock = 1_000_000
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock)
    try {
      loadDueAnalyticsBindings.mockResolvedValueOnce([due('a'), due('b')]).mockResolvedValue([])
      syncAnalyticsBinding.mockImplementation(async () => { clock += 40_000; return 'ok' })
      const res = await call()
      expect(syncAnalyticsBinding).toHaveBeenCalledTimes(1)
      expect((await res.json()).outcomes).toEqual({ ok: 1 })
    } finally {
      now.mockRestore()
    }
  })

  it('counts a deferred sync as due and not ok, so a run of only deferrals is 502', async () => {
    loadDueAnalyticsBindings.mockResolvedValueOnce([due('a')]).mockResolvedValue([])
    syncAnalyticsBinding.mockResolvedValue('deferred')
    const res = await call()
    expect(res.status).toBe(502)
    expect((await res.json()).outcomes).toEqual({ deferred: 1 })
    expect(finishCronRun).toHaveBeenCalledWith('run', 'error', { outcomes: { deferred: 1 } })
  })

  it('is 502 when bindings were due and none synced', async () => {
    loadDueAnalyticsBindings.mockResolvedValueOnce([due('a')]).mockResolvedValue([])
    syncAnalyticsBinding.mockResolvedValue('google_unavailable')
    expect((await call()).status).toBe(502)
  })

  it.each(['not_entitled', 'domain_mismatch', 'scope_missing', 'events_missing'])(
    'is not 502 when every binding was a deliberate %s skip', async skip => {
      loadDueAnalyticsBindings.mockResolvedValueOnce([due('a')]).mockResolvedValue([])
      syncAnalyticsBinding.mockResolvedValue(skip)
      const res = await call()
      expect(res.status).toBe(200)
      expect(finishCronRun).toHaveBeenCalledWith('run', 'ok', { outcomes: { [skip]: 1 } })
    })

  it('is 200 when one binding synced and another failed', async () => {
    loadDueAnalyticsBindings.mockResolvedValueOnce([due('a'), due('b')]).mockResolvedValue([])
    syncAnalyticsBinding.mockResolvedValueOnce('quota').mockResolvedValueOnce('ok')
    expect((await call()).status).toBe(200)
  })

  it('keeps going when one binding rejects: counts internal_error, logs only the name, finishes once', async () => {
    loadDueAnalyticsBindings.mockResolvedValueOnce([due('a'), due('b')]).mockResolvedValue([])
    const secretLookingMessage = 'connection failed: postgresql://user:hunter2@host/db'
    syncAnalyticsBinding.mockRejectedValueOnce(new TypeError(secretLookingMessage)).mockResolvedValueOnce('ok')

    const res = await call()

    expect(syncAnalyticsBinding).toHaveBeenCalledTimes(2)
    expect(res.status).toBe(200)
    expect((await res.json()).outcomes).toEqual({ internal_error: 1, ok: 1 })
    expect(finishCronRun).toHaveBeenCalledTimes(1)
    expect(finishCronRun).toHaveBeenCalledWith('run', 'ok', { outcomes: { internal_error: 1, ok: 1 } })
    const loggedText = JSON.stringify(consoleErrors)
    expect(loggedText).toContain('TypeError')
    expect(loggedText).not.toContain('hunter2')
    expect(loggedText).not.toContain(secretLookingMessage)
  })

  it('does not retry a rejecting binding in a loop: it stays unrecorded, so the next batch returns it again', async () => {
    loadDueAnalyticsBindings.mockResolvedValue([due('a')])
    syncAnalyticsBinding.mockRejectedValue(new Error('ledger down'))
    const res = await call()
    expect(syncAnalyticsBinding).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(502)
    expect(finishCronRun).toHaveBeenCalledTimes(1)
  })

  it('is 500 and finishes the run as an error when loading the due bindings fails, logging no message text', async () => {
    const secretLookingMessage = 'connection failed: postgresql://user:hunter2@host/db'
    loadDueAnalyticsBindings.mockRejectedValue(new Error(secretLookingMessage))

    const res = await call()

    expect(res.status).toBe(500)
    expect(finishCronRun).toHaveBeenCalledTimes(1)
    expect(finishCronRun).toHaveBeenCalledWith('run', 'error', expect.anything(), 'Error')
    const loggedText = JSON.stringify(consoleErrors)
    expect(loggedText).not.toContain('hunter2')
    expect(JSON.stringify(finishCronRun.mock.calls)).not.toContain('hunter2')
  })

  it('wires getStream to a web stream by id, and null for one the property no longer has', async () => {
    loadDueAnalyticsBindings.mockResolvedValueOnce([due('a')]).mockResolvedValue([])
    syncAnalyticsBinding.mockResolvedValue('ok')
    listWebStreams.mockResolvedValue([{ streamId: '1', displayName: 'x', defaultUri: 'https://x.test' }])
    await call()
    const deps = syncAnalyticsBinding.mock.calls[0]![1]
    expect(await deps.getStream('tok', 'p', '1')).toEqual({ streamId: '1', displayName: 'x', defaultUri: 'https://x.test' })
    expect(await deps.getStream('tok', 'p', '2')).toBeNull()
    expect(listWebStreams).toHaveBeenCalledWith('tok', 'p')
    expect(deps.listKeyEvents).toBe(listKeyEvents)
    expect(deps.report).toBe(runKeyEventReport)
  })
})
