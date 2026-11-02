/**
 * Search Console dates are defined on the Pacific calendar, not UTC. The sync
 * cron still uses a UTC `today()` (documented debt, Stage 6d out of scope); the
 * Studio in-answer path must not, because an evening HKT turn would otherwise
 * ask for a different day than Google's own calendar.
 */

export const GSC_ANSWER_DAYS = 28
/**
 * Search Analytics normally lags ~2–3 days. Answers end at Pacific today − 3 so
 * the snapshot never presents an unsettled day as complete.
 */
export const GSC_DATA_LAG_DAYS = 3

export type GscAnswerWindow = {
  startDate: string
  endDate: string
  pacificToday: string
  lagDays: number
  completeThrough: string
}

function calendarParts(now: Date | number): { year: number; month: number; day: number } {
  const date = typeof now === 'number' ? new Date(now) : now
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date)
  const value = (type: 'year' | 'month' | 'day') => Number(parts.find(part => part.type === type)?.value)
  return { year: value('year'), month: value('month'), day: value('day') }
}

const iso = (year: number, month: number, day: number): string =>
  `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

/** `YYYY-MM-DD` on the America/Los_Angeles calendar. */
export function pacificCalendarDate(now: Date | number): string {
  const { year, month, day } = calendarParts(now)
  return iso(year, month, day)
}

/** Calendar arithmetic on a YYYY-MM-DD label; safe across DST because no clock time is involved. */
function shiftDate(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function gscAnswerWindow(input: { now: Date | number; days?: number; lagDays?: number }): GscAnswerWindow {
  const days = Math.max(1, Math.trunc(input.days ?? GSC_ANSWER_DAYS))
  const lagDays = Math.max(0, Math.trunc(input.lagDays ?? GSC_DATA_LAG_DAYS))
  const pacificToday = pacificCalendarDate(input.now)
  const endDate = shiftDate(pacificToday, -lagDays)
  const startDate = shiftDate(endDate, -(days - 1))
  return { startDate, endDate, pacificToday, lagDays, completeThrough: endDate }
}
