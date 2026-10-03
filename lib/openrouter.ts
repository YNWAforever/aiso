import { clampOutputTokens, type TaskBudget } from '@/lib/agents/budget'
const BASE = 'https://openrouter.ai/api/v1/chat/completions'

interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
}

/** A strict JSON Schema; the root must be an object. */
export interface JsonSchemaFormat {
  name: string
  schema: Record<string, unknown>
}

/**
 * Which surface made the call, so the usage log attributes spend per feature
 * rather than per model (several surfaces share Haiku). Required, and a closed
 * list, so a new call site can neither forget it nor misspell it.
 */
export type CallLabel =
  | 'check.factual_density'
  | 'check.topical_authority'
  | 'fix.pack'
  | 'fix.rewrite_chunks'
  | 'fix.cluster_map'
  | 'fix.content_brief'
  | 'onboarding.seed_questions'
  | 'pulse.platform'
  | 'pulse.answer_analysis'
  | 'pulse.suggest_questions'
  | 'report.summary_polish'

interface CallOptions {
  label: CallLabel
  model: string
  messages: Message[]
  maxTokens?: number
  signal?: AbortSignal
  responseFormat?: JsonSchemaFormat
}

// Callers that pass no signal would otherwise wait indefinitely. vercel.json
// caps the scan route at 60s and fix at 30s, so an unbounded call can consume
// the whole budget and take the surrounding request down with it.
const DEFAULT_TIMEOUT_MS = 30_000

export async function callOpenRouter(options: CallOptions): Promise<string> {
  return (await callOpenRouterWithEvidence(options)).answer
}

export async function callOpenRouterWithEvidence({ label, model, messages, maxTokens = 2000, signal, responseFormat }: CallOptions): Promise<import('@/lib/pulse/runs/schema').ProviderEvidence> {
  const fail = (fields: Record<string, unknown>) => console.error({ event: 'openrouter_failed', label, model, ...fields })

  // Checked here rather than left to a 401: an empty key is a deployment fault,
  // and naming it is the difference between one log search and three weeks of
  // silent fallbacks.
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    fail({ reason: 'missing_api_key' })
    throw new Error('OPENROUTER_API_KEY is not set')
  }

  let res: Response
  try {
    res = await fetch(BASE, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://aeo.fimmick.com',
        'X-Title': 'Fimmick AEO',
        'Content-Type': 'application/json',
      },
      // Clamped, never raised. The ceiling is deployer-configured and applies here
      // rather than at each call site, so a caller cannot opt out by forgetting.
      body: JSON.stringify({
        model, max_tokens: clampOutputTokens(maxTokens), messages,
        // Structured outputs: the provider enforces the schema, so a caller no longer
        // depends on the model echoing a schema written out in prose.
        // require_parameters stops OpenRouter routing to a provider that would
        // silently ignore response_format.
        ...(responseFormat && {
          response_format: {
            type: 'json_schema',
            json_schema: { name: responseFormat.name, strict: true, schema: responseFormat.schema },
          },
          provider: { require_parameters: true },
        }),
      }),
      signal: signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    })
  } catch (error) {
    fail({ reason: error instanceof DOMException && error.name === 'TimeoutError' ? 'timeout' : 'network' })
    throw error
  }

  if (!res.ok) {
    const text = await res.text()
    fail({ reason: 'http_error', status: res.status, providerMessage: providerMessage(text) })
    throw new Error(`OpenRouter ${res.status}: ${text}`)
  }

  let data: CompletionMetadata & { choices?: Array<{ message?: { content?: unknown } }> }
  try {
    data = await res.json()
  } catch (error) {
    fail({ reason: 'invalid_json' })
    throw error
  }
  logUsage(label, model, data)

  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string') {
    fail({ reason: 'no_content', finishReason: str(data?.choices?.[0]?.finish_reason) })
    throw new Error('OpenRouter returned no content')
  }
  return { answer: content, actualModel: str(data.model), requestId: str(data.id),
    promptTokens: num(data.usage?.prompt_tokens), completionTokens: num(data.usage?.completion_tokens),
    costUsd: num(data.usage?.cost), httpStatus: res.status }
}

/**
 * OpenRouter's own error text (e.g. "No auth credentials found", or a routing
 * failure naming an unsupported parameter), which is what tells a bad key from a
 * provider problem. Only the parsed `error.message`, capped -- never the raw
 * body, which a provider could fill with an echo of the request.
 */
function providerMessage(body: string): string | null {
  try {
    const message = JSON.parse(body)?.error?.message
    return typeof message === 'string' ? message.slice(0, 200) : null
  } catch {
    return null
  }
}

type CompletionMetadata = {
  id?: unknown
  model?: unknown
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; cost?: unknown }
  choices?: Array<{ finish_reason?: unknown }>
}

const num = (value: unknown): number | null => (typeof value === 'number' ? value : null)
const str = (value: unknown): string | null => (typeof value === 'string' ? value : null)

/**
 * One metadata line per completion, so spend and truncation are visible at all.
 *
 * Never the prompt or the reply: both carry customer page text. `finishReason:
 * 'length'` means the reply hit max_tokens and was cut off, and every caller
 * parses and falls back on failure, so without this line a truncation is
 * indistinguishable from a model that answered badly. `generationId` looks the
 * call up in OpenRouter's /api/v1/generation; `costUsd` is logged when
 * OpenRouter includes it and null otherwise.
 */
function logUsage(label: CallLabel, model: string, data: CompletionMetadata | null | undefined): void {
  const finishReason = str(data?.choices?.[0]?.finish_reason)
  const entry = {
    event: 'openrouter_usage',
    label,
    model,
    servedBy: str(data?.model),
    generationId: str(data?.id),
    promptTokens: num(data?.usage?.prompt_tokens),
    completionTokens: num(data?.usage?.completion_tokens),
    costUsd: num(data?.usage?.cost),
    finishReason,
  }
  if (finishReason === 'length') console.warn({ ...entry, event: 'openrouter_truncated' })
  else console.info(entry)
}

const PLATFORMS = [
  { platform: 'perplexity-sonar',     model: 'perplexity/sonar' },
  { platform: 'perplexity-sonar-pro', model: 'perplexity/sonar-pro' },
  { platform: 'gpt-4o',               model: 'openai/gpt-4o' },
  { platform: 'claude-haiku',         model: 'anthropic/claude-haiku-4-5' },
  { platform: 'gemini-flash',         model: 'google/gemini-3.8-flash' },
]
// A retired or mistyped id fails every call to that platform, and
// callMultiPlatform drops failures, so the only symptom is a platform that
// quietly stops recording answers. `google/gemini-flash-2.0` was never a valid
// OpenRouter id and did exactly that -- to the only platform the Basic plan
// has. Check a new id first: GET https://openrouter.ai/api/v1/models/<id>/endpoints
// must return a non-empty `endpoints` list, not merely a 200.

export const PLATFORM_KEYS = PLATFORMS.map(p => p.platform)

export function modelVariantsFor(platforms: readonly string[]) {
  return PLATFORMS.filter(p => platforms.includes(p.platform)).map(p => ({ ...p }))
}

/**
 * Fans a prompt out across platforms, concurrently.
 *
 * `only` restricts the set, so a plan is billed for the platforms it actually
 * grants. It takes the keys in PLATFORM_KEYS — **not** an account's
 * `features.platform_access`, which is a different vocabulary sharing no key
 * with this one, so passing it raw selects nothing and the caller silently does
 * no work. Translate with `runtimePlatformsFor` in lib/pulse/platforms.ts.
 *
 * Omitting `only` queries all five, which is the right default for callers that
 * are not per-account.
 */
export async function callMultiPlatform(
  messages: Message[],
  maxTokens = 1000,
  only?: readonly string[],
  budget?: TaskBudget,
): Promise<Array<{ platform: string; answer: string }>> {
  const selected = only ? PLATFORMS.filter(p => only.includes(p.platform)) : PLATFORMS
  // A fan-out is N calls for one unit of work, which no per-call ceiling bounds.
  // Reserved up front so an over-budget fan-out is never dispatched at all --
  // reserving afterwards would spend first and complain second.
  if (budget) for (let k = 0; k < selected.length; k += 1) budget.reserve(maxTokens)
  const results = await Promise.allSettled(
    selected.map(async ({ platform, model }) => ({
      platform,
      // `model` already tells the platforms apart in the log.
      answer: await callOpenRouter({ label: 'pulse.platform', model, messages, maxTokens }),
    })),
  )
  return results
    .filter((r): r is PromiseFulfilledResult<{ platform: string; answer: string }> => r.status === 'fulfilled')
    .map(r => r.value)
}
