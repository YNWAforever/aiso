import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { neon } from '@neondatabase/serverless'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', async () => {
  const { neon: connect } = await import('@neondatabase/serverless')
  return { db: () => connect(process.env.TEST_DATABASE_URL!) }
})
const sent = vi.hoisted(() => ({ to: [] as string[] }))
vi.mock('@/lib/resend', () => ({
  sendTrialEmail: vi.fn(async ({ to }: { to: string }) => { sent.to.push(to) }),
}))

const sql = neon(process.env.TEST_DATABASE_URL!)

/**
 * Who receives an account's email. Both the alert store and the trial drip pick
 * one profile per account with DISTINCT ON, and both used to order by p.id with
 * no deactivated_at filter — so a removed member could keep receiving the
 * account's mail, chosen only because their uuid sorted first. The predicate
 * and ordering are SQL; a mocked `sql` can only show the text, this shows the
 * rows Postgres actually returns.
 *
 * REMOVED has the lowest uuid AND the earliest created_at, so the old ordering
 * picked it on either key; only the deactivated_at filter excludes it.
 */
const ACCOUNT = 'ee000000-0000-4000-8000-000000000001'
const CLIENT = 'ee000000-0000-4000-8000-0000000000c1'
const REMOVED = 'ee000000-0000-4000-8000-000000000002'
const NEWER = 'ee000000-0000-4000-8000-000000000003'
const OLDER_ACTIVE = 'ee000000-0000-4000-8000-000000000009'
const PEOPLE = [REMOVED, NEWER, OLDER_ACTIVE]
const email = (id: string) => `${id}@example.com`

async function cleanup() {
  await sql`delete from alert_configs where client_id = ${CLIENT}::uuid`
  await sql`delete from clients where id = ${CLIENT}::uuid`
  for (const person of PEOPLE) {
    await sql`delete from profiles where id = ${person}::uuid`
    await sql`delete from neon_auth.user where id = ${person}`
  }
  await sql`delete from accounts where id = ${ACCOUNT}::uuid`
}

async function addPerson(id: string, createdAt: string) {
  await sql`
    insert into neon_auth.user (id, email, name, "emailVerified")
    values (${id}, ${email(id)}, 'Fixture', true)
  `
  await sql`
    insert into profiles (id, account_id, display_name, created_at)
    values (${id}::uuid, ${ACCOUNT}::uuid, 'Fixture', ${createdAt}::timestamptz)
  `
}

// Migration 049 records a removal as two facts that must be set together.
async function deactivate(id: string, by: string) {
  await sql`
    update profiles set deactivated_at = '2026-02-01T00:00:00Z', deactivated_by = ${by}::uuid
    where id = ${id}::uuid
  `
}

beforeEach(async () => {
  await cleanup()
  sent.to.length = 0
  // A live trial: started two days ago, no subscription, nothing sent yet.
  await sql`
    insert into accounts (id, plan, status, trial_started_at, trial_ends_at, trial_emails_sent)
    values (${ACCOUNT}::uuid, 'basic', 'trialing', now() - interval '2 days',
            now() + interval '5 days', 0)
  `
  await sql`
    insert into clients (id, account_id, brand_name, status, competitors)
    values (${CLIENT}::uuid, ${ACCOUNT}::uuid, 'Recipients', 'active', ${[]}::text[])
  `
  await sql`
    insert into alert_configs (client_id, enabled_sov) values (${CLIENT}::uuid, true)
  `
})

afterAll(cleanup)

describe('account email recipient', () => {
  it('alerts never go to a removed member', async () => {
    await addPerson(REMOVED, '2026-01-01T00:00:00Z')
    await addPerson(NEWER, '2026-03-01T00:00:00Z')
    await deactivate(REMOVED, NEWER)
    const { createNeonAlertStore } = await import('@/lib/alerts/neon-store')

    const snapshot = await createNeonAlertStore(sql as never).loadSnapshot()

    expect(snapshot.emailsByAccount[ACCOUNT]).toBe(email(NEWER))
  })

  it('alerts go to the oldest active member, not the lowest uuid', async () => {
    await addPerson(NEWER, '2026-03-01T00:00:00Z')
    await addPerson(OLDER_ACTIVE, '2026-01-15T00:00:00Z')
    const { createNeonAlertStore } = await import('@/lib/alerts/neon-store')

    const snapshot = await createNeonAlertStore(sql as never).loadSnapshot()

    expect(snapshot.emailsByAccount[ACCOUNT]).toBe(email(OLDER_ACTIVE))
  })

  it('the trial drip never goes to a removed member', async () => {
    await addPerson(REMOVED, '2026-01-01T00:00:00Z')
    await addPerson(NEWER, '2026-03-01T00:00:00Z')
    await deactivate(REMOVED, NEWER)
    process.env.CRON_SECRET = 'integration-cron-secret-0123'
    const { GET } = await import('@/app/api/cron/trial-emails/route')

    await GET(new Request('https://app.example/api/cron/trial-emails', {
      headers: { authorization: 'Bearer integration-cron-secret-0123' },
    }))

    const ours = sent.to.filter(to => PEOPLE.map(email).includes(to))
    expect(ours.length).toBeGreaterThan(0)
    expect(ours.every(to => to === email(NEWER))).toBe(true)
  })
})
