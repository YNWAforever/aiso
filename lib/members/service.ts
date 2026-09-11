import 'server-only'
import { getProfile } from '@/lib/auth'
import { readLimitedJson } from '@/lib/approvals/request'
import { sendInvitationEmail } from '@/lib/resend'
import {
  consumeInvitationRateLimit,
  invitationRateLimitHeaders,
} from '@/lib/security/invitation-rate-limit'
import { INVITATION_BODY_LIMIT, MAX_ACCOUNT_MEMBERS, normalizeInvitationInput } from './schema'
import { createInvitation, loadAccountMembers, revokeInvitation } from './store'

/**
 * The gate for every members route, in one place so a route cannot ship with
 * two thirds of it.
 *
 * There is no entitlement step, unlike lib/localTrust/guard.ts. Membership is
 * not a paid feature, and gating it would make separation of duties — which
 * AC-08 asks of every account — something only some plans could satisfy. What
 * stands in its place is a cap plus a rate limit, because the endpoint sends
 * mail to an address the caller chose.
 *
 * There is no ownership step either, and that absence is the point:
 * `account_id` is read from the session and never from the request, so there
 * is no caller-supplied id to verify. These routes take no account parameter
 * at all, which is the strongest form the check can take.
 */

const statuses = {
  UNAUTHENTICATED: 401,
  INVALID_INVITATION_INPUT: 400,
  INVITATION_BODY_TOO_LARGE: 413,
  INVITATION_RATE_LIMITED: 429,
  MEMBER_ALREADY_IN_ACCOUNT: 409,
  INVITATION_ALREADY_PENDING: 409,
  EMAIL_ALREADY_REGISTERED: 409,
  MEMBER_LIMIT_REACHED: 403,
  INVITATION_DENIED: 403,
  INVITATION_NOT_FOUND: 404,
  MEMBERS_UNAVAILABLE: 503,
} as const

export class MemberServiceError extends Error {
  readonly status: number
  constructor(readonly code: keyof typeof statuses, readonly extraHeaders?: Headers) {
    super(code)
    this.name = 'MemberServiceError'
    this.status = statuses[code]
  }
}

const headers = { 'Cache-Control': 'no-store' }

function errorResponse(error: unknown): Response {
  if (error instanceof MemberServiceError) {
    const response = Response.json({ error: error.code }, { status: error.status, headers })
    error.extraHeaders?.forEach((value, key) => response.headers.set(key, value))
    return response
  }
  // Anything else is a dependency failing, not a caller mistake. 503 rather
  // than a 200 with an empty list: "no members" and "we could not look" must
  // never render the same.
  console.error('[members] operation failed:', (error as Error)?.message ?? String(error))
  return Response.json({ error: 'MEMBERS_UNAVAILABLE' }, { status: 503, headers })
}

/**
 * The session lookup is deliberately OUTSIDE every try/catch below.
 * getProfile() throws when the session store itself is unavailable, and
 * flattening that into a 401 would tell a signed-in member they are signed out
 * during an outage — the failure lib/admin-guard.ts names as well. Only the
 * "no session" case becomes a response here.
 */
async function member(): Promise<
  { ok: true; profile: Awaited<ReturnType<typeof getProfile>> & object } | { ok: false; response: Response }
> {
  const profile = await getProfile()
  if (!profile) return { ok: false, response: errorResponse(new MemberServiceError('UNAUTHENTICATED')) }
  return { ok: true, profile }
}

export async function readMembersPage(): Promise<Response> {
  const auth = await member()
  if (!auth.ok) return auth.response

  try {
    const page = await loadAccountMembers(auth.profile.account_id)
    return Response.json({ ...page, self: auth.profile.id, limit: MAX_ACCOUNT_MEMBERS }, { headers })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function inviteAccountMember(request: Request): Promise<Response> {
  const auth = await member()
  if (!auth.ok) return auth.response

  try {
    let body: unknown
    try {
      body = await readLimitedJson(request, INVITATION_BODY_LIMIT)
    } catch (error) {
      // readLimitedJson is shared with the approvals routes and speaks their
      // vocabulary; translate rather than duplicate a careful byte-counting
      // reader that never trusts Content-Length.
      const code = error instanceof Error ? error.message : ''
      throw new MemberServiceError(
        code === 'APPROVAL_BODY_TOO_LARGE' ? 'INVITATION_BODY_TOO_LARGE' : 'INVALID_INVITATION_INPUT',
      )
    }

    let input: ReturnType<typeof normalizeInvitationInput>
    try {
      input = normalizeInvitationInput(body)
    } catch {
      throw new MemberServiceError('INVALID_INVITATION_INPUT')
    }

    // Before the write and before the send, so a refused caller costs one
    // counter increment rather than a row and a mail.
    const decision = await consumeInvitationRateLimit(auth.profile.account_id)
    if (!decision.allowed) {
      throw new MemberServiceError('INVITATION_RATE_LIMITED', invitationRateLimitHeaders(decision))
    }

    const result = await createInvitation({
      accountId: auth.profile.account_id,
      invitedBy: auth.profile.id,
      email: input.email,
    })
    if (result.kind !== 'created') {
      throw new MemberServiceError(({
        already_member: 'MEMBER_ALREADY_IN_ACCOUNT',
        duplicate: 'INVITATION_ALREADY_PENDING',
        already_registered: 'EMAIL_ALREADY_REGISTERED',
        limit_reached: 'MEMBER_LIMIT_REACHED',
        denied: 'INVITATION_DENIED',
      } as const)[result.kind])
    }

    // The mail is a notification, not the mechanism — the invitation is
    // consumed by signing in with the address, so a failed send still leaves a
    // usable invitation. Report it rather than unwinding the row, and never
    // let it turn a successful write into an error the member would read as
    // "no invitation was created".
    let emailed = true
    try {
      await sendInvitationEmail({
        to: result.invitation.email,
        accountName: null,
        invitedBy: auth.profile.display_name ?? null,
        locale: input.locale,
      })
    } catch (error) {
      emailed = false
      console.error('[members] invitation email failed:', (error as Error)?.message ?? String(error))
    }

    return Response.json({ invitation: result.invitation, emailed }, { status: 201, headers })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function revokeAccountInvitation(invitationId: string): Promise<Response> {
  const auth = await member()
  if (!auth.ok) return auth.response

  try {
    const revoked = await revokeInvitation({
      accountId: auth.profile.account_id,
      invitationId,
      revokedBy: auth.profile.id,
    })
    // 404 for "not yours", "already decided" and "no such id" alike. The id
    // came from the caller, so a 403 would confirm it belongs to somebody.
    if (!revoked) throw new MemberServiceError('INVITATION_NOT_FOUND')
    return Response.json({ revoked: true }, { headers })
  } catch (error) {
    if (error instanceof Error && error.message === 'INVALID_INVITATION_INPUT') {
      return errorResponse(new MemberServiceError('INVALID_INVITATION_INPUT'))
    }
    return errorResponse(error)
  }
}
