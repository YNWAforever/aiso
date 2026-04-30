import type { CheckResult } from '@/lib/types'

export function checkInternalLinks(html: string, baseUrl: string): CheckResult {
  let hostname = ''
  try { hostname = new URL(baseUrl).hostname } catch { /* ignore */ }

  const hrefPattern = /<a\s[^>]*href=["']([^"'#?]+)["']/gi
  let internal = 0
  let m: RegExpExecArray | null

  while ((m = hrefPattern.exec(html)) !== null) {
    const href = m[1]
    if (!href) continue
    if (href.startsWith('/') && !href.startsWith('//')) {
      internal++
    } else {
      try {
        if (new URL(href).hostname === hostname) internal++
      } catch { /* not a valid URL */ }
    }
  }

  if (internal >= 10) return { status: 'pass', message: 'internal_links_good', details: `${internal} links` }
  if (internal >= 3)  return { status: 'warn', message: 'internal_links_few',  details: `${internal} links` }
  return                     { status: 'fail', message: 'internal_links_poor', details: `${internal} links` }
}
