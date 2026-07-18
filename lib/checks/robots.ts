import type { PublicUrlFetch } from '@/lib/security/public-url'
import type { CheckResult } from '@/lib/types'

const AI_BOTS = ['gptbot', 'claudebot', 'perplexitybot', 'anthropic-ai', 'google-extended']

export async function checkRobots(baseUrl: string, fetcher: PublicUrlFetch = fetch): Promise<CheckResult> {
  const robotsUrl = new URL('/robots.txt', baseUrl).toString()

  try {
    const res = await fetcher(robotsUrl, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'Fimmick-AEO/1.0' },
    })

    if (!res.ok) return { status: 'fail', message: 'robots_not_found' }

    const lower = (await res.text()).toLowerCase()

    const hasBlock = AI_BOTS.some(bot => {
      const idx = lower.indexOf(`user-agent: ${bot}`)
      if (idx === -1) return false
      const next = lower.indexOf('user-agent:', idx + 1)
      const section = next === -1 ? lower.slice(idx) : lower.slice(idx, next)
      return section.includes('disallow: /')
    })

    if (hasBlock) return { status: 'fail', message: 'robots_ai_blocked' }

    const hasAllow = AI_BOTS.some(bot => lower.includes(`user-agent: ${bot}`))
    if (hasAllow) return { status: 'pass', message: 'robots_ai_allowed' }

    return { status: 'warn', message: 'robots_no_ai_rules' }
  } catch {
    return { status: 'fail', message: 'robots_fetch_error' }
  }
}
