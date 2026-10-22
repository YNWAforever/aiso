import { createHash, randomUUID } from 'node:crypto'
import { resolveCommercialEntitlement } from '@/lib/tier'
import { readScanEvidence } from '@/lib/scan-evidence'
import { deriveSuggestions } from '@/lib/opportunities/rules'
import { scanOpportunityCopy } from '@/lib/opportunities/presentation'
import { callOpenRouter, type JsonSchemaFormat } from '@/lib/openrouter'
import { consumeAiToolAllowance } from '@/lib/fix/guard'
import { createTaskBudget } from './budget'
import { fenceUntrusted, UNTRUSTED_SYSTEM_RULE } from './untrusted'
import { readAgentGeneration, type AgentGenerationReceipt, type ImproveResult } from './generation-state'
import { claimGeneration, commitGeneration, failGeneration, markProviderStarted, readGenerationScan, readMeasuredProgress, type GenerationScope, type GenerationInputGuard, type NativeRecommendation } from './generation-store'

export type { AgentGenerationReceipt, ImproveResult } from './generation-state'
const PRODUCER = 'native-improve.v1' as const
const MAX_RECOMMENDATIONS = 6
const MODEL = 'anthropic/claude-sonnet-4-5'

function sources(scanId: string, raw: unknown) {
  const envelope = readScanEvidence(raw)
  if (!envelope) return []
  return deriveSuggestions({ kind: 'scan-check', scanId, recordedAt: null, envelope }).slice(0, MAX_RECOMMENDATIONS)
    .flatMap(item => item.evidence.kind === 'scan-check' ? [{ checkId: item.evidence.checkKey,
      assessment: item.evidence.check.assessment, action: scanOpportunityCopy(item.evidence, 'en').action,
      source: { scanId, checkId: item.evidence.checkKey }, limitations: item.limitations }] : [])
}

function parseRecommendations(raw: string, input: ReturnType<typeof sources>, platform: string): NativeRecommendation[] {
  let parsed: { recommendations?: unknown }
  try { parsed = JSON.parse(raw) } catch { throw new Error('INVALID_GENERATED_RECOMMENDATIONS') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).some(key => key !== 'recommendations')
    || !Array.isArray(parsed.recommendations) || parsed.recommendations.length < 1 || parsed.recommendations.length > MAX_RECOMMENDATIONS) throw new Error('INVALID_GENERATED_RECOMMENDATIONS')
  const seen = new Set<string>()
  return parsed.recommendations.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_GENERATED_RECOMMENDATIONS')
    const r = value as Record<string, unknown>
    const source = input.find(item => item.checkId === r.checkId)
    if (!source || typeof r.text !== 'string' || r.text.trim().length < 20 || r.text.length > 1200
      || Object.keys(r).some(key => !['checkId', 'text'].includes(key)) || seen.has(source.checkId)) throw new Error('INVALID_GENERATED_RECOMMENDATIONS')
    seen.add(source.checkId)
    return { platform, category: source.checkId, priority: source.assessment === 'fail' ? 'high' : 'medium',
      recommendation: r.text.trim(), impact_score: source.assessment === 'fail' ? 7 : 4 }
  })
}

function recommendationFormat(checkIds: string[]): JsonSchemaFormat {
  return { name: 'grounded_improve_drafts', schema: { type: 'object', additionalProperties: false, required: ['recommendations'], properties: {
    recommendations: { type: 'array', minItems: 1, maxItems: MAX_RECOMMENDATIONS, items: { type: 'object', additionalProperties: false,
      required: ['checkId', 'text'], properties: { checkId: { type: 'string', enum: checkIds }, text: { type: 'string' } } } },
  } } }
}

function savedResult(scanId: string, raw: unknown): ImproveResult {
  const generation = readAgentGeneration(raw)
  if (!generation) return { status: 409, state: 'error', scanId, generation: null, error: 'GENERATION_OUTCOME_UNKNOWN' }
  if (generation.state === 'complete') return { status: 200, state: 'complete', scanId, generation }
  if (generation.state === 'error') return { status: 409, state: 'error', scanId, generation, error: generation.error ?? 'GENERATION_FAILED' }
  if (Date.parse(generation.leaseUntil) > Date.now()) return { status: 202, state: 'running', scanId, generation }
  return { status: 409, state: 'error', scanId, generation, error: 'GENERATION_OUTCOME_UNKNOWN' }
}

/** One scan, one native claim, at most one model call. Reads never invoke this service. */
export async function generateImprove(scope: GenerationScope): Promise<ImproveResult> {
  const { scanId } = scope
  let receipt: AgentGenerationReceipt | null = null
  try {
    const scan = await readGenerationScan(scope)
    if (!scan) return { status: 404, state: 'unavailable', scanId, generation: null, error: 'NOT_FOUND' }
    const { features, source: entitlementSource } = resolveCommercialEntitlement(scan)
    if (!features.agent_recs || !features.platform_access.length) return { status: 403, state: 'unavailable', scanId, generation: null, error: 'UPGRADE_REQUIRED' }
    if (scan.webhook_url) return { status: 409, state: 'unavailable', scanId, generation: null, error: 'EXTERNAL_AGENT_CONFIGURED' }
    const raw = scan.results?._agent_generation
    const existing = readAgentGeneration(raw)
    // A started/unknown provider boundary is never retried. Pre-provider allowance
    // failures can be retried using a fresh fenced claim because no AI call occurred.
    if (raw != null && !(existing?.state === 'error' && !existing.providerStarted)) {
      const saved = savedResult(scanId, raw)
      if (saved.error === 'GENERATION_OUTCOME_UNKNOWN' && existing?.state === 'running') {
        const abandoned: AgentGenerationReceipt = { ...existing, state: 'error', error: saved.error }
        await failGeneration(scope, abandoned)
        return { ...saved, generation: abandoned }
      }
      return saved
    }
    if (scan.agent_status === 'complete') return { status: 200, state: 'complete', scanId, generation: null }
    const input = sources(scanId, scan.results?.evidence)
    const requirements = { agent_recs: features.agent_recs, agent_progress: features.agent_progress, agent_competitors: features.agent_competitors }
    const expiry = entitlementSource === 'override' ? scan.override_expires_at
      : entitlementSource === 'trial' && !(scan.status === 'trialing' && scan.stripe_subscription_id) ? scan.trial_ends_at : null
    const guard: GenerationInputGuard = { evidence: scan.results?.evidence, commercial: scan.commercial_snapshot,
      entitlementExpiresAt: expiry instanceof Date ? expiry.toISOString() : typeof expiry === 'string' ? expiry : null }
    receipt = {
      version: 1, producer: PRODUCER, token: randomUUID(), state: 'running',
      fingerprint: createHash('sha256').update(JSON.stringify({ producer: PRODUCER, scanId, input, requirements, platforms: features.platform_access, guard })).digest('hex'),
      startedAt: new Date().toISOString(), leaseUntil: new Date(Date.now() + 60_000).toISOString(), providerStarted: false,
      outcomes: { recommendations: 'unavailable', progress: features.agent_progress ? 'unavailable' : 'not-required', competitors: features.agent_competitors ? 'unavailable' : 'not-required' },
      counts: { recommendations: 0, progress: 0, competitors: 0 }, reasons: {}, sourceCheckIds: input.map(item => item.checkId),
      recommendationBasis: input,
    }
    if (!await claimGeneration(scope, receipt, raw, requirements, features.platform_access, guard)) {
      const latest = await readGenerationScan(scope)
      return savedResult(scanId, latest?.results?._agent_generation)
    }
    const progress = features.agent_progress ? await readMeasuredProgress(scope, features.platform_access) : []
    receipt.progressSamples = progress.map(p => ({ platform: p.platform, week: p.week, classified: p.classified, mentioned: p.mentioned }))
    receipt.counts.progress = progress.length
    if (progress.length) receipt.outcomes.progress = 'available'
    else if (features.agent_progress) receipt.reasons.progress = 'no-classified-observations'
    if (features.agent_competitors) receipt.reasons.competitors = 'no-sourced-competitor-evidence'
    let recommendations: NativeRecommendation[] = []
    if (input.length) {
      // The daily allowance is only a rate counter; it does not resolve plans.
      // Read current commercial state again immediately before spending, then
      // fence the persisted state/evidence once more at the provider boundary.
      const current = await readGenerationScan(scope)
      const currentFeatures = resolveCommercialEntitlement(current).features
      if (!current || !currentFeatures.agent_recs || JSON.stringify(currentFeatures) !== JSON.stringify(features)
        || JSON.stringify(current.commercial_snapshot) !== JSON.stringify(guard.commercial)
        || JSON.stringify(current.results?.evidence) !== JSON.stringify(guard.evidence)) throw new Error('GENERATION_INPUT_CHANGED')
      const allowance = await consumeAiToolAllowance(scope.accountId)
      if (allowance) {
        receipt.state = 'error'; receipt.error = 'AI_TOOL_ALLOWANCE_UNAVAILABLE'
        await failGeneration(scope, receipt)
        return { status: allowance.status, state: 'error', scanId, generation: receipt, error: receipt.error }
      }
      if (!await markProviderStarted(scope, receipt, guard)) throw new Error('GENERATION_CLAIM_LOST')
      receipt.providerStarted = true
      const budget = createTaskBudget({ calls: 1, tokens: 1200 }); budget.reserve(1200)
      const rawOutput = await callOpenRouter({ label: 'improve.recommendations', model: MODEL, maxTokens: 1200,
        onEvidence: evidence => {
          receipt!.provider = { requestedModel: MODEL, actualModel: evidence.actualModel, requestId: evidence.requestId,
            promptTokens: evidence.promptTokens, completionTokens: evidence.completionTokens, costUsd: evidence.costUsd, httpStatus: evidence.httpStatus }
        },
        signal: AbortSignal.timeout(20_000), responseFormat: recommendationFormat(receipt.sourceCheckIds), messages: [
          { role: 'system', content: UNTRUSTED_SYSTEM_RULE + ' Write proposed website review actions using only the supplied measured checks. Each checkId must be supplied. Do not invent page contents, rankings, competitor rates, progress, or completed fixes. These are human review drafts, not per-platform measurements.' },
          { role: 'user', content: fenceUntrusted('validated scan check evidence and review actions', JSON.stringify(input)) },
        ] })
      // The storage platform is an entitlement grouping; the receipt records that
      // these drafts derive from website checks, never a platform/model measurement.
      recommendations = parseRecommendations(rawOutput, input, features.platform_access[0]!)
      receipt.counts.recommendations = recommendations.length; receipt.outcomes.recommendations = 'available'
    } else receipt.reasons.recommendations = 'no-actionable-scan-evidence'
    receipt.state = 'complete'; receipt.completedAt = new Date().toISOString()
    if (!await commitGeneration(scope, receipt, recommendations, progress, guard)) throw new Error('GENERATION_CLAIM_LOST')
    return { status: 200, state: 'complete', scanId, generation: receipt }
  } catch (error) {
    const known = ['INVALID_GENERATED_RECOMMENDATIONS', 'GENERATION_CLAIM_LOST', 'GENERATION_INPUT_CHANGED']
    const code = error instanceof Error && known.includes(error.message) ? error.message : 'GENERATION_UNAVAILABLE'
    if (receipt) {
      receipt = { ...receipt, state: 'error', error: code }
      try { await failGeneration(scope, receipt) } catch { /* Unknown writes retain the original claim and cannot trigger another AI call. */ }
    }
    console.error('[improve] generation failed:', code)
    return { status: 503, state: 'error', scanId, generation: receipt, error: code }
  }
}
