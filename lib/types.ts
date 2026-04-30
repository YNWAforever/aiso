export type CheckStatus = 'pass' | 'warn' | 'fail'

export interface CheckResult {
  status: CheckStatus
  message: string
  details?: string
}

export interface ScanResults {
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
  plan: 'starter' | 'pro' | 'enterprise'
  status: 'active' | 'past_due' | 'cancelled' | 'trialing'
  created_at: string
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
  category: string
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
