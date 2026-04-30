import type { CheckResult } from '@/lib/types'

const ENTITY_TYPES = new Set(['Organization', 'Person', 'LocalBusiness', 'Corporation', 'NGO', 'EducationalOrganization'])

export function checkEntitySignals(html: string, _baseUrl: string): CheckResult {
  // Check JSON-LD for entity types
  const jsonLdBlocks = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) ?? []
  for (const block of jsonLdBlocks) {
    try {
      const inner = block.replace(/<[^>]+>/g, '')
      const data = JSON.parse(inner) as Record<string, unknown>
      const types: string[] = Array.isArray(data['@type'])
        ? data['@type'] as string[]
        : [data['@type'] as string]
      if (types.some(t => ENTITY_TYPES.has(t))) {
        return { status: 'pass', message: 'entity_schema_found', details: types.join(', ') }
      }
    } catch { /* invalid JSON */ }
  }

  // Fallback: og:site_name, author meta, byline class
  const hasOgSiteName  = /property=["']og:site_name["']/i.test(html)
  const hasAuthorMeta  = /name=["']author["']/i.test(html)
  const hasBylineClass = /class=["'][^"']*byline[^"']*["']/i.test(html)

  if (hasOgSiteName || hasAuthorMeta || hasBylineClass) {
    return { status: 'warn', message: 'entity_signals_only' }
  }
  return { status: 'fail', message: 'entity_missing' }
}
