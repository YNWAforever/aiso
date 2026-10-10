/**
 * Impact engine — deterministic, modelled estimates derived entirely from
 * the check results already stored in scans.results. Never throws; missing
 * or legacy data degrades by omitting the affected stat.
 */
import { CORE_PTS, EXT_PTS, GEO_PTS, assignGrade, capScore } from '@/lib/scoring'
import type { CheckResult, CollectorAccess } from '@/lib/types'
import { rankActionableChecks, resolveCheckPriorities } from '@/lib/view-models/check-priority'

/* ── Types ───────────────────────────────────────────────────── */
export type PlatformKey = 'chatgpt' | 'perplexity' | 'claude' | 'gemini' | 'google_aio'
export type PlatformStatus = 'visible' | 'partial' | 'blocked' | 'not_measured'

export interface PlatformVisibility {
  platform: PlatformKey
  label: string
  status: PlatformStatus
  reason: string
}

export type Effort = 'minutes' | 'hours' | 'days'

export interface QuickWin {
  key: string
  label: string
  pointsGain: number
  effort: Effort
}

export type HeadlineStat =
  | { type: 'evidence_needed'; text: string }
  | { type: 'platforms_blocked'; count: number; total: number; text: string }
  | { type: 'low_readable'; percent: number; text: string }
  | { type: 'score_uplift'; delta: number; projectedScore: number; projectedGrade: string; text: string }

export interface ImpactReport {
  benchmark: null
  collectorAccess: CollectorAccess[]
  platformVisibility: PlatformVisibility[]
  aiReadablePercent: number | null
  quickWins: QuickWin[]
  projectedScore: number
  projectedGrade: string
  headlineStat: HeadlineStat
}

/* ── Static maps ─────────────────────────────────────────────── */
const PLATFORM_LABELS: Record<PlatformKey, string> = {
  chatgpt: 'ChatGPT', perplexity: 'Perplexity', claude: 'Claude',
  gemini: 'Gemini', google_aio: 'Google AI Overviews',
}

const ALL_PLATFORMS: PlatformKey[] = ['chatgpt', 'perplexity', 'claude', 'gemini', 'google_aio']

const EFFORT_MAP: Record<string, Effort> = {
  c1_robots: 'minutes', c2_llms_txt: 'minutes', c6_llms_full_txt: 'minutes',
  c8_sitemap: 'minutes', c12_canonical: 'minutes',
  c4_structured_data: 'hours', c7_mcp_card: 'hours', c9_meta_desc: 'hours',
  c10_headings: 'hours', c11_faq: 'hours', c14_internal_links: 'hours',
  c15_entity: 'hours', c16_freshness: 'hours',
  c18_factual_density: 'hours', c20_chunkability: 'hours',
  c3_bot_access: 'days', c5_extractability: 'days', c13_render: 'days',
  c17_citation_density: 'days', c19_topical_authority: 'days',
}

const QUICK_WIN_LABELS: Record<string, string> = {
  c1_robots: 'Allow AI crawlers in robots.txt',
  c2_llms_txt: 'Add an llms.txt file',
  c3_bot_access: 'Unblock AI bots at the server level',
  c4_structured_data: 'Add JSON-LD structured data',
  c5_extractability: 'Improve content extractability',
  c6_llms_full_txt: 'Improve optional llms.txt content completeness',
  c7_mcp_card: 'Publish an MCP server card',
  c8_sitemap: 'Add an XML sitemap',
  c9_meta_desc: 'Write meta descriptions',
  c10_headings: 'Fix heading structure',
  c11_faq: 'Add FAQ schema',
  c12_canonical: 'Add canonical tags',
  c13_render: 'Server-render your content',
  c14_internal_links: 'Strengthen internal linking',
  c15_entity: 'Add entity signals',
  c16_freshness: 'Update content freshness signals',
  c17_citation_density: 'Cite higher-authority sources',
  c18_factual_density: 'Add statistics, dates and named facts',
  c19_topical_authority: 'Build out topic clusters',
  c20_chunkability: 'Restructure content into AI-friendly chunks',
}

const ALL_WEIGHTS: Record<string, number> = { ...CORE_PTS, ...EXT_PTS, ...GEO_PTS }

/* ── Helpers ─────────────────────────────────────────────────── */
function getCheck(results: Record<string, unknown>, key: string): CheckResult | undefined {
  const v = results[key]
  if (v && typeof v === 'object' && 'status' in (v as object)) {
    const status = (v as CheckResult).status
    if (status === 'pass' || status === 'warn' || status === 'fail') return v as CheckResult
  }
  return undefined
}

function statusToPercent(status: CheckResult['status']): number {
  return status === 'pass' ? 100 : status === 'warn' ? 60 : 20
}

/* ── Platform visibility ─────────────────────────────────────── */
function derivePlatforms(results: Record<string, unknown>): PlatformVisibility[] {
  const c1 = getCheck(results, 'c1_robots')
  const c3 = getCheck(results, 'c3_bot_access')
  if (!c1 && !c3) return []

  // A crawler response and robots policy cannot establish a consumer answer,
  // citation or rank. Legacy aggregate checks cannot identify per-bot policy.
  return ALL_PLATFORMS.map(platform => ({ platform, label: PLATFORM_LABELS[platform],
    status: 'not_measured', reason: 'Consumer exposure has not been measured by this technical scan' }))
}

function deriveCollectorAccess(results: Record<string, unknown>): CollectorAccess[] {
  const merged = new Map<string, CollectorAccess>()
  for (const key of ['c1_robots', 'c3_bot_access']) {
    const entries = getCheck(results, key)?.collectorAccess
    if (!Array.isArray(entries)) continue
    for (const entry of entries) {
      if (!entry || typeof entry.crawler !== 'string' || !['search','training','user_triggered'].includes(entry.role)
        || !['allowed','blocked','unknown'].includes(entry.policy) || !['reachable','unreachable','not_measured'].includes(entry.probe)) continue
      const previous = merged.get(entry.crawler)
      merged.set(entry.crawler, { ...entry,
        policy: entry.policy === 'unknown' && previous ? previous.policy : entry.policy,
        probe: entry.probe === 'not_measured' && previous ? previous.probe : entry.probe })
    }
  }
  return [...merged.values()]
}

/* ── AI-readable percent ─────────────────────────────────────── */
function deriveReadable(results: Record<string, unknown>): number | null {
  const parts: number[] = []
  const c5 = getCheck(results, 'c5_extractability')
  const c13 = getCheck(results, 'c13_render')
  if (c5)  parts.push(statusToPercent(c5.status))
  if (c13) parts.push(statusToPercent(c13.status))
  const c20data = results['c20_chunkability_data']
  if (c20data && typeof c20data === 'object' && typeof (c20data as { optimalChunkRatio?: unknown }).optimalChunkRatio === 'number') {
    parts.push((c20data as { optimalChunkRatio: number }).optimalChunkRatio)
  }
  if (!parts.length) return null
  return Math.round(parts.reduce((a, b) => a + b, 0) / parts.length)
}

/* ── Quick wins ──────────────────────────────────────────────── */
function deriveQuickWins(checks: Record<string, unknown>): QuickWin[] {
  return rankActionableChecks(checks).map(check => {
    const key = check.checkKey
    const weight = ALL_WEIGHTS[key]!
    const pointsGain = check.assessment === 'fail' ? weight : weight * 0.5
    return {
      key,
      label: QUICK_WIN_LABELS[key] ?? key,
      pointsGain,
      effort: EFFORT_MAP[key] ?? 'hours',
    }
  })
}

/* ── Main ────────────────────────────────────────────────────── */
export function computeImpact(
  results: Record<string, unknown>,
  opts: { score: number; grade?: string; industry?: string | null; confirmedChecks?: Record<string, unknown> },
): ImpactReport {
  let platformVisibility: PlatformVisibility[] = []
  let collectorAccess: CollectorAccess[] = []
  let aiReadablePercent: number | null = null
  let quickWins: QuickWin[] = []
  const checks = opts.confirmedChecks ?? {}
  const resolution = resolveCheckPriorities(checks)
  const observed = Object.fromEntries(Object.entries(checks).filter(([, raw]) => {
    const check = raw as { collection?: unknown; applicability?: unknown } | null
    return check?.collection === 'complete' && check.applicability === 'applicable'
  }).flatMap(([key]) => [[key, results[key]], [`${key}_data`, results[`${key}_data`]]]))

  try { platformVisibility = derivePlatforms(results) } catch { /* degrade */ }
  try { collectorAccess = deriveCollectorAccess(observed) } catch { /* degrade */ }
  try { aiReadablePercent  = deriveReadable(observed) }  catch { /* degrade */ }
  try { quickWins          = deriveQuickWins(checks) } catch { /* degrade */ }

  const score = Number.isFinite(opts.score) ? opts.score : 0
  const uplift = quickWins
    .filter(w => w.effort !== 'days')
    .reduce((s, w) => s + w.pointsGain, 0)
  const projectedScore = capScore(Math.round((score + uplift) * 10) / 10)
  const projectedGrade = assignGrade(projectedScore)

  // No industry comparison is available without a verified dataset.
  const blockedCount = collectorAccess.filter(p => p.policy === 'blocked' || p.probe === 'unreachable').length

  let headlineStat: HeadlineStat
  if (resolution.state === 'insufficient-evidence') {
    headlineStat = { type: 'evidence_needed', text: 'More evidence is needed before estimating a fix or score improvement.' }
  } else if (blockedCount > 0) {
    headlineStat = {
      type: 'platforms_blocked',
      count: blockedCount,
      total: collectorAccess.length,
      text: `${blockedCount} crawler access checks report restrictions; consumer exposure is unmeasured`,
    }
  } else if (aiReadablePercent !== null && aiReadablePercent < 50) {
    headlineStat = {
      type: 'low_readable',
      percent: aiReadablePercent,
      text: `AI engines can only use about ${aiReadablePercent}% of your content`,
    }
  } else {
    const delta = Math.max(0, projectedScore - score)
    headlineStat = {
      type: 'score_uplift',
      delta,
      projectedScore,
      projectedGrade,
      text: delta > 0
        ? `Quick fixes could lift your score by ${delta} points to ${projectedScore} (${projectedGrade})`
        : 'No confirmed fixes identified in the collected checks; actual AI visibility remains unmeasured.',
    }
  }

  return { benchmark: null, platformVisibility, collectorAccess, aiReadablePercent, quickWins, projectedScore, projectedGrade, headlineStat }
}
