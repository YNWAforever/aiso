import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { neon } from '@neondatabase/serverless'
import { selectPendingClients } from '@/lib/pulse/schedule'

const sql = neon(process.env.TEST_DATABASE_URL!)

// Created far in the past so these two sort ahead of anything another file
// leaves behind: the property under test is about who is first in line.
const EXPIRED_ACCOUNT = '77777777-7777-7777-7777-000000000001'
const PAID_ACCOUNT = '77777777-7777-7777-7777-000000000002'
const EXPIRED_CLIENT = '77777777-7777-7777-7777-0000000000c1'
const PAID_CLIENT = '77777777-7777-7777-7777-0000000000c2'

async function cleanup() {
  await sql`delete from prompt_bank where client_id in (${EXPIRED_CLIENT}, ${PAID_CLIENT})`
  await sql`delete from clients where id in (${EXPIRED_CLIENT}, ${PAID_CLIENT})`
  await sql`delete from accounts where id in (${EXPIRED_ACCOUNT}, ${PAID_ACCOUNT})`
}

/**
 * The keyset paging is SQL: a row-value comparison on (created_at, id), a null
 * cursor on the first page, and created_at round-tripped through text. A mocked
 * `sql` can only show the TypeScript loop; this shows Postgres agrees.
 */
async function seed() {
  await cleanup()
  // Passes the SQL prefilter (paid plan name, not past_due/cancelled) but
  // resolves to free: the trial ended and there is no subscription.
  await sql`
    insert into accounts (id, plan, status, trial_ends_at)
    values (${EXPIRED_ACCOUNT}, 'basic', 'trialing', '2000-01-08T00:00:00Z')
  `
  await sql`
    insert into accounts (id, plan, status, stripe_subscription_id)
    values (${PAID_ACCOUNT}, 'pro', 'active', 'sub_schedule_test')
  `
  await sql`
    insert into clients (id, account_id, brand_name, status, competitors, created_at)
    values
      (${EXPIRED_CLIENT}, ${EXPIRED_ACCOUNT}, 'Expired', 'active', ${[]}::text[], '2000-01-01T00:00:00.000001Z'),
      (${PAID_CLIENT},    ${PAID_ACCOUNT},    'Paid',    'active', ${[]}::text[], '2000-01-01T00:00:00.000002Z')
  `
  await sql`
    insert into prompt_bank (client_id, category, question, language, is_active)
    values
      (${EXPIRED_CLIENT}, 'brand_query', 'q', 'en', true),
      (${PAID_CLIENT},    'brand_query', 'q', 'en', true)
  `
}

describe('selectPendingClients against Postgres', () => {
  beforeEach(seed)
  afterAll(cleanup)

  it('selects the paid client even when an expired trial is older', async () => {
    const pending = await selectPendingClients(sql as never, 1)

    expect(pending[0]?.clientId).toBe(PAID_CLIENT)
    expect(pending.map(p => p.clientId)).not.toContain(EXPIRED_CLIENT)
  })
})
