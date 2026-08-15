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
    h.runAlertEvaluation.mockResolvedValue({ processed: 3, fired: 2 })
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
    await expect(response.json()).resolves.toEqual({ processed: 3, fired: 2 })
    expect(h.db).toHaveBeenCalledOnce()
    expect(h.createNeonAlertStore).toHaveBeenCalledWith('sql')
    expect(h.runAlertEvaluation).toHaveBeenCalledWith({
      ...store,
      sendAlertEmail: h.sendAlertEmail,
    })
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
    h.runAlertEvaluation.mockResolvedValue({ processed: 3, fired: 2 })
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
    await expect(response.json()).resolves.toEqual({ processed: 3, fired: 2 })
    expect(h.runAlertEvaluation).toHaveBeenCalledOnce()
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
})
