import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sendAlertEmail, sendInvitationEmail, sendTrialEmail } from '@/lib/resend'

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

  // `??` falls back only on null/undefined, so a RESEND_FROM_EMAIL that a
  // deploy environment declared without a value produced an empty sender and
  // Resend rejected the send. On the alert path that is invisible until
  // somebody notices alerts stopped arriving.
  it('falls back to the default sender when RESEND_FROM_EMAIL is empty', async () => {
    process.env.RESEND_FROM_EMAIL = ''
    h.send.mockResolvedValue({ data: { id: 'email-1' }, error: null })

    await sendAlertEmail(emailPayload)

    expect(h.send).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'alerts@fimmick-aeo.com' }),
    )
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

describe('sendTrialEmail', () => {
  beforeEach(() => {
    h.send.mockReset()
    process.env.RESEND_API_KEY = 'test-resend-key'
  })

  it('sends with the trial-emails default from-address when unset', async () => {
    delete process.env.RESEND_FROM_EMAIL
    h.send.mockResolvedValue({ data: { id: 'email-1' }, error: null })

    await sendTrialEmail({ to: 'user@example.com', subject: 'Hi', text: 'Body' })

    expect(h.send).toHaveBeenCalledWith({
      from: 'hello@fimmick-aeo.com',
      to: 'user@example.com',
      subject: 'Hi',
      text: 'Body',
    })
  })

  it('honours RESEND_TRIAL_FROM_EMAIL independently of RESEND_FROM_EMAIL', async () => {
    process.env.RESEND_FROM_EMAIL = 'alerts@example.com'
    process.env.RESEND_TRIAL_FROM_EMAIL = 'trial@example.com'
    h.send.mockResolvedValue({ data: { id: 'email-1' }, error: null })

    await sendTrialEmail({ to: 'user@example.com', subject: 'Hi', text: 'Body' })

    expect(h.send).toHaveBeenCalledWith(expect.objectContaining({ from: 'trial@example.com' }))
    delete process.env.RESEND_TRIAL_FROM_EMAIL
  })

  it('rejects when Resend resolves with a provider error object', async () => {
    const providerError = { message: 'Invalid API key', name: 'validation_error' }
    h.send.mockResolvedValue({ data: null, error: providerError })

    let thrown: unknown
    await sendTrialEmail({ to: 'user@example.com', subject: 'Hi', text: 'Body' }).catch(error => {
      thrown = error
    })

    expect(thrown).toBeInstanceOf(Error)
    expect(thrown).toMatchObject({
      message: 'Resend trial email failed',
      cause: providerError,
    })
  })
})

describe('sendInvitationEmail', () => {
  const invitation = {
    to: 'approver@example.com',
    accountName: 'Acme',
    invitedBy: 'Dana',
    locale: 'en' as const,
  }

  beforeEach(() => {
    h.send.mockReset()
    h.send.mockResolvedValue({ error: null })
    process.env.RESEND_API_KEY = 'test-resend-key'
    process.env.RESEND_FROM_EMAIL = 'alerts@example.com'
  })

  const sent = () => h.send.mock.calls[0][0]

  it('falls back to the default sender when RESEND_FROM_EMAIL is empty', async () => {
    // Same trap the alert path hit: `??` keeps '', and an environment that
    // declares the variable without a value produces a sender Resend rejects.
    process.env.RESEND_FROM_EMAIL = ''
    await sendInvitationEmail(invitation)

    expect(sent().from).toBe('alerts@fimmick-aeo.com')
  })

  it('rejects when Resend resolves with a provider error object', async () => {
    h.send.mockResolvedValue({ error: { name: 'validation_error', message: 'bad' } })

    await expect(sendInvitationEmail(invitation)).rejects.toThrow('Resend invitation email failed')
  })

  /**
   * The security property, pinned so that adding one later is a visible edit.
   * There is no accept link and no token: the invitation is consumed by
   * signing in with the invited address, so a forwarded copy grants nothing.
   * A token in this mail would turn a forwarded email into account access.
   */
  it('carries a plain sign-in URL and no token of any kind', async () => {
    await sendInvitationEmail(invitation)

    const body = sent().text as string
    expect(body).toContain('/en/auth/login')
    expect(body).not.toMatch(/token|invite=|[?&][a-z]+=/i)
    // The recipient has to know WHICH address joins them, because using a
    // different one silently starts a separate account.
    expect(body).toContain('approver@example.com')
  })

  it('says, in the mail itself, that another address starts a separate account', async () => {
    await sendInvitationEmail(invitation)

    expect(sent().text as string).toMatch(/different address/i)
  })

  it('writes a different subject and body per locale, not just a different subject', async () => {
    await sendInvitationEmail(invitation)
    const english = sent()
    h.send.mockReset()
    h.send.mockResolvedValue({ error: null })
    await sendInvitationEmail({ ...invitation, locale: 'zh-HK' })
    const chinese = sent()

    expect(chinese.subject).not.toBe(english.subject)
    expect(chinese.text).not.toBe(english.text)
    expect(chinese.text as string).toContain('/zh-HK/auth/login')
  })

  it('names the workspace and the inviter when it knows them, and copes when it does not', async () => {
    await sendInvitationEmail(invitation)
    expect(sent().subject as string).toContain('Dana')
    expect(sent().subject as string).toContain('Acme')

    h.send.mockReset()
    h.send.mockResolvedValue({ error: null })
    await sendInvitationEmail({ ...invitation, accountName: null, invitedBy: null })

    // No "null invited you to null" — both sides have a stated fallback.
    expect(sent().subject as string).not.toContain('null')
    expect(sent().text as string).not.toContain('null')
  })
})
