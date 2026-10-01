import { LAG_DAYS, WINDOW_DAYS } from './types'

// Pure date arithmetic for Attribution. Every date is a YYYY-MM-DD string and
// all arithmetic goes through UTC, so neither the machine's zone nor a DST
// change can shift a day. Hong Kong has no DST; only the conversion from an
// instant to a Hong Kong date needs a zone, and that names it explicitly.

const HK_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Hong_Kong',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function hkDate(instant: Date): string {
  const parts = HK_DATE.formatToParts(instant) // throws RangeError on an invalid Date
  const get = (type: string) => parts.find((p) => p.type === type)!.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** `YYYY-MM-DD` plus `n` calendar days (n may be negative). */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d))
  t.setUTCDate(t.getUTCDate() + n)
  return t.toISOString().slice(0, 10)
}

/** The Hong Kong calendar date of a delivery timestamp. */
export function deliveryDay(deliveredAt: string): string {
  return hkDate(new Date(deliveredAt))
}

/** Today's Hong Kong calendar date. `now` is an input so callers own the clock. */
export function hkToday(now: Date): string {
  return hkDate(now)
}

export type DayRange = { from: string; to: string }

/** Before = D-28..D-1, after = D+1..D+28, both inclusive (spec 3.1). */
export function windowsFor(day: string): { before: DayRange; after: DayRange } {
  return {
    before: { from: addDays(day, -WINDOW_DAYS), to: addDays(day, -1) },
    after: { from: addDays(day, 1), to: addDays(day, WINDOW_DAYS) },
  }
}

/** First day the comparison can be trusted: the after-window plus Google's lag. */
export function readyOn(day: string): string {
  return addDays(day, WINDOW_DAYS + LAG_DAYS)
}
