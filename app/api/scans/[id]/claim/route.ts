import { NextRequest, NextResponse } from 'next/server'
import { getProfile } from '@/lib/auth'
import { db } from '@/lib/db'
import { CLAIM_INTENT_COOKIE, verifyScanClaimIntent } from '@/lib/security/scan-claim-intent'

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
  const profile = await getProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const token = req.cookies.get(CLAIM_INTENT_COOKIE)?.value
  if (token) {
    const intent = verifyScanClaimIntent(token)
    const expectedReturnPath = intent ? `/${intent.lang}/result/${encodeURIComponent(id)}?claim=1` : ''
    if (!intent || intent.scanId !== id || intent.returnPath !== expectedReturnPath) return claimUnavailable()
  }

  const result = await claimScanForAccount(id, profile.account_id)
  if (result.status === 'error') return NextResponse.json({ error: 'Failed to claim scan' }, { status: 500 })
  return claimResponse(result)
}
