import { NextRequest, NextResponse } from 'next/server'
import { getProfile } from '@/lib/auth'
import { supabase }   from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// POST /api/dashboard/clients — self-service brand creation
export async function POST(req: NextRequest) {
  const profile = await getProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { brand_name, domain } = await req.json()
  if (!brand_name || typeof brand_name !== 'string') {
    return NextResponse.json({ error: 'brand_name required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('clients')
    .insert({
      brand_name: brand_name.trim(),
      domain: domain?.trim() ?? null,
      account_id: profile.account_id,
      status: 'active',
    })
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: 'Failed to create brand' }, { status: 500 })

  return NextResponse.json({ id: data.id })
}
