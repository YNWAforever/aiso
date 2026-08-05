import type { PublicUrlFetch } from '@/lib/security/public-url'
import type { CheckResult } from '@/lib/types'

async function findSitemapUrl(baseUrl: string, fetcher: PublicUrlFetch): Promise<string> {
  // Check robots.txt for Sitemap: directive
  try {
    const res = await fetcher(new URL('/robots.txt', baseUrl).toString(), {
      headers: { 'User-Agent': 'FimmickAISO/1.0' },
      signal: AbortSignal.timeout(5_000),
    })
    if (res.ok) {
      const text = await res.text()
      const match = text.match(/^Sitemap:\s*(.+)$/im)
      if (match?.[1]) return match[1].trim()
    }
  } catch { /* fall through */ }
  return new URL('/sitemap.xml', baseUrl).toString()
}

export async function checkSitemap(baseUrl: string, fetcher: PublicUrlFetch): Promise<CheckResult> {
  try {
    const sitemapUrl = await findSitemapUrl(baseUrl, fetcher)
    const res = await fetcher(sitemapUrl, {
      headers: { 'User-Agent': 'FimmickAISO/1.0' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return { status: 'fail', message: 'sitemap_missing' }

    const xml  = await res.text()
    const urls = (xml.match(/<url>/gi) ?? []).length +
                 (xml.match(/<sitemap>/gi) ?? []).length  // sitemapindex

    if (urls >= 10) return { status: 'pass', message: 'sitemap_good', details: `${urls} URLs` }
    if (urls >= 1)  return { status: 'warn', message: 'sitemap_sparse', details: `${urls} URLs` }
    return { status: 'fail', message: 'sitemap_missing' }
  } catch {
    return { status: 'fail', message: 'sitemap_fetch_error' }
  }
}
