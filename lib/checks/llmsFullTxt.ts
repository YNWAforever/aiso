import type { PublicUrlFetch } from '@/lib/security/public-url'
import type { CheckResult } from '@/lib/types'

export async function checkLlmsFullTxt(baseUrl: string, fetcher: PublicUrlFetch): Promise<CheckResult> {
  try {
    const res = await fetcher(new URL('/llms.txt', baseUrl).toString(), {
      headers: { 'User-Agent': 'FimmickAISO/1.0' },
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) return { status: 'fail', message: 'llms_full_txt_missing' }

    const text = await res.text()
    if (!text.trim()) return { status: 'fail', message: 'llms_full_txt_missing' }

    const hasTitle   = /^#\s+\S/m.test(text)
    const links = [
      ...Array.from(text.matchAll(/\[[^\]\n]*\]\(\s*<?([^\s)>]+)>?(?:\s+["'][^\n]*?["'])?\s*\)/g), match => match[1]),
      ...Array.from(text.matchAll(/^\s*(https?:\/\/\S+)\s*$/gm), match => match[1]),
    ]
    const urls = new Set<string>()
    for (const link of links) {
      try {
        const url = new URL(link, baseUrl)
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) continue
        url.hash = ''
        urls.add(url.href)
      } catch { /* malformed optional link */ }
    }
    const urlCount   = urls.size
    const lineCount  = text.split('\n').filter(l => l.trim()).length

    // The llms.txt spec also defines a `> summary` blockquote under the title.
    // This check computed `hasDesc = text.includes('>')` and then never read it,
    // so the richness test below has only ever considered title, line count and
    // URL count. Removed rather than wired in: requiring the summary would move
    // sites that currently pass into 'warn' and change their score, which is a
    // deliberate scoring decision, not a lint cleanup.

    if (hasTitle && lineCount >= 5 && urlCount >= 3) {
      return { status: 'pass', message: 'llms_full_txt_rich', details: `${urlCount} URLs, ${lineCount} lines` }
    }
    return { status: 'warn', message: 'llms_full_txt_sparse', details: `${urlCount} URLs, ${lineCount} lines` }
  } catch {
    return { diagnostic: { collection: 'failed', reason: 'fetch-failed' }, status: 'fail', message: 'llms_full_txt_fetch_error' }
  }
}
