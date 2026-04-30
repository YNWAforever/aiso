import type { CheckResult } from '@/lib/types'

export function checkCanonical(html: string, baseUrl: string): CheckResult {
  const match = html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)
             ?? html.match(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["']canonical["']/i)

  if (!match?.[1]) return { status: 'fail', message: 'canonical_missing' }

  const canonical = match[1].trim()
  try {
    const canonicalOrigin = new URL(canonical).origin
    const baseOrigin      = new URL(baseUrl).origin
    if (canonicalOrigin === baseOrigin) {
      return { status: 'pass', message: 'canonical_good', details: canonical }
    }
    return { status: 'warn', message: 'canonical_external', details: canonical }
  } catch {
    return { status: 'warn', message: 'canonical_external', details: canonical }
  }
}
