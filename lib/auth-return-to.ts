export const AUTH_RETURN_TO_HEADER = 'x-aiso-return-to'
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const uuid = new RegExp(`^${UUID}$`, 'i')
const OPAQUE = '[A-Za-z0-9][A-Za-z0-9_-]{0,127}'
export function authLocale(lang: string): 'en' | 'zh-HK' { return lang === 'zh-HK' ? 'zh-HK' : 'en' }

/** Only routes this app serves and explicitly named business context survive sign-in. */
export function safeReturnTo(raw: unknown, requestedLang: string): string {
  const lang = authLocale(requestedLang), dashboard = `/${lang}/dashboard`
  if (typeof raw !== 'string' || raw.length > 2048 || !raw.startsWith('/') || raw.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(raw)) return dashboard
  const rawPath = raw.split(/[?#]/, 1)[0]
  // Known route segments are ASCII identifiers. Encoded separators/dots must never be reinterpreted later.
  if (rawPath.includes('%') || /(?:^|\/)\.{1,2}(?:\/|$)/.test(rawPath)) return dashboard
  try {
    const url = new URL(raw, 'https://auth.invalid')
    if (url.origin !== 'https://auth.invalid') return dashboard
    const path = url.pathname
    const clientRoot = new RegExp(`^${dashboard}/${UUID}$`, 'i')
    const tools = new RegExp(`^${dashboard}/${UUID}/(?:entities|sources|observations|opportunities|prompts|reports)$`, 'i')
    const nested = new RegExp(`^${dashboard}/${UUID}/(?:reports/(?:new|${UUID})|result/${OPAQUE}|work-items/${UUID}/versions)$`, 'i')
    // Existing public scan claim is a separate, already-used login continuation.
    const scanClaim = new RegExp(`^/${lang}/result/${OPAQUE}$`)
    if (path !== dashboard && path !== `${dashboard}/settings` && !clientRoot.test(path) && !tools.test(path) && !nested.test(path) && !scanClaim.test(path)) return dashboard
    const kept = new URLSearchParams()
    const single = (key: string) => url.searchParams.getAll(key).length === 1 ? url.searchParams.get(key) : null
    const step = single('step')
    if ((path === dashboard || clientRoot.test(path)) && step && ['home', 'scan', 'results', 'improve', 'monitor', 'roi'].includes(step)) kept.set('step', step)
    const draft = single('draft')
    if (path.endsWith('/opportunities') && draft && uuid.test(draft)) kept.set('draft', draft)
    if(path.endsWith('/sources')){
      const source=single('source'),version=single('version')
      if(source&&version&&uuid.test(source)&&uuid.test(version)){kept.set('source',source);kept.set('version',version)}
    }
    if (scanClaim.test(path) && single('claim') === '1') kept.set('claim', '1')
    if (path.endsWith('/observations')) {
      const run=single('run'),cursor=single('runCursor'),status=single('runStatus')
      if(run&&uuid.test(run)){kept.set('run',run);if(cursor&&uuid.test(cursor))kept.set('runCursor',cursor);if(status&&['all','failed','pending','unclassified'].includes(status))kept.set('runStatus',status)}
      const week = single('week')
      if (week && /^\d{4}-\d{2}-\d{2}$/.test(week) && Number.isFinite(Date.parse(week))) kept.set('week', week)
      for (const [key, allowed] of [['result', ['all', 'success', 'incomplete']], ['mention', ['all', 'mentioned', 'not-mentioned', 'unknown']]] as const) {
        const value = single(key)
        if (value && (allowed as readonly string[]).includes(value)) kept.set(key, value)
      }
    }
    const query = kept.size ? `?${kept}` : ''
    // Plain fragment identifiers may name a section; OAuth key/value fragments cannot survive.
    const hash = /^#[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(url.hash) ? url.hash : ''
    return `${path}${query}${hash}`
  } catch { return dashboard }
}
