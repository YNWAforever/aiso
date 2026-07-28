import { NextRequest, NextResponse } from 'next/server'
import { getProfile } from '@/lib/auth'
import { db } from '@/lib/db'

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

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const profile = await getProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const result = await claimScanForAccount(id, profile.account_id)
  if (result.status === 'not-found') return NextResponse.json({ error: 'Scan not found' }, { status: 404 })
  if (result.status === 'conflict') return NextResponse.json({ error: 'Scan belongs to another account' }, { status: 409 })
  if (result.status === 'error') return NextResponse.json({ error: 'Failed to claim scan' }, { status: 500 })
  return NextResponse.json({ ok: true, alreadyOwned: result.status === 'already-owned' })
}
