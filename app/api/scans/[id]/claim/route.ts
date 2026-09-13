import { NextRequest, NextResponse } from 'next/server'
import { getProfile } from '@/lib/auth'
import { db } from '@/lib/db'
import { CLAIM_INTENT_COOKIE, authorizedScanClaimIntent } from '@/lib/security/scan-claim-intent'
import { consumeScanClaimAttempt } from '@/lib/security/scan-claim-attempt'

export const dynamic = 'force-dynamic'

export type ScanClaimResult = { status: 'claimed' | 'already-owned' | 'not-found' | 'conflict' | 'error' }

// Race-safe: the UPDATE's WHERE clause is re-evaluated against the committed
// row under lock, so of two concurrent claims for the same unowned scan only
// one UPDATE can ever match — the loser falls through to the re-read below
// and reports 'already-owned' (same account) or 'conflict' (different one).
export async function claimScanForAccount(scanId: string, accountId: string): Promise<ScanClaimResult> {
  try {
    const sql = db()
    const claimed = await sql`
      update scans set account_id = ${accountId}
      where id = ${scanId} and account_id is null
      returning id
    `
    if (claimed.length > 0) return { status: 'claimed' }

    // Nothing updated: classify why.
    const rows = await sql`select account_id from scans where id = ${scanId} limit 1`
    if (!rows[0]) return { status: 'not-found' }
    if (rows[0].account_id === accountId) return { status: 'already-owned' }
    return { status: 'conflict' }
  } catch {
    return { status: 'error' }
  }
}

function claimUnavailable() {
  return NextResponse.json({ error: 'Claim unavailable' }, { status: 403 })
}

function claimResponse(result: ScanClaimResult) {
  const response = result.status === 'not-found'
    ? NextResponse.json({ error: 'Scan not found' }, { status: 404 })
    : result.status === 'conflict'
      ? NextResponse.json({ error: 'Scan belongs to another account' }, { status: 409 })
      : NextResponse.json({ ok: true, alreadyOwned: result.status === 'already-owned' })
  response.cookies.delete(CLAIM_INTENT_COOKIE)
  return response
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  // getProfile() THROWS when the auth dependency is unavailable — an empty
  // NEON_AUTH_COOKIE_SECRET is enough to do it — and an unhandled throw here
  // produced a bare 500 with an empty body, which tells the caller nothing and
  // reads like a fault in their request. A missing session and a missing auth
  // service are different facts and get different answers.
  let profile: Awaited<ReturnType<typeof getProfile>>
  try {
    profile = await getProfile()
  } catch {
    return NextResponse.json({ error: 'Claim unavailable' }, { status: 503 })
  }
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Mandatory, not conditional. This check used to run only `if (token)`, so
  // omitting the cookie skipped it entirely and any authenticated session could
  // claim any unowned scan id. isAuthorizedScanClaim treats an absent token as a
  // denial and swallows its own verification failures, so a misconfigured deploy
  // degrades to claimUnavailable() rather than crashing.
  const intent = authorizedScanClaimIntent(req.cookies.get(CLAIM_INTENT_COOKIE)?.value, id)
  if (!intent) return claimUnavailable()

  // Single-use (AC-03). Verifying proved the cookie is ours; it never proved
  // this was the first presentation of it, so an intercepted copy claimed the
  // scan again on every replay inside its 15-minute window. Spend the attempt
  // BEFORE the effect — that is what single-use means — and fail closed if it
  // cannot be recorded, because allowing an unrecorded claim through is the
  // one outcome this must never produce.
  let attempt: Awaited<ReturnType<typeof consumeScanClaimAttempt>>
  try {
    attempt = await consumeScanClaimAttempt(intent.attemptId, id)
  } catch {
    return NextResponse.json({ error: 'Claim unavailable' }, { status: 503 })
  }
  // Same opaque answer as an unverifiable token: a replayed intent must not be
  // distinguishable from a forged one, and neither from a malformed one.
  if (attempt !== 'consumed') return claimUnavailable()

  const result = await claimScanForAccount(id, profile.account_id)
  if (result.status === 'error') return NextResponse.json({ error: 'Failed to claim scan' }, { status: 500 })
  return claimResponse(result)
}
