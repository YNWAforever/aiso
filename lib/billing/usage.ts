import { db } from '@/lib/db'
import type { GroundedFixPack } from '@/lib/fix/grounded-pack'
import { fixPackMeterConfig, stripe } from '@/lib/stripe'

export const FIX_METER_IDENTIFIER_PREFIX = 'fixbilling:'
export const MAX_METER_ATTEMPTS = 10
export const METER_RETRY_WINDOW_MS = 24 * 60 * 60 * 1000

export function fixMeterIdentifier(fixPackId: string): string {
  return `${FIX_METER_IDENTIFIER_PREFIX}${fixPackId}`
}

/** Serialize cache insertion for the selected scan and commit the eligible ledger entry with it. */
export async function storeFixPack(accountId: string, scanId: string, pack: GroundedFixPack) {
  const sql = db()
  const [[scan], [stored]] = await sql.transaction([
    sql`select id from scans where id = ${scanId}::uuid
        and (account_id is null or account_id = ${accountId}::uuid) for update`,
    sql`with scoped as (
          select s.id, s.account_id, s.client_id
          from scans s where s.id = ${scanId}::uuid and (s.account_id is null or s.account_id = ${accountId}::uuid)
        ), latest_pack as (
          select p.llms_txt, p.robots_patch, p.faq_schema from fix_packs p join scoped s on s.id = p.scan_id
          order by p.created_at desc, p.id desc limit 1
        ), inserted as (
          insert into fix_packs (scan_id, llms_txt, robots_patch, faq_schema)
          select id, ${pack.llms_txt}, ${pack.robots_patch}, ${pack.faq_schema} from scoped
          where not exists (select 1 from latest_pack where llms_txt = ${pack.llms_txt}
            and robots_patch = ${pack.robots_patch} and faq_schema = ${pack.faq_schema})
          returning id, scan_id
        ), ledger as (
          insert into fix_billing_events (account_id, client_id, fix_pack_id, stripe_meter_event_identifier)
          select s.account_id, s.client_id, i.id, ${FIX_METER_IDENTIFIER_PREFIX} || i.id::text
          from inserted i join scoped s on s.id = i.scan_id
          join account_billing b on b.account_id = s.account_id and b.mode = 'metered'
          where s.account_id = ${accountId}::uuid and s.client_id is not null
          returning id
        )
        select exists (select 1 from scoped) as available, (select id from ledger) as usage_id`,
  ])
  return { available: Boolean(scan && stored?.available), usageId: (stored?.usage_id ?? null) as string | null }
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
 * `storeFixPack`, or the row id the admin retry names.
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
