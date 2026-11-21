import 'server-only'
import { aiOverviewConfig, fetchAiOverview } from '@/lib/integrations/dataforseo/ai-overview'
import type { ProviderEvidence } from '@/lib/pulse/runs/schema'
import { safeEvidenceUrl, type ProviderCitation } from '@/lib/pulse/provider-citations'

/**
 * The saved answer when Google showed no AI Overview for the question. It is a
 * real observation (the brand is not visible there), so it is stored and
 * classified like any answer: it is non-blank, which stops the producers from
 * re-collecting and re-billing it every run, and it names no brand, so it is
 * classified "not mentioned" rather than guessed.
 */
export const GOOGLE_AIO_ABSENT_ANSWER = 'No Google AI Overview was shown for this search.'

/**
 * Google Ads geo-target codes for the onboarding markets (lib/prompts/context.ts).
 * EU and Global have no single Google search market, so they are not collected
 * rather than silently searched as somewhere else.
 */
const MARKET_LOCATION: Readonly<Record<string, number>> = {
  HK: 2344, TW: 2158, SG: 2702, JP: 2392, KR: 2410, US: 2840, UK: 2826, AU: 2036, CA: 2124,
}
const LANGUAGE_CODE: Readonly<Record<string, string>> = { 'zh-HK': 'zh-TW', en: 'en' }

export type GoogleAioContext = { language: string | null; market: string | null }

/** The SERP market for a prompt's own saved context, or null when it has none to search. */
export function googleAioMarket(context: GoogleAioContext): { locationCode: number; languageCode: string } | null {
  const locationCode = context.market ? MARKET_LOCATION[context.market] : undefined
  const languageCode = context.language ? LANGUAGE_CODE[context.language] : undefined
  return locationCode && languageCode ? { locationCode, languageCode } : null
}

export class GoogleAioUnsupportedMarketError extends Error {
  constructor() { super('No single Google search market for this prompt context'); this.name = 'GoogleAioUnsupportedMarketError' }
}

export class GoogleAioUnconfiguredError extends Error {
  constructor() { super('DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD are not set'); this.name = 'GoogleAioUnconfiguredError' }
}

export function googleAioConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return aiOverviewConfig(env) !== null
}

/**
 * One billed DataForSEO task for one question. Throws on any failure, so each
 * producer applies its own failure rule (the classic route drops the platform;
 * the run ledger records an unknown outcome and never re-dispatches blindly).
 */
export async function collectGoogleAio(
  question: string,
  context: GoogleAioContext,
  signal?: AbortSignal,
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderEvidence> {
  const credentials = aiOverviewConfig(env)
  if (!credentials) throw new GoogleAioUnconfiguredError()
  // Search the prompt's own market and language, as the model collectors honour them.
  const market = googleAioMarket(context)
  if (!market) throw new GoogleAioUnsupportedMarketError()
  const result = await fetchAiOverview(question, { ...credentials, ...market }, fetchImpl, signal)
  if (result.status === 'failed') {
    const error = new Error(`google_aio_${result.reason}`)
    error.name = result.reason === 'transport' ? 'TimeoutOrTransportError' : 'GoogleAioError'
    throw error
  }
  const citations: ProviderCitation[] | null = result.status === 'present'
    ? result.references
      .map(ref => ({ url: safeEvidenceUrl(ref.url), title: ref.title }))
      .filter((ref): ref is ProviderCitation => ref.url !== null)
    : null
  return {
    answer: result.status === 'present' ? result.text : GOOGLE_AIO_ABSENT_ANSWER,
    actualModel: 'dataforseo/google-ai-overview',
    requestId: null,
    promptTokens: null,
    completionTokens: null,
    costUsd: null,
    httpStatus: 200,
    providerCitations: citations,
    providerFinishReason: result.status,
    grounding: 'native',
  }
}
