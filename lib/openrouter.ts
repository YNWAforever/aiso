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
    signal,
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

export async function callMultiPlatform(
  messages: Message[],
  maxTokens = 1000,
): Promise<Array<{ platform: string; answer: string }>> {
  const results = await Promise.allSettled(
    PLATFORMS.map(async ({ platform, model }) => ({
      platform,
      answer: await callOpenRouter({ model, messages, maxTokens }),
    })),
  )
  return results
    .filter((r): r is PromiseFulfilledResult<{ platform: string; answer: string }> => r.status === 'fulfilled')
    .map(r => r.value)
}
