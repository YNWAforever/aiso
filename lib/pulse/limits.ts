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
