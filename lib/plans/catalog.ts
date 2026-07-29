export const PLAN_IDS = ['free', 'basic', 'pro', 'enterprise'] as const
export const CHECKOUT_PLAN_IDS = ['basic', 'pro', 'enterprise'] as const

export type PlanId = (typeof PLAN_IDS)[number]
export type CheckoutPlanId = (typeof CHECKOUT_PLAN_IDS)[number]
export type ReleaseState = 'available' | 'planned' | 'custom' | 'unavailable'
export type CompetitorMode = 'none' | 'summary' | 'full'
export type ReportBranding = 'none' | 'fimmick' | 'white-label'
export type SupportLevel = 'standard' | 'priority' | 'contractual'
export type MonitoringCadence = 'manual' | 'weekly'
export type ExportFormat = 'csv' | 'pdf' | 'api'
export type StripePriceMap = Record<CheckoutPlanId, string>

export interface PlanFeatures {
  plan: PlanId
  platform_access: string[]
  agent_recs: boolean
  agent_progress: boolean
  agent_competitors: boolean
  alerts: boolean
  csv_export: boolean
  max_brands: number
  history_weeks: number
  edit_prompts: boolean
  local_trust_roi: boolean
  local_trust_competitors: boolean
  local_trust_export: boolean
  client_reports_online: boolean
}

export interface PlanReleaseState {
  monitoring: ReleaseState
  competitorSummary: ReleaseState
  clientReports: ReleaseState
  whiteLabelPdf: ReleaseState
  publicApi: ReleaseState
  customPlatforms: ReleaseState
  dedicatedSuccess: ReleaseState
}

export interface PlanDefinition {
  id: PlanId
  checkout: boolean
  monthlyPriceUsd: number
  maxBrands: number
  historyWeeks: number | null
  monthlyScanLimit: number | null
  monitoringCadence: MonitoringCadence
  competitorMode: CompetitorMode
  reportBranding: ReportBranding
  exportFormats: readonly ExportFormat[]
  supportLevel: SupportLevel
  release: PlanReleaseState
  features: PlanFeatures
}

const unavailableRelease: PlanReleaseState = {
  monitoring: 'unavailable',
  competitorSummary: 'unavailable',
  clientReports: 'unavailable',
  whiteLabelPdf: 'unavailable',
  publicApi: 'unavailable',
  customPlatforms: 'unavailable',
  dedicatedSuccess: 'unavailable',
}

export const PLAN_CATALOG: Record<PlanId, PlanDefinition> = {
  free: {
    id: 'free', checkout: false, monthlyPriceUsd: 0,
    maxBrands: 1, historyWeeks: 0, monthlyScanLimit: 0,
    monitoringCadence: 'manual', competitorMode: 'none', reportBranding: 'none',
    exportFormats: [], supportLevel: 'standard', release: unavailableRelease,
    features: {
      plan: 'free', platform_access: [],
      agent_recs: false, agent_progress: false, agent_competitors: false,
      alerts: false, csv_export: false, max_brands: 1, history_weeks: 0,
      edit_prompts: false, local_trust_roi: false,
      local_trust_competitors: false, local_trust_export: false, client_reports_online: false,
    },
  },
  basic: {
    id: 'basic', checkout: true, monthlyPriceUsd: 29,
    maxBrands: 1, historyWeeks: 4, monthlyScanLimit: 3,
    monitoringCadence: 'manual', competitorMode: 'none', reportBranding: 'none',
    exportFormats: [], supportLevel: 'standard', release: unavailableRelease,
    features: {
      plan: 'basic', platform_access: ['gemini'],
      agent_recs: true, agent_progress: false, agent_competitors: false,
      alerts: false, csv_export: false, max_brands: 1, history_weeks: 4,
      edit_prompts: false, local_trust_roi: false,
      local_trust_competitors: false, local_trust_export: false, client_reports_online: false,
    },
  },
  pro: {
    id: 'pro', checkout: true, monthlyPriceUsd: 79,
    maxBrands: 3, historyWeeks: 26, monthlyScanLimit: null,
    monitoringCadence: 'weekly', competitorMode: 'summary', reportBranding: 'fimmick',
    exportFormats: [], supportLevel: 'standard',
    release: {
      ...unavailableRelease,
      monitoring: 'planned', competitorSummary: 'planned', clientReports: 'available',
    },
    features: {
      plan: 'pro',
      platform_access: ['gemini', 'gpt4o', 'claude', 'perplexity-s', 'perplexity-p'],
      agent_recs: true, agent_progress: true, agent_competitors: false,
      alerts: true, csv_export: false, max_brands: 3, history_weeks: 26,
      edit_prompts: true, local_trust_roi: true,
      local_trust_competitors: false, local_trust_export: false, client_reports_online: true,
    },
  },
  enterprise: {
    id: 'enterprise', checkout: true, monthlyPriceUsd: 199,
    maxBrands: 10, historyWeeks: null, monthlyScanLimit: null,
    monitoringCadence: 'weekly', competitorMode: 'full', reportBranding: 'fimmick',
    exportFormats: ['csv'], supportLevel: 'priority',
    release: {
      monitoring: 'planned', competitorSummary: 'available', clientReports: 'available',
      whiteLabelPdf: 'planned', publicApi: 'custom', customPlatforms: 'custom',
      dedicatedSuccess: 'custom',
    },
    features: {
      plan: 'enterprise',
      platform_access: ['gemini', 'gpt4o', 'claude', 'perplexity-s', 'perplexity-p'],
      agent_recs: true, agent_progress: true, agent_competitors: true,
      alerts: true, csv_export: true, max_brands: 10, history_weeks: 999,
      edit_prompts: true, local_trust_roi: true,
      local_trust_competitors: true, local_trust_export: true, client_reports_online: true,
    },
  },
}

export function getPlanDefinition(value: unknown): PlanDefinition {
  return typeof value === 'string' && PLAN_IDS.includes(value as PlanId)
    ? PLAN_CATALOG[value as PlanId]!
    : PLAN_CATALOG.free
}

export function getCheckoutPlanId(value: unknown): CheckoutPlanId | null {
  return typeof value === 'string' && CHECKOUT_PLAN_IDS.includes(value as CheckoutPlanId)
    ? value as CheckoutPlanId
    : null
}

export type PricingAllowanceMessageKey =
  | 'allowance_scans_monthly'
  | 'allowance_scans_fair_use'
  | 'allowance_brands'
  | 'allowance_history_weeks'
  | 'allowance_history_lifetime'

export type PricingAllowanceFormatter = (
  key: PricingAllowanceMessageKey,
  values?: Record<string, number>,
) => string

export interface PricingAllowanceProjection {
  scans: string
  brands: string
  history: string
}

export function buildPricingAllowanceProjection(
  plan: CheckoutPlanId,
  format: PricingAllowanceFormatter,
): PricingAllowanceProjection {
  const definition = PLAN_CATALOG[plan]
  return {
    scans: definition.monthlyScanLimit === null
      ? format('allowance_scans_fair_use')
      : format('allowance_scans_monthly', { count: definition.monthlyScanLimit }),
    brands: format('allowance_brands', { count: definition.maxBrands }),
    history: definition.historyWeeks === null
      ? format('allowance_history_lifetime')
      : format('allowance_history_weeks', { count: definition.historyWeeks }),
  }
}

export function getPlanFromStripePrice(
  priceId: string,
  prices: Partial<StripePriceMap>,
): CheckoutPlanId | null {
  if (!priceId) return null
  const matches = CHECKOUT_PLAN_IDS.filter(plan => prices[plan] === priceId)
  return matches.length === 1 ? matches[0]! : null
}
