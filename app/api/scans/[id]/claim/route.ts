import { NextRequest, NextResponse } from 'next/server'
import { getProfile } from '@/lib/auth'
import { supabase }   from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// POST /api/scans/:id/claim — links an anonymous scan to the logged-in user's account
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const profile = await getProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { error } = await supabase
    .from('scans')
    .update({ account_id: profile.account_id })
    .eq('id', id)
    .is('account_id', null) // only claim unowned scans

  if (error) return NextResponse.json({ error: 'Failed to claim scan' }, { status: 500 })

  return NextResponse.json({ ok: true })
}
