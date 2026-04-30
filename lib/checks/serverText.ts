import type { CheckResult } from '@/lib/types'

export function checkServerText(html: string, _baseUrl: string): CheckResult {
  // Strip scripts, styles, and all tags; count words
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const words = stripped.split(/\s+/).filter(w => w.length > 1).length

  if (words >= 500) return { status: 'pass', message: 'server_text_good',  details: `${words} words` }
  if (words >= 100) return { status: 'warn', message: 'server_text_low',   details: `${words} words` }
  return              { status: 'fail', message: 'server_text_poor', details: `${words} words` }
}
