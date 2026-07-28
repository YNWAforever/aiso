import { db } from '@/lib/db'
import { resolveCommercialEntitlement } from '@/lib/tier'
import type { PlanId } from '@/lib/plans/catalog'

export type CreateBrandInput = {
  accountId: string
  brandName: string
  domain?: string | null
  industry?: string | null
  region?: string | null
  description?: string | null
  competitors?: string[]
}

/**
 * A discriminated union rather than a thrown error: the brand limit is an
 * expected outcome, not an exception, and the service must not know about HTTP.
 * Database failures still throw.
 */
export type CreateBrandResult =
  | { ok: true; clientId: string; trialEndsAt: Date }
  | { ok: false; reason: 'BRAND_LIMIT_REACHED'; plan: PlanId; limit: number }

export async function createBrandForAccount(
  input: CreateBrandInput,
): Promise<CreateBrandResult> {
  const sql = db()

  const accountRows = await sql`
    select id, plan, status, stripe_customer_id, stripe_subscription_id,
           trial_started_at, trial_ends_at, trial_emails_sent, created_at,
           override_plan, override_expires_at
    from accounts where id = ${input.accountId} limit 1
  `
  const account = accountRows[0]
  if (!account) throw new Error(`createBrandForAccount: account ${input.accountId} not found`)

  const entitlement = resolveCommercialEntitlement(account as never)
  const plan = entitlement.plan
  const limit = entitlement.features.max_brands

  // Advisory pre-check for a clear error. check_brand_limit() is the authority
  // and catches the concurrent race below.
  const counted = await sql`
    select count(*)::int as n from clients where account_id = ${input.accountId}
  `
  if ((counted[0]?.n ?? 0) >= limit) {
    return { ok: false, reason: 'BRAND_LIMIT_REACHED', plan, limit }
  }

  // One statement, so it is atomic without an interactive transaction: a
  // trigger failure on the insert aborts the trial grant too. Splitting these
  // would reproduce the bug this work exists to fix — a brand with no trial.
  try {
    const rows = await sql`
      with inserted as (
        insert into clients (brand_name, domain, industry, region, description, competitors, account_id, status)
        values (
          ${input.brandName.trim()},
          ${input.domain?.trim() ?? null},
          ${input.industry ?? null},
          ${input.region ?? null},
          ${input.description ?? null},
          ${(Array.isArray(input.competitors) ? input.competitors : []) as string[]}::text[],
          ${input.accountId},
          'active'
        )
        returning id
      ),
      trial as (
        update accounts
        set trial_started_at = coalesce(trial_started_at, now()),
            trial_ends_at    = coalesce(trial_ends_at, now() + interval '7 days'),
            plan = case
                     when trial_started_at is null
                      and coalesce(stripe_subscription_id, '') = ''
                     then 'basic'
                     else plan
                   end
        where id = ${input.accountId}
        returning trial_ends_at
      )
      select inserted.id as client_id, trial.trial_ends_at
      from inserted, trial
    `
    const row = rows[0]
    if (!row) throw new Error('createBrandForAccount: insert returned no row')
    const raw = row.trial_ends_at
    return {
      ok: true,
      clientId: row.client_id as string,
      trialEndsAt: raw instanceof Date ? raw : new Date(String(raw)),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('BRAND_LIMIT_REACHED')) {
      return { ok: false, reason: 'BRAND_LIMIT_REACHED', plan, limit }
    }
    throw err
  }
}
