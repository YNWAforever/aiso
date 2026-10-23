/** The page's language for funnel events, read from <html lang> so callers need no intl context. */
export function funnelLocale(): 'en' | 'zh-HK' {
  return typeof document !== 'undefined' && document.documentElement.lang === 'zh-HK' ? 'zh-HK' : 'en'
}
