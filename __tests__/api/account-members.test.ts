import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The members API surface: who may call it, and what it does with the account
 * id.
 *
 * Everything below the gate is mocked, deliberately — which account a row
 * lands in is proven against real Postgres in
 * __tests__/integration/account-invitations.test.ts, and re-asserting it
 * against a mock would prove only that the mock was told what to say. What
 * this file proves is the part that lives in the route: that an anonymous
 * caller is refused, that the account id comes from the SESSION and never from
 * the request, that a session-store outage does not read as "signed out", and
 * that the rate limiter is consulted before anything is written or mailed.
 *
 * The rate limiter is mocked EXPLICITLY rather than left to its real
 * implementation. CLAUDE.md records why: the funnel-events suite passed
 * through the limiter's fail-open path until someone mocked it, so "the
 * limiter allowed it" and "the limiter was never reached" looked identical.
 */

const mocks = vi.hoisted(() => ({
  getProfile: vi.fn(),
  loadAccountMembers: vi.fn(),
  createInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
  setMemberActive: vi.fn(),
  sendInvitationEmail: vi.fn(),
  consumeInvitationRateLimit: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth', () => ({ getProfile: mocks.getProfile }))
vi.mock('@/lib/members/store', () => ({
  loadAccountMembers: mocks.loadAccountMembers,
  createInvitation: mocks.createInvitation,
  revokeInvitation: mocks.revokeInvitation,
  setMemberActive: mocks.setMemberActive,
}))
vi.mock('@/lib/resend', () => ({ sendInvitationEmail: mocks.sendInvitationEmail }))
vi.mock('@/lib/security/invitation-rate-limit', () => ({
  consumeInvitationRateLimit: mocks.consumeInvitationRateLimit,
  invitationRateLimitHeaders: () => new Headers({ 'RateLimit-Limit': '10' }),
}))

const ACCOUNT = '11111111-1111-4111-8111-111111111111'
const OTHER_ACCOUNT = '99999999-9999-4999-8999-999999999999'
const PROFILE = '22222222-2222-4222-8222-222222222222'
const INVITATION = '33333333-3333-4333-8333-333333333333'
const EMAIL = 'approver@example.com'

const invitation = {
  id: INVITATION,
  email: EMAIL,
  status: 'pending' as const,
  invitedAt: '2026-09-11T00:00:00.000000Z',
  expiresAt: '2026-09-18T00:00:00.000000Z',
}

function signedIn() {
  mocks.getProfile.mockResolvedValue({
    id: PROFILE,
    account_id: ACCOUNT,
    display_name: 'Owner',
    is_admin: false,
    email: 'owner@example.com',
    accounts: { id: ACCOUNT, plan: 'basic', status: 'active' },
  })
}

function inviteRequest(body: unknown, url = 'http://localhost/api/account/invitations') {
  return new Request(url, {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getProfile.mockResolvedValue(null)
  mocks.consumeInvitationRateLimit.mockResolvedValue({ allowed: true, remaining: 9, resetAt: 0 })
  mocks.loadAccountMembers.mockResolvedValue({ members: [], invitations: [] })
  mocks.createInvitation.mockResolvedValue({ kind: 'created', invitation })
  mocks.revokeInvitation.mockResolvedValue(true)
  mocks.setMemberActive.mockResolvedValue('updated')
  mocks.sendInvitationEmail.mockResolvedValue(undefined)
})

describe('GET /api/account/members', () => {
  it('refuses an anonymous caller', async () => {
    const { GET } = await import('@/app/api/account/members/route')

    const response = await GET()

    expect(response.status).toBe(401)
    expect(mocks.loadAccountMembers).not.toHaveBeenCalled()
  })

  it('reads the account from the session, never from the query string', async () => {
    signedIn()
    const { GET } = await import('@/app/api/account/members/route')

    await GET()

    expect(mocks.loadAccountMembers).toHaveBeenCalledWith(ACCOUNT)
    expect(mocks.loadAccountMembers).not.toHaveBeenCalledWith(OTHER_ACCOUNT)
  })

  it('names the caller so the surface can mark which member is you', async () => {
    signedIn()
    mocks.loadAccountMembers.mockResolvedValue({
      members: [
        { profileId: PROFILE, displayName: 'Owner', approver: false, joinedAt: '2026-09-01T00:00:00.000000Z' },
      ],
      invitations: [],
    })
    const { GET } = await import('@/app/api/account/members/route')

    const body = await (await GET()).json()

    expect(body.self).toBe(PROFILE)
    expect(body.members).toHaveLength(1)
  })

  /**
   * getProfile() throws when the session store itself is unavailable. Catching
   * that and answering 401 would tell a signed-in member they are signed out
   * during an outage, which is the failure lib/admin-guard.ts names too.
   */
  it('lets a session-store outage surface as 500 rather than 401', async () => {
    mocks.getProfile.mockRejectedValue(new Error('session store unreachable'))
    const { GET } = await import('@/app/api/account/members/route')

    await expect(GET()).rejects.toThrow('session store unreachable')
  })
})

describe('POST /api/account/invitations', () => {
  it('refuses an anonymous caller before consuming any allowance', async () => {
    const { POST } = await import('@/app/api/account/invitations/route')

    const response = await POST(inviteRequest({ email: EMAIL, locale: 'en' }))

    expect(response.status).toBe(401)
    expect(mocks.consumeInvitationRateLimit).not.toHaveBeenCalled()
    expect(mocks.createInvitation).not.toHaveBeenCalled()
  })

  it('creates the invitation against the session account and mails the address', async () => {
    signedIn()
    const { POST } = await import('@/app/api/account/invitations/route')

    const response = await POST(inviteRequest({ email: 'Approver@Example.com', locale: 'en' }))

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ invitation, emailed: true })
    expect(mocks.createInvitation).toHaveBeenCalledWith({
      accountId: ACCOUNT,
      invitedBy: PROFILE,
      email: EMAIL,
    })
    expect(mocks.sendInvitationEmail).toHaveBeenCalledTimes(1)
    expect(mocks.sendInvitationEmail.mock.calls[0][0]).toMatchObject({ to: EMAIL, locale: 'en' })
  })

  it('rejects a body that is not a valid invitation', async () => {
    signedIn()
    const { POST } = await import('@/app/api/account/invitations/route')

    const response = await POST(inviteRequest({ email: 'not-an-address', locale: 'en' }))

    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('INVALID_INVITATION_INPUT')
    expect(mocks.createInvitation).not.toHaveBeenCalled()
  })

  /**
   * An invitation sends mail to an address the caller chose, so an uncapped
   * endpoint is a relay with someone else's `from`. The limiter must therefore
   * be consulted before the write, not after it.
   */
  it('refuses once the account has spent its allowance, writing and mailing nothing', async () => {
    signedIn()
    mocks.consumeInvitationRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetAt: 0 })
    const { POST } = await import('@/app/api/account/invitations/route')

    const response = await POST(inviteRequest({ email: EMAIL, locale: 'en' }))

    expect(response.status).toBe(429)
    expect(mocks.createInvitation).not.toHaveBeenCalled()
    expect(mocks.sendInvitationEmail).not.toHaveBeenCalled()
  })

  it('keys the allowance to the account, so one account cannot spend another one', async () => {
    signedIn()
    const { POST } = await import('@/app/api/account/invitations/route')

    await POST(inviteRequest({ email: EMAIL, locale: 'en' }))

    expect(mocks.consumeInvitationRateLimit).toHaveBeenCalledWith(ACCOUNT)
  })

  it.each([
    ['already_member', 409, 'MEMBER_ALREADY_IN_ACCOUNT'],
    ['duplicate', 409, 'INVITATION_ALREADY_PENDING'],
    ['already_registered', 409, 'EMAIL_ALREADY_REGISTERED'],
    ['limit_reached', 403, 'MEMBER_LIMIT_REACHED'],
    ['denied', 403, 'INVITATION_DENIED'],
  ])('maps a %s refusal to %i and mails nothing', async (kind, status, code) => {
    signedIn()
    mocks.createInvitation.mockResolvedValue({ kind })
    const { POST } = await import('@/app/api/account/invitations/route')

    const response = await POST(inviteRequest({ email: EMAIL, locale: 'en' }))

    expect(response.status).toBe(status)
    expect((await response.json()).error).toBe(code)
    expect(mocks.sendInvitationEmail).not.toHaveBeenCalled()
  })

  /**
   * The invitation is consumed by signing in with the invited address, not by
   * clicking anything, so the mail is a notification rather than the
   * mechanism. A failed send therefore does not invalidate the invitation —
   * but it must be reported, or the member would believe someone had been
   * told when nobody had.
   */
  it('still reports the invitation when the mail could not be sent, and says so', async () => {
    signedIn()
    mocks.sendInvitationEmail.mockRejectedValue(new Error('Resend invitation email failed'))
    const { POST } = await import('@/app/api/account/invitations/route')

    const response = await POST(inviteRequest({ email: EMAIL, locale: 'en' }))

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ invitation, emailed: false })
  })

  it('rejects a body larger than the limit', async () => {
    signedIn()
    const { INVITATION_BODY_LIMIT } = await import('@/lib/members/schema')
    const { POST } = await import('@/app/api/account/invitations/route')

    const response = await POST(inviteRequest('x'.repeat(INVITATION_BODY_LIMIT + 1)))

    expect(response.status).toBe(413)
    expect(mocks.createInvitation).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/account/invitations/[invitationId]', () => {
  function context(invitationId = INVITATION) {
    return { params: Promise.resolve({ invitationId }) }
  }

  it('refuses an anonymous caller', async () => {
    const { DELETE } = await import('@/app/api/account/invitations/[invitationId]/route')

    const response = await DELETE(new Request('http://localhost'), context())

    expect(response.status).toBe(401)
    expect(mocks.revokeInvitation).not.toHaveBeenCalled()
  })

  it('revokes against the session account and names the caller as the actor', async () => {
    signedIn()
    const { DELETE } = await import('@/app/api/account/invitations/[invitationId]/route')

    const response = await DELETE(new Request('http://localhost'), context())

    expect(response.status).toBe(200)
    expect(mocks.revokeInvitation).toHaveBeenCalledWith({
      accountId: ACCOUNT,
      invitationId: INVITATION,
      revokedBy: PROFILE,
    })
  })

  /**
   * 404, not 403. The id came from the caller, so confirming it exists
   * somewhere would tell them it belongs to somebody.
   */
  it('answers 404 when the invitation is not this account', async () => {
    signedIn()
    mocks.revokeInvitation.mockResolvedValue(false)
    const { DELETE } = await import('@/app/api/account/invitations/[invitationId]/route')

    const response = await DELETE(new Request('http://localhost'), context())

    expect(response.status).toBe(404)
  })

  it('answers 400 for an id that is not a uuid', async () => {
    signedIn()
    mocks.revokeInvitation.mockRejectedValue(new Error('INVALID_INVITATION_INPUT'))
    const { DELETE } = await import('@/app/api/account/invitations/[invitationId]/route')

    const response = await DELETE(new Request('http://localhost'), context('not-a-uuid'))

    expect(response.status).toBe(400)
  })
})

describe('PATCH /api/account/members/[profileId]', () => {
  const MEMBER = '44444444-4444-4444-4444-444444444444'
  const context = (profileId = MEMBER) => ({ params: Promise.resolve({ profileId }) })
  const body = (value: unknown) =>
    new Request('http://localhost/api/account/members/x', {
      method: 'PATCH',
      body: JSON.stringify(value),
      headers: { 'Content-Type': 'application/json' },
    })

  it('refuses an anonymous caller', async () => {
    const { PATCH } = await import('@/app/api/account/members/[profileId]/route')

    const response = await PATCH(body({ active: false }), context())

    expect(response.status).toBe(401)
    expect(mocks.setMemberActive).not.toHaveBeenCalled()
  })

  it('removes against the session account and names the caller as the actor', async () => {
    signedIn()
    const { PATCH } = await import('@/app/api/account/members/[profileId]/route')

    const response = await PATCH(body({ active: false }), context())

    expect(response.status).toBe(200)
    expect(mocks.setMemberActive).toHaveBeenCalledWith({
      accountId: ACCOUNT, profileId: MEMBER, actorId: PROFILE, active: false,
    })
  })

  it('is idempotent: an unchanged state is still a success', async () => {
    signedIn()
    mocks.setMemberActive.mockResolvedValue('unchanged')
    const { PATCH } = await import('@/app/api/account/members/[profileId]/route')

    expect((await PATCH(body({ active: false }), context())).status).toBe(200)
  })

  it('refuses a caller removing themselves, with a reason they can act on', async () => {
    signedIn()
    mocks.setMemberActive.mockResolvedValue('self')
    const { PATCH } = await import('@/app/api/account/members/[profileId]/route')

    const response = await PATCH(body({ active: false }), context())

    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe('MEMBER_CANNOT_REMOVE_SELF')
  })

  it('answers 404 for somebody who is not in this account', async () => {
    signedIn()
    mocks.setMemberActive.mockResolvedValue('not_found')
    const { PATCH } = await import('@/app/api/account/members/[profileId]/route')

    expect((await PATCH(body({ active: false }), context())).status).toBe(404)
  })

  it.each([
    ['a missing field', {}],
    ['a non-boolean', { active: 'no' }],
    ['an extra key', { active: false, reason: 'x' }],
  ])('rejects %s without reaching the store', async (_label, value) => {
    signedIn()
    const { PATCH } = await import('@/app/api/account/members/[profileId]/route')

    const response = await PATCH(body(value), context())

    expect(response.status).toBe(400)
    expect(mocks.setMemberActive).not.toHaveBeenCalled()
  })
})
