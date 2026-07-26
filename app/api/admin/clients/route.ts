import { NextRequest, NextResponse } from 'next/server'
import { requireApiAdmin } from '@/lib/admin-guard'
import { db } from '@/lib/db'
import { resolveCommercialEntitlement } from '@/lib/tier'
import { PLAN_IDS, type PlanId } from '@/lib/plans/catalog'

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

function isPlanId(value: unknown): value is PlanId {
  return typeof value === 'string' && (PLAN_IDS as readonly string[]).includes(value)
}

export async function PATCH(req: NextRequest) {
  const admin = await requireApiAdmin()
  if (!admin.ok) return admin.response

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { accountId, action } = body as { accountId?: unknown; action?: unknown }
  if (typeof accountId !== 'string' || !accountId) {
    return NextResponse.json({ error: 'accountId required' }, { status: 400 })
  }
  if (action !== 'grant' && action !== 'revoke') {
    return NextResponse.json({ error: "action must be 'grant' or 'revoke'" }, { status: 400 })
  }

  const sql = db()

  if (action === 'revoke') {
    try {
      const rows = await sql`
        update accounts
           set override_plan = null,
               override_reason = null,
               override_set_by = null,
               override_expires_at = null
         where id = ${accountId}
        returning id
      `
      if (!rows.length) return NextResponse.json({ error: 'Account not found' }, { status: 404 })
      return NextResponse.json({ ok: true })
    } catch (err) {
      console.error('[admin/clients] revoke failed:', (err as Error)?.message ?? String(err))
      return NextResponse.json({ error: 'Failed to revoke override' }, { status: 500 })
    }
  }

  const { plan, reason, expiresAt } = body as {
    plan?: unknown; reason?: unknown; expiresAt?: unknown
  }

  // Validated against the catalog, not a hardcoded list — this is what allows
  // 'free' as a downgrade comp and keeps the endpoint correct as plans change.
  if (!isPlanId(plan)) {
    return NextResponse.json(
      { error: 'Invalid plan', valid: PLAN_IDS }, { status: 400 },
    )
  }

  const trimmedReason = typeof reason === 'string' ? reason.trim() : ''
  if (!trimmedReason) {
    return NextResponse.json({ error: 'reason required' }, { status: 400 })
  }

  // null expiry = permanent comp. A past timestamp is rejected rather than
  // stored, because an already-expired override is a silent no-op that reads as
  // success in the UI.
  let expiry: string | null = null
  if (expiresAt !== undefined && expiresAt !== null && expiresAt !== '') {
    if (typeof expiresAt !== 'string' || Number.isNaN(new Date(expiresAt).getTime())) {
      return NextResponse.json({ error: 'expiresAt must be an ISO-8601 timestamp' }, { status: 400 })
    }
    if (new Date(expiresAt).getTime() <= Date.now()) {
      return NextResponse.json({ error: 'expiresAt must be in the future' }, { status: 400 })
    }
    expiry = expiresAt
  }

  try {
    const rows = await sql`
      update accounts
         set override_plan = ${plan},
             override_reason = ${trimmedReason},
             override_set_by = ${admin.profile.id},
             override_expires_at = ${expiry}
       where id = ${accountId}
      returning id
    `
    if (!rows.length) return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[admin/clients] grant failed:', (err as Error)?.message ?? String(err))
    return NextResponse.json({ error: 'Failed to grant override' }, { status: 500 })
  }
}
