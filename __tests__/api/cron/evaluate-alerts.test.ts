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

describe('POST /api/cron/evaluate-alerts', () => {
  const originalCronSecret = process.env.CRON_SECRET

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'test-cron-secret'
    h.db.mockReturnValue('sql')
    h.createNeonAlertStore.mockReturnValue({
      loadSnapshot: vi.fn(),
      upsertNotification: vi.fn(),
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

    const response = await POST(request('wrong-secret'))

    expect(response.status).toBe(401)
    expect(h.db).not.toHaveBeenCalled()
    expect(h.runAlertEvaluation).not.toHaveBeenCalled()
  })

  it('composes Neon storage and Resend after authentication', async () => {
    const store = {
      loadSnapshot: vi.fn(),
      upsertNotification: vi.fn(),
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
