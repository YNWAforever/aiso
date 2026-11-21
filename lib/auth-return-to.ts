export const AUTH_RETURN_TO_HEADER = 'x-aiso-return-to'
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const uuid = new RegExp(`^${UUID}$`, 'i')
const OPAQUE = '[A-Za-z0-9][A-Za-z0-9_-]{0,127}'
export function authLocale(lang: string): 'en' | 'zh-HK' { return lang === 'zh-HK' ? 'zh-HK' : 'en' }

/** Only routes this app serves and explicitly named business context survive sign-in. */
export function safeReturnTo(raw: unknown, requestedLang: string): string {
  const lang = authLocale(requestedLang), dashboard = `/${lang}/dashboard`
  if (typeof raw !== 'string' || raw.length > 8192 || !raw.startsWith('/') || raw.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(raw)) return dashboard
  const rawPath = raw.split(/[?#]/, 1)[0]
  // Known route segments are ASCII identifiers. Encoded separators/dots must never be reinterpreted later.
  if (rawPath.includes('%') || /(?:^|\/)\.{1,2}(?:\/|$)/.test(rawPath)) return dashboard
  try {
    const url = new URL(raw, 'https://auth.invalid')
    if (url.origin !== 'https://auth.invalid') return dashboard
    const path = url.pathname
    if (raw.length > 2048 && !path.endsWith('/observations')) return dashboard
    const clientRoot = new RegExp(`^${dashboard}/${UUID}$`, 'i')
    const tools = new RegExp(`^${dashboard}/${UUID}/(?:entities|sources|observations|opportunities|prompts|reports|tasks)$`, 'i')
    const nested = new RegExp(`^${dashboard}/${UUID}/(?:reports/(?:new|${UUID})|result/${OPAQUE}|work-items/${UUID}/versions)$`, 'i')
    // Existing public scan claim is a separate, already-used login continuation.
    const scanClaim = new RegExp(`^/${lang}/result/${OPAQUE}$`)
    const onboarding = path === `/${lang}/onboarding`
    if (path !== dashboard && path !== `${dashboard}/settings` && !onboarding && !clientRoot.test(path) && !tools.test(path) && !nested.test(path) && !scanClaim.test(path)) return dashboard
    const kept = new URLSearchParams()
    const single = (key: string) => url.searchParams.getAll(key).length === 1 ? url.searchParams.get(key) : null
    const scan = single('scan')
    if(onboarding && scan && uuid.test(scan)) kept.set('scan',scan)
    const step = single('step')
    if ((path === dashboard || clientRoot.test(path)) && step && ['home', 'scan', 'results', 'improve', 'monitor', 'roi'].includes(step)) kept.set('step', step)
    const monitorRun = single('run')
    if (clientRoot.test(path) && step === 'monitor' && monitorRun && uuid.test(monitorRun)) kept.set('run', monitorRun)
    const scanId = single('scanId')
    if ((clientRoot.test(path) || new RegExp(`^${dashboard}/${UUID}/reports(?:/(?:new|${UUID}))?$`, 'i').test(path))
      && scanId && new RegExp(`^${OPAQUE}$`).test(scanId)) kept.set('scanId', scanId)
    const recoveryUrl = single('url')
    if (clientRoot.test(path) && step === 'scan' && recoveryUrl) kept.set('url', recoveryUrl)
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
      for (const key of ['promptId', 'observation'] as const) {
        const value = single(key)
        if (value && uuid.test(value)) kept.set(key, value)
      }
      const platform = single('platform'), question = single('question'), limit = single('limit'), answerCursor = single('cursor')
      if (platform && Array.from(platform).length <= 80) kept.set('platform', platform)
      if (question?.trim() && Array.from(question).length <= 500) kept.set('question', question)
      if (limit && /^(?:[1-9]\d?|100)$/.test(limit)) kept.set('limit', limit)
      if (answerCursor && /^[A-Za-z0-9_-]{1,512}$/.test(answerCursor) && (kept.has('week') || kept.has('run'))) kept.set('cursor', answerCursor)
      for (const [key, allowed] of [['result', ['all', 'success', 'incomplete']], ['mention', ['all', 'mentioned', 'not-mentioned', 'absent', 'unknown']]] as const) {
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
