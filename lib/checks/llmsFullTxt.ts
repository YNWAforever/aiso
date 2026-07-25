import type { PublicUrlFetch } from '@/lib/security/public-url'
import type { CheckResult } from '@/lib/types'

export async function checkLlmsFullTxt(baseUrl: string, fetcher: PublicUrlFetch = fetch): Promise<CheckResult> {
  try {
    const res = await fetcher(`${baseUrl}/llms.txt`, {
      headers: { 'User-Agent': 'FimmickAISO/1.0' },
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) return { status: 'fail', message: 'llms_full_txt_missing' }

    const text = await res.text()
    if (!text.trim()) return { status: 'fail', message: 'llms_full_txt_missing' }

    const hasTitle   = /^#\s+\S/.test(text)
    const hasDesc    = text.includes('>')
    const urlCount   = (text.match(/^https?:\/\//gm) ?? []).length
    const lineCount  = text.split('\n').filter(l => l.trim()).length

    if (hasTitle && lineCount >= 5 && urlCount >= 3) {
      return { status: 'pass', message: 'llms_full_txt_rich', details: `${urlCount} URLs, ${lineCount} lines` }
    }
    return { status: 'warn', message: 'llms_full_txt_sparse', details: `${urlCount} URLs, ${lineCount} lines` }
  } catch {
    return { status: 'fail', message: 'llms_full_txt_fetch_error' }
  }
}
