import 'server-only'

// Temporary Preview gate only. Each warm process has its own counter; a restart
// resets it. This is deliberately NOT a durable account-wide weekly entitlement.
const usage = new Map<string, { week: string; answers: number; searches: number }>()
const MAX_ACCOUNTS = 10_000

export function studioLiveCap(): number {
  const raw = process.env.STUDIO_LIVE_ANSWERS_PER_WEEK
  if (!raw || !/^\d+$/.test(raw)) return 0
  const cap = Number(raw)
  return Number.isSafeInteger(cap) && cap >= 0 ? cap : 0
}

export function studioWeek(now = new Date()): string {
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7)
  return monday.toISOString().slice(0, 10)
}

/** Synchronous reservation before dispatch. Unknown/failed calls remain charged. */
export function reserveStudioAnswers(accountId: string, count: number, week: string) {
  const cap = studioLiveCap()
  for (const [key, value] of usage) if (value.week !== week) usage.delete(key)
  const current = usage.get(accountId) ?? { week, answers: 0, searches: 0 }
  if (!Number.isSafeInteger(count) || count < 1 || cap === 0 || count > cap - current.answers
    || (!usage.has(accountId) && usage.size >= MAX_ACCOUNTS)) throw new Error('STUDIO_QUOTA_EXCEEDED')
  current.answers += count
  usage.set(accountId, current)
  return { cap, remaining: cap - current.answers, scope: 'process' as const }
}

/** Includes local Studio web requests, which are intentionally absent from Pulse. */
export function reserveStudioSearches(accountId: string, count: number, allowance: { allowed: boolean; used: number | null; cap: number }): boolean {
  const current = usage.get(accountId)
  if (!current || !allowance.allowed || allowance.used === null
    || count > allowance.cap - allowance.used - current.searches) return false
  current.searches += count
  return true
}
