import { getProfile } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { planAllows } from '@/lib/tier'

const DEFAULT_CONFIG = {
  enabled_sov: false, sov_threshold: 50,
  enabled_wow: false, wow_threshold: 10,
  notify_email: true, notify_inapp: true,
}

async function verifyOwnership(clientId: string, accountId: string) {
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase.from('clients').select('id')
    .eq('id', clientId).eq('account_id', accountId).single()
  return !!data
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params
  const profile = await getProfile()
  if (!profile) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!await verifyOwnership(clientId, profile.account_id))
    return Response.json({ error: 'Not found' }, { status: 404 })

  const supabase = await createServerSupabaseClient()
  const { data } = await supabase.from('alert_configs').select('*').eq('client_id', clientId).single()
  return Response.json({ config: data ?? { ...DEFAULT_CONFIG, client_id: clientId } })
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params
  const profile = await getProfile()
  if (!profile) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // Plan gate — alerts are a Pro+ feature
  const plan = profile.accounts?.plan ?? 'starter'
  if (!planAllows(plan, 'alerts')) {
    return Response.json({ error: 'UPGRADE_REQUIRED', feature: 'alerts', plan }, { status: 403 })
  }

  if (!await verifyOwnership(clientId, profile.account_id))
    return Response.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  const upsertData = {
    client_id:     clientId,
    enabled_sov:   Boolean(body.enabled_sov),
    sov_threshold: Number(body.sov_threshold) || 50,
    enabled_wow:   Boolean(body.enabled_wow),
    wow_threshold: Number(body.wow_threshold) || 10,
    notify_email:  Boolean(body.notify_email),
    notify_inapp:  Boolean(body.notify_inapp),
    updated_at:    new Date().toISOString(),
  }

  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('alert_configs').upsert(upsertData, { onConflict: 'client_id' }).select().single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ config: data })
}
