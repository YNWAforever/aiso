import type {
  CheckResult,
  LocalTrustBucketKey,
  LocalTrustBucketScore,
  LocalTrustGap,
} from '@/lib/types'
import { estimateRoi } from './roi'
import type { LocalTrustInput, LocalTrustSnapshotDraft } from './types'

const BUCKET_LABELS: Record<LocalTrustBucketKey, string> = {
  local_visibility: 'Local visibility',
  proof_depth: 'Proof depth',
  ai_answer_readiness: 'AI answer readiness',
  market_authority: 'Market authority',
}

function clamp(value: number, max = 100) {
  return Math.max(0, Math.min(max, Math.round(value)))
}

function statusPoints(result: unknown, passPoints: number, warnPoints = Math.round(passPoints * 0.6)) {
  const status = (result as CheckResult | undefined)?.status
  if (status === 'pass') return passPoints
  if (status === 'warn') return warnPoints
  if (status === 'fail') return 0
  return 0
}

function latestAggregateSov(input: LocalTrustInput) {
  return input.pulseSummary
    .filter(row => !row.platform)
    .sort((a, b) => a.scan_week.localeCompare(b.scan_week))
    .at(-1)
}

function snapshotMonthFrom(value: string | null | undefined) {
  const fallback = '1970-01'
  const month = value && value.length >= 7 ? value.slice(0, 7) : fallback
  return `${month}-01`
}

function bucket(
  key: LocalTrustBucketKey,
  score: number,
  explanation: string,
  strongestSignal: string,
  weakestSignal: string,
  topAction: string,
): LocalTrustBucketScore {
  return {
    key,
    label: BUCKET_LABELS[key],
    score: clamp(score, 25),
    maxScore: 25,
    explanation,
    strongestSignal,
    weakestSignal,
    topAction,
  }
}

function buildGaps(input: LocalTrustInput, buckets: LocalTrustBucketScore[]): LocalTrustGap[] {
  const gaps: LocalTrustGap[] = []
  const results = input.scan?.results ?? {}

  if (!input.scan) {
    gaps.push({
      stableKey: 'run-first-scan',
      title: 'Run the first AISO scan',
      bucket: 'ai_answer_readiness',
      impact: 'high',
      effort: 'low',
      rationale: 'The ROI view needs a baseline scan before it can show trustworthy progress.',
      suggestedTarget: 'Dashboard scan step',
    })
  }

  if (!input.profile?.service_area) {
    gaps.push({
      stableKey: 'add-service-area',
      title: 'Confirm your local service area',
      bucket: 'local_visibility',
      impact: 'high',
      effort: 'low',
      rationale: 'Local AI discovery depends on clear market and service-area signals.',
      suggestedTarget: 'Local Trust setup',
    })
  }

  if (!input.profile?.primary_services?.length) {
    gaps.push({
      stableKey: 'add-primary-services',
      title: 'Add your primary services',
      bucket: 'local_visibility',
      impact: 'high',
      effort: 'low',
      rationale: 'Service labels help the dashboard map visibility gaps to owner-friendly actions.',
      suggestedTarget: 'Local Trust setup',
    })
  }

  if ((results.c11_faq as CheckResult | undefined)?.status !== 'pass') {
    gaps.push({
      stableKey: 'add-local-faq',
      title: 'Add comparison and local buyer FAQs',
      bucket: 'ai_answer_readiness',
      impact: 'high',
      effort: 'low',
      rationale: 'FAQs make high-consideration services easier for AI systems to quote and summarize.',
      suggestedTarget: 'Priority service pages',
    })
  }

  if ((results.c15_entity as CheckResult | undefined)?.status !== 'pass') {
    gaps.push({
      stableKey: 'strengthen-entity-proof',
      title: 'Strengthen credentials and entity proof',
      bucket: 'proof_depth',
      impact: 'high',
      effort: 'medium',
      rationale: 'Professional and B2B buyers look for credentials, team authority, and proof before enquiring.',
      suggestedTarget: 'About, team, and service pages',
    })
  }

  if (input.missed.length > 0) {
    gaps.push({
      stableKey: 'close-missed-local-query',
      title: 'Create content for missed local AI queries',
      bucket: 'market_authority',
      impact: 'medium',
      effort: 'medium',
      rationale: 'Missed Pulse queries reveal where competitors are being cited instead of your brand.',
      suggestedTarget: input.missed[0]?.question ?? 'Pulse missed opportunities',
    })
  }

  for (const weakBucket of buckets.filter(b => b.score < 12)) {
    gaps.push({
      stableKey: `improve-${weakBucket.key}`,
      title: weakBucket.topAction,
      bucket: weakBucket.key,
      impact: 'medium',
      effort: 'medium',
      rationale: weakBucket.explanation,
      suggestedTarget: weakBucket.weakestSignal,
    })
  }

  const rank = { high: 0, medium: 1, low: 2 }
  const effortRank = { low: 0, medium: 1, high: 2 }
  return gaps
    .filter((gap, index, arr) => arr.findIndex(other => other.stableKey === gap.stableKey) === index)
    .sort((a, b) => rank[a.impact] - rank[b.impact] || effortRank[a.effort] - effortRank[b.effort])
}

export function calculateLocalTrust(input: LocalTrustInput): LocalTrustSnapshotDraft {
  const results = input.scan?.results ?? {}
  const latestSov = latestAggregateSov(input)
  const serviceArea = input.profile?.service_area || input.scan?.region || input.client.industry
  const accountId = input.scan?.account_id ?? input.profile?.account_id ?? null
  const hasVisibilityBaseline = Boolean(input.scan || latestSov)

  const localVisibility = bucket(
    'local_visibility',
    (serviceArea ? 8 : 0) +
      (input.profile?.primary_services?.length ? 5 : 0) +
      statusPoints(results.c8_sitemap, 4) +
      statusPoints(results.c12_canonical, 4) +
      statusPoints(results.c15_entity, 4),
    serviceArea ? 'Your site has identifiable market or service-area signals.' : 'Your local service area is not clear enough yet.',
    serviceArea ? `Service area: ${serviceArea}` : 'No service area confirmed',
    input.profile?.primary_services?.length ? 'Local schema and entity signals need review' : 'Primary services are missing',
    'Clarify local services and service area on priority pages',
  )

  const proofDepth = bucket(
    'proof_depth',
    (input.profile?.primary_services?.length ? 5 : 0) +
      statusPoints(results.c15_entity, 7) +
      statusPoints(results.c11_faq, 5) +
      statusPoints(results.c17_citation_density, 4) +
      statusPoints(results.c18_factual_density, 4),
    'Proof depth estimates whether a cautious local buyer can verify your credibility.',
    input.profile?.primary_services?.length ? 'Primary services are identified' : 'Technical proof signals are available',
    (results.c15_entity as CheckResult | undefined)?.status === 'pass' ? 'Case-study depth still needs review' : 'Entity and credential signals are weak',
    'Add credentials, case studies, testimonials, and measurable proof near conversion points',
  )

  const aiAnswerReadiness = bucket(
    'ai_answer_readiness',
    statusPoints(results.c4_structured_data, 4) +
      statusPoints(results.c5_extractability, 5) +
      statusPoints(results.c10_headings, 4) +
      statusPoints(results.c11_faq, 4) +
      statusPoints(results.c13_render, 4) +
      statusPoints(results.c20_chunkability, 4),
    'AI answer readiness measures whether your service content can be parsed, summarized, and cited.',
    (results.c5_extractability as CheckResult | undefined)?.status === 'pass' ? 'Content is extractable' : 'Structured checks are present',
    (results.c11_faq as CheckResult | undefined)?.status === 'pass' ? 'Comparison content can improve' : 'FAQ coverage is weak',
    'Add buyer-question sections and concise service explanations',
  )

  const marketAuthority = bucket(
    'market_authority',
    Math.min(8, Math.round((input.scan?.score ?? 0) / 12.5)) +
      Math.min(8, Math.round((latestSov?.sov_score ?? 0) / 12.5)) +
      statusPoints(results.c17_citation_density, 5) +
      (input.competitors.length ? 2 : 0) +
      (input.missed.length ? 0 : 2),
    'Market authority combines AISO strength, citations, and whether competitors are winning AI answers.',
    latestSov ? `Pulse SoV: ${latestSov.sov_score}%` : 'AISO scan score is available',
    input.missed.length ? 'Competitors are still appearing in missed queries' : 'Pulse data is missing or incomplete',
    'Earn more trusted local and industry citations, then close missed Pulse queries',
  )

  const buckets = [localVisibility, proofDepth, aiAnswerReadiness, marketAuthority]
  const score = clamp(buckets.reduce((sum, item) => sum + item.score, 0))
  const draft: LocalTrustSnapshotDraft = {
    client_id: input.client.id,
    account_id: accountId,
    snapshot_month: snapshotMonthFrom(latestSov?.scan_week ?? input.scan?.created_at),
    local_trust_score: score,
    bucket_scores: buckets,
    trust_gaps: [],
    roi_estimate: null,
    source_scan_id: input.scan?.id ?? null,
    source_pulse_week: latestSov?.scan_week ?? null,
  }

  draft.trust_gaps = buildGaps(input, buckets)
  draft.roi_estimate = hasVisibilityBaseline
    ? estimateRoi({
        currentSnapshot: draft,
        averageLeadValue: input.profile?.average_lead_value,
        closeRate: input.profile?.close_rate,
      })
    : null
  return draft
}
