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

type PagedQuery<T> = {
  range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
}

const PAGE_SIZE = 1000
const PROFILE_ACCOUNT_CHUNK_SIZE = 100
const PROFILE_QUERY_CONCURRENCY_LIMIT = 4
const AUTH_LOOKUP_CONCURRENCY_LIMIT = 16

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
      await deliverAlertEmail({
        to: email.to,
        brandName: email.brandName,
        type: email.type,
        currentSov: email.currentSov,
        previousSov: email.previousSov,
        threshold: email.threshold,
        dashboardUrl: email.dashboardUrl,
      })
    },
  }
}

async function loadSnapshot(supabase: ServiceClient): Promise<AlertSnapshot> {
  const configRows = await fetchPagedRows<AlertConfigRow>(() =>
    supabase
      .from('alert_configs')
      .select('*, clients(id, brand_name, account_id)')
      .or('enabled_sov.eq.true,enabled_wow.eq.true')
      .order('id', { ascending: true }),
  )

  const configs: AlertConfigWithClient[] = (configRows ?? [])
    .flatMap((row: AlertConfigRow) => {
      const { clients, ...config } = row
      return clients ? [{ ...config, client: clients }] : []
    })

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
    fetchPagedRows<AlertWeekSnapshot>(() =>
      supabase.rpc('get_alert_weekly_snapshot', { p_client_ids: clientIds }),
    ),
    accountIds.length
      ? loadProfilesByAccountIds(supabase, accountIds)
      : Promise.resolve([] as ProfileRow[]),
  ])

  const weeksByClient = buildWeeksByClient(weeksResult)
  const emailsByAccount = await loadEmailsByAccount(supabase, profilesResult)
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

async function fetchPagedRows<T>(makeQuery: () => PagedQuery<T>): Promise<T[]> {
  const rows: T[] = []
  let from = 0

  for (;;) {
    const to = from + PAGE_SIZE - 1
    const { data, error } = await makeQuery().range(from, to)
    if (error) throw error

    const page = data ?? []
    if (!page.length) break

    rows.push(...page)
    from += page.length
  }

  return rows
}

async function loadProfilesByAccountIds(supabase: ServiceClient, accountIds: string[]) {
  const chunks = chunkArray(accountIds, PROFILE_ACCOUNT_CHUNK_SIZE)
  const chunkResults: ProfileRow[][] = Array.from({ length: chunks.length }, () => [])
  const indexedChunks = chunks.map((accountIdChunk, index) => ({ accountIdChunk, index }))

  await runWithConcurrency(indexedChunks, PROFILE_QUERY_CONCURRENCY_LIMIT, async ({ accountIdChunk, index }) => {
    chunkResults[index] = await fetchPagedRows<ProfileRow>(() =>
      supabase
        .from('profiles')
        .select('id, account_id')
        .in('account_id', accountIdChunk)
        .order('id', { ascending: true }),
    )
  })

  return chunkResults.flat()
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = []

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }

  return chunks
}

function buildWeeksByClient(weeks: AlertWeekSnapshot[]) {
  const weeksByClient: Record<string, AlertWeekSnapshot[]> = {}
  const seenScanWeeksByClient = new Map<string, Set<string>>()

  for (const week of weeks) {
    const clientWeeks = weeksByClient[week.client_id] ?? []
    if (clientWeeks.length >= 2) continue
    const seenScanWeeks = seenScanWeeksByClient.get(week.client_id) ?? new Set<string>()
    if (seenScanWeeks.has(week.scan_week)) continue
    seenScanWeeks.add(week.scan_week)
    seenScanWeeksByClient.set(week.client_id, seenScanWeeks)
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

  const accountProfileEntries = [...profileIdsByAccount.entries()]
  await runWithConcurrency(accountProfileEntries, AUTH_LOOKUP_CONCURRENCY_LIMIT, async ([accountId, profileId]) => {
    const { data, error } = await supabase.auth.admin.getUserById(profileId)
    if (error) throw error
    emailsByAccount[accountId] = data.user?.email ?? null
  })

  return emailsByAccount
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
) {
  let nextIndex = 0
  const workerCount = Math.min(limit, items.length)

  await Promise.all(Array.from({ length: workerCount }, async () => {
    for (;;) {
      const item = items[nextIndex]
      nextIndex += 1
      if (item === undefined) return
      await worker(item)
    }
  }))
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
