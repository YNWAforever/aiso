import type { PublicUrlFetch } from '@/lib/security/public-url'
import type { CheckResult } from '@/lib/types'

import { AI_CRAWLER_ROLES, evaluateRobotsPolicy } from '@/lib/robots-policy'

export async function checkRobots(baseUrl: string, fetcher: PublicUrlFetch): Promise<CheckResult> {
  const robotsUrl = new URL('/robots.txt', baseUrl).toString()

  try {
    const res = await fetcher(robotsUrl, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'Fimmick-AEO/1.0' },
    })

    if (!res.ok) {
      const observedAbsence = res.status === 404 || res.status === 410
      return {
        status: 'fail', message: 'robots_not_found',
        diagnostic: observedAbsence
          ? { collection: 'complete' }
          : { collection: 'failed', reason: 'fetch-failed' },
      }
    }

    const text = await res.text()
    const policies = AI_CRAWLER_ROLES.filter(bot => bot.automatic)
      .map(bot => evaluateRobotsPolicy(text, bot.token, '/'))
    if (policies.some(policy => !policy.allowed)) return { status: 'fail', message: 'robots_ai_blocked' }
    const hasAllow = policies.some(policy => policy.explicit)
    if (hasAllow) return { status: 'pass', message: 'robots_ai_allowed' }

    return { status: 'warn', message: 'robots_no_ai_rules' }
  } catch {
    return { status: 'fail', message: 'robots_fetch_error', diagnostic: { collection: 'failed', reason: 'fetch-failed' } }
  }
}
