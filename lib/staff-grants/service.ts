import 'server-only'
import { getProfile } from '@/lib/auth'
import { readLimitedJson } from '@/lib/approvals/request'
import { STAFF_GRANT_BODY_LIMIT, parseStaffGrantInput } from './schema'
import { changeStaffGrant, createStaffGrant, listStaffAudit, listStaffGrants } from './store'

/**
 * The gate for every staff-grant route (Studio R3 A2a), in one place.
 *
 * Like lib/members/service.ts there is no account parameter anywhere: the
 * account is the session's, so the only caller-supplied id is a grant id, and
 * the store puts the account inside the statement that uses it. Any active
 * member may grant, renew or revoke (Willy, 2026-11-03); the store re-checks
 * the actor is an active member of the account in the same statement.
 */

const statuses = {
  UNAUTHENTICATED: 401,
  INVALID_STAFF_GRANT: 400,
  STAFF_GRANT_BODY_TOO_LARGE: 413,
  STAFF_NOT_ELIGIBLE: 404,
  STAFF_GRANT_EXISTS: 409,
  STAFF_GRANT_NOT_FOUND: 404,
  STAFF_GRANTS_UNAVAILABLE: 503,
} as const

export type StaffGrantErrorCode = keyof typeof statuses

class StaffGrantError extends Error {
  readonly status: number
  constructor(readonly code: StaffGrantErrorCode) {
    super(code)
    this.status = statuses[code]
  }
}

const headers = { 'Cache-Control': 'no-store' }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function errorResponse(error: unknown): Response {
  if (error instanceof StaffGrantError) return Response.json({ error: error.code }, { status: error.status, headers })
  // Name only: the Neon driver can echo the connection string in a message.
  console.error('[staff-grants] operation failed', { name: error instanceof Error ? error.name : typeof error })
  return Response.json({ error: 'STAFF_GRANTS_UNAVAILABLE' }, { status: 503, headers })
}

/** Outside every try/catch: a session-store outage must not read as "signed out". */
async function member() {
  const profile = await getProfile()
  return profile ? { ok: true as const, profile } : { ok: false as const, response: errorResponse(new StaffGrantError('UNAUTHENTICATED')) }
}

export async function readStaffGrants(): Promise<Response> {
  const auth = await member()
  if (!auth.ok) return auth.response
  try {
    const [grants, audit] = await Promise.all([listStaffGrants(auth.profile.account_id), listStaffAudit(auth.profile.account_id)])
    return Response.json({ grants, audit }, { headers })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function grantStaffAccess(request: Request): Promise<Response> {
  const auth = await member()
  if (!auth.ok) return auth.response
  try {
    let body: unknown
    try {
      body = await readLimitedJson(request, STAFF_GRANT_BODY_LIMIT)
    } catch (error) {
      throw new StaffGrantError(error instanceof Error && error.message === 'APPROVAL_BODY_TOO_LARGE' ? 'STAFF_GRANT_BODY_TOO_LARGE' : 'INVALID_STAFF_GRANT')
    }
    let email: string
    try {
      email = parseStaffGrantInput(body).email
    } catch {
      throw new StaffGrantError('INVALID_STAFF_GRANT')
    }
    const outcome = await createStaffGrant(auth.profile.account_id, auth.profile.id, email)
    // An unknown address and an ineligible one answer alike: this endpoint
    // must not become a way to learn who holds a platform admin flag.
    if (outcome.result === 'not_eligible' || outcome.result === 'not_member') throw new StaffGrantError('STAFF_NOT_ELIGIBLE')
    if (outcome.result === 'exists') throw new StaffGrantError('STAFF_GRANT_EXISTS')
    return Response.json({ id: outcome.id }, { status: 201, headers })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function changeStaffAccess(grantId: string, action: 'renew' | 'revoke'): Promise<Response> {
  const auth = await member()
  if (!auth.ok) return auth.response
  // A malformed id would fail the ::uuid cast and read as an outage; it is simply not found.
  if (!UUID.test(grantId)) return errorResponse(new StaffGrantError('STAFF_GRANT_NOT_FOUND'))
  try {
    const changed = await changeStaffGrant(auth.profile.account_id, auth.profile.id, grantId, action)
    // 404 for "not yours", "already revoked" and "no such id" alike.
    if (!changed) throw new StaffGrantError('STAFF_GRANT_NOT_FOUND')
    return Response.json({ [action === 'renew' ? 'renewed' : 'revoked']: true }, { headers })
  } catch (error) {
    return errorResponse(error)
  }
}
