import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { createServiceSupabaseClient } from '@/lib/supabase-server'
import { requireApiAdmin } from '@/lib/admin-guard'
import { db } from '@/lib/db'
import { resolveCommercialEntitlement } from '@/lib/tier'

export const dynamic = 'force-dynamic'

type AccountQueryRow = {
  id: string
  plan: string
  status: string
  stripe_subscription_id: string | null
  trial_ends_at: string | Date | null
  override_plan: string | null
  override_reason: string | null
  override_expires_at: string | Date | null
  override_set_by: string | null
  created_at: string | Date
  display_name: string | null
  override_set_by_name: string | null
  clients: { id: string; brand_name: string; status: string }[]
}

export async function GET() {
  const admin = await requireApiAdmin()
  if (!admin.ok) return admin.response

  const sql = db()
  try {
    const rows = await sql`
      select
        a.id, a.plan, a.status, a.stripe_subscription_id, a.trial_ends_at,
        a.override_plan, a.override_reason, a.override_expires_at, a.override_set_by,
        a.created_at,
        (
          select p.display_name from profiles p
          where p.account_id = a.id
          order by p.created_at
          limit 1
        ) as display_name,
        -- Resolve the granting admin's name; override_set_by is a bare uuid and
        -- the badge has to show who issued the comp.
        (
          select p.display_name from profiles p
          where p.id = a.override_set_by
        ) as override_set_by_name,
        coalesce((
          select json_agg(json_build_object(
            'id', c.id, 'brand_name', c.brand_name, 'status', c.status
          ))
          from clients c where c.account_id = a.id
        ), '[]'::json) as clients
      from accounts a
      order by a.created_at desc
    ` as AccountQueryRow[]

    // Entitlement is resolved here, not in the client, so there is exactly one
    // resolution path in TypeScript.
    const accounts = rows.map(row => {
      const { stripe_subscription_id, ...rest } = row
      return {
        ...rest,
        hasSubscription: typeof stripe_subscription_id === 'string'
          && stripe_subscription_id.length > 0,
        entitlement: resolveCommercialEntitlement(row),
      }
    })

    return NextResponse.json(accounts)
  } catch (err) {
    console.error('[admin/clients] account query failed:', (err as Error)?.message ?? String(err))
    return NextResponse.json({ error: 'Failed to load accounts' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  await requireAdmin()
  const { accountId, plan } = await req.json()
  if (!['basic', 'pro', 'enterprise'].includes(plan)) {
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
