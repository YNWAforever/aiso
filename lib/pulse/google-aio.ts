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
  signal?: AbortSignal,
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderEvidence> {
  const config = aiOverviewConfig(env)
  if (!config) throw new GoogleAioUnconfiguredError()
  const result = await fetchAiOverview(question, config, fetchImpl, signal)
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
