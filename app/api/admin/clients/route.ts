import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { createServiceSupabaseClient } from '@/lib/supabase-server'

export async function GET() {
  await requireAdmin()
  const supabase = await createServiceSupabaseClient()

  const { data, error } = await supabase
    .from('accounts')
    .select('*, clients(id, brand_name, status), profiles(display_name)')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  await requireAdmin()
  const { accountId, plan } = await req.json()
  if (!['starter', 'pro', 'enterprise'].includes(plan)) {
    return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
  }

  const supabase = await createServiceSupabaseClient()
  const { error } = await supabase
    .from('accounts')
    .update({ plan })
    .eq('id', accountId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
