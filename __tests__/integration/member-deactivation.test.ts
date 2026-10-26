import { beforeEach, describe, expect, it, vi } from 'vitest'
import { neon } from '@neondatabase/serverless'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', async () => {
  const { neon: connect } = await import('@neondatabase/serverless')
  return { db: () => connect(process.env.TEST_DATABASE_URL!) }
})

const sql = neon(process.env.TEST_DATABASE_URL!)

/**
 * Removing somebody from a workspace.
 *
 * Removal is **deactivation, never deletion**, and that is forced rather than
 * chosen: `profiles.account_id` cannot move and the row cannot go, because the
 * composite-FK tenancy chain in 041-046 binds every version, decision and
 * delivery that profile authored to it. So the row stays and stops being a way
 * in — `getProfile()` refuses a deactivated profile, which is the single
 * chokepoint every gated route passes through.
 *
 * Fixtures are keyed to this file; setup.ts shares one branch across the run.
 */

const ACCOUNT = 'aa000000-0000-4000-8000-000000000001'
const OTHER_ACCOUNT = 'aa000000-0000-4000-8000-000000000002'
const OWNER = 'aa000000-0000-4000-8000-000000000003'
const MEMBER = 'aa000000-0000-4000-8000-000000000004'
const OUTSIDER = 'aa000000-0000-4000-8000-000000000005'
const RESTOREE = 'aa000000-0000-4000-8000-000000000006'

const PEOPLE = [OWNER, MEMBER, OUTSIDER, RESTOREE]
const ACCOUNTS = [ACCOUNT, OTHER_ACCOUNT]

beforeEach(async () => {
  await sql`delete from account_invitations where account_id in (${ACCOUNT}::uuid, ${OTHER_ACCOUNT}::uuid)`
  for (const person of PEOPLE) {
    await sql`delete from profiles where id = ${person}::uuid`
    await sql`delete from neon_auth.user where id = ${person}`
  }
  for (const account of ACCOUNTS) {
    await sql`delete from accounts where id = ${account}::uuid`
    await sql`insert into accounts (id, plan, status) values (${account}::uuid, 'basic', 'active')`
  }
  for (const [person, account] of [
    [OWNER, ACCOUNT], [MEMBER, ACCOUNT], [OUTSIDER, OTHER_ACCOUNT],
  ] as const) {
    await sql`
      insert into neon_auth.user (id, email, name, "emailVerified")
      values (${person}, ${`${person}@example.com`}, 'Fixture', false)
    `
    await sql`
      insert into profiles (id, account_id, display_name)
      values (${person}::uuid, ${account}::uuid, 'Fixture')
    `
  }
})

const set = async (profileId: string, active: boolean, actorId = OWNER, accountId = ACCOUNT) => {
  const { setMemberActive } = await import('@/lib/members/store')
  return setMemberActive({ accountId, profileId, actorId, active })
}

const activeFlags = async () => {
  const { loadAccountMembers } = await import('@/lib/members/store')
  const page = await loadAccountMembers(ACCOUNT)
  return Object.fromEntries(page.members.map(member => [member.profileId, member.active]))
}

// Widen the old single-statement race deliberately. Each HTTP call/transaction
// owns an independent PostgreSQL session; this is not an in-memory lock model.
async function withSlowMembershipWrites(run: () => Promise<void>) {
  await sql`create or replace function audit_slow_member_write() returns trigger language plpgsql as $$
    begin perform pg_sleep(0.4); return new; end $$`
  await sql`create trigger audit_slow_member_write before update on profiles for each row
    when (new.account_id = 'aa000000-0000-4000-8000-000000000001'::uuid)
    execute function audit_slow_member_write()`
  try { await run() }
  finally {
    await sql`drop trigger audit_slow_member_write on profiles`
    await sql`drop function audit_slow_member_write()`
  }
}

async function waitForMembershipWrite() {
  for (let attempt = 0; attempt < 80; attempt++) {
    const rows = await sql`select 1 from pg_stat_activity where pid <> pg_backend_pid()
      and wait_event = 'PgSleep' and query like '%deactivated_at = case%'`
    if (rows.length) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('Membership write did not enter its test barrier')
}

describe('setMemberActive', () => {
  it('serializes reciprocal removals from independent sessions and leaves one active member', async () => {
    await withSlowMembershipWrites(async () => {
      const outcomes = await Promise.all([set(MEMBER, false, OWNER), set(OWNER, false, MEMBER)])
      expect(outcomes.sort()).toEqual(['not_found', 'updated'])
      const flags = await activeFlags()
      expect(Object.values(flags).filter(Boolean)).toHaveLength(1)
    })
  })

  it('rechecks a removed actor after the account lock before allowing a concurrent restore', async () => {
    await sql`insert into neon_auth.user (id, email, name, "emailVerified") values (${RESTOREE}, 'restoree@example.com', 'Fixture', false)`
    await sql`insert into profiles (id, account_id, display_name, deactivated_at, deactivated_by)
      values (${RESTOREE}::uuid, ${ACCOUNT}::uuid, 'Fixture', now(), ${OWNER}::uuid)`
    await withSlowMembershipWrites(async () => {
      const removal = set(MEMBER, false, OWNER)
      try {
        await waitForMembershipWrite()
        expect(await set(RESTOREE, true, MEMBER)).toBe('not_found')
      } finally { await removal }
      expect(await activeFlags()).toEqual({ [OWNER]: true, [MEMBER]: false, [RESTOREE]: false })
    })
  })

  it('allows a restore that acquires the account lock before its actor is removed', async () => {
    await sql`insert into neon_auth.user (id, email, name, "emailVerified") values (${RESTOREE}, 'restoree@example.com', 'Fixture', false)`
    await sql`insert into profiles (id, account_id, display_name, deactivated_at, deactivated_by)
      values (${RESTOREE}::uuid, ${ACCOUNT}::uuid, 'Fixture', now(), ${OWNER}::uuid)`
    await withSlowMembershipWrites(async () => {
      const restoration = set(RESTOREE, true, MEMBER)
      try {
        await waitForMembershipWrite()
        expect(await set(MEMBER, false, OWNER)).toBe('updated')
      } finally { expect(await restoration).toBe('updated') }
      expect(await activeFlags()).toEqual({ [OWNER]: true, [MEMBER]: false, [RESTOREE]: true })
    })
  })

  it('deactivates a member while leaving the row, and its account, in place', async () => {
    await expect(set(MEMBER, false)).resolves.toBe('updated')

    expect(await activeFlags()).toEqual({ [OWNER]: true, [MEMBER]: false })
    // The row must survive: everything this person authored is bound to it by
    // a composite foreign key on (…, account_id).
    const rows = (await sql`
      select account_id, deactivated_by from profiles where id = ${MEMBER}::uuid
    `) as Array<Record<string, unknown>>
    expect(rows[0].account_id).toBe(ACCOUNT)
    expect(rows[0].deactivated_by).toBe(OWNER)
  })

  /**
   * Restoring matters more than it looks. A removed person keeps their
   * `neon_auth.user` row, so re-inviting them answers `already_registered` —
   * without a restore, an accidental removal would be permanent.
   */
  it('restores a member who was removed by mistake', async () => {
    await set(MEMBER, false)

    await expect(set(MEMBER, true)).resolves.toBe('updated')

    expect(await activeFlags()).toEqual({ [OWNER]: true, [MEMBER]: true })
    const rows = (await sql`
      select deactivated_at, deactivated_by from profiles where id = ${MEMBER}::uuid
    `) as Array<Record<string, unknown>>
    expect(rows[0]).toEqual({ deactivated_at: null, deactivated_by: null })
  })

  it('refuses to let somebody remove themselves', async () => {
    await expect(set(OWNER, false, OWNER)).resolves.toBe('self')

    expect(await activeFlags()).toEqual({ [OWNER]: true, [MEMBER]: true })
  })

  /**
   * The account lock serializes the active-actor recheck, so the self-removal
   * rule also holds when different sessions remove different members.
   */
  it('cannot be used to empty an account', async () => {
    await set(MEMBER, false)

    await expect(set(OWNER, false, OWNER)).resolves.toBe('self')
    await expect(set(OWNER, false, MEMBER)).resolves.toBe('not_found')

    expect(await activeFlags()).toEqual({ [OWNER]: true, [MEMBER]: false })
  })

  it('refuses a member of another account, without saying whether they exist', async () => {
    await expect(set(OUTSIDER, false)).resolves.toBe('not_found')

    const rows = (await sql`
      select deactivated_at from profiles where id = ${OUTSIDER}::uuid
    `) as Array<Record<string, unknown>>
    expect(rows[0].deactivated_at).toBeNull()
  })

  it('refuses an actor who is not an active member of the account', async () => {
    await expect(set(MEMBER, false, OUTSIDER)).resolves.toBe('not_found')
  })

  it('reports an unchanged state rather than rewriting who removed them', async () => {
    await set(MEMBER, false)

    await expect(set(MEMBER, false)).resolves.toBe('unchanged')
  })
})

describe('a deactivated member stops counting', () => {
  it('frees a slot, so the cap counts only active people', async () => {
    const { createInvitation } = await import('@/lib/members/store')
    const { MAX_ACCOUNT_MEMBERS } = await import('@/lib/members/schema')
    // Fill to the cap: two members already, so MAX-2 invitations.
    for (let index = 0; index < MAX_ACCOUNT_MEMBERS - 2; index += 1) {
      expect((await createInvitation({
        accountId: ACCOUNT, invitedBy: OWNER, email: `cap-aa-${index}@example.com`,
      })).kind).toBe('created')
    }
    expect((await createInvitation({
      accountId: ACCOUNT, invitedBy: OWNER, email: 'cap-aa-overflow@example.com',
    })).kind).toBe('limit_reached')

    await set(MEMBER, false)

    expect((await createInvitation({
      accountId: ACCOUNT, invitedBy: OWNER, email: 'cap-aa-overflow@example.com',
    })).kind).toBe('created')
  })

  it('cannot invite while deactivated, even though the row is still there', async () => {
    const { createInvitation } = await import('@/lib/members/store')
    await set(MEMBER, false)

    expect((await createInvitation({
      accountId: ACCOUNT, invitedBy: MEMBER, email: 'nope-aa@example.com',
    })).kind).toBe('denied')
  })
})
