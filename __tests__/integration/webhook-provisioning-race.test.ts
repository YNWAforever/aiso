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
 *
 * Every query below is keyed to this file's own fixtures, and that is not
 * incidental tidiness. setup.ts provisions ONE Neon branch for the whole
 * integration run and every file shares it, so any fixture query phrased over
 * the whole table is a cross-file hazard: it reads, asserts on, or deletes rows
 * another file created. `accounts` in particular is written by
 * brand-workspace.test.ts and client-reports.test.ts, which also insert `scans`
 * rows referencing them.
 */

/** Ids of accounts nothing points at — the shape the race used to leave behind. */
async function orphanAccountIds(): Promise<Set<string>> {
  const rows = (await sql`
    select a.id
    from accounts a
    left join profiles p on p.account_id = a.id
    where p.id is null
  `) as Array<{ id: string }>
  return new Set(rows.map(row => row.id))
}

async function countAccounts(): Promise<number> {
  const rows = (await sql`select count(*)::int as n from accounts`) as Array<{ n: number }>
  return rows[0].n
}

async function seed() {
  // profiles.id FKs to neon_auth.user (migration 022). That schema lives
  // outside `public`, so setup.ts's `drop schema public cascade` leaves it
  // intact and rows persist between runs — delete before inserting.
  //
  // Only this user's own account is removed. The previous sweep
  // (`delete from accounts where id not in (select account_id from profiles …)`)
  // targeted every unlinked account on the shared branch, so it tried to delete
  // the accounts other files' `scans` rows reference and died on
  // scans_account_id_fkey before this file ran a single test.
  const owned = (await sql`
    select account_id from profiles where id = ${USER} and account_id is not null
  `) as Array<{ account_id: string }>
  // profiles.account_id references accounts, so the profile has to go first.
  await sql`delete from profiles where id = ${USER}`
  for (const row of owned) {
    await sql`delete from accounts where id = ${row.account_id}`
  }
  await sql`delete from neon_auth.user where id = ${USER}`
  // Neon Auth owns this table, so its shape is not ours to change: `name` and
  // `emailVerified` are NOT NULL with no default and must be supplied, and
  // `emailVerified` is camelCase so it only resolves when quoted.
  await sql`
    insert into neon_auth.user (id, email, name, "emailVerified")
    values (${USER}, ${EMAIL}, 'Race', false)
  `
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

    // Already scoped: the join pins this to the account THIS user's profile
    // points at, so other files' accounts cannot be counted.
    const linked = await sql`
      select count(*)::int as n
      from accounts a
      join profiles p on p.account_id = a.id
      where p.id = ${USER}
    `
    expect(linked[0].n).toBe(1)
  })

  it('leaves no account row without a profile pointing at it', async () => {
    // Orphanhood is a property of the whole table, so it is measured as a delta
    // against a snapshot taken before the act — an unrelated file's unlinked
    // account must not fail this test, and its absence must not excuse ours.
    const before = await orphanAccountIds()

    await Promise.allSettled(
      Array.from({ length: CONCURRENCY }, () =>
        provisionAccountForUser(sql, { userId: USER, name: 'Race' })),
    )

    // Before the advisory lock this was CONCURRENCY - 1 orphans: every delivery
    // inserted an accounts row with its own uuid, and only one profile won.
    // Every one of those rows is created inside the act above, so the delta
    // still catches the regression in full — it is zero or it is a bug.
    const after = await orphanAccountIds()
    const created = [...after].filter(id => !before.has(id))
    expect(created).toEqual([])
  })

  it('is a no-op when the user is already provisioned', async () => {
    // Counting the whole table and expecting 1 asserted this file owned the
    // branch. What the test actually means is that the two calls below add one
    // account between them, so count the growth instead of the total.
    const accountsBefore = await countAccounts()

    await provisionAccountForUser(sql, { userId: USER, name: 'First' })
    const before = await sql`select account_id from profiles where id = ${USER}`

    await provisionAccountForUser(sql, { userId: USER, name: 'Redelivery' })
    const after = await sql`select account_id, display_name from profiles where id = ${USER}`

    expect(after[0].account_id).toBe(before[0].account_id)
    expect(after[0].display_name).toBe('First')
    // +1 from the first delivery, +0 from the redelivery.
    expect(await countAccounts()).toBe(accountsBefore + 1)
  })
})
