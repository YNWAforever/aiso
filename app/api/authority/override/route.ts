import { NextRequest, NextResponse } from 'next/server'
import { requireApiAdmin } from '@/lib/admin-guard'
import { db } from '@/lib/db'

const OVERRIDE_TIERS = ['tier1', 'tier2', 'tier3', 'other', 'blacklist']

export async function POST(req: NextRequest) {
  const admin = await requireApiAdmin()
  if (!admin.ok) return admin.response

  let body: {
    domain?: string; overrideTier?: string; overrideScore?: number
    clientId?: string; reason?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { domain, overrideTier, overrideScore, clientId, reason } = body

  if (!domain || !overrideTier) {
    return NextResponse.json({ error: 'domain and overrideTier required' }, { status: 400 })
  }
  if (!OVERRIDE_TIERS.includes(overrideTier)) {
    return NextResponse.json(
      { error: `overrideTier must be one of: ${OVERRIDE_TIERS.join(', ')}` },
      { status: 400 }
    )
  }

  try {
    const sql = db()
    const rows = await sql`
      insert into authority_overrides (domain, override_tier, override_score, client_id, reason)
      values (${domain}, ${overrideTier}, ${overrideScore ?? null}, ${clientId ?? null}, ${reason ?? null})
      returning id
    `
    return NextResponse.json({ id: rows[0]?.id ?? null })
  } catch (err) {
    console.error('authority/override insert error:', err)
    return NextResponse.json({ error: 'failed to save override' }, { status: 500 })
  }
}

export async function GET(_req: NextRequest) {
  const admin = await requireApiAdmin()
  if (!admin.ok) return admin.response

  try {
    const sql = db()
    const rows = await sql`
      select id, client_id, domain, override_tier, override_score, reason, created_at
      from authority_overrides
      order by created_at desc
      limit 200
    `
    return NextResponse.json({ overrides: rows })
  } catch (err) {
    console.error('authority/override list error:', err)
    return NextResponse.json({ error: 'failed to load overrides' }, { status: 500 })
  }
}
