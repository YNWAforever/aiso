import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  db: vi.fn(),
  createNeonAlertStore: vi.fn(),
  runAlertEvaluation: vi.fn(),
  sendAlertEmail: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: h.db }))
vi.mock('@/lib/alerts/neon-store', () => ({ createNeonAlertStore: h.createNeonAlertStore }))
vi.mock('@/lib/alerts/evaluate', () => ({ runAlertEvaluation: h.runAlertEvaluation }))
vi.mock('@/lib/resend', () => ({ sendAlertEmail: h.sendAlertEmail }))

async function importRoute() {
  vi.resetModules()
  return import('@/app/api/cron/evaluate-alerts/route')
}

function request(secret?: string) {
  return new Request('https://app.example/api/cron/evaluate-alerts', {
    headers: secret ? { 'x-cron-secret': secret } : {},
  })
}

function cronRequest(bearer?: string) {
  return new Request('https://app.example/api/cron/evaluate-alerts', {
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  })
}

describe('POST /api/cron/evaluate-alerts', () => {
  const originalCronSecret = process.env.CRON_SECRET

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'test-cron-secret'
    h.db.mockReturnValue('sql')
    h.createNeonAlertStore.mockReturnValue({
      loadSnapshot: vi.fn(),
      upsertNotification: vi.fn(),
      claimEmailDelivery: vi.fn(),
      releaseEmailDelivery: vi.fn(),
    })
    h.runAlertEvaluation.mockResolvedValue({ processed: 3, stale: 0, fired: 2, emailed: 2, deferred: 0, emailFailures: 0, notificationFailures: 0 })
  })

  afterEach(() => {
    if (originalCronSecret === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = originalCronSecret
  })

  it('returns 500 when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET
    const { POST } = await importRoute()

    const response = await POST(request('test-cron-secret'))

    expect(response.status).toBe(500)
    expect(h.db).not.toHaveBeenCalled()
  })

  it('returns 401 for a missing or incorrect cron secret', async () => {
    const { POST } = await importRoute()

    const incorrectSecretResponse = await POST(request('wrong-secret'))
    const missingSecretResponse = await POST(request())

    expect(incorrectSecretResponse.status).toBe(401)
    expect(missingSecretResponse.status).toBe(401)
    expect(h.db).not.toHaveBeenCalled()
    expect(h.runAlertEvaluation).not.toHaveBeenCalled()
  })

  it('does not accept the GET handler\'s header shape', async () => {
    // Mirrors the GET-side test below. Guards against "fixing" this by making
    // POST read either header -- the smoke checks in
    // docs/alert-evaluation-release.md send x-cron-secret; a bare Bearer
    // header reaching POST is not that.
    const { POST } = await importRoute()

    const response = await POST(cronRequest('test-cron-secret'))

    expect(response.status).toBe(401)
  })

  it('composes Neon storage and Resend after authentication', async () => {
    const store = {
      loadSnapshot: vi.fn(),
      upsertNotification: vi.fn(),
      claimEmailDelivery: vi.fn(),
      releaseEmailDelivery: vi.fn(),
    }
    h.createNeonAlertStore.mockReturnValue(store)
    const { POST } = await importRoute()

    const response = await POST(request('test-cron-secret'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      processed: 3,
      stale: 0,
      fired: 2,
      emailed: 2,
      deferred: 0,
      emailFailures: 0,
      notificationFailures: 0,
    })
    expect(h.db).toHaveBeenCalledOnce()
    expect(h.createNeonAlertStore).toHaveBeenCalledWith('sql')
    expect(h.runAlertEvaluation).toHaveBeenCalledWith({
      ...store,
      sendAlertEmail: h.sendAlertEmail,
    })
  })

  it('returns 502 when emailFailures is greater than zero, so Vercel Cron sees a red run', async () => {
    // emailFailures exists specifically to distinguish an outage from a healthy
    // re-run, but Vercel Cron surfaces status codes, not bodies -- a 200 here
    // would read as a green cron while zero alerts were delivered.
    h.runAlertEvaluation.mockResolvedValue({
      processed: 3,
      stale: 0,
      fired: 2,
      emailed: 0,
      deferred: 0,
      emailFailures: 2,
      notificationFailures: 0,
    })
    const { POST } = await importRoute()

    const response = await POST(request('test-cron-secret'))

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({
      processed: 3,
      stale: 0,
      fired: 2,
      emailed: 0,
      deferred: 0,
      emailFailures: 2,
      notificationFailures: 0,
    })
  })

  it('returns 502 when notificationFailures is greater than zero, even with no email failures', async () => {
    h.runAlertEvaluation.mockResolvedValue({
      processed: 3,
      stale: 0,
      fired: 2,
      emailed: 2,
      deferred: 0,
      emailFailures: 0,
      notificationFailures: 2,
    })
    const { POST } = await importRoute()

    const response = await POST(request('test-cron-secret'))

    expect(response.status).toBe(502)
  })
})

describe('GET /api/cron/evaluate-alerts', () => {
  const originalCronSecret = process.env.CRON_SECRET

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'test-cron-secret'
    h.db.mockReturnValue('sql')
    h.createNeonAlertStore.mockReturnValue({
      loadSnapshot: vi.fn(),
      upsertNotification: vi.fn(),
      claimEmailDelivery: vi.fn(),
      releaseEmailDelivery: vi.fn(),
    })
    h.runAlertEvaluation.mockResolvedValue({ processed: 3, stale: 0, fired: 2, emailed: 2, deferred: 0, emailFailures: 0, notificationFailures: 0 })
  })

  afterEach(() => {
    if (originalCronSecret === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = originalCronSecret
  })

  it('accepts the Bearer header Vercel Cron actually sends', async () => {
    // The reason this handler exists: Vercel Cron issues GET with
    // `Authorization: Bearer $CRON_SECRET`. The POST handler reads only
    // x-cron-secret, so a cron pointed at it would 405 forever, silently.
    const { GET } = await importRoute()

    const response = await GET(cronRequest('test-cron-secret'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      processed: 3,
      stale: 0,
      fired: 2,
      emailed: 2,
      deferred: 0,
      emailFailures: 0,
      notificationFailures: 0,
    })
    expect(h.runAlertEvaluation).toHaveBeenCalledOnce()
  })

  it('returns 502 when emailFailures is greater than zero, matching the POST handler', async () => {
    h.runAlertEvaluation.mockResolvedValue({
      processed: 3,
      stale: 0,
      fired: 2,
      emailed: 0,
      deferred: 0,
      emailFailures: 2,
      notificationFailures: 0,
    })
    const { GET } = await importRoute()

    const response = await GET(cronRequest('test-cron-secret'))

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({
      processed: 3,
      stale: 0,
      fired: 2,
      emailed: 0,
      deferred: 0,
      emailFailures: 2,
      notificationFailures: 0,
    })
  })

  it('returns 502 when notificationFailures is greater than zero, even with no email failures', async () => {
    h.runAlertEvaluation.mockResolvedValue({
      processed: 3,
      stale: 0,
      fired: 2,
      emailed: 2,
      deferred: 0,
      emailFailures: 0,
      notificationFailures: 2,
    })
    const { GET } = await importRoute()

    const response = await GET(cronRequest('test-cron-secret'))

    expect(response.status).toBe(502)
  })

  it('rejects a missing or wrong Bearer token', async () => {
    const { GET } = await importRoute()

    const wrong = await GET(cronRequest('wrong-secret'))
    const missing = await GET(cronRequest())

    expect(wrong.status).toBe(401)
    expect(missing.status).toBe(401)
    expect(h.db).not.toHaveBeenCalled()
    expect(h.runAlertEvaluation).not.toHaveBeenCalled()
  })

  it('does not accept the POST handler\'s header shape', async () => {
    // Guards against "fixing" this by making GET read either header. Vercel
    // sends Bearer; anything else reaching GET is not the scheduler.
    const { GET } = await importRoute()

    const response = await GET(request('test-cron-secret'))

    expect(response.status).toBe(401)
  })

  it('returns 500 rather than running when CRON_SECRET is unset or too short', async () => {
    // A short secret is a misconfiguration, not a credential. cron/pulse
    // applies the same floor and CLAUDE.md documents it as >= 16 chars.
    const { GET } = await importRoute()
    delete process.env.CRON_SECRET
    const unset = await GET(cronRequest('test-cron-secret'))

    process.env.CRON_SECRET = 'too-short'
    const short = await GET(cronRequest('too-short'))

    expect(unset.status).toBe(500)
    expect(short.status).toBe(500)
    expect(h.runAlertEvaluation).not.toHaveBeenCalled()
  })

  it('composes the same ports the POST handler does', async () => {
    const store = {
      loadSnapshot: vi.fn(),
      upsertNotification: vi.fn(),
      claimEmailDelivery: vi.fn(),
      releaseEmailDelivery: vi.fn(),
    }
    h.createNeonAlertStore.mockReturnValue(store)
    const { GET } = await importRoute()

    await GET(cronRequest('test-cron-secret'))

    expect(h.createNeonAlertStore).toHaveBeenCalledWith('sql')
    expect(h.runAlertEvaluation).toHaveBeenCalledWith({
      ...store,
      sendAlertEmail: h.sendAlertEmail,
    })
  })

  it('returns 502 when every configured client was stale', async () => {
    // Not a partial data gap -- this is "the evaluator ran and could not
    // evaluate anybody", which in practice means the Pulse rollup did not land
    // at all. A 200 here would show green in the Vercel Cron log every Monday
    // while no alert was ever computed.
    h.runAlertEvaluation.mockResolvedValue({
      processed: 3, stale: 3, fired: 0, emailed: 0,
      deferred: 0, emailFailures: 0, notificationFailures: 0,
    })
    const { GET } = await importRoute()

    const response = await GET(cronRequest('test-cron-secret') as never)

    expect(response.status).toBe(502)
  })

  it('stays 200 when only some clients were stale', async () => {
    // One client's rollup lagging is a per-client data gap, not a system fault,
    // and failing the whole cron for it would train people to ignore the alarm.
    // The per-client console.warn in the evaluator is the signal for this case.
    h.runAlertEvaluation.mockResolvedValue({
      processed: 3, stale: 1, fired: 2, emailed: 2,
      deferred: 0, emailFailures: 0, notificationFailures: 0,
    })
    const { GET } = await importRoute()

    const response = await GET(cronRequest('test-cron-secret') as never)

    expect(response.status).toBe(200)
  })

  it('returns 502 when the run was truncated before finishing', async () => {
    h.runAlertEvaluation.mockResolvedValue({
      processed: 400, stale: 0, fired: 300, emailed: 120,
      deferred: 180, emailFailures: 0, notificationFailures: 0,
    })
    const { GET } = await importRoute()

    const response = await GET(cronRequest('test-cron-secret') as never)

    expect(response.status).toBe(502)
  })

  it('stays 200 for an empty run with zero configured clients', async () => {
    // The current production state: zero alert_configs rows, so processed and
    // stale are both 0. Without the `processed > 0` guard, `0 === 0` would
    // make an empty-but-healthy run report 502 forever -- this pins that the
    // guard is actually load-bearing, not just documented as such.
    h.runAlertEvaluation.mockResolvedValue({
      processed: 0, stale: 0, fired: 0, emailed: 0,
      deferred: 0, emailFailures: 0, notificationFailures: 0,
    })
    const { GET } = await importRoute()

    const response = await GET(cronRequest('test-cron-secret') as never)

    expect(response.status).toBe(200)
  })
})
