/**
 * Impact engine — deterministic, modelled estimates derived entirely from
 * the check results already stored in scans.results. Never throws; missing
 * or legacy data degrades by omitting the affected stat.
 */
import { CORE_PTS, EXT_PTS, GEO_PTS, assignGrade } from '@/lib/scoring'
import type { CheckResult } from '@/lib/types'

/* ── Types ───────────────────────────────────────────────────── */
export type PlatformKey = 'chatgpt' | 'perplexity' | 'claude' | 'gemini' | 'google_aio'
export type PlatformStatus = 'visible' | 'partial' | 'blocked'

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
  | { type: 'platforms_blocked'; count: number; total: number; text: string }
  | { type: 'low_readable'; percent: number; text: string }
  | { type: 'benchmark_gap'; benchmark: number; gap: number; industry: string; text: string }
  | { type: 'score_uplift'; delta: number; projectedScore: number; projectedGrade: string; text: string }

export interface ImpactReport {
  platformVisibility: PlatformVisibility[]
  aiReadablePercent: number | null
  quickWins: QuickWin[]
  projectedScore: number
  projectedGrade: string
  headlineStat: HeadlineStat
}

/* ── Benchmarks (single source of truth — also used by ScoreReveal) ── */
export const INDUSTRY_BENCHMARKS: Record<string, number> = {
  technology: 61, finance: 58, medical: 54, legal: 52,
  retail_ecommerce: 48, education: 51, real_estate: 44,
  travel_hospitality: 46, media_entertainment: 55,
  manufacturing: 40, energy_utilities: 42,
  general_b2b: 49, general_b2c: 47,
}

/* ── Static maps ─────────────────────────────────────────────── */
const PLATFORM_LABELS: Record<PlatformKey, string> = {
  chatgpt: 'ChatGPT', perplexity: 'Perplexity', claude: 'Claude',
  gemini: 'Gemini', google_aio: 'Google AI Overviews',
}

// c3 botAccess tests these bots; maps bot name → platform
const BOT_TO_PLATFORM: Record<string, PlatformKey> = {
  gptbot: 'chatgpt',
  claudebot: 'claude',
  'anthropic-ai': 'claude',
  perplexitybot: 'perplexity',
}
const C3_PLATFORMS: PlatformKey[] = ['chatgpt', 'claude', 'perplexity']
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
const EFFORT_FACTOR: Record<Effort, number> = { minutes: 1, hours: 2, days: 8 }

const QUICK_WIN_LABELS: Record<string, string> = {
  c1_robots: 'Allow AI crawlers in robots.txt',
  c2_llms_txt: 'Add an llms.txt file',
  c3_bot_access: 'Unblock AI bots at the server level',
  c4_structured_data: 'Add JSON-LD structured data',
  c5_extractability: 'Improve content extractability',
  c6_llms_full_txt: 'Add an llms-full.txt file',
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

  const statuses = new Map<PlatformKey, { status: PlatformStatus; reason: string }>()

  // 1. c3 — live bot requests (chatgpt / claude / perplexity only)
  if (c3) {
    const blockedBots = (typeof c3.details === 'string' ? c3.details : '')
      .toLowerCase().split(',').map(s => s.trim()).filter(Boolean)
    const blockedPlatforms = new Set(
      blockedBots.map(b => BOT_TO_PLATFORM[b]).filter(Boolean) as PlatformKey[],
    )
    // fail with no named bots → treat all tested bots as blocked
    if (c3.status === 'fail' && blockedPlatforms.size === 0) {
      C3_PLATFORMS.forEach(p => blockedPlatforms.add(p))
    }
    for (const p of C3_PLATFORMS) {
      if (blockedPlatforms.has(p)) {
        statuses.set(p, { status: 'blocked', reason: `${PLATFORM_LABELS[p]}'s crawler is blocked by your server` })
      } else {
        statuses.set(p, { status: 'visible', reason: 'Crawler can fetch your pages' })
      }
    }
  }

  // 2. c1 — robots.txt rules (covers all platforms incl. Gemini / Google AIO)
  if (c1) {
    if (c1.message === 'robots_ai_blocked') {
      for (const p of ALL_PLATFORMS) {
        const current = statuses.get(p)
        if (!current || current.status === 'visible') {
          statuses.set(p, { status: 'partial', reason: 'robots.txt disallows one or more AI crawlers' })
        }
      }
    } else if (c1.message === 'robots_not_found' || c1.message === 'robots_fetch_error') {
      for (const p of ALL_PLATFORMS) {
        if (!statuses.has(p)) {
          statuses.set(p, { status: 'partial', reason: 'No robots.txt found — crawler rules unverified' })
        }
      }
    } else {
      // robots_ai_allowed / robots_no_ai_rules — crawling permitted
      for (const p of ALL_PLATFORMS) {
        if (!statuses.has(p)) {
          statuses.set(p, { status: 'visible', reason: 'robots.txt permits AI crawlers' })
        }
      }
    }
  }

  return ALL_PLATFORMS
    .filter(p => statuses.has(p))
    .map(p => ({ platform: p, label: PLATFORM_LABELS[p], ...statuses.get(p)! }))
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
function deriveQuickWins(results: Record<string, unknown>): QuickWin[] {
  const wins: QuickWin[] = []
  for (const key of Object.keys(ALL_WEIGHTS)) {
    const check = getCheck(results, key)
    if (!check || check.status === 'pass') continue
    const weight = ALL_WEIGHTS[key]!
    const pointsGain = check.status === 'fail' ? weight : weight * 0.5
    wins.push({
      key,
      label: QUICK_WIN_LABELS[key] ?? key,
      pointsGain,
      effort: EFFORT_MAP[key] ?? 'hours',
    })
  }
  return wins.sort((a, b) =>
    (b.pointsGain / EFFORT_FACTOR[b.effort]) - (a.pointsGain / EFFORT_FACTOR[a.effort]) ||
    b.pointsGain - a.pointsGain,
  )
}

/* ── Main ────────────────────────────────────────────────────── */
export function computeImpact(
  results: Record<string, unknown>,
  opts: { score: number; grade?: string; industry?: string | null },
): ImpactReport {
  let platformVisibility: PlatformVisibility[] = []
  let aiReadablePercent: number | null = null
  let quickWins: QuickWin[] = []

  try { platformVisibility = derivePlatforms(results) } catch { /* degrade */ }
  try { aiReadablePercent  = deriveReadable(results) }  catch { /* degrade */ }
  try { quickWins          = deriveQuickWins(results) } catch { /* degrade */ }

  const score = Number.isFinite(opts.score) ? opts.score : 0
  const uplift = quickWins
    .filter(w => w.effort !== 'days')
    .reduce((s, w) => s + w.pointsGain, 0)
  const projectedScore = Math.min(100, Math.round((score + uplift) * 10) / 10)
  const projectedGrade = assignGrade(projectedScore)

  // Headline: blocked platforms > low readable > benchmark gap > uplift
  const blockedCount = platformVisibility.filter(p => p.status === 'blocked').length
  const benchmark = opts.industry ? INDUSTRY_BENCHMARKS[opts.industry] : undefined

  let headlineStat: HeadlineStat
  if (blockedCount > 0) {
    headlineStat = {
      type: 'platforms_blocked',
      count: blockedCount,
      total: ALL_PLATFORMS.length,
      text: `Your site is invisible to ${blockedCount} of ${ALL_PLATFORMS.length} major AI platforms`,
    }
  } else if (aiReadablePercent !== null && aiReadablePercent < 50) {
    headlineStat = {
      type: 'low_readable',
      percent: aiReadablePercent,
      text: `AI engines can only use about ${aiReadablePercent}% of your content`,
    }
  } else if (benchmark !== undefined && score < benchmark) {
    headlineStat = {
      type: 'benchmark_gap',
      benchmark,
      gap: benchmark - score,
      industry: opts.industry!,
      text: `You score ${benchmark - score} points below the average for your industry`,
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
        : 'Your site is in great shape for AI search',
    }
  }

  return { platformVisibility, aiReadablePercent, quickWins, projectedScore, projectedGrade, headlineStat }
}
