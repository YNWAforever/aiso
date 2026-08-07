import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  createClient: vi.fn(),
  runAlertEvaluation: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: h.createClient,
}))

vi.mock('@/lib/alerts/evaluate', () => ({
  runAlertEvaluation: h.runAlertEvaluation,
}))

function makeSupabaseStub() {
  return {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      or: vi.fn().mockResolvedValue({ data: [], error: null }),
    })),
  }
}

function makeRequest(secret?: string) {
  return new Request('http://localhost/api/cron/evaluate-alerts', {
    method: 'POST',
    headers: secret ? { 'x-cron-secret': secret } : undefined,
  })
}

describe('POST /api/cron/evaluate-alerts', () => {
  beforeEach(() => {
    vi.resetModules()
    h.createClient.mockReset()
    h.runAlertEvaluation.mockReset()

    process.env.CRON_SECRET = 'test-cron-secret'
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'

    h.createClient.mockReturnValue(makeSupabaseStub())
  })

  it('returns 500 when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET

    const { POST } = await import('@/app/api/cron/evaluate-alerts/route')
    const response = await POST(makeRequest())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Cron not configured' })
    expect(h.createClient).not.toHaveBeenCalled()
    expect(h.runAlertEvaluation).not.toHaveBeenCalled()
  })

  it('returns 401 when x-cron-secret header is missing', async () => {
    const { POST } = await import('@/app/api/cron/evaluate-alerts/route')
    const response = await POST(makeRequest())

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(h.createClient).not.toHaveBeenCalled()
    expect(h.runAlertEvaluation).not.toHaveBeenCalled()
  })

  it('returns 401 when x-cron-secret header is wrong', async () => {
    const { POST } = await import('@/app/api/cron/evaluate-alerts/route')
    const response = await POST(makeRequest('wrong-secret'))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(h.createClient).not.toHaveBeenCalled()
    expect(h.runAlertEvaluation).not.toHaveBeenCalled()
  })

  it('delegates to the evaluator and returns its result for valid auth', async () => {
    h.runAlertEvaluation.mockResolvedValue({ processed: 1, fired: 1 })

    const { POST } = await import('@/app/api/cron/evaluate-alerts/route')
    const response = await POST(makeRequest('test-cron-secret'))

    expect(h.createClient).toHaveBeenCalledWith(
      'https://test.supabase.co',
      'test-service-role-key',
    )
    expect(h.runAlertEvaluation).toHaveBeenCalledTimes(1)
    expect(h.runAlertEvaluation).toHaveBeenCalledWith(expect.objectContaining({
      loadSnapshot: expect.any(Function),
      upsertNotification: expect.any(Function),
      sendAlertEmail: expect.any(Function),
    }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ processed: 1, fired: 1 })
  })
})
