/**
 * Retainer OS Slice B: the Hong Kong calendar month, the same boundary as the
 * site-edit send cap (`SITE_EDIT_CAP_TIME_ZONE`). Hong Kong has kept UTC+8
 * without daylight saving since 1979, so the boundary is a fixed offset; the
 * database CHECK on `brand_month_snapshots.as_of` computes the same instant
 * with `at time zone 'Asia/Hong_Kong'`, so the two cannot drift silently.
 */

const HK_OFFSET_MS = 8 * 60 * 60 * 1000
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/

/** How long after a month ends before its closing snapshot is taken, so late Pulse and Search Console syncs land first. */
export const CLOSE_GRACE_DAYS = 3
/** How far back a month view may reach. Older months are refused rather than reconstructed from data that has since been replaced. */
export const MONTH_LOOKBACK = 12

export type BrandMonthPeriod = {
  /** `YYYY-MM` */
  key: string
  /** First day, `YYYY-MM-DD`. */
  month: string
  /** Opening boundary: the month's first Hong Kong midnight (ISO, UTC). */
  start: string
  /** Closing boundary: the next month's first Hong Kong midnight (ISO, UTC). */
  end: string
}

const pad = (n: number) => String(n).padStart(2, '0')
const boundary = (year: number, monthIndex: number) => new Date(Date.UTC(year, monthIndex, 1) - HK_OFFSET_MS).toISOString()

export function periodOf(key: string): BrandMonthPeriod | null {
  const m = MONTH.exec(key)
  if (!m) return null
  const year = Number(m[1]), index = Number(m[2]) - 1
  return { key, month: `${key}-01`, start: boundary(year, index), end: boundary(year, index + 1) }
}

/** The Hong Kong month an instant falls in. */
export function hongKongMonthKey(at: Date): string {
  const hk = new Date(at.getTime() + HK_OFFSET_MS)
  return `${hk.getUTCFullYear()}-${pad(hk.getUTCMonth() + 1)}`
}

/** `YYYY-MM` shifted by whole months. */
export function shiftMonth(key: string, by: number): string {
  const [y, m] = key.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + by, 1))
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`
}

/** A month the view may show: started already, and no older than the lookback. */
export function isViewableMonth(key: string, now: Date): boolean {
  const current = hongKongMonthKey(now)
  return MONTH.test(key) && key <= current && key >= shiftMonth(current, -MONTH_LOOKBACK)
}

export type SnapshotKind = 'opening' | 'closing'

/** Which snapshots are due for a month at `now`: opening once it has started, closing once it ended `CLOSE_GRACE_DAYS` ago. */
export function dueSnapshots(period: BrandMonthPeriod, now: Date): SnapshotKind[] {
  const due: SnapshotKind[] = []
  if (now.getTime() >= Date.parse(period.start)) due.push('opening')
  if (now.getTime() >= Date.parse(period.end) + CLOSE_GRACE_DAYS * 86_400_000) due.push('closing')
  return due
}

export const asOfFor = (period: BrandMonthPeriod, kind: SnapshotKind) => kind === 'opening' ? period.start : period.end
