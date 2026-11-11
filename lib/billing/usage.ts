import { db } from '@/lib/db'
import { fixPackMeterConfig, stripe } from '@/lib/stripe'

/**
 * Per-fix billing, model B (metered). Design:
 * docs/superpowers/specs/2026-11-11-per-fix-billing-design.md.
 *
 * Two steps, deliberately separate:
 *   1. `enqueueFixPackUsage` writes the pending ledger row synchronously, so a
 *      generated fix pack is recorded even if the request dies before reporting.
 *   2. `reportFixPackUsage` sends the Stripe v2 meter event afterwards. It is
 *      idempotent: the ledger's unique(fix_pack_id) admits one row, and the
 *      meter-event identifier is minted from that same fix-pack id.
 *
 * Nothing here may fail the caller's fix-pack response. Failures are recorded in
 * the ledger (`state='failed'`, bounded `last_error_code`) for the admin to
 * retry, never silently charged and never silently reported as billed.
 */

export const FIX_METER_IDENTIFIER_PREFIX = 'fixbilling:'
export const MAX_METER_ATTEMPTS = 10
export const METER_RETRY_WINDOW_MS = 24 * 60 * 60 * 1000

export type FixPackBillingRef = {
  fixPackId: string
  accountId: string
  clientId: string
}

export function fixMeterIdentifier(fixPackId: string): string {
  return `${FIX_METER_IDENTIFIER_PREFIX}${fixPackId}`
}

/**
 * Record one billable fix pack. Returns the ledger row id, or null when the
 * account is not on metered billing or the pack was already recorded.
 */
export async function enqueueFixPackUsage(ref: FixPackBillingRef): Promise<string | null> {
  const rows = await db()`
    insert into fix_billing_events (
      account_id, client_id, fix_pack_id, stripe_meter_event_identifier
    )
    select ${ref.accountId}::uuid, ${ref.clientId}::uuid, ${ref.fixPackId}::uuid,
           ${fixMeterIdentifier(ref.fixPackId)}
    where exists (
      select 1 from account_billing b
      where b.account_id = ${ref.accountId}::uuid and b.mode = 'metered'
    )
    on conflict (fix_pack_id) do nothing
    returning id
  `
  const row = rows[0] as { id?: string } | undefined
  return row?.id ?? null
}

export type MeterReportOutcome = 'reported' | 'failed' | 'skipped'

type LedgerRow = {
  id: string
  state: string
  attempts: number
  identifier: string
  customer_id: string | null
}

/**
 * Send the meter event for one ledger row. Callers pass the id returned by
 * `enqueueFixPackUsage`, or the row id the admin retry names.
 */
export async function reportFixPackUsage(eventId: string): Promise<MeterReportOutcome> {
  const rows = await db()`
    select e.id, e.state, e.attempts,
           e.stripe_meter_event_identifier as identifier,
           a.stripe_customer_id as customer_id
    from fix_billing_events e
    join accounts a on a.id = e.account_id
    where e.id = ${eventId}::uuid
    limit 1
  `
  const row = rows[0] as LedgerRow | undefined
  if (!row) return 'skipped'
  if (row.state === 'reported') return 'skipped'

  const { priceId, eventName } = fixPackMeterConfig()
  // Fails closed: no configured price/meter means no charge, and the row stays
  // visibly failed rather than pretending the pack was billed.
  if (!priceId || !eventName) return markFailed(eventId, 'STRIPE_CONFIG_MISSING')
  if (!row.customer_id) return markFailed(eventId, 'STRIPE_CUSTOMER_MISSING')

  try {
    await stripe.v2.billing.meterEvents.create({
      event_name: eventName,
      identifier: row.identifier,
      payload: { stripe_customer_id: row.customer_id, value: '1' },
    })
  } catch (error) {
    console.error(
      '[billing] meter event failed:',
      error instanceof Error ? error.message : 'unknown error',
    )
    return markFailed(eventId, 'STRIPE_METER_EVENT_FAILED')
  }

  const updated = await db()`
    update fix_billing_events
    set state = 'reported',
        reported_at = now(),
        last_error_code = null,
        attempts = least(attempts + 1, ${MAX_METER_ATTEMPTS})
    where id = ${eventId}::uuid and state <> 'reported'
    returning id
  `
  return updated.length > 0 ? 'reported' : 'skipped'
}

async function markFailed(eventId: string, code: string): Promise<'failed'> {
  await db()`
    update fix_billing_events
    set state = 'failed',
        attempts = least(attempts + 1, ${MAX_METER_ATTEMPTS}),
        last_error_code = ${code}
    where id = ${eventId}::uuid and state <> 'reported'
  `
  return 'failed'
}

export type MeterRetryOutcome =
  | { status: 'reported' }
  | { status: 'failed' }
  | { status: 'not_found' }
  | { status: 'not_retryable' }
  | { status: 'retry_window_elapsed' }
  | { status: 'attempts_exhausted' }

/**
 * Admin retry. Bounded and idempotent: only rows that never reached Stripe are
 * eligible, attempts are capped by the ledger CHECK, and the identifier makes a
 * duplicate send a no-op within Stripe's 24-hour identifier window. Later
 * retries are refused and left for reconciliation instead of risking a second
 * charge.
 */
export async function retryFixPackUsage(eventId: string): Promise<MeterRetryOutcome> {
  const rows = await db()`
    select id, state, attempts, created_at
    from fix_billing_events
    where id = ${eventId}::uuid
    limit 1
  `
  const row = rows[0] as
    | { id: string; state: string; attempts: number; created_at: string | Date }
    | undefined
  if (!row) return { status: 'not_found' }
  if (row.state === 'reported') return { status: 'not_retryable' }
  if (row.state !== 'pending' && row.state !== 'failed') return { status: 'not_retryable' }
  if (Number(row.attempts) >= MAX_METER_ATTEMPTS) return { status: 'attempts_exhausted' }

  const createdAt = new Date(row.created_at).getTime()
  if (!Number.isFinite(createdAt) || Date.now() - createdAt > METER_RETRY_WINDOW_MS) {
    return { status: 'retry_window_elapsed' }
  }

  const outcome = await reportFixPackUsage(eventId)
  return outcome === 'reported' ? { status: 'reported' } : { status: 'failed' }
}
