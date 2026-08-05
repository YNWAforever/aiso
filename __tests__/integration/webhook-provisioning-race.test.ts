import { describe, it, expect, beforeEach } from 'vitest'
import { neon } from '@neondatabase/serverless'
import { provisionAccountForUser } from '@/app/api/webhooks/neon/route'

const sql = neon(process.env.TEST_DATABASE_URL!)

const USER = '44444444-4444-4444-4444-444444444444'
const EMAIL = 'race@example.com'
const CONCURRENCY = 10

/**
 * The unit suite cannot see this bug. Its mock has one shared `profileRows`
 * array with no per-call sequencing, so "two deliveries both observe no
 * profile" is inexpressible there — which is why the race survived review with
 * a green suite. This is the only place the behaviour is actually proven.
 */
async function seed() {
  // profiles.id FKs to neon_auth.user (migration 022). That schema lives
  // outside `public`, so setup.ts's `drop schema public cascade` leaves it
  // intact and rows persist between runs — delete before inserting.
  await sql`delete from profiles where id = ${USER}`
  await sql`delete from accounts where id not in (select account_id from profiles where account_id is not null)`
  await sql`delete from neon_auth.user where id = ${USER}`
  await sql`insert into neon_auth.user (id, email) values (${USER}, ${EMAIL})`
}

describe('concurrent user.created provisioning', () => {
  beforeEach(seed)

  it('creates exactly one account when deliveries race', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: CONCURRENCY }, () =>
        provisionAccountForUser(sql, { userId: USER, name: 'Race' })),
    )

    // Losing deliveries are no-ops, not errors — the webhook returns 200 for
    // them, so a rejection here would mean Neon retries a completed signup.
    expect(results.every(result => result.status === 'fulfilled')).toBe(true)

    const linked = await sql`
      select count(*)::int as n
      from accounts a
      join profiles p on p.account_id = a.id
      where p.id = ${USER}
    `
    expect(linked[0].n).toBe(1)
  })

  it('leaves no account row without a profile pointing at it', async () => {
    await Promise.allSettled(
      Array.from({ length: CONCURRENCY }, () =>
        provisionAccountForUser(sql, { userId: USER, name: 'Race' })),
    )

    // Before the advisory lock this was CONCURRENCY - 1 orphans: every delivery
    // inserted an accounts row with its own uuid, and only one profile won.
    const orphans = await sql`
      select count(*)::int as n
      from accounts a
      left join profiles p on p.account_id = a.id
      where p.id is null
    `
    expect(orphans[0].n).toBe(0)
  })

  it('is a no-op when the user is already provisioned', async () => {
    await provisionAccountForUser(sql, { userId: USER, name: 'First' })
    const before = await sql`select account_id from profiles where id = ${USER}`

    await provisionAccountForUser(sql, { userId: USER, name: 'Redelivery' })
    const after = await sql`select account_id, display_name from profiles where id = ${USER}`

    expect(after[0].account_id).toBe(before[0].account_id)
    expect(after[0].display_name).toBe('First')
    const accounts = await sql`select count(*)::int as n from accounts`
    expect(accounts[0].n).toBe(1)
  })
})
