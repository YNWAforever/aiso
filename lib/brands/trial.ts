import { db } from '@/lib/db'

/**
 * The trial grant, expressed as one statement.
 *
 * `coalesce` in a SET clause reads the OLD row value, so a single UPDATE covers
 * grant, repair, and no-op:
 *   - never started        -> now() + 7 days, and the tier is pinned to 'basic'
 *   - started, no expiry   -> expiry filled, tier untouched (onboarding's repair case)
 *   - already has both     -> unchanged, stored expiry returned
 *
 * The tier pin matters: resolveCommercialEntitlement returns
 * activeEntitlement(account.plan, 'trial'), so without it a trial inherits
 * whatever `accounts.plan` happens to hold — one live account carries
 * 'enterprise', which would grant unmetered scans.
 *
 * An account with a live Stripe subscription never has its plan rewritten.
 */
export async function ensureTrialForAccount(accountId: string): Promise<Date> {
  const sql = db()
  const rows = await sql`
    update accounts
    set trial_started_at = coalesce(trial_started_at, now()),
        trial_ends_at    = coalesce(trial_ends_at, now() + interval '7 days'),
        plan = case
                 when trial_started_at is null
                  and coalesce(stripe_subscription_id, '') = ''
                 then 'basic'
                 else plan
               end
    where id = ${accountId}
    returning trial_ends_at
  `
  const raw = rows[0]?.trial_ends_at
  if (raw === undefined || raw === null) {
    throw new Error(`ensureTrialForAccount: account ${accountId} not found`)
  }
  // The Neon driver returns timestamptz as a Date; test fixtures and older rows
  // still supply ISO strings. Accept both.
  return raw instanceof Date ? raw : new Date(String(raw))
}
