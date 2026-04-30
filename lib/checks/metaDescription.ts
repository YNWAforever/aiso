import type { CheckResult } from '@/lib/types'

export function checkMetaDescription(html: string, _baseUrl: string): CheckResult {
  const match = html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']{1,500})["']/i)
             ?? html.match(/<meta[^>]+content=["']([^"']{1,500})["'][^>]*name=["']description["']/i)

  if (!match?.[1]) return { status: 'fail', message: 'meta_desc_missing' }

  const len = match[1].trim().length
  if (len >= 50 && len <= 160) {
    return { status: 'pass', message: 'meta_desc_good', details: `${len} chars` }
  }
  return { status: 'warn', message: 'meta_desc_length', details: `${len} chars (target 50–160)` }
}
