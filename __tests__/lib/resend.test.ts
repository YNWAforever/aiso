import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sendAlertEmail } from '@/lib/resend'

const h = vi.hoisted(() => ({
  send: vi.fn(),
}))

vi.mock('resend', () => ({
  Resend: class MockResend {
    emails = {
      send: h.send,
    }
  },
}))

const emailPayload = {
  to: 'owner@example.com',
  brandName: 'Acme',
  type: 'sov_threshold' as const,
  currentSov: 40,
  previousSov: 55,
  threshold: 50,
  dashboardUrl: 'https://app.example/en/dashboard/client-1',
}

describe('sendAlertEmail', () => {
  beforeEach(() => {
    h.send.mockReset()
    process.env.RESEND_API_KEY = 'test-resend-key'
    process.env.RESEND_FROM_EMAIL = 'alerts@example.com'
  })

  it('preserves successful Resend sends', async () => {
    h.send.mockResolvedValue({ data: { id: 'email-1' }, error: null })

    await expect(sendAlertEmail(emailPayload)).resolves.toBeUndefined()

    expect(h.send).toHaveBeenCalledWith({
      from: 'alerts@example.com',
      to: 'owner@example.com',
      subject: expect.stringContaining('Acme'),
      text: expect.stringContaining('Share of Voice fell below 50%'),
    })
  })

  it('rejects when Resend resolves with a provider error object', async () => {
    const providerError = { message: 'Invalid API key', name: 'validation_error' }
    h.send.mockResolvedValue({ data: null, error: providerError })

    let thrown: unknown
    await sendAlertEmail(emailPayload).catch(error => {
      thrown = error
    })

    expect(thrown).toBeInstanceOf(Error)
    expect(thrown).toMatchObject({
      message: 'Resend alert email failed',
      cause: providerError,
    })
  })
})
