import type { CheckResult } from '@/lib/types'

const MONTHS_24 = 24 * 30 * 24 * 60 * 60 * 1000

function isRecent(dateStr: string): boolean {
  try {
    return Date.now() - new Date(dateStr).getTime() < MONTHS_24
  } catch { return false }
}

export function checkContentFreshness(html: string, _baseUrl: string): CheckResult {
  // 1. JSON-LD dateModified / datePublished
  const jsonLdBlocks = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) ?? []
  for (const block of jsonLdBlocks) {
    try {
      const data = JSON.parse(block.replace(/<[^>]+>/g, '')) as Record<string, unknown>
      const date = (data['dateModified'] ?? data['datePublished']) as string | undefined
      if (date) {
        return isRecent(date)
          ? { status: 'pass', message: 'freshness_recent', details: date }
          : { status: 'warn', message: 'freshness_stale',  details: date }
      }
    } catch { /* invalid JSON */ }
  }

  // 2. Open Graph / article meta
  const ogMatch = html.match(/property=["']article:modified_time["'][^>]*content=["']([^"']+)["']/i)
               ?? html.match(/property=["']article:published_time["'][^>]*content=["']([^"']+)["']/i)
  if (ogMatch?.[1]) {
    return isRecent(ogMatch[1])
      ? { status: 'pass', message: 'freshness_recent', details: ogMatch[1] }
      : { status: 'warn', message: 'freshness_stale',  details: ogMatch[1] }
  }

  // 3. <time datetime="…">
  const timeMatch = html.match(/<time[^>]+datetime=["']([^"']+)["']/i)
  if (timeMatch?.[1]) {
    return isRecent(timeMatch[1])
      ? { status: 'warn', message: 'freshness_stale', details: `<time> ${timeMatch[1]}` }
      : { status: 'warn', message: 'freshness_stale', details: `<time> ${timeMatch[1]}` }
  }

  return { status: 'fail', message: 'freshness_missing' }
}
