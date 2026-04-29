import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'

async function requireAdmin() {
  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'unauthorized', status: 401 }
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()
  if (!profile?.is_admin) return { error: 'forbidden', status: 403 }
  return null
}

export async function POST(req: NextRequest) {
  const authErr = await requireAdmin()
  if (authErr) return NextResponse.json({ error: authErr.error }, { status: authErr.status })

  const body = await req.json() as {
    domain?: string; overrideTier?: string; overrideScore?: number
    clientId?: string; reason?: string
  }
  const { domain, overrideTier, overrideScore, clientId, reason } = body

  if (!domain || !overrideTier) {
    return NextResponse.json({ error: 'domain and overrideTier required' }, { status: 400 })
  }

  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('authority_overrides')
    .insert({
      domain,
      override_tier:  overrideTier,
      override_score: overrideScore ?? null,
      client_id:      clientId ?? null,
      reason:         reason ?? null,
    })
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ id: data.id })
}

export async function GET(_req: NextRequest) {
  const authErr = await requireAdmin()
  if (authErr) return NextResponse.json({ error: authErr.error }, { status: authErr.status })

  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('authority_overrides')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ overrides: data ?? [] })
}
