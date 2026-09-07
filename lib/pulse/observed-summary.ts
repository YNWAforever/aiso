import { isoDate } from '@/lib/iso-date'
import type { ClientOverview, PulseWeeklySummary } from '@/lib/types'

export type ObservedPulseSummary = { summary: PulseWeeklySummary[]; kpi: ClientOverview['pulseKpi']; latestWeek: string | null }

function number(value: unknown): number | null {
  if ((typeof value !== 'number' && typeof value !== 'string') || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** Rollups count all metrics. Only a complete matching nonempty-answer denominator is usable. */
export function projectObservedSummary(rows: Record<string, unknown>[]): ObservedPulseSummary {
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

