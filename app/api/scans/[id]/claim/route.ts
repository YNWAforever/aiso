import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getProfile } from '@/lib/auth'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export type ScanClaimResult = { status: 'claimed' | 'already-owned' | 'not-found' | 'conflict' | 'error' }
type ScanClaimClient = Pick<SupabaseClient, 'from'>

export async function claimScanForAccount(client: ScanClaimClient, scanId: string, accountId: string): Promise<ScanClaimResult> {
  const readScan = () => client.from('scans').select('id, account_id').eq('id', scanId).maybeSingle()
  const { data: scan, error: readError } = await readScan()
  if (readError) return { status: 'error' }
  if (!scan) return { status: 'not-found' }
  if (scan.account_id === accountId) return { status: 'already-owned' }
  if (scan.account_id !== null) return { status: 'conflict' }

  const { data: claimed, error: claimError } = await client.from('scans')
    .update({ account_id: accountId })
    .eq('id', scanId)
    .is('account_id', null)
    .select('id, account_id').maybeSingle()
  if (claimError) return { status: 'error' }
  if (claimed?.account_id === accountId) return { status: 'claimed' }

  const { data: current, error: currentError } = await readScan()
  if (currentError) return { status: 'error' }
  if (!current) return { status: 'not-found' }
  if (current.account_id === accountId) return { status: 'already-owned' }
  if (current.account_id !== null) return { status: 'conflict' }
  return { status: 'error' }
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const profile = await getProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const result = await claimScanForAccount(supabase, id, profile.account_id)
  if (result.status === 'not-found') return NextResponse.json({ error: 'Scan not found' }, { status: 404 })
  if (result.status === 'conflict') return NextResponse.json({ error: 'Scan belongs to another account' }, { status: 409 })
  if (result.status === 'error') return NextResponse.json({ error: 'Failed to claim scan' }, { status: 500 })
  return NextResponse.json({ ok: true, alreadyOwned: result.status === 'already-owned' })
}
