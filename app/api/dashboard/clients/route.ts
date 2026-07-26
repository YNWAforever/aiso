import { NextRequest, NextResponse } from 'next/server'
import { getProfile } from '@/lib/auth'
import { db } from '@/lib/db'
import { resolveCommercialEntitlement } from '@/lib/tier'

export const dynamic = 'force-dynamic'

// POST /api/dashboard/clients — self-service brand creation
export async function POST(req: NextRequest) {
  const profile = await getProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const entitlement = resolveCommercialEntitlement(profile.accounts)
  const { plan } = entitlement
  const limit = entitlement.features.max_brands

  const body = await req.json()
  const { brand_name, domain, industry, competitors } = body

  if (!brand_name || typeof brand_name !== 'string') {
    return NextResponse.json({ error: 'brand_name required' }, { status: 400 })
  }

  const sql = db()

  try {
    // Application-level check for a clear error before hitting the database.
    // The check_brand_limit() trigger is the authority and catches the race.
    const counted = await sql`
      select count(*)::int as n from clients where account_id = ${profile.account_id}
    `
    if ((counted[0]?.n ?? 0) >= limit) {
      return NextResponse.json({ error: 'BRAND_LIMIT_REACHED', plan, limit }, { status: 403 })
    }

    // clients.competitors is text[], not jsonb — pass the array straight
    // through and let the driver serialize it as a Postgres array literal.
    const rows = await sql`
      insert into clients (brand_name, domain, industry, competitors, account_id, status)
      values (
        ${brand_name.trim()},
        ${domain?.trim() ?? null},
        ${industry ?? null},
        ${(Array.isArray(competitors) ? competitors : []) as string[]}::text[],
        ${profile.account_id},
        'active'
      )
      returning id
    `
    return NextResponse.json({ id: rows[0].id })
  } catch (err) {
    // Neon throws where supabase-js resolved { data, error }. The trigger raises
    // BRAND_LIMIT_REACHED when a concurrent request won the race.
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('BRAND_LIMIT_REACHED')) {
      return NextResponse.json({ error: 'BRAND_LIMIT_REACHED', plan, limit }, { status: 403 })
    }
    console.error('Brand creation failed:', message.replace(/postgresql:\/\/\S+/g, '[redacted]'))
    return NextResponse.json({ error: 'Failed to create brand' }, { status: 500 })
  }
}
