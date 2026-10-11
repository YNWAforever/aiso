/**
 * The most questions one client's bank may hold, and the most a weekly run will
 * scan.
 *
 * These must be the same number. `pulse/run` reads `order by id limit
 * MAX_PROMPTS`, so a bank larger than this is silently truncated — the excess is
 * never scanned, and `sov_score` ends up computed over an arbitrary
 * id-ordered subset while still being reported as the client's share of voice.
 * Nothing could exceed the limit while the bank was write-once at onboarding
 * (24 rows); restoring POST is what makes it reachable, so the producer's cap
 * and the writer's cap now come from here rather than from two constants that
 * could drift.
 *
 * Counted over all rows, not just active ones, so deactivating a question does
 * not free capacity that reactivating would then silently exceed.
 */
export const MAX_PROMPTS = 50

/**
 * Output-token limit for one Pulse platform answer. A cut-off answer
 * (finish_reason 'length') is discarded rather than stored, so the limit must
 * leave room for the whole answer: 500 cut off every Gemini 3.8 Flash answer
 * (a reasoning model, whose reasoning counts towards the limit) and some
 * web-searched answers that cite their sources (production, 2026-10-10).
 * Well under AISO_LLM_MAX_OUTPUT_TOKENS's default of 4000, which still clamps.
 */
export const PULSE_ANSWER_MAX_TOKENS = 1500

/**
 * Gemini 3.8 Flash thinks before it answers and its thinking counts towards
 * the limit: at 1500 it ran out mid-answer in 5 of 8 answers (production,
 * week 2026-10-05). Asking it to think less fixed the cut-offs but its answers
 * then stopped citing the search results, so it keeps its default thinking and
 * gets AISO_LLM_MAX_OUTPUT_TOKENS's default ceiling instead.
 */
export const PULSE_REASONING_ANSWER_MAX_TOKENS = 4000
const REASONING_PLATFORMS: ReadonlySet<string> = new Set(['gemini-flash'])

/** The answer limit for one platform. */
export function pulseAnswerMaxTokens(platform: string): number {
  return REASONING_PLATFORMS.has(platform) ? PULSE_REASONING_ANSWER_MAX_TOKENS : PULSE_ANSWER_MAX_TOKENS
}
