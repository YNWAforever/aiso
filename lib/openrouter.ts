const BASE = 'https://openrouter.ai/api/v1/chat/completions'

interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
}

interface CallOptions {
  model: string
  messages: Message[]
  maxTokens?: number
  signal?: AbortSignal
}

// Callers that pass no signal would otherwise wait indefinitely. vercel.json
// caps the scan route at 60s and fix at 30s, so an unbounded call can consume
// the whole budget and take the surrounding request down with it.
const DEFAULT_TIMEOUT_MS = 30_000

export async function callOpenRouter({ model, messages, maxTokens = 2000, signal }: CallOptions): Promise<string> {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'HTTP-Referer': 'https://aeo.fimmick.com',
      'X-Title': 'Fimmick AEO',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages }),
    signal: signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  })

  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return data.choices[0].message.content as string
}

const PLATFORMS = [
  { platform: 'perplexity-sonar',     model: 'perplexity/sonar' },
  { platform: 'perplexity-sonar-pro', model: 'perplexity/sonar-pro' },
  { platform: 'gpt-4o',               model: 'openai/gpt-4o' },
  { platform: 'claude-haiku',         model: 'anthropic/claude-haiku-4-5' },
  { platform: 'gemini-flash',         model: 'google/gemini-flash-2.0' },
]

export const PLATFORM_KEYS = PLATFORMS.map(p => p.platform)

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
): Promise<Array<{ platform: string; answer: string }>> {
  const selected = only ? PLATFORMS.filter(p => only.includes(p.platform)) : PLATFORMS
  const results = await Promise.allSettled(
    selected.map(async ({ platform, model }) => ({
      platform,
      answer: await callOpenRouter({ model, messages, maxTokens }),
    })),
  )
  return results
    .filter((r): r is PromiseFulfilledResult<{ platform: string; answer: string }> => r.status === 'fulfilled')
    .map(r => r.value)
}
