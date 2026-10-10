/**
 * Page URLs from a site's /sitemap.xml, for c19 (topical authority).
 *
 * Most CMSs publish a sitemap *index* at /sitemap.xml whose <loc>s are child
 * sitemaps, not pages. The scan route used to pass those straight to c19, so a
 * site with an index looked like a flat list of .xml files — no structure to
 * cluster. This follows an index one level, to the first child on the same
 * origin, within the same time budget as the root fetch.
 *
 * The fetcher is the route's injected one (SSRF-pinned, observation-recording);
 * a root fetch failure is thrown so the caller records it, while a failed child
 * read just yields no URLs.
 */
export type SitemapFetcher = (url: URL, init: RequestInit) => Promise<Response>

const MAX_URLS = 200
const USER_AGENT = 'FimmickAISO/1.0'

function locs(xml: string): string[] {
  return (xml.match(/<loc>([^<]+)<\/loc>/g) ?? []).map(m => m.replace(/<\/?loc>/g, '').trim())
}

export async function fetchSitemapPageUrls(
  fetcher: SitemapFetcher,
  baseUrl: string,
  { timeoutMs }: { timeoutMs: number },
): Promise<string[]> {
  // One budget for both reads, so following an index cannot double the time.
  const signal = AbortSignal.timeout(timeoutMs)
  const init = { headers: { 'User-Agent': USER_AGENT }, signal }
  const origin = new URL(baseUrl).origin

  const root = await fetcher(new URL('/sitemap.xml', baseUrl), init)
  if (!root.ok) return []
  const rootXml = await root.text()
  if (!/<sitemapindex[\s>]/i.test(rootXml)) return locs(rootXml).slice(0, MAX_URLS)

  const child = locs(rootXml).find(loc => {
    try { return new URL(loc).origin === origin } catch { return false }
  })
  if (!child) return []

  try {
    const res = await fetcher(new URL(child), init)
    if (!res.ok) return []
    return locs(await res.text()).slice(0, MAX_URLS)
  } catch {
    return []
  }
}
