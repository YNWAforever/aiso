import 'server-only'
import { db } from '@/lib/db'
import { resolveCommercialEntitlement, type CommercialAccount } from '@/lib/tier'
import { isoDate } from '@/lib/iso-date'
import type { AgentCompetitor, AgentProgress, AgentRecommendation, Client, ClientOverview, PulseWeeklySummary, Scan } from '@/lib/types'

export type WorkspaceRead<T> = { status: 'ok' | 'error' | 'locked'; data: T }
export type WorkspaceClient = Pick<Client, 'id' | 'brand_name' | 'domain' | 'industry' | 'status'>
type PulseData = { summary: PulseWeeklySummary[]; kpi: ClientOverview['pulseKpi']; latestWeek: string | null }
export type OwnedWorkspace = {
  client: WorkspaceClient
  scan: WorkspaceRead<Scan | null>
  history: WorkspaceRead<ClientOverview['scanHistory']>
  pulse: WorkspaceRead<PulseData>
  missed: WorkspaceRead<ClientOverview['missedOpportunities']>
  recommendations: WorkspaceRead<AgentRecommendation[]>
  progress: WorkspaceRead<AgentProgress[]>
  competitors: WorkspaceRead<AgentCompetitor[]>
}

async function read<T>(name: string, work: () => Promise<T>, empty: T): Promise<WorkspaceRead<T>> {
  try { return { status: 'ok', data: await work() } } catch {
    console.error(`[workspace] ${name} read failed`)
    return { status: 'error', data: empty }
  }
}
function unavailable<T>(data: T, status: 'locked' | 'error' | 'ok' = 'ok'): WorkspaceRead<T> { return { status, data } }
function number(value: unknown): number | null {
  if ((typeof value !== 'number' && typeof value !== 'string') || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function timestamp(value: unknown): string {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : ''
  return typeof value === 'string' ? value : ''
}
function scanRow<T extends { score: unknown; created_at: unknown }>(row: T) {
  const score = number(row.score)
  if (score === null) throw new Error('Invalid stored scan score')
  return { ...row, score, created_at: timestamp(row.created_at) }
}

/** Rollups count all metrics. Only a complete matching nonempty-answer denominator is usable. */
function pulseData(rows: Record<string, unknown>[]): PulseData {
  const ordered = rows.map((row): Record<string, unknown> & { scan_week: string } => ({ ...row, scan_week: isoDate(row.scan_week as string | Date | null, '') }))
    .filter(row => row.scan_week).sort((a, b) => a.scan_week.localeCompare(b.scan_week))
  const latestWeek = ordered.at(-1)?.scan_week ?? null
  const aggregate = ordered.find(row => row.scan_week === latestWeek && row.platform === null && row.total_queries !== undefined)
  const total = number(aggregate?.total_queries)
  const successful = number(aggregate?.successful_queries)
  const observed = number(aggregate?.observed_queries)
  const mentions = number(aggregate?.brand_mentions)
  const observedMentions = number(aggregate?.observed_brand_mentions)
  const sov = number(aggregate?.sov_score)
  const platforms = number(aggregate?.successful_platform_count)
  const valid = total !== null && total > 0 && total === successful && total === observed
    && mentions !== null && mentions >= 0 && mentions <= total && mentions === observedMentions
    && sov !== null && sov >= 0 && sov <= 100 && platforms !== null && platforms > 0
  const summary = ordered.filter(row => row.total_queries !== undefined && row.total_queries !== null).map(row => ({
    id: row.id, client_id: row.client_id, scan_week: row.scan_week, platform: row.platform,
    total_queries: row.total_queries, brand_mentions: row.brand_mentions, sov_score: row.sov_score,
    avg_sentiment_score: row.avg_sentiment_score, top_competitors: row.top_competitors, created_at: row.created_at,
  })) as PulseWeeklySummary[]
  return { summary, latestWeek, kpi: valid && latestWeek ? {
    sovScore: sov!, brandMentions: mentions!, totalQueries: total!, platformCount: platforms!, scanWeek: latestWeek,
  } : null }
}

/** Call only after the route/page authenticates. Ownership failure is null; lookup outage throws. */
export async function loadOwnedWorkspace({ clientId, profile, scanId }: {
  clientId: string
  profile: { account_id: string; accounts?: CommercialAccount }
  scanId?: string
}): Promise<OwnedWorkspace | null> {
  const sql = db()
  const accountId = profile.account_id
  const clientRows = await sql`
    select id, brand_name, domain, industry, status from clients
    where id = ${clientId} and account_id = ${accountId} limit 1
  `
  if (!clientRows[0]) return null
  const client = clientRows[0] as WorkspaceClient
  const { features } = resolveCommercialEntitlement(profile.accounts)
  const [scan, history, pulse, missed] = await Promise.all([
    read('scan', async () => {
      const rows = scanId !== undefined
        ? await sql`select * from scans where id = ${scanId} and client_id = ${clientId} and account_id = ${accountId} limit 1`
        : await sql`select * from scans where client_id = ${clientId} and account_id = ${accountId} order by created_at desc, id desc limit 1`
      return rows[0] ? scanRow(rows[0] as Scan) : null
    }, null),
    read('history', async () => { const rows = await sql`
      select id, domain, score, grade, created_at from scans
      where client_id = ${clientId} and account_id = ${accountId} order by created_at desc, id desc limit 10
    `; return (rows as ClientOverview['scanHistory']).map(scanRow) }, []),
    read('pulse', async () => {
      const rows = await sql`
        with recent_weeks as (
          select s.scan_week from pulse_weekly_summary s join clients c on c.id = s.client_id
          where c.id = ${clientId} and c.account_id = ${accountId}
          union
          select m.scan_week from pulse_metrics m join clients c on c.id = m.client_id
          where c.id = ${clientId} and c.account_id = ${accountId}
          order by scan_week desc limit 40
        ), observations as (
          select m.scan_week, count(*)::int as observed_queries,
            count(*) filter (where m.brand_mentioned = true and m.raw_answer ~ '[^[:space:]]')::int as observed_brand_mentions,
            count(*) filter (where m.raw_answer ~ '[^[:space:]]' and m.brand_mentioned is not null)::int as successful_queries,
            count(distinct m.platform) filter (where m.raw_answer ~ '[^[:space:]]' and m.brand_mentioned is not null)::int as successful_platform_count
          from pulse_metrics m join clients c on c.id = m.client_id
          join recent_weeks w on w.scan_week = m.scan_week
          where c.id = ${clientId} and c.account_id = ${accountId}
          group by m.scan_week
        )
        select s.*, w.scan_week, o.observed_queries, o.observed_brand_mentions, o.successful_queries, o.successful_platform_count
        from recent_weeks w
        left join pulse_weekly_summary s on s.scan_week = w.scan_week and s.client_id = ${clientId}
          and exists (select 1 from clients c where c.id = s.client_id and c.account_id = ${accountId})
        left join observations o on o.scan_week = w.scan_week
        order by w.scan_week, s.platform nulls first
      `
      return pulseData(rows)
    }, { summary: [], kpi: null, latestWeek: null }),
    read('missed', async () => await sql`
      select m.platform, m.question, m.competitors_mentioned, m.scan_week
      from pulse_metrics m join clients c on c.id = m.client_id
      where c.id = ${clientId} and c.account_id = ${accountId} and m.brand_mentioned = false
        and m.raw_answer ~ '[^[:space:]]'
      order by m.scan_week desc, m.id desc limit 10
    ` as ClientOverview['missedOpportunities'], []),
  ])
  const selected = scan.data
  const platforms = features.platform_access
  const agentRead = async <T extends { platform: string }>(allowed: boolean, name: string, work: () => Promise<T[]>): Promise<WorkspaceRead<T[]>> => {
    if (!allowed) return unavailable([], 'locked')
    if (scan.status === 'error') return unavailable([], 'error')
    if (!selected) return unavailable([])
    return read(name, async () => (await work()).filter(row => name !== 'recommendations' || platforms.includes(row.platform))
      .map(row => ({ ...row, ...('created_at' in row ? { created_at: timestamp(row.created_at) } : {}) })), [])
  }
  const [recommendations, progress, competitors] = await Promise.all([
    agentRead<AgentRecommendation>(features.agent_recs, 'recommendations', async () => await sql`
      select a.* from agent_recommendations a join scans s on s.id = a.scan_id
      where s.id = ${selected!.id} and s.client_id = ${clientId} and s.account_id = ${accountId}
        and a.platform = any(${platforms}::text[]) order by a.priority, a.impact_score desc
    ` as AgentRecommendation[]),
    agentRead<AgentProgress>(features.agent_progress, 'progress', async () => await sql`
      select a.* from agent_progress a join scans s on s.id = a.scan_id
      where s.id = ${selected!.id} and s.client_id = ${clientId} and s.account_id = ${accountId}

    ` as AgentProgress[]),
    agentRead<AgentCompetitor>(features.agent_competitors, 'competitors', async () => await sql`
      select a.* from agent_competitors a join scans s on s.id = a.scan_id
      where s.id = ${selected!.id} and s.client_id = ${clientId} and s.account_id = ${accountId}
        order by a.mention_rate desc
    ` as AgentCompetitor[]),
  ])
  return { client, scan, history, pulse, missed, recommendations, progress, competitors }
}

/** Existing API shape remains stable; unlike home it must not return partial success. */
export function workspaceOverview(workspace: OwnedWorkspace): ClientOverview {
  const { client, scan, history, pulse, missed, recommendations, progress, competitors } = workspace
  if ([scan, history, pulse, missed, recommendations, progress, competitors].some(section => section.status === 'error')) throw new Error('Failed to load overview')
  return { client: { brand_name: client.brand_name }, latestScan: scan.data, scanHistory: history.data,
    pulseSummary: pulse.data.summary, pulseKpi: pulse.data.kpi, missedOpportunities: missed.data,
    recommendations: recommendations.data, progress: progress.data, competitors: competitors.data }
}
