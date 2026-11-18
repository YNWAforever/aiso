import { buildPublicResultSummary } from '@/lib/result-access'
import {
  CHECK_SLOTS,
  bucketPoints,
  potentialScore,
  rankFixes,
  visualStatus,
  type Bucket,
} from '@/lib/result/view-model'
import { getCheckActionCopy } from '@/lib/checkExplanations'
import { TRUST_SIGNAL_KEYS, type TrustSignalStatus } from '@/lib/trust-signals'
import type { FactualDensityView } from '@/lib/factual-density-evidence'
import {
  ALL_PLATFORMS,
  type ShareOfVoiceView,
} from '@/lib/pulse/share-of-voice'

export type ReportLocale = 'en' | 'zh-HK'
export type CombinedCheckStatus = 'pass' | 'warn' | 'fail' | 'unknown'

export type CombinedReportCheck = {
  key: string
  status: CombinedCheckStatus
  bucket: Bucket
  /** Points the check is worth when it passes. */
  weight: number
  /** The scan's own finding code, translated by the report's checks catalog. */
  finding?: string | null
  /** Concrete measurement behind the finding, e.g. "51 words". */
  details?: string | null
  /** The owner-facing next action for a confirmed problem. */
  action?: string | null
}

export type CombinedReportIssue = {
  key: string
  status: 'warn' | 'fail'
  title: string
  nextStep: string | null
  points?: number
  effort?: 'minutes' | 'hours' | 'days'
  bucket?: Bucket
}

export type CombinedCitationDensity = {
  qualityScore?: number
  citationsPerThousandWords?: number
  totalLinks?: number
  externalLinks?: number
  authorityBreakdown?: Record<string, number>
}

export type CombinedTopicalAuthority = {
  topicalCoverageScore?: number
  totalClusters?: number
  hasOrphanPages?: number
  detectedClusters?: { topic: string; completenessScore: number }[]
}

export type CombinedChunkability = {
  avgChunkLength?: number
  optimalChunkRatio?: number
  totalChunks?: number
  hasFaqStyle?: boolean
}

export type CombinedGeo = {
  c17?: CombinedCitationDensity
  c18?: FactualDensityView
  c19?: CombinedTopicalAuthority
  c19Check?: unknown
  c20?: CombinedChunkability
}

export type CombinedTrustSignals = {
  version: string
  signals: { key: string; status: TrustSignalStatus }[]
}

export type CombinedScan =
  | {
      state: 'recorded'
      scanId: string
      score: number
      grade: string | null
      scannedAt: string
      collectionFailed: boolean
      counts: { pass: number; warn: number; fail: number; unknown: number; notApplicable: number; total: number }
      /** Score once the three priority fixes are done; null when no confirmed fix exists. */
      potentialScore?: number | null
      buckets?: { key: Bucket; earned: number; max: number }[]
      checks: CombinedReportCheck[]
      issues: CombinedReportIssue[]
      geo?: CombinedGeo | null
      trustSignals?: CombinedTrustSignals | null
    }
  | { state: 'none' }
  | { state: 'unscored' }
  | { state: 'unavailable' }

export type CombinedPulse =
  | {
      state: 'recorded'
      week: string
      answers: number
      brandMentions: number
      brandShare: number | null
      change?: number | null
      platforms: { key: string; answers: number; mentions: number; share: number | null }[]
      prompts: { question: string; answers: number; brandMentions: number }[]
      competitors?: { label: string; mentions: number; share: number | null }[]
    }
  | { state: 'none' }
  | { state: 'unavailable' }

export type CombinedReportData = {
  client: { name: string; domain: string }
  branding: { agencyName: string } | null
  scan: CombinedScan
  pulse: CombinedPulse
  activeQuestions: number | null
  generatedAt: string
}

export type ScanSource = {
  id: string
  domain: string
  createdAt: string
  score: number | null
  grade: string | null
  results: unknown
  accountId: string
}

export function isoDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  if (typeof value !== 'string') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** Pure: the scan half of the report, built from one saved scan. */
export function buildCombinedScanView(scan: ScanSource, locale: ReportLocale): CombinedScan {
  if (scan.score === null) return { state: 'unscored' }
  if (!scan.results || typeof scan.results !== 'object') return { state: 'unavailable' }

  let summary: ReturnType<typeof buildPublicResultSummary>
  try {
    summary = buildPublicResultSummary({
      id: scan.id,
      domain: scan.domain,
      score: scan.score,
      grade: scan.grade,
      industry: null,
      region: null,
      results: scan.results as Parameters<typeof buildPublicResultSummary>[0]['results'],
      account_id: scan.accountId,
      created_at: scan.createdAt,
    })
  } catch {
    return { state: 'unavailable' }
  }
  if (summary.score === null) return { state: 'unscored' }

  const results = scan.results as Record<string, unknown>
  const finding = (key: string) => {
    const value = results[key]
    const row = value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null
    return {
      finding: row && typeof row.message === 'string' ? row.message : null,
      details: row && typeof row.details === 'string' ? row.details : null,
    }
  }

  const checks: CombinedReportCheck[] = CHECK_SLOTS.map(slot => {
    const status = visualStatus(summary.checks[slot.key])
    const action = status === 'warn' || status === 'fail' ? getCheckActionCopy(slot.key, locale) : null
    const found = finding(slot.key)
    return {
      key: slot.key,
      status,
      bucket: slot.bucket,
      weight: slot.weight,
      finding: found.finding,
      details: found.details,
      action: action?.nextStep ?? null,
    }
  })

  // The same ranking the scanner uses, so the report's "top three" and its
  // projected score mean the same thing as the result page.
  const topFixes = rankFixes(summary.checks).slice(0, 3)
  const issues: CombinedReportIssue[] = topFixes.map(fix => {
    const action = getCheckActionCopy(fix.key, locale)
    return {
      key: fix.key,
      status: fix.assessment,
      title: action?.title ?? fix.key,
      nextStep: action?.nextStep ?? null,
      points: fix.points,
      effort: fix.effort,
      bucket: fix.bucket,
    }
  })

  const points = bucketPoints(summary.checks)
  const buckets = (['core', 'extended', 'geo'] as const).map(key => ({
    key,
    earned: points[key].earned,
    max: points[key].max,
  }))

  return {
    state: 'recorded',
    scanId: scan.id,
    score: summary.score,
    grade: summary.grade,
    scannedAt: isoDate(summary.createdAt) ?? scan.createdAt,
    collectionFailed: summary.collectionFailed,
    counts: summary.counts,
    potentialScore: topFixes.length ? potentialScore(summary.score, topFixes) : null,
    buckets,
    checks,
    issues,
    geo: buildGeoDetails(results),
    trustSignals: buildTrustSignals(results.trust_signals),
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function numberField(row: Record<string, unknown>, key: string): number | undefined {
  const value = row[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function booleanField(row: Record<string, unknown>, key: string): boolean | undefined {
  return typeof row[key] === 'boolean' ? row[key] : undefined
}

function citationDensity(value: unknown): CombinedCitationDensity | undefined {
  const row = asRecord(value)
  if (!row) return undefined
  const result: CombinedCitationDensity = {}
  for (const key of ['qualityScore', 'citationsPerThousandWords', 'totalLinks', 'externalLinks'] as const) {
    const number = numberField(row, key)
    if (number !== undefined) result[key] = number
  }
  const breakdown = asRecord(row.authorityBreakdown)
  if (breakdown) {
    const tiers: Record<string, number> = {}
    for (const tier of ['tier1', 'tier2', 'tier3', 'other']) {
      const number = numberField(breakdown, tier)
      if (number !== undefined) tiers[tier] = number
    }
    if (Object.keys(tiers).length) result.authorityBreakdown = tiers
  }
  return Object.keys(result).length ? result : undefined
}

function factualDensity(value: unknown): FactualDensityView | undefined {
  const row = asRecord(value)
  if (!row) return undefined
  const result: FactualDensityView = {}
  for (const key of ['qualityScore', 'numberDensity', 'namedEntityDensity', 'dateReferences', 'uniquenessScore'] as const) {
    const number = numberField(row, key)
    if (number !== undefined) result[key] = number
  }
  for (const key of ['hasComparativeData', 'hasTimeSeriesData'] as const) {
    const boolean = booleanField(row, key)
    if (boolean !== undefined) result[key] = boolean
  }
  if (row.uniquenessStatus === 'observed' || row.uniquenessStatus === 'unavailable') {
    result.uniquenessStatus = row.uniquenessStatus
  }
  if (Array.isArray(row.uniqueClaims)) {
    result.uniqueClaims = row.uniqueClaims.filter((claim): claim is string => typeof claim === 'string')
  }
  return Object.keys(result).length ? result : undefined
}

function topicalAuthority(value: unknown): CombinedTopicalAuthority | undefined {
  const row = asRecord(value)
  if (!row) return undefined
  const result: CombinedTopicalAuthority = {}
  for (const key of ['topicalCoverageScore', 'totalClusters', 'hasOrphanPages'] as const) {
    const number = numberField(row, key)
    if (number !== undefined) result[key] = number
  }
  if (Array.isArray(row.detectedClusters)) {
    const clusters = row.detectedClusters.flatMap(cluster => {
      const item = asRecord(cluster)
      const topic = item && typeof item.topic === 'string' ? item.topic : null
      const completenessScore = item ? numberField(item, 'completenessScore') : undefined
      return topic && completenessScore !== undefined ? [{ topic, completenessScore }] : []
    })
    if (clusters.length) result.detectedClusters = clusters
  }
  return Object.keys(result).length ? result : undefined
}

function chunkability(value: unknown): CombinedChunkability | undefined {
  const row = asRecord(value)
  if (!row) return undefined
  const result: CombinedChunkability = {}
  for (const key of ['avgChunkLength', 'optimalChunkRatio', 'totalChunks'] as const) {
    const number = numberField(row, key)
    if (number !== undefined) result[key] = number
  }
  const faq = booleanField(row, 'hasFaqStyle')
  if (faq !== undefined) result.hasFaqStyle = faq
  return Object.keys(result).length ? result : undefined
}

function buildGeoDetails(results: Record<string, unknown>): CombinedGeo | null {
  const c17 = citationDensity(results.c17_citation_density_data ?? results.c17)
  const c18 = factualDensity(results.c18_factual_density_data ?? results.c18)
  const c19 = topicalAuthority(results.c19_topical_authority_data ?? results.c19)
  const c20 = chunkability(results.c20_chunkability_data ?? results.c20)
  if (!c17 && !c18 && !c19 && !c20) return null
  return { c17, c18, c19, c19Check: results.c19_topical_authority, c20 }
}

function buildTrustSignals(value: unknown): CombinedTrustSignals | null {
  const row = asRecord(value)
  const signals = row && Array.isArray(row.signals) ? row.signals : []
  const valid = signals.flatMap(signal => {
    const item = asRecord(signal)
    const key = item && typeof item.key === 'string' ? item.key : null
    const status: TrustSignalStatus | null = item && (item.status === 'pass' || item.status === 'warn' || item.status === 'fail')
      ? item.status
      : null
    return key && status && (TRUST_SIGNAL_KEYS as readonly string[]).includes(key)
      ? [{ key, status }]
      : []
  })
  if (!valid.length) return null
  return { version: row && typeof row.version === 'string' ? row.version : '', signals: valid }
}

/** Pure: the Pulse half, always the latest classified canonical week. */
export function buildCombinedPulseView(view: ShareOfVoiceView): CombinedPulse {
  const week = view.weeks[0]
  if (!week) return { state: 'none' }
  const brand = view.subjects.find(subject => subject.kind === 'brand')
  const total = brand?.cells[week]?.[ALL_PLATFORMS]
  if (!total) return { state: 'unavailable' }

  const competitors = view.subjects
    .filter(subject => subject.kind !== 'brand')
    .flatMap(subject => {
      const cell = subject.cells[week]?.[ALL_PLATFORMS]
      return cell && cell.mentions > 0
        ? [{ label: subject.label, mentions: cell.mentions, share: cell.share }]
        : []
    })
    .sort((a, b) => b.mentions - a.mentions || a.label.localeCompare(b.label))
    .slice(0, 5)

  return {
    state: 'recorded',
    week,
    answers: total.answers,
    brandMentions: total.mentions,
    brandShare: total.share,
    change: brand?.change ?? null,
    platforms: view.platforms.map(key => {
      const cell = brand?.cells[week]?.[key]
      return {
        key,
        answers: cell?.answers ?? 0,
        mentions: cell?.mentions ?? 0,
        share: cell?.share ?? null,
      }
    }),
    prompts: view.prompts
      .filter(prompt => prompt.question.trim().length > 0)
      .map(prompt => ({
        question: prompt.question,
        answers: prompt.answers,
        brandMentions: prompt.brandMentions,
      })),
    competitors,
  }
}
