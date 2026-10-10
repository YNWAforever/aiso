import type { db } from '@/lib/db'
import { isFeatureEnabled } from '@/lib/flags'
import { MAX_PROMPTS } from '@/lib/pulse/limits'

type Sql = ReturnType<typeof db>

/**
 * Whether a Pulse answer was produced with web search (GEO parity Step 1).
 *
 *   native -- the model searches by itself (Perplexity Sonar)
 *   web    -- web search was requested for this call (OpenRouter `web` plugin)
 *   none   -- answered without search, from training data
 *
 * Recorded on every answer (migration 062) so no reader can present a
 * training-data answer as a live one.
 */
export type Grounding = 'native' | 'web' | 'none'

const NATIVE_SEARCH = new Set(['perplexity-sonar', 'perplexity-sonar-pro'])
/** Platforms that would search if asked: everything that does not search by itself. */
const SEARCHABLE_PLATFORMS = 3

export function groundingFor(platform: string, webSearchAllowed: boolean): Grounding {
  if (NATIVE_SEARCH.has(platform)) return 'native'
  return webSearchAllowed ? 'web' : 'none'
}

/**
 * The structural ceiling: every prompt on every platform that searches only
 * when asked, once a week. The cap exists to stop a retry loop or a runaway
 * driver spending past what a full week can legitimately cost.
 */
export const DEFAULT_GROUNDED_ANSWERS_PER_WEEK = MAX_PROMPTS * SEARCHABLE_PLATFORMS

/** PULSE_GROUNDED_ANSWERS_PER_WEEK as a whole number >= 0; anything else is the default. */
export function groundedAnswersCap(env: Record<string, string | undefined> = process.env): number {
  const raw = env.PULSE_GROUNDED_ANSWERS_PER_WEEK
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return DEFAULT_GROUNDED_ANSWERS_PER_WEEK
  return Number(raw.trim())
}

/**
 * May this account's Pulse ask for web search now? Off unless
 * FEATURE_PULSE_GROUNDING=1, and only while this week's web-searched answers
 * are under the cap. Decided once per chunk, so a chunk can overshoot by at most
 * its own size. Fails closed: if usage cannot be read, nothing is searched.
 *
 * Counts provider attempts (a failed web search still cost money) plus legacy
 * writer rows; ledger projections into pulse_metrics carry a run_item_id and
 * are excluded so they are not counted twice.
 */
export async function webSearchAllowance(sql: Sql, accountId: string, scanWeek: string): Promise<{ allowed: boolean; used: number; cap: number }> {
  const cap = groundedAnswersCap()
  if (!isFeatureEnabled('pulse_grounding') || cap === 0) return { allowed: false, used: 0, cap }
  try {
    const [row] = await sql`
      select (
        select count(*)::int from pulse_metrics m join clients c on c.id = m.client_id
        where c.account_id = ${accountId} and m.scan_week = ${scanWeek}::date
          and m.grounding = 'web' and m.run_item_id is null
      ) + (
        select count(*)::int from pulse_item_attempts a
        join pulse_run_items i on i.id = a.item_id and i.account_id = a.account_id
        join pulse_runs r on r.id = i.run_id and r.account_id = a.account_id
        where a.account_id = ${accountId} and r.scan_week = ${scanWeek}::date and a.grounding = 'web'
      ) as used
    `
    const used = Number((row as { used?: unknown } | undefined)?.used ?? 0)
    return { allowed: used < cap, used, cap }
  } catch {
    console.error('[pulse] grounded-answer usage could not be read; web search disabled for this chunk')
    return { allowed: false, used: 0, cap }
  }
}
