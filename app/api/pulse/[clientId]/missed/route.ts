import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getProfile } from '@/lib/auth'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

// There is no RLS in effect — every caller-supplied clientId must be proven to
// belong to the caller's account before any data is read. Fails closed on error.
async function ownsClient(clientId: string, accountId: string): Promise<boolean> {
  try {
    const sql = db()
    const rows = await sql`
      select id from clients
      where id = ${clientId} and account_id = ${accountId}
      limit 1
    `
    return rows.length > 0
  } catch {
    return false
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const { clientId } = await params

  const profile = await getProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 404 rather than 403 so the endpoint does not leak which clientIds exist
  if (!await ownsClient(clientId, profile.account_id))
    return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data, error } = await supabase
    .from('pulse_metrics')
    .select('platform, question, competitors_mentioned, scan_week')
    .eq('client_id', clientId)
    .eq('brand_mentioned', false)
    .order('scan_week', { ascending: false })
    .limit(50)

  if (error) return NextResponse.json({ error: 'DB error' }, { status: 500 })
  return NextResponse.json(data)
}
