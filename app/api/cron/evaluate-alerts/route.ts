import { createClient } from '@supabase/supabase-js'
import {
  runAlertEvaluation,
  type AlertConfigWithClient,
  type AlertEvaluationPorts,
  type AlertSnapshot,
  type AlertWeekSnapshot,
} from '@/lib/alerts/evaluate'
import { sendAlertEmail as deliverAlertEmail } from '@/lib/resend'
import type { Profile } from '@/lib/types'

type ServiceClient = ReturnType<typeof serviceClient>

type AlertClientRow = AlertConfigWithClient['client']

type AlertConfigRow = Omit<AlertConfigWithClient, 'client'> & {
  clients: AlertClientRow | null
}

type ProfileRow = Pick<Profile, 'id' | 'account_id'>

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

function createAlertEvaluationPorts(supabase: ServiceClient): AlertEvaluationPorts {
  return {
    loadSnapshot: async () => loadSnapshot(supabase),
    upsertNotification: async notification => {
      const { error } = await supabase.from('notifications').upsert(notification, {
        onConflict: 'client_id,type,scan_week',
        ignoreDuplicates: true,
      })
      if (error) throw error
    },
    sendAlertEmail: async email => {
      await deliverAlertEmail(email)
    },
  }
}

async function loadSnapshot(supabase: ServiceClient): Promise<AlertSnapshot> {
  const { data: configRows, error: configError } = await supabase
    .from('alert_configs')
    .select('*, clients(id, brand_name, account_id)')
    .or('enabled_sov.eq.true,enabled_wow.eq.true')

  if (configError) throw configError

  const configs: AlertConfigWithClient[] = (configRows ?? [])
    .flatMap((row: AlertConfigRow) => (row.clients ? [{ ...row, client: row.clients }] : []))

  if (!configs.length) {
    return {
      configs: [],
      weeksByClient: {},
      emailsByAccount: {},
      dashboardUrlByClient: {},
    }
  }

  const clientIds = [...new Set(configs.map(config => config.client_id))]
  const accountIds = [...new Set(configs.map(config => config.client.account_id))]

  const [weeksResult, profilesResult] = await Promise.all([
    supabase
      .from('pulse_weekly_summary')
      .select('client_id, scan_week, sov_score')
      .in('client_id', clientIds)
      .is('platform', null)
      .order('scan_week', { ascending: false }),
    accountIds.length
      ? supabase
          .from('profiles')
          .select('id, account_id')
          .in('account_id', accountIds)
      : Promise.resolve({ data: [] as ProfileRow[], error: null }),
  ])

  if (weeksResult.error) throw weeksResult.error
  if (profilesResult.error) throw profilesResult.error

  const weeksByClient = buildWeeksByClient(weeksResult.data ?? [])
  const emailsByAccount = await loadEmailsByAccount(supabase, profilesResult.data ?? [])
  const dashboardUrlByClient = Object.fromEntries(
    configs.map(config => [
      config.client_id,
      `${process.env.NEXT_PUBLIC_APP_URL}/en/dashboard/${config.client_id}`,
    ]),
  )

  return {
    configs,
    weeksByClient,
    emailsByAccount,
    dashboardUrlByClient,
  }
}

function buildWeeksByClient(weeks: AlertWeekSnapshot[]) {
  const weeksByClient: Record<string, AlertWeekSnapshot[]> = {}

  for (const week of weeks) {
    const clientWeeks = weeksByClient[week.client_id] ?? []
    if (clientWeeks.length >= 2) continue
    clientWeeks.push(week)
    weeksByClient[week.client_id] = clientWeeks
  }

  return weeksByClient
}

async function loadEmailsByAccount(supabase: ServiceClient, profiles: ProfileRow[]) {
  const emailsByAccount: Record<string, string | null> = {}
  const profileIdsByAccount = new Map<string, string>()

  for (const profile of profiles) {
    if (!profileIdsByAccount.has(profile.account_id)) {
      profileIdsByAccount.set(profile.account_id, profile.id)
    }
  }

  for (const [accountId, profileId] of profileIdsByAccount) {
    const { data, error } = await supabase.auth.admin.getUserById(profileId)
    if (error) throw error
    emailsByAccount[accountId] = data.user?.email ?? null
  }

  return emailsByAccount
}

export async function POST(req: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('evaluate-alerts: CRON_SECRET env var is not set')
    return Response.json({ error: 'Cron not configured' }, { status: 500 })
  }

  const incomingSecret = req.headers.get('x-cron-secret')
  if (!incomingSecret || incomingSecret !== cronSecret) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = serviceClient()
  const result = await runAlertEvaluation(createAlertEvaluationPorts(supabase))

  return Response.json(result)
}
