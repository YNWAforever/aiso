import type { PlanFeatures } from '@/lib/types'

const FEATURES: Record<string, PlanFeatures> = {
  basic: {
    plan: 'basic',
    platform_access: ['gemini'],
    agent_recs: true, agent_progress: false, agent_competitors: false,
    alerts: false, csv_export: false,
    max_brands: 1, history_weeks: 4, edit_prompts: false,
  },
  pro: {
    plan: 'pro',
    platform_access: ['gemini', 'gpt4o', 'claude', 'perplexity-s', 'perplexity-p'],
    agent_recs: true, agent_progress: true, agent_competitors: false,
    alerts: true, csv_export: false,
    max_brands: 3, history_weeks: 26, edit_prompts: true,
  },
  enterprise: {
    plan: 'enterprise',
    platform_access: ['gemini', 'gpt4o', 'claude', 'perplexity-s', 'perplexity-p'],
    agent_recs: true, agent_progress: true, agent_competitors: true,
    alerts: true, csv_export: true,
    max_brands: 10, history_weeks: 999, edit_prompts: true,
  },
}

export function getPlanFeatures(plan: string): PlanFeatures {
  return FEATURES[plan] ?? FEATURES.basic!
}

export function planAllows(plan: string, feature: keyof PlanFeatures): boolean {
  const f = getPlanFeatures(plan)
  return Boolean(f[feature])
}

export function maxBrandsForPlan(plan: string): number {
  return getPlanFeatures(plan).max_brands
}
