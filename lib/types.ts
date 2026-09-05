import type { CheckDiagnostic, ScanEvidence } from '@/lib/scan-evidence'
export type CheckStatus = 'pass' | 'warn' | 'fail'

export interface CheckResult {
  status: CheckStatus
  message: string
  details?: string
  diagnostic?: CheckDiagnostic
}

export interface ScanResults {
  evidence?: ScanEvidence
  // Core checks (45 pts)
  c1_robots:          CheckResult
  c2_llms_txt:        CheckResult
  c3_bot_access:      CheckResult
  c4_structured_data: CheckResult
  c5_extractability:  CheckResult
  // Extended checks (30 pts)
  c6_llms_full_txt?:   CheckResult
  c7_mcp_card?:        CheckResult
  c8_sitemap?:         CheckResult
  c9_meta_desc?:       CheckResult
  c10_headings?:       CheckResult
  c11_faq?:            CheckResult
  c12_canonical?:      CheckResult
  c13_render?:         CheckResult
  c14_internal_links?: CheckResult
  c15_entity?:         CheckResult
  c16_freshness?:      CheckResult
}

export interface Scan {
  id: string
  url: string
  domain: string
  score: number
  grade?: string | null
  industry?: string | null
  region?: string | null
  results: ScanResults & Record<string, unknown>
  account_id: string | null
  agent_status?: AgentStatus | null
  created_at: string
}

export interface FixPack {
  id: string
  scan_id: string
  llms_txt: string
  robots_patch: string
  faq_schema: string
  created_at: string
}

export interface Client {
  id: string
  brand_name: string
  domain: string | null
  industry: string | null
  competitors: string[]
  status: string
  created_at: string
}

export interface PulseWeeklySummary {
  id: string
  client_id: string
  scan_week: string
  platform: string | null
  total_queries: number
  brand_mentions: number
  sov_score: number
  avg_sentiment_score: number
  top_competitors: Record<string, number>
  created_at: string
}

export interface PulseMetric {
  id: string
  client_id: string
  prompt_id: string
  platform: string
  question: string
  raw_answer: string | null
  brand_mentioned: boolean
  sentiment: 'positive' | 'neutral' | 'negative' | 'not_mentioned'
  mention_position: number | null
  competitors_mentioned: string[]
  scan_week: string
  created_at: string
}

export interface Account {
  id: string
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  plan: 'basic' | 'pro' | 'enterprise'
  status: 'active' | 'past_due' | 'cancelled' | 'trialing'
  // These four are `timestamptz`, and the Neon driver returns those as a JS
  // `Date`. They were typed `string` only, which is why lib/tier.ts's
  // `typeof … === 'string'` trial check silently never matched.
  trial_started_at: string | Date | null
  trial_ends_at: string | Date | null
  trial_emails_sent: number
  created_at: string | Date
  override_plan: string | null
  override_expires_at: string | Date | null
}

export interface Profile {
  id: string
  account_id: string
  display_name: string | null
  email: string | null   // from auth.users, attached by getProfile()
  is_admin: boolean
  created_at: string
}

export interface ProfileWithAccount extends Profile {
  accounts: Account
}

export interface PromptBankItem {
  id: string
  client_id: string
  // Nullable in the database (002_phase2.sql:13) and written by an LLM, so a row
  // may carry no category at all. Typing this `string` let grouping code index
  // by null and produce a section literally keyed "null".
  category: string | null
  question: string
  language: string
  is_active: boolean
  created_at: string
}

export interface AlertConfig {
  id?: string
  client_id: string
  enabled_sov: boolean
  sov_threshold: number
  enabled_wow: boolean
  wow_threshold: number
  notify_email: boolean
  notify_inapp: boolean
  created_at?: string
  updated_at?: string
}

export interface Notification {
  id: string
  account_id: string
  client_id: string | null
  type: 'sov_threshold' | 'sov_wow_drop' | 'sov_recovery'
  title: string
  message: string
  read: boolean
  /** ISO date of the pulse scan week — used for deduplication (unique per client+type+week) */
  scan_week: string | null
  created_at: string
}

// ── AISO v3.3 Types ──────────────────────────────────────────────

export type IndustryCode =
  | 'finance' | 'medical' | 'legal' | 'technology'
  | 'retail_ecommerce' | 'travel_hospitality' | 'education'
  | 'real_estate' | 'manufacturing' | 'media_entertainment'
  | 'energy_utilities' | 'general_b2b' | 'general_b2c'

export type RegionCode =
  | 'HK' | 'TW' | 'SG' | 'JP' | 'KR'
  | 'US' | 'UK' | 'EU' | 'AU' | 'CA' | 'global'

export type AuthorityTier = 'tier1' | 'tier2' | 'tier3' | 'other' | 'blacklist'

export interface CheckContext {
  industry: IndustryCode
  region: RegionCode
  clientId?: string
}

export interface AuthorityBreakdown {
  layer1_tld:      { baseScore: number; category: string }
  layer2_signals:  { signalScore: number; signals: Record<string, unknown> }
  layer3_industry: { score: number; tier: AuthorityTier; multiplier: number }
  layer4_regional: { score: number; tier: AuthorityTier }
  layer5_dynamic:  { zScore: number; dynamicBoost: number; citationFrequency90d: number } | null
  finalScore:      number
  tier:            AuthorityTier
  // Flat aliases for convenient access in tests and UI
  totalScore?:  number
  layer1Score?: number
  layer2Score?: number
  layer3Score?: number
  layer4Score?: number
}

export interface CitationDensityResult {
  qualityScore:              number
  totalLinks:                number
  externalLinks:             number
  authorityBreakdown:        { tier1: number; tier2: number; tier3: number; other: number }
  citationsPerThousandWords: number
  hasStatistics:             boolean
  statisticsWithSource:      number
  details: Array<{ url: string; domain: string; tier: AuthorityTier; authorityScore: number }>
}

export interface FactualDensityResult {
  qualityScore:       number
  numberDensity:      number
  namedEntityDensity: number
  dateReferences:     number
  hasComparativeData: boolean
  hasTimeSeriesData:  boolean
  uniquenessScore:    number
  uniqueClaims:       string[]
}

export interface TopicalAuthorityResult {
  topicalCoverageScore: number
  detectedClusters: Array<{
    topic:               string
    pillarPageUrl:       string
    pillarPageWordCount: number
    clusterArticles:     Array<{ url: string; title: string; wordCount: number }>
    interlinkCount:      number
    completenessScore:   number
  }>
  totalClusters:  number
  hasOrphanPages: number
}

export interface ChunkabilityResult {
  avgChunkLength:    number
  optimalChunkRatio: number
  hasFaqStyle:       boolean
  totalChunks:       number
  chunkAnalysis: Array<{
    heading:             string
    wordCount:           number
    tokenEstimate:       number
    isAnswerFirst:       boolean
    isSelfContained:     boolean
    hasDefinition:       boolean
    hasList:             boolean
    extractabilityScore: number
  }>
}

export interface ScanResultsV3 {
  c17_citation_density?:  CitationDensityResult
  c18_factual_density?:   FactualDensityResult
  c19_topical_authority?: TopicalAuthorityResult
  c20_chunkability?:      ChunkabilityResult
  geoScore?: number
  grade?:    string
}

/**
 * The 20 check result keys.
 *
 * Unions BOTH result interfaces: `ScanResults` declares c1-c16 and
 * `ScanResultsV3` declares the four GEO checks c17-c20. Reading only the first
 * would silently omit a fifth of the checks from anything derived from this.
 * The template-literal filter excludes the non-check members `geoScore` and
 * `grade`, so a bare `keyof` is not equivalent.
 */
export type CheckKey =
  | Extract<keyof ScanResults, `c${number}_${string}`>
  | Extract<keyof ScanResultsV3, `c${number}_${string}`>

// Typed Record<CheckKey, true> so the compiler rejects this object if any check
// key is missing -- the array below therefore cannot drift from the interfaces.
// Deliberately NOT derived from CHECK_EXPLANATIONS: a guard that takes its
// expected set from the thing it checks is circular and would pass with a check
// absent from every locale.
const CHECK_KEY_PRESENCE: Record<CheckKey, true> = {
  c1_robots: true, c2_llms_txt: true, c3_bot_access: true, c4_structured_data: true,
  c5_extractability: true, c6_llms_full_txt: true, c7_mcp_card: true, c8_sitemap: true,
  c9_meta_desc: true, c10_headings: true, c11_faq: true, c12_canonical: true,
  c13_render: true, c14_internal_links: true, c15_entity: true, c16_freshness: true,
  c17_citation_density: true, c18_factual_density: true, c19_topical_authority: true,
  c20_chunkability: true,
}

export const CHECK_KEYS = Object.keys(CHECK_KEY_PRESENCE) as CheckKey[]

// ── Agent Dashboard Types ─────────────────────────────────────────

export type AgentStatus = 'pending' | 'running' | 'complete' | 'error'

export interface AgentRecommendation {
  id: string
  scan_id: string
  platform: string
  category: string
  priority: 'high' | 'medium' | 'low'
  recommendation: string
  impact_score: number
  created_at: string
}

export interface AgentProgress {
  id: string
  scan_id: string
  platform: string
  metric: string
  current_value: number
  previous_value: number | null
  delta: number | null
  created_at: string
}

export interface AgentCompetitor {
  id: string
  scan_id: string
  platform: string
  competitor_domain: string
  competitor_name: string | null
  mention_rate: number
  your_rate: number
  gap_analysis: string
  created_at: string
}

export interface ClientOverview {
  client: { brand_name: string }
  latestScan: Scan | null
  scanHistory: Pick<Scan, 'id' | 'domain' | 'score' | 'grade' | 'created_at'>[]
  recommendations: AgentRecommendation[]
  progress: AgentProgress[]
  competitors: AgentCompetitor[]
  pulseSummary: PulseWeeklySummary[]
  pulseKpi: { sovScore: number; brandMentions: number; totalQueries: number; platformCount: number; scanWeek: string } | null
  missedOpportunities: Pick<PulseMetric, 'platform' | 'question' | 'competitors_mentioned' | 'scan_week'>[]
}

export type { PlanFeatures } from '@/lib/plans/catalog'

export type LocalTrustBucketKey = 'local_visibility' | 'proof_depth' | 'ai_answer_readiness' | 'market_authority'
export type LocalTrustActionStatus = 'open' | 'planned' | 'done' | 'skipped'
export type LocalTrustImpact = 'low' | 'medium' | 'high'
export type LocalTrustEffort = 'low' | 'medium' | 'high'

export interface LocalTrustProfile {
  id: string
  client_id: string
  account_id: string
  primary_services: string[]
  service_area: string | null
  average_lead_value: number | null
  close_rate: number | null
  competitors: string[]
  created_at: string
  updated_at: string
}

export interface LocalTrustBucketScore {
  key: LocalTrustBucketKey
  label: string
  score: number
  maxScore: number
  explanation: string
  strongestSignal: string
  weakestSignal: string
  topAction: string
}

export interface LocalTrustGap {
  stableKey: string
  title: string
  bucket: LocalTrustBucketKey
  impact: LocalTrustImpact
  effort: LocalTrustEffort
  rationale: string
  suggestedTarget: string
}

export interface LocalTrustRoiEstimate {
  low: number
  high: number
  currency: 'HKD'
  assumptions: {
    averageLeadValue: number
    closeRate: number
    estimatedExtraEnquiriesLow: number
    estimatedExtraEnquiriesHigh: number
  }
  confidence: 'directional'
}

export interface LocalTrustSnapshot {
  id: string
  client_id: string
  account_id: string
  snapshot_month: string
  local_trust_score: number
  bucket_scores: LocalTrustBucketScore[]
  trust_gaps: LocalTrustGap[]
  roi_estimate: LocalTrustRoiEstimate | null
  source_scan_id: string | null
  source_pulse_week: string | null
  created_at: string
}

export interface LocalTrustAction {
  id: string
  client_id: string
  snapshot_id: string
  stable_key: string
  title: string
  bucket: LocalTrustBucketKey
  impact: LocalTrustImpact
  effort: LocalTrustEffort
  status: LocalTrustActionStatus
  created_at: string
  updated_at: string
}

// ── Versioning contract (docs/contracts/versioning.md) ─────────────
/**
 * Bumped whenever check-engine detection logic changes for any of c1-c20.
 * Stored on new scans in results.evidence.scannerVersion; historical rows are not backfilled.
 */
export const SCANNER_VERSION = '2026-09-05.v1'

export interface ScanVersionInfo {
  scannerVersion: string
  methodologyVersion: string
}
