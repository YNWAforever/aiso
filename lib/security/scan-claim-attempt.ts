import { db } from '@/lib/db'

/**
 * Spend a scan-claim attempt, exactly once.
 *
 * The signature on a claim intent proves the token is ours. It does not prove
 * this is the first time it has been presented, and until migration 047 there
 * was nowhere to record that it had been — so a copy of the cookie claimed the
 * scan again on every presentation inside its 15-minute window. This is the
 * missing half.
 *
 * The primary key decides the winner. `on conflict do nothing returning` is
 * one statement, so two concurrent presentations of the same cookie cannot
 * both win; a select-then-insert could, and that race is the whole thing being
 * prevented.
 *
 * Spend BEFORE the effect, not after. That is what single-use means, and it is
 * safe here because a legitimate retry can always re-mint: the claim-intent
 * route reissues freely for a scan that is still unowned (rate-limited), and
 * refuses once the scan has an account — which is exactly when a retry should
 * stop working anyway.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Three outcomes, not a boolean, because two of them are the caller's problem
 * and one is ours. `invalid` and `replayed` are both denials; a thrown error
 * is a dependency failure and becomes a 503. Collapsing `invalid` into a throw
 * turned a malformed id into an outage — the route answered 503 where it
 * should have answered "no".
 */
export type ScanClaimAttemptResult = 'consumed' | 'replayed' | 'invalid'

export async function consumeScanClaimAttempt(
  attemptId: string,
  scanId: string,
): Promise<ScanClaimAttemptResult> {
  // A non-uuid would reach Postgres as `invalid input syntax for type uuid`.
  // Checking the shape here keeps that out of the error path entirely.
  if (!UUID.test(attemptId) || !UUID.test(scanId)) return 'invalid'

  const sql = db()
  // Deliberately NOT wrapped in try/catch. A failure to record the attempt
  // must reach the caller as a failure: swallowing it and returning true would
  // let an unbounded number of replays through for the duration of an outage,
  // which is the one thing this table exists to stop.
  const rows = await sql`
    insert into scan_claim_attempts (attempt_id, scan_id)
    values (${attemptId.toLowerCase()}::uuid, ${scanId.toLowerCase()}::uuid)
    on conflict (attempt_id) do nothing
    returning attempt_id
  `
  return rows.length > 0 ? 'consumed' : 'replayed'
}
