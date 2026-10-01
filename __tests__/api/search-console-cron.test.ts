import { beforeEach, describe, expect, it, vi } from 'vitest'

const loadDueBindings = vi.hoisted(() => vi.fn())
const syncBinding = vi.hoisted(() => vi.fn())
const startCronRun = vi.hoisted(() => vi.fn())
const finishCronRun = vi.hoisted(() => vi.fn())
const consoleErrors = vi.hoisted(() => [] as unknown[][])

vi.mock('@/lib/integrations/search-console/store', () => ({
  loadDueBindings, loadConnectionSecret: vi.fn(), listSyncPages: vi.fn(), writeDaily: vi.fn(),
  writePageQueries: vi.fn(), markConnection: vi.fn(), recordRun: vi.fn(),
}))
vi.mock('@/lib/integrations/search-console/sync', () => ({ syncBinding }))
vi.mock('@/lib/cron/recordRun', () => ({ startCronRun, finishCronRun }))

const call = async (auth = 'Bearer cron-secret-0123456789') => {
  const { GET } = await import('@/app/api/cron/search-console/route')
  return GET(new Request('https://app.test/api/cron/search-console', { headers: { authorization: auth } }))
}

beforeEach(() => {
  Object.assign(process.env, {
    CRON_SECRET: 'cron-secret-0123456789', FEATURE_SEARCH_CONSOLE: '1',
    GOOGLE_OAUTH_CLIENT_ID: 'c', GOOGLE_OAUTH_CLIENT_SECRET: 's',
    GOOGLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  })
  loadDueBindings.mockReset().mockResolvedValue([])
  syncBinding.mockReset()
  startCronRun.mockReset().mockResolvedValue('run')
  finishCronRun.mockReset()
  consoleErrors.length = 0
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { consoleErrors.push(args) })
})

describe('GET /api/cron/search-console', () => {
  it('rejects a wrong secret', async () => {
    expect((await call('Bearer nope')).status).toBe(401)
  })

  it('is 500 when CRON_SECRET is too short to be one', async () => {
    process.env.CRON_SECRET = 'short'
    expect((await call('Bearer short')).status).toBe(500)
  })

  it('skips cleanly with the flag off, never looking like an outage', async () => {
    delete process.env.FEATURE_SEARCH_CONSOLE
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ skipped: 'flag_off' })
    expect(loadDueBindings).not.toHaveBeenCalled()
  })

  it('counts outcomes and records the run as ok', async () => {
    loadDueBindings.mockResolvedValueOnce([{ clientId: 'a' }, { clientId: 'b' }]).mockResolvedValue([])
    syncBinding.mockResolvedValueOnce('ok').mockResolvedValueOnce('quota')
    const res = await call()
    expect(res.status).toBe(200)
    expect((await res.json()).outcomes).toEqual({ ok: 1, quota: 1 })
    expect(finishCronRun).toHaveBeenCalledWith('run', 'ok', { outcomes: { ok: 1, quota: 1 } })
  })

  it('gives every sync a deadline 45 s after the run started', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    try {
      loadDueBindings.mockResolvedValueOnce([{ clientId: 'a' }]).mockResolvedValue([])
      syncBinding.mockResolvedValue('ok')
      await call()
      expect(syncBinding).toHaveBeenCalledWith({ clientId: 'a' }, expect.objectContaining({ deadline: 1_045_000 }))
    } finally {
      now.mockRestore()
    }
  })

  it('takes no new binding once 40 s have passed', async () => {
    let clock = 1_000_000
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock)
    try {
      loadDueBindings.mockResolvedValueOnce([{ clientId: 'a' }, { clientId: 'b' }]).mockResolvedValue([])
      syncBinding.mockImplementation(async () => { clock += 40_000; return 'ok' })
      const res = await call()
      expect(syncBinding).toHaveBeenCalledTimes(1)
      expect((await res.json()).outcomes).toEqual({ ok: 1 })
    } finally {
      now.mockRestore()
    }
  })

  it('counts a deferred sync as due and not ok, so a run of only deferrals is 502', async () => {
    loadDueBindings.mockResolvedValueOnce([{ clientId: 'a' }]).mockResolvedValue([])
    syncBinding.mockResolvedValue('deferred')
    const res = await call()
    expect(res.status).toBe(502)
    expect((await res.json()).outcomes).toEqual({ deferred: 1 })
    expect(finishCronRun).toHaveBeenCalledWith('run', 'error', { outcomes: { deferred: 1 } })
  })

  it('is 502 when bindings were due and none synced', async () => {
    loadDueBindings.mockResolvedValueOnce([{ clientId: 'a' }]).mockResolvedValue([])
    syncBinding.mockResolvedValue('google_unavailable')
    expect((await call()).status).toBe(502)
  })

  it('is not 502 when every binding was a deliberate skip', async () => {
    loadDueBindings.mockResolvedValueOnce([{ clientId: 'a' }]).mockResolvedValue([])
    syncBinding.mockResolvedValue('not_entitled')
    expect((await call()).status).toBe(200)
  })

  // CHANGED twice. It used to pin "one rejection aborts the run with a 500",
  // which starved every brand behind the failing one; then, once the runner was
  // shared, "counted internal_error, run answers 200", which turned a lost ledger
  // write into a success. syncBinding only rejects when its own recordRun call
  // fails, so that brand's run left no record: the loop still carries on, the
  // brand is counted ledger_write_failed (a response counter, not a ledger
  // outcome), and the run ends 500. The failure must still never carry the
  // rejection's message text into a log, because the Neon driver can echo the
  // connection string (password included) into its own error messages.
  it('counts a rejecting syncBinding as ledger_write_failed, keeps going, answers 500 and logs no message text', async () => {
    loadDueBindings.mockResolvedValueOnce([{ clientId: 'a' }, { clientId: 'b' }]).mockResolvedValue([])
    const secretLookingMessage = 'connection failed: postgresql://user:hunter2@host/db'
    syncBinding.mockRejectedValueOnce(new TypeError(secretLookingMessage)).mockResolvedValueOnce('ok')

    const res = await call()

    expect(syncBinding).toHaveBeenCalledTimes(2)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Sync failed', outcomes: { ledger_write_failed: 1, ok: 1 } })
    expect(finishCronRun).toHaveBeenCalledTimes(1)
    expect(finishCronRun).toHaveBeenCalledWith('run', 'error', { outcomes: { ledger_write_failed: 1, ok: 1 } }, 'ledger_write_failed')

    const loggedText = JSON.stringify(consoleErrors)
    expect(loggedText).toContain('TypeError')
    expect(loggedText).not.toContain(secretLookingMessage)
    expect(loggedText).not.toContain('hunter2')
  })

  it('attempts a rejecting binding once per run, not once per batch, and answers 500', async () => {
    loadDueBindings.mockResolvedValue([{ clientId: 'a' }])
    syncBinding.mockRejectedValue(new Error('ledger down'))
    const res = await call()
    expect(syncBinding).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Sync failed', outcomes: { ledger_write_failed: 1 } })
    expect(finishCronRun).toHaveBeenCalledTimes(1)
  })

  it('is 500 and finishes the run as an error when loading the due bindings fails, logging no message text', async () => {
    const secretLookingMessage = 'connection failed: postgresql://user:hunter2@host/db'
    loadDueBindings.mockRejectedValue(new Error(secretLookingMessage))

    const res = await call()

    expect(res.status).toBe(500)
    expect(finishCronRun).toHaveBeenCalledWith('run', 'error', expect.anything(), 'Error')
    expect(JSON.stringify(consoleErrors)).not.toContain('hunter2')
    expect(JSON.stringify(finishCronRun.mock.calls)).not.toContain('hunter2')
  })
})
