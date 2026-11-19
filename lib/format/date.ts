/**
 * The one way the signed-in app shows a stored date to a person: never a raw ISO or
 * Postgres timestamp. A bare calendar date ("2026-10-28") is shown as that date; an
 * instant is shown in Hong Kong time, the product's market. Anything unparseable is
 * returned unchanged rather than guessed. Pure and server-safe.
 */
export type DisplayDateOptions = {
  /** Include the time of day (instants only; a bare date never gains a time). */
  withTime?: boolean
  /** Append the zone ("HKT" / "（香港時間）") after a time, for surfaces that mix zones. */
  zoneLabel?: boolean
}

export function formatDisplayDate(input: string | Date | null | undefined, locale: string, options: DisplayDateOptions = {}): string {
  if (!input) return ''
  // Row types say `string`, but the Neon driver returns timestamptz columns as Date
  // objects at runtime. Calling .replace on one crashed the Results page in production
  // (2026-11-19), so accept both rather than trust the declared type.
  if (input instanceof Date) {
    if (!Number.isFinite(input.getTime())) return ''
    input = input.toISOString()
  }
  if (typeof input !== 'string') return ''
  const value = input
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value)
  // Postgres text timestamps use a space and a bare hour offset ("… 03:47:12+00"),
  // which Date cannot parse; normalise to ISO ("…T03:47:12+00:00").
  const iso = value.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00')
  const date = new Date(dateOnly ? `${value}T00:00:00Z` : iso)
  if (!Number.isFinite(date.getTime())) return value
  const zh = locale === 'zh-HK'
  const withTime = Boolean(options.withTime) && !dateOnly
  const text = new Intl.DateTimeFormat(zh ? 'zh-HK' : 'en-GB', {
    dateStyle: 'medium',
    ...(withTime ? { timeStyle: 'short' } : {}),
    timeZone: dateOnly ? 'UTC' : 'Asia/Hong_Kong',
  }).format(date)
  if (!withTime || !options.zoneLabel) return text
  return zh ? `${text}（香港時間）` : `${text} HKT`
}
