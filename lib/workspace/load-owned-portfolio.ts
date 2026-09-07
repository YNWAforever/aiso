import 'server-only'
import { db } from '@/lib/db'
import { resolveCommercialEntitlement, type CommercialAccount, type EffectivePlan } from '@/lib/tier'
import { projectObservedSummary, type ObservedPulseSummary } from '@/lib/pulse/observed-summary'
import type { ClientOverview } from '@/lib/types'
import type { WorkspaceClient } from '@/lib/workspace/load-owned-workspace'

export type PortfolioRead<T> = { status: 'ok' | 'error'; data: T }
export type OwnedPortfolio = {
  clients: WorkspaceClient[]
  history: PortfolioRead<ClientOverview['scanHistory']>
  pulse: PortfolioRead<Record<string, ObservedPulseSummary>>
  count: PortfolioRead<number | null>
  limit: number
  plan: EffectivePlan
}
async function optional<T>(name: string, load: () => Promise<T>, empty: T): Promise<PortfolioRead<T>> {
  try { return { status: 'ok', data: await load() } } catch {
    console.error(`[portfolio] ${name} read failed`)
    return { status: 'error', data: empty }
  }
}
function numeric(value: unknown): number | null {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}
function timestamp(value: unknown): string {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : ''
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : ''
}

/** The page supplies an authenticated profile. Active-client lookup is authoritative and throws on outage. */
export async function loadOwnedPortfolio({ profile }: { profile: { account_id: string; accounts?: CommercialAccount } }): Promise<OwnedPortfolio> {
  const sql = db()
  const accountId = profile.account_id
  const rows = await sql`
    select id, brand_name, domain, industry, status from clients
    where account_id = ${accountId} and status = 'active' order by created_at, id
  `
  const clients = rows.map(row => ({ id: row.id, brand_name: row.brand_name, domain: row.domain, industry: row.industry, status: row.status })) as WorkspaceClient[]
  const ids = clients.map(client => client.id)
  const entitlement = resolveCommercialEntitlement(profile.accounts)
  const [count, history, pulse] = await Promise.all([
    optional('capacity', async () => {
      const counted = await sql`select count(*)::int as n from clients where account_id = ${accountId}`
      const total = numeric(counted[0]?.n)
      if (total === null || !Number.isInteger(total) || total < 0) throw new Error('Unavailable client count')
      return total
    }, null),
    optional('history', async () => {
      const scans = await sql`
        select id, domain, score, grade, created_at from scans
        where account_id = ${accountId} order by created_at desc, id desc limit 10
      `
      return scans.map(row => {
        const score = numeric(row.score)
        if (score === null) throw new Error('Unavailable stored score')
        return { id: row.id as string, domain: row.domain as string, score, grade: typeof row.grade === 'string' ? row.grade : null, created_at: timestamp(row.created_at) }
      })
    }, []),
    ids.length ? optional('visibility', async () => {
      const observations = await sql`
        with owned_clients as (
          select id from clients where account_id = ${accountId} and status = 'active' and id = any(${ids}::uuid[])
        ), weeks as (
          select s.client_id, s.scan_week from pulse_weekly_summary s join owned_clients c on c.id = s.client_id
          union
          select m.client_id, m.scan_week from pulse_metrics m join owned_clients c on c.id = m.client_id
        ), latest_weeks as (
          select client_id, max(scan_week) as scan_week from weeks group by client_id
        ), observations as (
          select m.client_id, m.scan_week, count(*)::int as observed_queries,
            count(*) filter (where m.brand_mentioned = true and m.raw_answer ~ '[^[:space:]]')::int as observed_brand_mentions,
            count(*) filter (where m.raw_answer ~ '[^[:space:]]' and m.brand_mentioned is not null)::int as successful_queries,
            count(distinct m.platform) filter (where m.raw_answer ~ '[^[:space:]]' and m.brand_mentioned is not null)::int as successful_platform_count
          from pulse_metrics m join owned_clients c on c.id = m.client_id
          join latest_weeks w on w.client_id = m.client_id and w.scan_week = m.scan_week
          group by m.client_id, m.scan_week
        )
        select s.*, w.client_id, w.scan_week, o.observed_queries, o.observed_brand_mentions, o.successful_queries, o.successful_platform_count
        from latest_weeks w
        left join pulse_weekly_summary s on s.client_id = w.client_id and s.scan_week = w.scan_week and s.platform is null
        left join observations o on o.client_id = w.client_id and o.scan_week = w.scan_week
        order by w.client_id
      `
      const byClient = new Map<string, Record<string, unknown>[]>()
      for (const row of observations) {
        if (typeof row.client_id !== 'string') continue
        const group = byClient.get(row.client_id) ?? []
        group.push(row); byClient.set(row.client_id, group)
      }
      return Object.fromEntries(ids.map(id => [id, projectObservedSummary(byClient.get(id) ?? [])]))
    }, {}) : Promise.resolve<PortfolioRead<Record<string, ObservedPulseSummary>>>({ status: 'ok', data: {} }),
  ])
  return { clients, history, pulse, count, limit: entitlement.features.max_brands, plan: entitlement.plan }
}
