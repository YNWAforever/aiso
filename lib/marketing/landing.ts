import { CORE_PTS, EXT_PTS, GEO_PTS, assignGrade, scorePts } from '@/lib/scoring'
import { CHECKOUT_PLAN_IDS, PLAN_CATALOG, type CheckoutPlanId } from '@/lib/plans/catalog'
import type { CheckStatus } from '@/lib/types'

/**
 * Data behind the landing page's sample report and pricing table.
 *
 * The sample is a synthetic illustration (example.invalid). Only the statuses
 * are invented; its score, grade, pillar points and "if the top 3 fixes are
 * done" figure are all computed from them with the real weights in
 * lib/scoring.ts, so the preview can never show a number the scorer would not
 * produce for those statuses.
 */

export type Pillar = 'core' | 'extended' | 'geo'
type SampleStatus = Extract<CheckStatus, 'pass' | 'warn' | 'fail'>

export const PILLAR_WEIGHTS: Record<Pillar, Readonly<Record<string, number>>> = {
  core: CORE_PTS,
  extended: EXT_PTS,
  geo: GEO_PTS,
}

export const SAMPLE_DOMAIN = 'example.invalid'

const SAMPLE_STATUSES: Record<string, SampleStatus> = {
  c1_robots: 'pass', c2_llms_txt: 'fail', c3_bot_access: 'pass', c4_structured_data: 'warn', c5_extractability: 'pass',
  c6_llms_full_txt: 'warn', c7_mcp_card: 'fail', c8_sitemap: 'pass', c9_meta_desc: 'pass', c10_headings: 'warn',
  c11_faq: 'fail', c12_canonical: 'pass', c13_render: 'pass', c14_internal_links: 'pass', c15_entity: 'warn', c16_freshness: 'pass',
  c17_citation_density: 'warn', c18_factual_density: 'pass', c19_topical_authority: 'fail', c20_chunkability: 'pass',
}

export interface SampleCheck { key: string; pillar: Pillar; status: SampleStatus; weight: number }

export const SAMPLE_CHECKS: readonly SampleCheck[] = (Object.keys(PILLAR_WEIGHTS) as Pillar[]).flatMap(pillar =>
  Object.entries(PILLAR_WEIGHTS[pillar]).map(([key, weight]) => ({ key, pillar, weight, status: SAMPLE_STATUSES[key]! })),
)

const earned = (check: SampleCheck) => scorePts({ status: check.status, message: '' }, check.weight)

export function samplePillarPoints(pillar: Pillar): { earned: number; max: number } {
  const checks = SAMPLE_CHECKS.filter(check => check.pillar === pillar)
  return { earned: checks.reduce((sum, check) => sum + earned(check), 0), max: checks.reduce((sum, check) => sum + check.weight, 0) }
}

/** Failing checks worth the most points first; ties keep check order. */
export function sampleTopFixes(count = 3): readonly SampleCheck[] {
  return SAMPLE_CHECKS.filter(check => check.status === 'fail').sort((a, b) => b.weight - a.weight).slice(0, count)
}

export function sampleSummary() {
  const score = SAMPLE_CHECKS.reduce((sum, check) => sum + earned(check), 0)
  const potential = Math.min(100, score + sampleTopFixes().reduce((sum, check) => sum + check.weight - earned(check), 0))
  return { score, grade: assignGrade(score), potential, potentialGrade: assignGrade(potential) }
}

/**
 * Pricing table cells, read from the plan catalog so the landing page cannot
 * claim more than /pricing does. Free is a footnote, as on /pricing: anonymous
 * scans need no plan, and the Fix Pack needs only a free account.
 */
export type PricingCell = boolean | { kind: 'scans' | 'brands'; count: number | null }

/**
 * No history row: that allowance is AI Pulse history, and Monitor is hidden
 * until Pulse is scheduled in production (decision 2026-10-22).
 */
export interface PricingRow { key: 'checks' | 'fixpack' | 'scans' | 'brands' | 'client_report' | 'csv'; cells: Record<CheckoutPlanId, PricingCell> }

export function landingPricingRows(): readonly PricingRow[] {
  const per = <T extends PricingCell>(pick: (plan: CheckoutPlanId) => T) =>
    Object.fromEntries(CHECKOUT_PLAN_IDS.map(plan => [plan, pick(plan)])) as Record<CheckoutPlanId, T>
  return [
    { key: 'checks', cells: per(() => true) },
    { key: 'fixpack', cells: per(() => true) },
    { key: 'scans', cells: per(plan => ({ kind: 'scans', count: PLAN_CATALOG[plan].monthlyScanLimit })) },
    { key: 'brands', cells: per(plan => ({ kind: 'brands', count: PLAN_CATALOG[plan].maxBrands })) },
    { key: 'client_report', cells: per(plan => PLAN_CATALOG[plan].features.client_reports_online && PLAN_CATALOG[plan].release.clientReports === 'available') },
    { key: 'csv', cells: per(plan => PLAN_CATALOG[plan].features.csv_export) },
  ]
}

export function planPriceUsd(plan: CheckoutPlanId): number {
  return PLAN_CATALOG[plan].monthlyPriceUsd
}
