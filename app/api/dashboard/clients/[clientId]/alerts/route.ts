import { getProfile } from '@/lib/auth'
import { db } from '@/lib/db'
import { resolveCommercialEntitlement } from '@/lib/tier'

export const dynamic = 'force-dynamic'

const DEFAULT_CONFIG = {
  enabled_sov: false, sov_threshold: 50,
  enabled_wow: false, wow_threshold: 10,
  notify_email: true, notify_inapp: true,
}

// Both thresholds are percentages. The column is `integer`, so an unbounded
// Number() from the body could overflow it and turn a bad request into a 500.
function percent(value: unknown, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(100, Math.max(0, Math.trunc(parsed)))
}

async function parseJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json()
    return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}
  } catch {
    return null
  }
}

/** Resolves the brand against the caller's account. Null means "not yours or not there". */
async function ownedClient(clientId: string, accountId: string): Promise<boolean> {
  const rows = await db()`
    select id from clients
    where id = ${clientId} and account_id = ${accountId}
    limit 1
  `
  return rows.length > 0
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const { clientId } = await params
  const profile = await getProfile()
  if (!profile) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // Deliberately no entitlement gate on the read: showing an owner their own
  // configuration (or the defaults) is not the paid capability, and gating it
  // would leave the dashboard tab unable to render for a plan that can see it.
  try {
    if (!await ownedClient(clientId, profile.account_id)) {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }

    const rows = await db()`
      select * from alert_configs where client_id = ${clientId} limit 1
    `
    return Response.json({ config: rows[0] ?? { ...DEFAULT_CONFIG, client_id: clientId } })
  } catch {
    return Response.json({ error: 'Alert config lookup failed' }, { status: 503 })
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const { clientId } = await params
  const profile = await getProfile()
  if (!profile) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // Configuring alerts is the Pro+ capability. Checked before ownership so an
  // unentitled caller cannot probe which client ids exist on their account.
  const { plan, features } = resolveCommercialEntitlement(profile.accounts)
  if (!features.alerts) {
    return Response.json({ error: 'UPGRADE_REQUIRED', feature: 'alerts', plan }, { status: 403 })
  }

  const body = await parseJson(req)
  if (!body) return Response.json({ error: 'Invalid JSON' }, { status: 400 })

  try {
    if (!await ownedClient(clientId, profile.account_id)) {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }

    // client_id carries the UNIQUE constraint from migration 010, so this is a
    // genuine upsert rather than a read-then-write race.
    const rows = await db()`
      insert into alert_configs (
        client_id, enabled_sov, sov_threshold, enabled_wow, wow_threshold,
        notify_email, notify_inapp, updated_at
      )
      values (
        ${clientId}, ${Boolean(body.enabled_sov)}, ${percent(body.sov_threshold, 50)},
        ${Boolean(body.enabled_wow)}, ${percent(body.wow_threshold, 10)},
        ${Boolean(body.notify_email)}, ${Boolean(body.notify_inapp)}, now()
      )
      on conflict (client_id) do update set
        enabled_sov   = excluded.enabled_sov,
        sov_threshold = excluded.sov_threshold,
        enabled_wow   = excluded.enabled_wow,
        wow_threshold = excluded.wow_threshold,
        notify_email  = excluded.notify_email,
        notify_inapp  = excluded.notify_inapp,
        updated_at    = now()
      returning *
    `
    if (!rows[0]) return Response.json({ error: 'Alert config update failed' }, { status: 500 })
    return Response.json({ config: rows[0] })
  } catch {
    // 5xx, never a 2xx over a failed write.
    return Response.json({ error: 'Alert config update failed' }, { status: 500 })
  }
}
