import type { PublicUrlFetch } from '@/lib/security/public-url'
import type { CheckResult } from '@/lib/types'

const BOTS = [
  { name: 'GPTBot',        ua: 'Mozilla/5.0 (compatible; GPTBot/1.3; +https://openai.com/gptbot)' },
  { name: 'ClaudeBot',     ua: 'Mozilla/5.0 (compatible; ClaudeBot/1.0; +https://anthropic.com/)' },
  { name: 'PerplexityBot', ua: 'Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/)' },
]

export async function checkBotAccess(url: string, fetcher: PublicUrlFetch = fetch): Promise<CheckResult> {
  const results = await Promise.allSettled(
    BOTS.map(bot =>
      fetcher(url, {
        headers: { 'User-Agent': bot.ua },
        redirect: 'follow',
        signal: AbortSignal.timeout(8000),
      }),
    ),
  )

  const outcomes = results.map((r, i) => ({
    bot: BOTS[i].name,
    accessible: r.status === 'fulfilled' && r.value.ok,
  }))

  const blocked = outcomes.filter(o => !o.accessible)

  if (blocked.length === 0) return { status: 'pass', message: 'bots_all_accessible' }
  if (blocked.length === BOTS.length) return { status: 'fail', message: 'bots_all_blocked', details: blocked.map(b => b.bot).join(', ') }
  return { status: 'warn', message: 'bots_partially_blocked', details: blocked.map(b => b.bot).join(', ') }
}
