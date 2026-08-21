/**
 * Render whatever a driver returned for a `date` column as `YYYY-MM-DD`.
 *
 * The two drivers in play disagree. The HTTP driver (`db()`) hands a `date`
 * back as a string; the WebSocket/`Client` driver parses it into a `Date`.
 * Code that assumes one of those shapes breaks silently under the other, which
 * is how `computeWeeklySummary` came to return
 * "Mon Jan 05 2026 00:00:00 GMT+0800 (Hong Kong Standard Time)" from an API
 * field typed as a date (fixed in d243eb5).
 *
 * Read the LOCAL components, never `toISOString()`. A Postgres `date` carries
 * no time or zone and the driver builds the Date at local midnight, so at any
 * positive UTC offset `toISOString()` reports the previous day. Where the value
 * is a dedup key -- `notifications (client_id, type, scan_week)` and
 * `alert_email_deliveries (client_id, type, scan_week)` -- being one day off
 * does not throw. It silently stops deduplicating.
 */
export function isoDate(value: string | Date | null | undefined, fallback: string): string {
  if (value instanceof Date) {
    // An invalid Date (e.g. new Date('garbage')) must fall back rather than
    // render 'NaN-NaN-NaN' -- a string that typechecks as a date but is
    // garbage as a dedup key.
    if (Number.isNaN(value.getTime())) return fallback
    const month = String(value.getMonth() + 1).padStart(2, '0')
    const day = String(value.getDate()).padStart(2, '0')
    return `${value.getFullYear()}-${month}-${day}`
  }
  return typeof value === 'string' && value !== '' ? value : fallback
}
