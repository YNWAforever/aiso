import type { CheckResult } from '@/lib/types'

export function checkHeadingStructure(html: string, _baseUrl: string): CheckResult {
  const h1Count = (html.match(/<h1[\s>]/gi) ?? []).length
  const h2Count = (html.match(/<h2[\s>]/gi) ?? []).length

  if (h1Count === 0) return { status: 'fail', message: 'headings_missing' }
  if (h1Count === 1 && h2Count >= 2) {
    return { status: 'pass', message: 'headings_good', details: `H1:${h1Count} H2:${h2Count}` }
  }
  return { status: 'warn', message: 'headings_shallow', details: `H1:${h1Count} H2:${h2Count}` }
}
