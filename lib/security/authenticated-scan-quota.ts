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
      where month_start < date_trunc('month', now() at time zone 'UTC')::date - interval '14 months'
    ), consumed as (
      insert into authenticated_scan_monthly_usage (account_id, month_start, request_count)
      select ${accountId}::uuid, month_start, 1 from current_month
      on conflict (account_id, month_start)
      do update set request_count = authenticated_scan_monthly_usage.request_count + 1
      returning request_count, month_start
    )
    select request_count <= ${limit} as allowed,
      greatest(0, ${limit} - request_count)::int as remaining,
      extract(epoch from ((month_start + interval '1 month')::timestamp at time zone 'UTC'))::bigint as reset_at
    from consumed
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
 * Gives back one scan consumed this month. Used when a scan that already spent
 * quota turns out to have nothing to assess (the site never responded): no
 * result is saved, so it must not cost one of the account's monthly scans.
 * Floors at zero and only touches the current UTC month, the one consumed.
 */
export async function releaseAuthenticatedScanQuota(accountId: string): Promise<void> {
  await db()`
    update authenticated_scan_monthly_usage
    set request_count = greatest(0, request_count - 1)
    where account_id = ${accountId}::uuid
      and month_start = date_trunc('month', now() at time zone 'UTC')::date
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
