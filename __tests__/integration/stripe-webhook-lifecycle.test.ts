import { describe, it, expect, beforeEach } from 'vitest'
import { neon } from '@neondatabase/serverless'
import { randomUUID } from 'node:crypto'

// Calls the three real Postgres functions the Stripe webhook route uses,
// against a real ephemeral Neon branch, with the exact named-argument call
// shape the route uses (`p_foo => value`). A vi.fn() mock will happily
// accept a transposed argument order — nine parameters of which five are
// `text` — because it only ever sees whatever object shape the test handed
// it. Only running the real functions proves the mapping is correct.
const sql = neon(process.env.TEST_DATABASE_URL!)

const ACCOUNT = '44444444-4444-4444-4444-444444444444'
const SUB = 'sub_webhook_lifecycle_test'

async function seed() {
  // Cascades to stripe_webhook_events via its account_id FK.
  await sql`delete from accounts where id = ${ACCOUNT}`
  // Leases are keyed by subscription_id only — no FK to accounts.
  await sql`delete from stripe_subscription_processing_leases where subscription_id = ${SUB}`
  await sql`
    insert into accounts (id, plan, status, stripe_subscription_id)
    values (${ACCOUNT}, 'basic', 'active', null)
  `
}

async function acquire(subscriptionId: string, leaseOwner: string): Promise<boolean> {
  const rows = await sql`
    select acquire_stripe_subscription_lease(
      p_subscription_id => ${subscriptionId},
      p_lease_owner     => ${leaseOwner}::uuid
    ) as acquired
  `
  return rows[0].acquired as boolean
}

async function release(subscriptionId: string, leaseOwner: string): Promise<boolean> {
  const rows = await sql`
    select release_stripe_subscription_lease(
      p_subscription_id => ${subscriptionId},
      p_lease_owner     => ${leaseOwner}::uuid
    ) as released
  `
  return rows[0].released as boolean
}

async function apply(args: {
  accountId: string | null
  subscriptionId: string
  customerId: string
  plan: string
  status: string
  eventCreated: number
  eventId: string
  eventType: string
  leaseOwner: string
}): Promise<string> {
  const rows = await sql`
    select apply_stripe_account_event(
      p_account_id      => ${args.accountId}::uuid,
      p_subscription_id => ${args.subscriptionId},
      p_customer_id     => ${args.customerId},
      p_plan            => ${args.plan},
      p_status          => ${args.status},
      p_event_created   => ${args.eventCreated}::bigint,
      p_event_id        => ${args.eventId},
      p_event_type      => ${args.eventType},
      p_lease_owner     => ${args.leaseOwner}::uuid
    ) as result
  `
  return rows[0].result as string
}

describe('Stripe webhook Postgres functions, called with named arguments', () => {
  beforeEach(seed)

  it('applies a checkout event and writes every column to its matching argument, not a transposed one', async () => {
    const leaseOwner = randomUUID()
    expect(await acquire(SUB, leaseOwner)).toBe(true)

    // customerId and subscriptionId are both plain strings with no DB
    // constraint distinguishing them — a transposition here would compile,
    // run, and silently swap the two columns. Using visibly different
    // prefixes makes that failure mode obvious in the assertion below.
    const outcome = await apply({
      accountId: ACCOUNT,
      subscriptionId: SUB,
      customerId: 'cus_lifecycle_test',
      plan: 'pro',
      status: 'active',
      eventCreated: 1000,
      eventId: 'evt_lifecycle_checkout',
      eventType: 'checkout.session.completed',
      leaseOwner,
    })
    expect(outcome).toBe('applied')

    const rows = await sql`select * from accounts where id = ${ACCOUNT}`
    expect(rows[0]).toMatchObject({
      plan: 'pro',
      status: 'active',
      stripe_customer_id: 'cus_lifecycle_test',
      stripe_subscription_id: SUB,
      stripe_event_id: 'evt_lifecycle_checkout',
    })
    expect(Number(rows[0].stripe_event_created_at)).toBe(1000)

    expect(await release(SUB, leaseOwner)).toBe(true)
  })

  it('is idempotent for a duplicate event id — the account state from the first delivery survives', async () => {
    const leaseOwner = randomUUID()
    await acquire(SUB, leaseOwner)
    await apply({
      accountId: ACCOUNT, subscriptionId: SUB, customerId: 'cus_first', plan: 'pro',
      status: 'active', eventCreated: 1000, eventId: 'evt_duplicate_test',
      eventType: 'customer.subscription.updated', leaseOwner,
    })

    const outcome = await apply({
      accountId: ACCOUNT, subscriptionId: SUB, customerId: 'cus_replay', plan: 'enterprise',
      status: 'past_due', eventCreated: 2000, eventId: 'evt_duplicate_test',
      eventType: 'customer.subscription.updated', leaseOwner,
    })
    expect(outcome).toBe('duplicate')

    const rows = await sql`select plan, status, stripe_customer_id from accounts where id = ${ACCOUNT}`
    expect(rows[0]).toMatchObject({ plan: 'pro', status: 'active', stripe_customer_id: 'cus_first' })

    await release(SUB, leaseOwner)
  })

  it('does not regress state for an out-of-order (older) event delivered after a newer one', async () => {
    const leaseOwner = randomUUID()
    await acquire(SUB, leaseOwner)
    await apply({
      accountId: ACCOUNT, subscriptionId: SUB, customerId: 'cus_new', plan: 'enterprise',
      status: 'active', eventCreated: 5000, eventId: 'evt_newer',
      eventType: 'customer.subscription.updated', leaseOwner,
    })

    const outcome = await apply({
      accountId: ACCOUNT, subscriptionId: SUB, customerId: 'cus_old', plan: 'basic',
      status: 'cancelled', eventCreated: 1000, eventId: 'evt_older',
      eventType: 'customer.subscription.deleted', leaseOwner,
    })
    expect(outcome).toBe('stale')

    const rows = await sql`select plan, status, stripe_customer_id from accounts where id = ${ACCOUNT}`
    expect(rows[0]).toMatchObject({ plan: 'enterprise', status: 'active', stripe_customer_id: 'cus_new' })

    await release(SUB, leaseOwner)
  })

  it('returns not_found when no account links the subscription yet', async () => {
    const leaseOwner = randomUUID()
    await acquire(SUB, leaseOwner)

    const outcome = await apply({
      accountId: null, subscriptionId: SUB, customerId: 'cus_orphan', plan: 'basic',
      status: 'active', eventCreated: 100, eventId: 'evt_orphan',
      eventType: 'customer.subscription.updated', leaseOwner,
    })
    expect(outcome).toBe('not_found')

    await release(SUB, leaseOwner)
  })

  it('fences a former lease owner: applying after release returns lease_lost and changes nothing', async () => {
    const leaseOwner = randomUUID()
    await acquire(SUB, leaseOwner)
    await release(SUB, leaseOwner)

    const outcome = await apply({
      accountId: ACCOUNT, subscriptionId: SUB, customerId: 'cus_fenced', plan: 'pro',
      status: 'active', eventCreated: 100, eventId: 'evt_fenced',
      eventType: 'customer.subscription.updated', leaseOwner,
    })
    expect(outcome).toBe('lease_lost')

    const rows = await sql`select plan from accounts where id = ${ACCOUNT}`
    expect(rows[0].plan).toBe('basic')
  })

  it('serializes concurrent handlers: a second acquire fails while the first holds the lease, and succeeds after release', async () => {
    const ownerA = randomUUID()
    const ownerB = randomUUID()
    expect(await acquire(SUB, ownerA)).toBe(true)
    expect(await acquire(SUB, ownerB)).toBe(false)
    expect(await release(SUB, ownerA)).toBe(true)
    expect(await acquire(SUB, ownerB)).toBe(true)
    expect(await release(SUB, ownerB)).toBe(true)
  })
})
