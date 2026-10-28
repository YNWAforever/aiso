import 'server-only'
import { getProfile } from '@/lib/auth'
import { db } from '@/lib/db'
import { isFeatureEnabled } from '@/lib/flags'
import { resolveCommercialEntitlement } from '@/lib/tier'
import { runtimePlatformsFor } from '@/lib/pulse/platforms'
import { readLimitedJson } from '@/lib/approvals/request'
import { BudgetExceededError, clampOutputTokens, createTaskBudget } from '@/lib/agents/budget'
import { callOpenRouterWithEvidence, modelVariantsFor } from '@/lib/openrouter'
import { groundingFor, searchEvidenceFor, webSearchAllowance } from '@/lib/pulse/grounding'
import { normalizeProviderCitations } from '@/lib/pulse/provider-citations'
import { promptCollectionMessages } from '@/lib/prompts/context'
import { STUDIO_PROMPT_LIMIT, type StudioLiveAnswer } from './live-types'
import { reserveStudioAnswers, reserveStudioSearches, studioWeek } from './live-quota'

const respond = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
const invalid = () => respond({ error: 'INVALID_STUDIO_INPUT' }, 400)

export async function answerStudio(request: Request, clientId: string): Promise<Response> {
  // Kill switch precedes auth, SQL, body reads, and provider dispatch.
  if (!isFeatureEnabled('conversation_studio_live')) return respond({ error: 'Not found' }, 404)
  try {
    const profile = await getProfile()
    if (!profile) return respond({ error: 'Unauthorized' }, 401)
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(clientId)) return respond({ error: 'Not found' }, 404)
    const sql = db()
    const brands = await sql`select id, brand_name from clients where id = ${clientId}::uuid and account_id = ${profile.account_id} and status = 'active'`
    if (!brands[0]) return respond({ error: 'Not found' }, 404)
    const platforms = runtimePlatformsFor(resolveCommercialEntitlement(profile.accounts).features.platform_access)
    if (!platforms.length) return respond({ error: 'UPGRADE_REQUIRED' }, 403)
    let raw: unknown
    try { raw = await readLimitedJson(request, 4096) } catch { return invalid() }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid()
    const body = raw as Record<string, unknown>
    if (Object.keys(body).some(key => !['prompt', 'platforms', 'language'].includes(key))
      || typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > STUDIO_PROMPT_LIMIT
      || !Array.isArray(body.platforms) || body.platforms.length < 1 || body.platforms.length > platforms.length
      || body.platforms.some(value => typeof value !== 'string' || !platforms.includes(value))
      || new Set(body.platforms).size !== body.platforms.length
      || (body.language !== 'en' && body.language !== 'zh-HK')) return invalid()
    const selected = modelVariantsFor(body.platforms as string[])
    if (selected.length !== body.platforms.length) return invalid()
    const maxTokens = clampOutputTokens(1000)
    const budget = createTaskBudget()
    // Reserve the entire fan-out first, so rejection cannot cause partial spend.
    selected.forEach(() => budget.reserve(maxTokens))
    const week = studioWeek()
    const quota = reserveStudioAnswers(profile.account_id, selected.length, week)
    const allowance = await webSearchAllowance(sql, profile.account_id, week)
    const searchable = selected.filter(({ platform }) => groundingFor(platform, false) === 'none').length
    const webSearch = searchable > 0 && reserveStudioSearches(profile.account_id, searchable, allowance)
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(20_000)])
    const messages = promptCollectionMessages({ question: body.prompt.trim(), language: body.language, market: null, contextVersion: '2026-10-03.v1' })
    messages[0].content += ` Brand context: ${JSON.stringify(brands[0].brand_name)}. Do not claim access to saved records or conversation history.`
    const answers = await Promise.all(selected.map(async ({ platform, model }): Promise<StudioLiveAnswer> => {
      const started = Date.now()
      const grounding = groundingFor(platform, webSearch)
      const base = { platform, model, startedAt: new Date(started).toISOString(), grounding }
      try {
        const evidence = await callOpenRouterWithEvidence({ label: 'studio.answer', model, messages, maxTokens, signal, webSearch: grounding === 'web' })
        return { ...base, model: evidence.actualModel ?? model, durationMs: Date.now() - started,
          answer: evidence.answer, coverage: 'present', error: null,
          finishReason: evidence.providerFinishReason ?? null,
          searchEvidence: evidence.searchEvidence ?? searchEvidenceFor(grounding),
          citations: normalizeProviderCitations(evidence.providerCitations) ?? [] }
      } catch {
        return { ...base, durationMs: Date.now() - started, answer: null, coverage: 'missing',
          finishReason: null, citations: [], searchEvidence: searchEvidenceFor(grounding), error: 'PROVIDER_UNAVAILABLE' }
      }
    }))
    return respond({ answers, quota })
  } catch (error) {
    if (error instanceof BudgetExceededError) return respond({ error: 'STUDIO_BUDGET_EXCEEDED' }, 429)
    if (error instanceof Error && error.message === 'STUDIO_QUOTA_EXCEEDED') return respond({ error: 'STUDIO_QUOTA_EXCEEDED' }, 429)
    return respond({ error: 'STUDIO_UNAVAILABLE' }, 503)
  }
}
