import type { CheckResult } from '@/lib/types'

export function checkFaqDetection(html: string, _baseUrl: string): CheckResult {
  // Check for FAQPage JSON-LD
  const jsonLdMatches = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) ?? []
  for (const block of jsonLdMatches) {
    try {
      const inner = block.replace(/<[^>]+>/g, '')
      const data = JSON.parse(inner) as Record<string, unknown>
      const types: string[] = Array.isArray(data['@type']) ? data['@type'] as string[] : [data['@type'] as string]
      if (types.includes('FAQPage')) {
        const entities = (data['mainEntity'] as unknown[]) ?? []
        const count = Array.isArray(entities) ? entities.length : 0
        if (count >= 3) return { status: 'pass', message: 'faq_schema_found', details: `${count} Q&As` }
        return { status: 'warn', message: 'faq_schema_found', details: `${count} Q&As (target ≥3)` }
      }
    } catch { /* invalid JSON */ }
  }

  // Fallback: FAQ-like HTML patterns
  const hasQuestionPattern = /\bq(?:uestion)?:\s|\bq\d+[\.\)]/i.test(html)
  const hasDlPattern       = /<d[lt][\s>]/i.test(html)
  const hasFaqHeading      = /(?:<h[2-4][^>]*>)[^<]*\bfaq\b/i.test(html)

  if (hasQuestionPattern || hasDlPattern || hasFaqHeading) {
    return { status: 'warn', message: 'faq_content_only' }
  }
  return { status: 'fail', message: 'faq_missing' }
}
