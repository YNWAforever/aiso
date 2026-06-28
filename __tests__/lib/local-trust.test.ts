import { describe, expect, it } from 'vitest'
import { calculateLocalTrust, estimateRoi } from '@/lib/localTrust'
import type { Client, Scan, PulseWeeklySummary, PulseMetric, AgentCompetitor, LocalTrustProfile } from '@/lib/types'

const pass = (message = 'pass') => ({ status: 'pass' as const, message })
const warn = (message = 'warn') => ({ status: 'warn' as const, message })
const fail = (message = 'fail') => ({ status: 'fail' as const, message })

const client: Client = {
  id: 'client-1',
  brand_name: 'Harbour Advisory',
  domain: 'harbour.example',
  industry: 'legal',
  competitors: ['rival.example'],
  status: 'active',
  created_at: '2026-06-01T00:00:00.000Z',
}

const profile: LocalTrustProfile = {
  id: 'profile-1',
  client_id: 'client-1',
  account_id: 'account-1',
  primary_services: ['tax advisory', 'company secretary'],
  service_area: 'Hong Kong',
  average_lead_value: 20000,
  close_rate: 0.25,
  competitors: ['rival.example'],
  created_at: '2026-06-01T00:00:00.000Z',
  updated_at: '2026-06-01T00:00:00.000Z',
}

const scan: Scan = {
  id: 'scan-1',
  url: 'https://harbour.example',
  domain: 'harbour.example',
  score: 78,
  grade: 'B',
  industry: 'legal',
  region: 'HK',
  account_id: 'account-1',
  created_at: '2026-06-20T00:00:00.000Z',
  results: {
    c4_structured_data: pass(),
    c5_extractability: pass(),
    c8_sitemap: pass(),
    c9_meta_desc: pass(),
    c10_headings: warn(),
    c11_faq: fail(),
    c12_canonical: pass(),
    c13_render: pass(),
    c14_internal_links: warn(),
    c15_entity: warn(),
    c16_freshness: warn(),
    c17_citation_density: warn(),
    c18_factual_density: warn(),
    c19_topical_authority: warn(),
    c20_chunkability: pass(),
  },
}

const pulse: PulseWeeklySummary[] = [{
  id: 'summary-1',
  client_id: 'client-1',
  scan_week: '2026-06-22',
  platform: null,
  total_queries: 20,
  brand_mentions: 8,
  sov_score: 40,
  avg_sentiment_score: 0.2,
  top_competitors: { 'rival.example': 12 },
  created_at: '2026-06-22T00:00:00.000Z',
}]

const missed: PulseMetric[] = [{
  id: 'metric-1',
  client_id: 'client-1',
  prompt_id: 'prompt-1',
  platform: 'chatgpt',
  question: 'best tax advisor hong kong',
  raw_answer: null,
  brand_mentioned: false,
  sentiment: 'not_mentioned',
  mention_position: null,
  competitors_mentioned: ['rival.example'],
  scan_week: '2026-06-22',
  created_at: '2026-06-22T00:00:00.000Z',
}]

const competitors: AgentCompetitor[] = [{
  id: 'comp-1',
  scan_id: 'scan-1',
  platform: 'chatgpt',
  competitor_domain: 'rival.example',
  competitor_name: 'Rival Advisory',
  mention_rate: 60,
  your_rate: 40,
  gap_analysis: 'Rival has stronger case studies and FAQ coverage.',
  created_at: '2026-06-22T00:00:00.000Z',
}]

describe('calculateLocalTrust', () => {
  it('returns four buckets and a capped 100-point score', () => {
    const result = calculateLocalTrust({ client, profile, scan, pulseSummary: pulse, missed, competitors })
    expect(result.local_trust_score).toBeGreaterThan(0)
    expect(result.local_trust_score).toBeLessThanOrEqual(100)
    expect(result.bucket_scores).toHaveLength(4)
    expect(result.bucket_scores.map(b => b.key)).toEqual([
      'local_visibility',
      'proof_depth',
      'ai_answer_readiness',
      'market_authority',
    ])
  })

  it('prioritizes high-impact low-effort trust gaps', () => {
    const result = calculateLocalTrust({ client, profile, scan, pulseSummary: pulse, missed, competitors })
    expect(result.trust_gaps[0]).toMatchObject({
      impact: 'high',
      effort: 'low',
    })
  })

  it('degrades when scan and Pulse data are missing', () => {
    const result = calculateLocalTrust({ client, profile: null, scan: null, pulseSummary: [], missed: [], competitors: [] })
    expect(result.local_trust_score).toBeGreaterThanOrEqual(0)
    expect(result.trust_gaps.some(g => g.stableKey === 'run-first-scan')).toBe(true)
    expect(result.roi_estimate).toBeNull()
  })
})

describe('estimateRoi', () => {
  it('returns null without lead value and close rate assumptions', () => {
    const current = calculateLocalTrust({ client, profile: { ...profile, average_lead_value: null, close_rate: null }, scan, pulseSummary: pulse, missed, competitors })
    expect(estimateRoi({ currentSnapshot: current })).toBeNull()
  })

  it('returns a directional low/high range with assumptions', () => {
    const current = calculateLocalTrust({ client, profile, scan, pulseSummary: pulse, missed, competitors })
    const estimate = estimateRoi({
      previousScore: current.local_trust_score - 10,
      currentSnapshot: current,
      averageLeadValue: 20000,
      closeRate: 0.25,
    })
    expect(estimate).toMatchObject({
      currency: 'HKD',
      confidence: 'directional',
    })
    expect(estimate!.low).toBeGreaterThan(0)
    expect(estimate!.high).toBeGreaterThan(estimate!.low)
  })
})
