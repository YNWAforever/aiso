import type { PublicUrlFetch } from '@/lib/security/public-url'
import type { CheckResult } from '@/lib/types'

export async function checkStructuredData(url: string, fetcher: PublicUrlFetch = fetch): Promise<CheckResult> {
  try {
    const res = await fetcher(url, {
      headers: { 'User-Agent': 'Fimmick-AEO/1.0' },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return { status: 'fail', message: 'structured_data_fetch_error' }

    const html = await res.text()
    const jsonLd = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>/gi)
    if (jsonLd?.length) return { status: 'pass', message: 'structured_data_found', details: `${jsonLd.length} block(s)` }
    if (html.includes('itemtype=') || html.includes('itemscope')) return { status: 'warn', message: 'structured_data_microdata_only' }
    return { status: 'fail', message: 'structured_data_missing' }
  } catch {
    return { status: 'fail', message: 'structured_data_fetch_error' }
  }
}
