import type { PublicUrlFetch } from '@/lib/security/public-url'
import type { CheckResult } from '@/lib/types'

export async function checkLlmsTxt(baseUrl: string, fetcher: PublicUrlFetch): Promise<CheckResult> {
  const url = new URL('/llms.txt', baseUrl).toString()
  try {
    const res = await fetcher(url, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'Fimmick-AEO/1.0' },
    })
    if (!res.ok) return { status: 'fail', message: 'llms_txt_missing' }
    const text = await res.text()
    if (text.trim().length === 0) return { status: 'warn', message: 'llms_txt_empty' }
    return { status: 'pass', message: 'llms_txt_found' }
  } catch {
    return { diagnostic: { collection: 'failed', reason: 'fetch-failed' }, status: 'fail', message: 'llms_txt_fetch_error' }
  }
}
