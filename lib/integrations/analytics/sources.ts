/**
 * Which class does a GA4 key-event source belong to? Pure.
 *
 * GA4's `source` dimension is a host-like string, not a URL, and it varies in
 * case and subdomain (`chatgpt.com`, `www.perplexity.ai`, `Perplexity.ai`,
 * `(direct)`, `(not set)`, `google`). AI assistants are matched by exact host or
 * a `'.' + host` suffix so a subdomain counts and a lookalike such as
 * `notchatgpt.com` does not. AI is classified first: an assistant that GA4
 * happens to file under Organic Search is still an assistant.
 */

export type SourceClass = 'organic_search' | 'ai_assistant' | 'other'

export const SOURCE_CLASSES: readonly SourceClass[] = ['organic_search', 'ai_assistant', 'other']

export const AI_ASSISTANT_HOSTS: readonly string[] = [
  'chatgpt.com',
  'chat.openai.com',
  'openai.com',
  'perplexity.ai',
  'gemini.google.com',
  'bard.google.com',
  'copilot.microsoft.com',
  'claude.ai',
  'you.com',
  'phind.com',
  'deepseek.com',
]

const ORGANIC_CHANNEL = 'Organic Search'

export function classifySource(source: string, defaultChannelGroup: string): SourceClass {
  const host = source.trim().toLowerCase()
  if (host && AI_ASSISTANT_HOSTS.some(h => host === h || host.endsWith(`.${h}`))) return 'ai_assistant'
  return defaultChannelGroup === ORGANIC_CHANNEL ? 'organic_search' : 'other'
}
