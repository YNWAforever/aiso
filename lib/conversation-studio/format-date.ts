/**
 * Readable dates for Studio records, instead of raw ISO / Postgres timestamps.
 * A bare calendar date ("2026-10-28") is shown as that date; a timestamp is shown
 * in Hong Kong time. Anything unparseable is returned unchanged rather than guessed.
 */
export function studioDate(value: string | null | undefined, locale: string, withTime = false): string {
  if (!value) return ''
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value)
  const date = new Date(dateOnly ? `${value}T00:00:00Z` : value.replace(' ', 'T'))
  if (!Number.isFinite(date.getTime())) return value
  return new Intl.DateTimeFormat(locale === 'zh-HK' ? 'zh-HK' : 'en-GB', {
    dateStyle: 'medium',
    ...(withTime && !dateOnly ? { timeStyle: 'short' } : {}),
    timeZone: dateOnly ? 'UTC' : 'Asia/Hong_Kong',
  }).format(date)
}
