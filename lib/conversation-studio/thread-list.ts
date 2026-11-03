/**
 * Studio redesign R1: browser-safe helpers for the full thread list
 * (search, date groups, relative time). Pure, so the grouping rules are
 * testable without a DOM.
 */

export type ThreadGroupKey = 'today' | 'week' | 'older' | 'unsaved'
export const THREAD_GROUP_ORDER: readonly ThreadGroupKey[] = ['unsaved', 'today', 'week', 'older']

type Listable = { title: string; goal: string; updatedAt?: string }

const DAY = 24 * 60 * 60 * 1000

/** Midnight of `now` in the viewer's own clock, so "today" means their today. */
function startOfDay(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
}

export function threadGroup(updatedAt: string | undefined, now: Date): ThreadGroupKey {
  // A thread with no saved timestamp has not reached the server yet.
  const at = updatedAt ? Date.parse(updatedAt) : Number.NaN
  if (!Number.isFinite(at)) return 'unsaved'
  const today = startOfDay(now)
  if (at >= today) return 'today'
  if (at >= today - 6 * DAY) return 'week'
  return 'older'
}

/** Groups in display order, each keeping the incoming (most recent first) order; empty groups are dropped. */
export function groupThreads<T extends Listable>(threads: readonly T[], now: Date): { key: ThreadGroupKey; threads: T[] }[] {
  const groups = new Map<ThreadGroupKey, T[]>()
  for (const thread of threads) {
    const key = threadGroup(thread.updatedAt, now)
    groups.set(key, [...(groups.get(key) ?? []), thread])
  }
  return THREAD_GROUP_ORDER.filter(key => groups.has(key)).map(key => ({ key, threads: groups.get(key)! }))
}

/** Case- and width-insensitive match on title, goal and the skill's label. */
export function matchesThread(thread: Listable, query: string, skillLabel?: string | null): boolean {
  const needle = query.normalize('NFKC').trim().toLocaleLowerCase()
  if (!needle) return true
  return [thread.title, thread.goal, skillLabel ?? ''].some(field => field.normalize('NFKC').toLocaleLowerCase().includes(needle))
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [['day', DAY], ['hour', 60 * 60 * 1000], ['minute', 60 * 1000]]

/** "5 hours ago" / "5 小時前"; under a minute reads as "now" / "現在". Null when the time is unknown. */
export function relativeTime(updatedAt: string | undefined, now: Date, locale: string): string | null {
  const at = updatedAt ? Date.parse(updatedAt) : Number.NaN
  if (!Number.isFinite(at)) return null
  const elapsed = Math.max(0, now.getTime() - at)
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  for (const [unit, size] of UNITS) {
    if (elapsed >= size) return format.format(-Math.floor(elapsed / size), unit)
  }
  return format.format(0, 'second')
}
