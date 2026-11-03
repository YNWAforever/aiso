import 'server-only'
import { db } from '@/lib/db'
import { isFeatureEnabled } from '@/lib/flags'
import { resolveCommercialEntitlement, type CommercialAccount } from '@/lib/tier'
import { loadOwnedPortfolio } from '@/lib/workspace/load-owned-portfolio'
import { projectScanStatus, type ScanDisplayState } from '@/lib/view-models/scan-status'
import { loadBinding, loadPanelData } from '@/lib/integrations/search-console/store'
import { bindingMatchesDomain } from '@/lib/integrations/search-console/binding'
import type { StudioOpportunities } from './types'

/**
 * Studio redesign R1b: the Overview snapshot and the Weekly report rows.
 *
 * Saved data only. Nothing here calls a model, a provider or Google: every
 * number is read from rows earlier work already wrote, through the same
 * account-scoped readers the dashboard uses, so Overview never shows a figure
 * Monitor or the scan page would contradict. Each section fails on its own:
 * an outage reads `unavailable`, never as zero or as "not connected".
 */
type Section<T> = { status: 'ok'; data: T } | { status: 'empty' | 'unavailable' }

export type StudioWeek = { week: string; sovScore: number; brandMentions: number; totalQueries: number }
export type StudioOverview = {
  visibility: Section<{ sovScore: number; brandMentions: number; totalQueries: number; platformCount: number; week: string }>
  /** Weekly rollup rows (all platforms), newest first; at most 12. */
  weeks: Section<StudioWeek[]>
  scan: Section<{ state: ScanDisplayState; score: number | null; grade: string | null; recordedAt: string }>
  searchConsole: Section<{ clicks: number; impressions: number; dataThrough: string | null }> | { status: 'unbound' | 'not_entitled' }
  opportunities: Section<{ count: number; week: string | null }>
}

const WEEK_LIMIT = 12
const fail = (name: string) => { console.error(`[studio-overview] ${name} read failed`); return { status: 'unavailable' as const } }
const iso = (value: unknown) => value instanceof Date ? value.toISOString() : String(value)

/** Weekly rollup rows (all platforms) for one owned brand, newest first. */
export async function loadStudioWeeks(accountId: string, clientId: string): Promise<StudioOverview['weeks']> {
  try {
    // Tenancy inside the statement: the client must be this account's.
    const rows = await db()`
      select to_char(s.scan_week, 'YYYY-MM-DD') as scan_week, s.sov_score, s.brand_mentions, s.total_queries
      from pulse_weekly_summary s join clients c on c.id = s.client_id
      where s.client_id = ${clientId}::uuid and c.account_id = ${accountId}::uuid and s.platform is null
      order by s.scan_week desc limit ${WEEK_LIMIT}`
    const parsed = rows.flatMap(row => {
      const sov = Number(row.sov_score), mentions = Number(row.brand_mentions), total = Number(row.total_queries)
      return typeof row.scan_week === 'string' && [sov, mentions, total].every(Number.isFinite) && total >= 0 && mentions >= 0 && mentions <= total
        ? [{ week: row.scan_week, sovScore: sov, brandMentions: mentions, totalQueries: total }] : []
    })
    return parsed.length ? { status: 'ok', data: parsed } : { status: 'empty' }
  } catch { return fail('weeks') }
}

export async function loadStudioOverview(
  profile: { account_id: string; accounts?: CommercialAccount },
  clientId: string,
  opportunities: StudioOpportunities | null,
  { staff = false }: { staff?: boolean } = {},
): Promise<StudioOverview> {
  const accountId = profile.account_id
  const sql = db()
  const [visibility, weeks, scan, searchConsole] = await Promise.all([
    (async (): Promise<StudioOverview['visibility']> => {
      try {
        const portfolio = await loadOwnedPortfolio({ profile })
        if (portfolio.pulse.status === 'error') return fail('visibility')
        const kpi = portfolio.pulse.data[clientId]?.kpi
        return kpi ? { status: 'ok', data: { sovScore: kpi.sovScore, brandMentions: kpi.brandMentions, totalQueries: kpi.totalQueries, platformCount: kpi.platformCount, week: kpi.scanWeek } } : { status: 'empty' }
      } catch { return fail('visibility') }
    })(),
    loadStudioWeeks(accountId, clientId),
    (async (): Promise<StudioOverview['scan']> => {
      try {
        const [row] = await sql`
          select s.score, s.grade, s.created_at, s.results->'evidence' as evidence
          from scans s join clients c on c.id = s.client_id
          where s.client_id = ${clientId}::uuid and s.account_id = ${accountId}::uuid and c.account_id = ${accountId}::uuid
          order by s.created_at desc nulls last, s.id desc limit 1`
        if (!row) return { status: 'empty' }
        const score = row.score === null || row.score === undefined ? null : Number(row.score)
        const display = projectScanStatus({ score: Number.isFinite(score) ? score : null, grade: typeof row.grade === 'string' ? row.grade : null, evidence: row.evidence })
        return { status: 'ok', data: { state: display.state, score: display.score, grade: display.grade, recordedAt: iso(row.created_at) } }
      } catch { return fail('scan') }
    })(),
    (async (): Promise<StudioOverview['searchConsole']> => {
      if (staff) return { status: 'unavailable' }
      if (!isFeatureEnabled('search_console') || !resolveCommercialEntitlement(profile.accounts).features.search_console) return { status: 'not_entitled' }
      try {
        const binding = await loadBinding(accountId, clientId)
        if (!binding || binding.connectionStatus !== 'active' || !bindingMatchesDomain(binding, binding.currentDomain)) return { status: 'unbound' }
        const panel = await loadPanelData(accountId, clientId)
        return panel.property ? { status: 'ok', data: { clicks: panel.property.clicks, impressions: panel.property.impressions, dataThrough: panel.lastGoodDataThrough } } : { status: 'empty' }
      } catch { return fail('search_console') }
    })(),
  ])
  const opportunitySection: StudioOverview['opportunities'] = opportunities === null ? { status: 'unavailable' }
    : opportunities.state === 'ready' ? { status: 'ok', data: { count: opportunities.suggestions.length, week: opportunities.pulseWeek } }
    : { status: 'empty' }
  return { visibility, weeks, scan, searchConsole, opportunities: opportunitySection }
}
