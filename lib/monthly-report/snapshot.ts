import type { ReportBrandingInput, ReportBrandingSnapshot, ReportLocale } from '@/lib/reports/types'
import type { MonthActivity, MonthSnapshot, SnapshotFigures } from '@/lib/brand-month/store'
import type { BrandMonthPeriod } from '@/lib/brand-month/period'
import { buildVisibility, type PulsePlatformWeek, type VisibilitySection } from './movement'

/**
 * Retainer OS Slice C1: the monthly deliverables report snapshot (schema 2),
 * frozen into client_report_versions like a scan report's (schema 1). Pure.
 *
 * Fixed section order, the product decision in the brief (§0, §2 Slice C):
 *   1. delivered: verified live first, then self-reported, never merged;
 *   2. visibility: the recorded opening and closing share of voice per platform,
 *      with Q1's movement rule deciding whether a direction may be claimed. The
 *      rule refuses a verdict more often than it gives one; "not enough data yet"
 *      is a valid and expected result (lib/monthly-report/movement.ts);
 *   3. search demand: the recorded opening and closing figures, dated;
 *   4. next month: work items still open.
 * Every figure is copied from a stored row with its source date; nothing is
 * computed that a stored row does not hold. The narrative is the operator's.
 */

export const MONTHLY_REPORT_SCHEMA_VERSION = 2 as const
export const MONTHLY_NARRATIVE_MIN = 1
export const MONTHLY_NARRATIVE_MAX = 1200
export const MONTHLY_DELIVERED_MAX = 50
export const MONTHLY_OPEN_ITEMS_MAX = 20
/** 098's CHECK on a schema-2 snapshot's JSON size. Every snapshot the builder can produce fits (tested at the worst case). */
export const MONTHLY_SNAPSHOT_MAX_BYTES = 262144

export type MonthlyDeliveredItem = { title: string; recordedAt: string; versionId: string }
type SearchFigure = SnapshotFigures['search'] | { state: 'not_recorded' }

export interface MonthlyReportSnapshotV2 {
  snapshotSchemaVersion: 2
  kind: 'monthly'
  locale: ReportLocale
  month: string
  period: { start: string; end: string }
  branding: ReportBrandingSnapshot
  client: { name: string; domain: string }
  delivered: { verifiedLive: MonthlyDeliveredItem[]; selfReported: MonthlyDeliveredItem[] }
  visibility: VisibilitySection
  search: { opening: SearchFigure; closing: SearchFigure }
  nextMonth: { openWorkItems: { title: string }[] }
  executiveSummary: string
  builtAt: string
}

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/

/** The operator's narrative: plain text (newlines allowed), 1–1200 characters after trimming. */
export function normalizeNarrative(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.normalize('NFC').replace(/\r\n?/g, '\n').trim()
  if (text.length < MONTHLY_NARRATIVE_MIN || text.length > MONTHLY_NARRATIVE_MAX || CONTROL.test(text)) return null
  return text
}

const plain = (value: string, field: string) => {
  const text = value.normalize('NFC').replace(/\s+/g, ' ').trim()
  if (!text || CONTROL.test(value)) throw new Error(`${field} must be plain text`)
  return text
}

/**
 * Client identity is the one part of a report allowed to be blank. A brand may
 * have skipped its website at onboarding (and the name falls back to the
 * domain), and refusing the draft over an empty field would report a 503 for a
 * report that is otherwise perfectly honest. Control characters are still refused.
 */
const optionalPlain = (value: string, field: string) => {
  if (CONTROL.test(value)) throw new Error(`${field} must be plain text`)
  return value.normalize('NFC').replace(/\s+/g, ' ').trim()
}

function brandingSnapshot(input: ReportBrandingInput): ReportBrandingSnapshot {
  const optional = (v: string | null, f: string) => v === null ? null : plain(v, f)
  return {
    agencyName: plain(input.agencyName, 'Agency name'), logoUrl: optional(input.logoUrl, 'Logo URL'),
    primaryColor: plain(input.primaryColor, 'Primary color'), contactLabel: optional(input.contactLabel, 'Contact label'),
    contactUrl: optional(input.contactUrl, 'Contact URL'), attribution: 'Powered by Fimmick AISO',
  }
}

const searchFrom = (snapshot: MonthSnapshot | undefined): SearchFigure => snapshot ? snapshot.figures.search : { state: 'not_recorded' }

const pulsePlatforms = (snapshot: MonthSnapshot | undefined) =>
  snapshot && snapshot.figures.pulse.state === 'ok' ? snapshot.figures.pulse.platforms : []

/** Default narrative: restates only the figures in the snapshot. The operator rewrites it. */
export function defaultNarrative(locale: ReportLocale, monthLabel: string, delivered: MonthlyReportSnapshotV2['delivered']): string {
  const v = delivered.verifiedLive.length, s = delivered.selfReported.length
  return locale === 'zh-HK'
    ? `${monthLabel}：已上線核實 ${v} 項修改，自行申報 ${s} 項。`
    : `${monthLabel}: ${v} ${v === 1 ? 'change' : 'changes'} verified live and ${s} self-reported.`
}

export function buildMonthlyReportSnapshot(input: {
  locale: ReportLocale
  period: BrandMonthPeriod
  monthLabel: string
  branding: ReportBrandingInput
  client: { name: string; domain: string }
  activity: MonthActivity
  snapshots: MonthSnapshot[]
  /** The month's stored weekly Pulse rollups, which is what the movement rule judges. */
  pulseWeeks: readonly PulsePlatformWeek[]
  openWorkItems: { title: string }[]
  narrative: string | null
  now: Date
}): MonthlyReportSnapshotV2 {
  const item = (d: MonthActivity['verifiedLive'][number]): MonthlyDeliveredItem => ({ title: plain(d.title || '—', 'Title'), recordedAt: d.recordedAt, versionId: d.versionId })
  const delivered = {
    verifiedLive: input.activity.verifiedLive.slice(0, MONTHLY_DELIVERED_MAX).map(item),
    selfReported: input.activity.selfReported.slice(0, MONTHLY_DELIVERED_MAX).map(item),
  }
  const narrative = input.narrative === null ? defaultNarrative(input.locale, input.monthLabel, delivered) : normalizeNarrative(input.narrative)
  if (!narrative) throw new Error('Narrative must be 1–1200 characters of plain text')
  const openingSnapshot = input.snapshots.find(s => s.kind === 'opening')
  const closingSnapshot = input.snapshots.find(s => s.kind === 'closing')
  return {
    snapshotSchemaVersion: MONTHLY_REPORT_SCHEMA_VERSION, kind: 'monthly', locale: input.locale,
    month: input.period.key, period: { start: input.period.start, end: input.period.end },
    branding: brandingSnapshot(input.branding),
    client: { name: optionalPlain(input.client.name, 'Client name'), domain: optionalPlain(input.client.domain, 'Client domain') },
    delivered,
    visibility: buildVisibility({
      weeks: input.pulseWeeks,
      opening: pulsePlatforms(openingSnapshot).map(p => ({ platform: p.platform, sovScore: p.sovScore })),
      closing: pulsePlatforms(closingSnapshot).map(p => ({ platform: p.platform, sovScore: p.sovScore })),
    }),
    search: { opening: searchFrom(openingSnapshot), closing: searchFrom(closingSnapshot) },
    nextMonth: { openWorkItems: input.openWorkItems.slice(0, MONTHLY_OPEN_ITEMS_MAX).map(w => ({ title: plain(w.title || '—', 'Title') })) },
    executiveSummary: narrative,
    builtAt: input.now.toISOString(),
  }
}

/** Reads a stored schema-2 snapshot back; anything else is rejected rather than half-rendered. */
export function parseMonthlyReportSnapshot(value: unknown): MonthlyReportSnapshotV2 | null {
  if (!value || typeof value !== 'object') return null
  const s = value as Record<string, unknown>
  const arr = (v: unknown) => Array.isArray(v)
  const delivered = s.delivered as Record<string, unknown> | undefined
  const search = s.search as Record<string, unknown> | undefined
  const next = s.nextMonth as Record<string, unknown> | undefined
  if (s.snapshotSchemaVersion !== 2 || s.kind !== 'monthly' || (s.locale !== 'en' && s.locale !== 'zh-HK')
    || typeof s.month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(s.month) || typeof s.executiveSummary !== 'string'
    || !delivered || !arr(delivered.verifiedLive) || !arr(delivered.selfReported)
    || !search || typeof search.opening !== 'object' || typeof search.closing !== 'object'
    || !next || !arr(next.openWorkItems) || !validVisibility(s.visibility)
    || !s.branding || typeof s.branding !== 'object' || !s.client || typeof s.client !== 'object') return null
  return value as MonthlyReportSnapshotV2
}

const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value)
const nullableNumber = (value: unknown) => value === null || number(value)

/**
 * Three stored shapes are valid: the legacy "rule pending" section of versions
 * frozen before Q1, the no-data answer, and a recorded section. A recorded
 * platform is checked field by field so a half-written row is rejected rather
 * than rendered as a claim.
 */
function validVisibility(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  if (v.state === 'not_enough_data') return v.reason === 'movement_rule_pending' || v.reason === 'no_pulse_data'
  if (v.state !== 'recorded' || v.rule !== 1 || !number(v.minAnswersPerWeek) || !number(v.minDelta) || !Array.isArray(v.platforms)) return false
  return v.platforms.every((platform: unknown) => {
    if (!platform || typeof platform !== 'object') return false
    const p = platform as Record<string, unknown>
    return typeof p.platform === 'string' && (p.direction === null || p.direction === 'up' || p.direction === 'down')
      && (p.reason === null || p.reason === 'insufficient_weeks' || p.reason === 'insufficient_answers' || p.reason === 'no_clear_trend')
      && nullableNumber(p.opening) && nullableNumber(p.closing) && nullableNumber(p.delta) && number(p.weeks)
  })
}

