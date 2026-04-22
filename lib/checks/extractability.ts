import type { CheckResult } from '@/lib/types'

export async function checkExtractability(url: string): Promise<CheckResult> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Fimmick-AEO/1.0' },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return { status: 'fail', message: 'extractability_fetch_error' }

    const html = await res.text()
    const stripped = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    const wordCount = stripped.split(' ').filter(w => w.length > 2).length

    if (wordCount >= 200) return { status: 'pass', message: 'extractability_good', details: `~${wordCount} words` }
    if (wordCount >= 50)  return { status: 'warn', message: 'extractability_low',  details: `~${wordCount} words` }
    return { status: 'fail', message: 'extractability_poor', details: `~${wordCount} words` }
  } catch {
    return { status: 'fail', message: 'extractability_fetch_error' }
  }
}
