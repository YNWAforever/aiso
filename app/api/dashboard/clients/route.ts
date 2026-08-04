import { NextRequest, NextResponse } from 'next/server'
import { getProfile } from '@/lib/auth'
import { supabase }   from '@/lib/supabase'
import { resolveCommercialEntitlement } from '@/lib/tier'
import { sanitizeDatabaseError } from '@/lib/observability/database-error'

export const dynamic = 'force-dynamic'

// POST /api/dashboard/clients — self-service brand creation
export async function POST(req: NextRequest) {
  const profile = await getProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const entitlement = resolveCommercialEntitlement(profile.accounts)
  const { plan } = entitlement
  const limit = entitlement.features.max_brands

  // Count existing brands for this account
  const { count } = await supabase
    .from('clients')
    .select('*', { count: 'exact', head: true })
    .eq('account_id', profile.account_id)

  if ((count ?? 0) >= limit) {
    return NextResponse.json(
      { error: 'BRAND_LIMIT_REACHED', plan, limit },
      { status: 403 }
    )
  }

  const body = await req.json()
  const { brand_name, domain, industry, competitors } = body

  if (!brand_name || typeof brand_name !== 'string') {
    return NextResponse.json({ error: 'brand_name required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('clients')
    .insert({
      brand_name:  brand_name.trim(),
      domain:      domain?.trim()     ?? null,
      industry:    industry           ?? null,
      competitors: Array.isArray(competitors) ? competitors : [],
      account_id:  profile.account_id,
      status:      'active',
    })
    .select('id')
    .single()

  if (error) {
    // DB trigger raises BRAND_LIMIT_REACHED if a concurrent request won the race
    if (error.message?.includes('BRAND_LIMIT_REACHED')) {
      return NextResponse.json({ error: 'BRAND_LIMIT_REACHED', plan, limit }, { status: 403 })
    }
    const diagnostic = sanitizeDatabaseError(error, {
      correlationId: crypto.randomUUID(),
      route: '/api/dashboard/clients',
    })
    console.error({
      event: 'brand_create_database_error',
      correlationId: diagnostic.correlationId,
      database: {
        code: diagnostic.code,
        category: diagnostic.category,
      },
    })
    return NextResponse.json({ error: 'Failed to create brand' }, { status: 500 })
  }

  return NextResponse.json({ id: data.id })
}
