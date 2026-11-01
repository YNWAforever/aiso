import 'server-only'
import { db } from '@/lib/db'
import type { StudioLiveQuota } from './live-types'

// Search reservations are a within-process guard on top of the existing Pulse
// web-search allowance. LIVE answers use the durable Neon counter below.
const searches = new Map<string, { week: string; count: number }>()
const MAX_ACCOUNTS = 10_000

type StudioAnswerCounterDecision = {
  allowed: boolean
  remaining: number
}

export type DurableStudioAnswerCounter = (
  accountId: string,
  count: number,
  week: string,
  cap: number,
) => Promise<StudioAnswerCounterDecision>

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

const consumeFromNeon: DurableStudioAnswerCounter = async (accountId, count, week, cap) => {
  const rows = await db()`
    with consumed as (
      insert into studio_live_weekly_usage (account_id, week_start, answer_count)
      values (${accountId}::uuid, ${week}::date, ${count})
      on conflict (account_id, week_start)
      do update set answer_count = studio_live_weekly_usage.answer_count + excluded.answer_count
      where studio_live_weekly_usage.answer_count + excluded.answer_count <= ${cap}
      returning answer_count
    )
    select exists(select 1 from consumed) as allowed,
      coalesce(
        (select answer_count from consumed),
        (select answer_count from studio_live_weekly_usage
         where account_id = ${accountId}::uuid and week_start = ${week}::date),
        0
      ) as answer_count
  `
  const row = rows[0] as { allowed: boolean; answer_count: number | string } | undefined
  if (!row) throw new Error('Studio LIVE quota returned no result')
  const used = Number(row.answer_count)
  if (!Number.isSafeInteger(used) || used < 0) throw new Error('Studio LIVE quota returned invalid usage')
  return {
    allowed: row.allowed === true && used <= cap,
    remaining: Math.max(0, cap - used),
  }
}

/**
 * Atomically reserves the full answer fan-out before provider dispatch. The
 * account-week row survives process restarts and is shared across instances.
 * Unknown/failed provider attempts remain charged.
 */
export async function reserveStudioAnswers(
  accountId: string,
  count: number,
  week: string,
  consume: DurableStudioAnswerCounter = consumeFromNeon,
): Promise<StudioLiveQuota> {
  const cap = studioLiveCap()
  if (!Number.isSafeInteger(count) || count < 1 || cap === 0 || count > cap
    || !/^\d{4}-\d{2}-\d{2}$/.test(week)) throw new Error('STUDIO_QUOTA_EXCEEDED')
  const decision = await consume(accountId, count, week, cap)
  if (!decision.allowed) throw new Error('STUDIO_QUOTA_EXCEEDED')
  return { cap, remaining: decision.remaining, scope: 'account' }
}

/** Includes local Studio web requests, which are intentionally absent from Pulse. */
export function reserveStudioSearches(
  accountId: string,
  count: number,
  allowance: { allowed: boolean; used: number | null; cap: number },
  week = studioWeek(),
): boolean {
  for (const [key, value] of searches) if (value.week !== week) searches.delete(key)
  const current = searches.get(accountId)
  if (!allowance.allowed || allowance.used === null || !Number.isSafeInteger(count) || count < 1
    || count > allowance.cap - allowance.used - (current?.count ?? 0)
    || (!current && searches.size >= MAX_ACCOUNTS)) return false
  searches.set(accountId, { week, count: (current?.count ?? 0) + count })
  return true
}
