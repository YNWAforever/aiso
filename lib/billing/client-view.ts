import { db } from '@/lib/db'
import { hongKongMonthKey, periodOf } from '@/lib/brand-month/period'
import { listAccountInvoices, type BillingInvoiceRow } from '@/lib/billing/invoices'

/**
 * Client-facing billing view (design slice 4): the account's per-fix billing
 * mode, this Hong Kong month's billable fix-pack counts, and its one-off
 * invoices. Everything is scoped by the account id the caller passes — the API
 * route takes that from the session and never from the request.
 *
 * Honesty rule: `pending` and `failed` ledger rows have NOT been billed. They
 * are reported as "not yet reported" and never folded into the billed count, so
 * a client never sees a figure the Stripe meter has not accepted.
 */
export type ClientBillingMode = 'included' | 'metered' | null

export type ClientBillingViewData = {
  /** Hong Kong calendar month the counts cover, `YYYY-MM`. */
  monthKey: string
  mode: ClientBillingMode
  reportedFixPacks: number
  notReportedFixPacks: number
  invoices: BillingInvoiceRow[]
  hasStripeCustomer: boolean
}

export async function loadClientBillingView(
  accountId: string,
  now: Date = new Date(),
): Promise<ClientBillingViewData> {
  const monthKey = hongKongMonthKey(now)
  const period = periodOf(monthKey)
  if (!period) {
    // hongKongMonthKey always produces a valid key; this is a constructor
    // failure, not caller input, so refuse rather than query a broken window.
    throw new Error('Invalid Hong Kong month')
  }

  const accountRows = await db()`
    select a.stripe_customer_id, b.mode
    from accounts a
    left join account_billing b on b.account_id = a.id
    where a.id = ${accountId}::uuid
    limit 1
  `
  const account = accountRows[0] as
    | { stripe_customer_id: string | null; mode: 'included' | 'metered' | null }
    | undefined

  const usageRows = await db()`
    select
      count(*) filter (where state = 'reported')::int as reported,
      count(*) filter (where state in ('pending', 'failed'))::int as not_reported
    from fix_billing_events
    where account_id = ${accountId}::uuid
      and created_at >= ${period.start}::timestamptz
      and created_at < ${period.end}::timestamptz
  `
  const usage = usageRows[0] as { reported?: number; not_reported?: number } | undefined

  const invoices = await listAccountInvoices(accountId)

  return {
    monthKey,
    mode: account?.mode ?? null,
    reportedFixPacks: Number(usage?.reported ?? 0),
    notReportedFixPacks: Number(usage?.not_reported ?? 0),
    invoices,
    hasStripeCustomer: Boolean(account?.stripe_customer_id),
  }
}
