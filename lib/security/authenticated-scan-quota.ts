import { db } from '@/lib/db'

export const AUTHENTICATED_BASIC_SCAN_LIMIT = 3

export type AuthenticatedScanQuotaDecision = {
  allowed: boolean
  remaining: number
  resetAt: number
}

export type DurableAuthenticatedScanCounter = (
  accountId: string,
  limit: number,
) => Promise<AuthenticatedScanQuotaDecision>

const consumeFromNeon: DurableAuthenticatedScanCounter = async (accountId, limit) => {
  const rows = await db()`
    with current_month as (
      select date_trunc('month', now() at time zone 'UTC')::date as month_start
    ), cleanup as (
      delete from authenticated_scan_monthly_usage
      where account_id = ${accountId}::uuid
        and month_start < date_trunc('month', now() at time zone 'UTC')::date - interval '14 months'
    ), consumed as (
      insert into authenticated_scan_monthly_usage (account_id, month_start, request_count)
      select ${accountId}::uuid, month_start, 1 from current_month
      on conflict (account_id, month_start)
      do update set request_count = authenticated_scan_monthly_usage.request_count + 1
      where authenticated_scan_monthly_usage.request_count < ${limit}
      returning request_count, month_start
    )
    select consumed.request_count is not null as allowed,
      greatest(0, ${limit} - coalesce(consumed.request_count, ${limit}))::int as remaining,
      extract(epoch from ((current_month.month_start + interval '1 month')::timestamp at time zone 'UTC'))::bigint as reset_at
    from current_month
    left join consumed on true
  `
  const row = rows[0] as {
    allowed: boolean
    remaining: number
    reset_at: number | string
  } | undefined
  if (!row) throw new Error('Authenticated scan quota returned no result')
  return {
    allowed: row.allowed,
    remaining: Number(row.remaining),
    resetAt: Number(row.reset_at),
  }
}

export function consumeAuthenticatedScanQuota(
  accountId: string,
  consume: DurableAuthenticatedScanCounter = consumeFromNeon,
) {
  return consume(accountId, AUTHENTICATED_BASIC_SCAN_LIMIT)
}

/**
 * Gives back one admitted scan in its original UTC month, including when the
 * scan finishes after the month changes. The caller must release a reservation
 * at most once and only after a definitive failure before a scan is saved.
 * Deletes the row at zero to respect migration 025's positive-count constraint;
 * this aggregate counter is not an idempotent reservation ledger.
 */
export async function releaseAuthenticatedScanQuota(
  accountId: string,
  reservation: Pick<AuthenticatedScanQuotaDecision, 'allowed' | 'resetAt'>,
): Promise<void> {
  const reset = new Date(reservation.resetAt * 1000)
  if (
    reservation.allowed !== true ||
    !Number.isSafeInteger(reservation.resetAt) ||
    !Number.isFinite(reset.getTime()) ||
    reset.getUTCDate() !== 1 ||
    reset.getUTCHours() !== 0 ||
    reset.getUTCMinutes() !== 0 ||
    reset.getUTCSeconds() !== 0
  ) {
    throw new Error('Authenticated scan quota release requires an admitted reservation with a UTC month reset')
  }
  reset.setUTCMonth(reset.getUTCMonth() - 1)
  const periodStart = reset.toISOString().split('T')[0]

  // FOR UPDATE refreshes the reservation after a concurrent admission commits.
  // Use that locked count in SET too: a snapshot count of 1 could otherwise
  // produce 0 and fail CHECK before PostgreSQL rechecks the updated row.
  await db()`
    with reservation as materialized (
      select request_count
      from authenticated_scan_monthly_usage
      where account_id = ${accountId}::uuid
        and month_start = ${periodStart}::date
      for update
    ), refunded as (
      update authenticated_scan_monthly_usage
      set request_count = (select request_count from reservation) - 1
      where account_id = ${accountId}::uuid
        and month_start = ${periodStart}::date
        and (select request_count from reservation) > 1
    )
    delete from authenticated_scan_monthly_usage
    where account_id = ${accountId}::uuid
      and month_start = ${periodStart}::date
      and (select request_count from reservation) = 1
  `
}

export function authenticatedScanQuotaHeaders(
  decision: AuthenticatedScanQuotaDecision,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  const resetDelay = Math.max(0, decision.resetAt - nowSeconds)
  const headers = new Headers({
    'RateLimit-Limit': String(AUTHENTICATED_BASIC_SCAN_LIMIT),
    'RateLimit-Remaining': String(decision.remaining),
    'RateLimit-Reset': String(resetDelay),
  })
  if (!decision.allowed) headers.set('Retry-After', String(Math.max(1, resetDelay)))
  return headers
}
