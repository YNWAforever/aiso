import sitemap from '@/app/sitemap'
import { PRODUCT_FACTS } from '@/lib/product-facts'
import { ORGANIZATION, SITE_URL } from '@/lib/seo'

/**
 * A plain description of the site for AI agents (/.well-known/ai.json, one of
 * the paths our c7 check looks for). It describes the public website only:
 * there is no public API, plugin or MCP server, and this file does not claim
 * one. Any field added here must be true of the live site.
 */
export function GET() {
  const body = {
    schema_version: '1',
    name: 'Fimmick AISO',
    description: `Runs ${PRODUCT_FACTS.checkCount} AI search readiness checks on a website and returns an evidence score out of ${PRODUCT_FACTS.scoreMaximum} with prioritised fixes.`,
    url: new URL('/', SITE_URL).toString(),
    languages: ['en', 'zh-HK'],
    publisher: { name: ORGANIZATION.name, url: ORGANIZATION.url },
    llms_txt: new URL('/llms.txt', SITE_URL).toString(),
    sitemap: new URL('/sitemap.xml', SITE_URL).toString(),
    pages: sitemap().map(({ url }) => url),
    api: null,
  }
  return Response.json(body, { headers: { 'Cache-Control': 'public, max-age=3600' } })
}
