import { buildPublicResultSummary } from '@/lib/result-access'
import { CHECK_SLOTS, visualStatus, type Bucket } from '@/lib/result/view-model'
import { getCheckActionCopy } from '@/lib/checkExplanations'
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
}

export type CombinedReportIssue = {
  key: string
  status: 'warn' | 'fail'
  title: string
  nextStep: string | null
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
      checks: CombinedReportCheck[]
      issues: CombinedReportIssue[]
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
      platforms: { key: string; answers: number; mentions: number; share: number | null }[]
      prompts: { question: string; answers: number; brandMentions: number }[]
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

  const checks: CombinedReportCheck[] = CHECK_SLOTS.map(slot => ({
    key: slot.key,
    status: visualStatus(summary.checks[slot.key]),
    bucket: slot.bucket,
  }))

  const actionable = CHECK_SLOTS
    .map((slot, index) => ({ slot, index, status: visualStatus(summary.checks[slot.key]) }))
    .filter((entry): entry is typeof entry & { status: 'warn' | 'fail' } => entry.status === 'warn' || entry.status === 'fail')
    .sort((a, b) => (a.status === 'fail' ? 0 : 1) - (b.status === 'fail' ? 0 : 1) || a.index - b.index)
    .slice(0, 3)

  const issues: CombinedReportIssue[] = actionable.map(({ slot, status }) => {
    const action = getCheckActionCopy(slot.key, locale)
    return {
      key: slot.key,
      status,
      title: action?.title ?? slot.key,
      nextStep: action?.nextStep ?? null,
    }
  })

  return {
    state: 'recorded',
    scanId: scan.id,
    score: summary.score,
    grade: summary.grade,
    scannedAt: isoDate(summary.createdAt) ?? scan.createdAt,
    collectionFailed: summary.collectionFailed,
    counts: summary.counts,
    checks,
    issues,
  }
}

/** Pure: the Pulse half, always the latest classified canonical week. */
export function buildCombinedPulseView(view: ShareOfVoiceView): CombinedPulse {
  const week = view.weeks[0]
  if (!week) return { state: 'none' }
  const brand = view.subjects.find(subject => subject.kind === 'brand')
  const total = brand?.cells[week]?.[ALL_PLATFORMS]
  if (!total) return { state: 'unavailable' }

  return {
    state: 'recorded',
    week,
    answers: total.answers,
    brandMentions: total.mentions,
    brandShare: total.share,
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
  }
}
