export function normalizeAuthNext(lang: string, next?: string): string {
  const fallback = `/${lang}/dashboard`
  if (!next) return fallback

  try {
    const url = new URL(next, 'https://auth.invalid')
    if (
      url.origin !== 'https://auth.invalid'
      || !url.pathname.startsWith(`/${lang}/`)
    ) return fallback
    return `${url.pathname}${url.search}${url.hash}`
  } catch {}

  return fallback
}
