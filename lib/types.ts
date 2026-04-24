export type CheckStatus = 'pass' | 'warn' | 'fail'

export interface CheckResult {
  status: CheckStatus
  message: string
  details?: string
}

export interface ScanResults {
  c1_robots: CheckResult
  c2_llms_txt: CheckResult
  c3_bot_access: CheckResult
  c4_structured_data: CheckResult
  c5_extractability: CheckResult
}

export interface Scan {
  id: string
  url: string
  domain: string
  score: number
  results: ScanResults
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
  created_at: string
}
