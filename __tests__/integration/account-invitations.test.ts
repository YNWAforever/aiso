import { beforeEach, describe, expect, it, vi } from 'vitest'
import { neon } from '@neondatabase/serverless'
import { provisionAccountForUser } from '@/app/api/webhooks/neon/route'

vi.mock('server-only', () => ({}))
// lib/members/store reads through db(); point it at the same provisioned branch
// the raw assertions below use, so the store and the SQL see one database. The
// factory imports dynamically because vi.mock is hoisted above this file's own
// imports, so the top-level `neon` binding is not yet initialised when it runs.
// provisionAccountForUser is unaffected — it takes its `sql` as an argument.
vi.mock('@/lib/db', async () => {
  const { neon: connect } = await import('@neondatabase/serverless')
  return { db: () => connect(process.env.TEST_DATABASE_URL!) }
})

const sql = neon(process.env.TEST_DATABASE_URL!)

/**
 * Account membership by invitation, proven against real Postgres.
 *
 * The unit suite cannot prove any of this. The behaviour under test is which
 * account a `profiles` row lands in, and that is decided by SQL — a mocked `db`
 * would only replay whatever the mock was told to say. The argument
 * webhook-provisioning-race.test.ts makes about the concurrency race applies
 * here to tenancy: a second member in the WRONG account is the failure mode,
 * and only the database can refute it.
 *
 * Every query is keyed to this file's own fixture ids. setup.ts provisions ONE
 * branch for the whole integration run and every file shares it, so a query
 * phrased over a whole table would read or delete another file's rows —
 * `accounts` in particular is written by brand-workspace.test.ts and
 * client-reports.test.ts.
 */

const ACCOUNT_A = 'a7000000-0000-4000-8000-000000000001'
const OWNER_A = 'a7000000-0000-4000-8000-000000000002'
const INVITEE = 'a7000000-0000-4000-8000-000000000003'
const ACCOUNT_B = 'a7000000-0000-4000-8000-000000000004'
const OWNER_B = 'a7000000-0000-4000-8000-000000000005'

const OWNER_A_EMAIL = 'owner-a7-a@example.com'
const OWNER_B_EMAIL = 'owner-a7-b@example.com'
const INVITEE_EMAIL = 'invitee-a7@example.com'

const ALL_USERS = [OWNER_A, OWNER_B, INVITEE]
const ALL_ACCOUNTS = [ACCOUNT_A, ACCOUNT_B]

type Row = Record<string, unknown>

async function accountIds(): Promise<Set<string>> {
  const rows = (await sql`select id from accounts`) as Array<{ id: string }>
  return new Set(rows.map(row => row.id))
}

/** Accounts provisioning created, i.e. not one of this file's fixtures. */
async function accountsCreatedSince(before: Set<string>): Promise<string[]> {
  return [...(await accountIds())].filter(id => !before.has(id))
}

async function profileOf(userId: string): Promise<Row | undefined> {
  const rows = (await sql`
    select id, account_id from profiles where id = ${userId}::uuid
  `) as Row[]
  return rows[0]
}

async function invitations(): Promise<Row[]> {
  return (await sql`
    select id, account_id, email, invited_by, accepted_at, accepted_profile_id,
           revoked_at, revoked_by, revoked_reason, expires_at
    from account_invitations
    where email = ${INVITEE_EMAIL}
    order by invited_at asc, id asc
  `) as Row[]
}

/**
 * Invite INVITEE_EMAIL into `accountId`. `invitedAgo`/`expiresIn` are minutes,
 * so a test can express "older invitation" and "already expired" without
 * sleeping.
 */
async function invite(
  accountId: string,
  invitedBy: string,
  { invitedAgo = 0, expiresIn = 60 }: { invitedAgo?: number; expiresIn?: number } = {},
): Promise<string> {
  const rows = (await sql`
    insert into account_invitations (account_id, email, invited_by, invited_at, expires_at)
    values (
      ${accountId}::uuid, ${INVITEE_EMAIL}, ${invitedBy}::uuid,
      now() - make_interval(mins => ${invitedAgo}),
      now() + make_interval(mins => ${expiresIn})
    )
    returning id
  `) as Array<{ id: string }>
  return rows[0].id
}

async function seed() {
  // account_invitations references accounts and profiles, so it goes first;
  // profiles.account_id references accounts, so profiles go before accounts.
  // Both clauses are needed: the store tests invite addresses other than
  // INVITEE_EMAIL, and the provisioning tests invite from accounts that are
  // deleted and recreated here.
  await sql`delete from account_invitations where email = ${INVITEE_EMAIL}`
  await sql`
    delete from account_invitations
    where account_id in (${ACCOUNT_A}::uuid, ${ACCOUNT_B}::uuid)
  `
  for (const user of ALL_USERS) {
    const owned = (await sql`
      select account_id from profiles where id = ${user}::uuid and account_id is not null
    `) as Array<{ account_id: string }>
    await sql`delete from profiles where id = ${user}::uuid`
    for (const row of owned) {
      // Only accounts this file's own users hold. An account another file's
      // `scans` rows reference must not be touched.
      if (!ALL_ACCOUNTS.includes(row.account_id)) {
        await sql`delete from accounts where id = ${row.account_id}::uuid`
      }
    }
  }
  // account_approver_events references accounts with ON DELETE RESTRICT, and
  // _state references the events, so both have to go before the account can.
  // The approver fixture below writes them, and without this the SECOND test
  // in the file fails on a constraint naming a table it never touched.
  for (const account of ALL_ACCOUNTS) {
    await sql`delete from account_approver_state where account_id = ${account}::uuid`
    await sql`delete from account_approver_events where account_id = ${account}::uuid`
  }
  for (const account of ALL_ACCOUNTS) {
    await sql`delete from accounts where id = ${account}::uuid`
  }
  // neon_auth lives outside `public`, so setup.ts's cascade leaves it intact
  // and rows persist between runs — delete before inserting.
  for (const user of ALL_USERS) {
    await sql`delete from neon_auth.user where id = ${user}`
  }

  for (const [account, owner, email] of [
    [ACCOUNT_A, OWNER_A, OWNER_A_EMAIL],
    [ACCOUNT_B, OWNER_B, OWNER_B_EMAIL],
  ] as const) {
    await sql`insert into accounts (id, plan, status) values (${account}::uuid, 'basic', 'active')`
    // `name` and `emailVerified` are NOT NULL with no default, and
    // `emailVerified` is camelCase so it only resolves when quoted.
    await sql`
      insert into neon_auth.user (id, email, name, "emailVerified")
      values (${owner}, ${email}, 'Owner', false)
    `
    await sql`
      insert into profiles (id, account_id, display_name)
      values (${owner}::uuid, ${account}::uuid, 'Owner')
    `
  }
  await sql`
    insert into neon_auth.user (id, email, name, "emailVerified")
    values (${INVITEE}, ${INVITEE_EMAIL}, 'Invitee', false)
  `
}

beforeEach(seed)

describe('provisioning consumes an invitation', () => {
  it('puts the new profile in the INVITING account, not a fresh one', async () => {
    const before = await accountIds()
    await invite(ACCOUNT_A, OWNER_A)

    await provisionAccountForUser(sql, { userId: INVITEE, email: INVITEE_EMAIL, name: 'Invitee' })

    expect((await profileOf(INVITEE))?.account_id).toBe(ACCOUNT_A)
    // The whole point: two profiles, one account. `can_decide` requires exactly
    // this — a second member of the SAME account as the version's submitter.
    const members = (await sql`
      select id from profiles where account_id = ${ACCOUNT_A}::uuid order by id
    `) as Row[]
    expect(members.map(row => row.id)).toEqual([OWNER_A, INVITEE].sort())
    expect(await accountsCreatedSince(before)).toEqual([])
  })

  it('marks the invitation accepted and records who consumed it', async () => {
    await invite(ACCOUNT_A, OWNER_A)

    await provisionAccountForUser(sql, { userId: INVITEE, email: INVITEE_EMAIL, name: 'Invitee' })

    const [invitation] = await invitations()
    expect(invitation.accepted_at).not.toBeNull()
    expect(invitation.accepted_profile_id).toBe(INVITEE)
  })

  it('matches on the normalised address, so a differently-cased sign-in still joins', async () => {
    await invite(ACCOUNT_A, OWNER_A)

    await provisionAccountForUser(sql, {
      userId: INVITEE,
      email: INVITEE_EMAIL.toUpperCase(),
      name: 'Invitee',
    })

    expect((await profileOf(INVITEE))?.account_id).toBe(ACCOUNT_A)
  })
})

describe('provisioning refuses an invitation that is not live', () => {
  it('mints a fresh account when there is no invitation at all', async () => {
    const before = await accountIds()

    await provisionAccountForUser(sql, { userId: INVITEE, email: INVITEE_EMAIL, name: 'Invitee' })

    const created = await accountsCreatedSince(before)
    expect(created).toHaveLength(1)
    expect((await profileOf(INVITEE))?.account_id).toBe(created[0])
  })

  it('mints a fresh account when the invitation has expired', async () => {
    const before = await accountIds()
    // Invited an hour ago with a window that closed a minute ago. `invitedAgo`
    // matters: account_invitations_window_check requires expires_at to be after
    // invited_at, so "expired" has to be expressed as a past window rather than
    // a negative one.
    await invite(ACCOUNT_A, OWNER_A, { invitedAgo: 60, expiresIn: -1 })

    await provisionAccountForUser(sql, { userId: INVITEE, email: INVITEE_EMAIL, name: 'Invitee' })

    expect(await accountsCreatedSince(before)).toHaveLength(1)
    expect((await profileOf(INVITEE))?.account_id).not.toBe(ACCOUNT_A)
    expect((await invitations())[0].accepted_at).toBeNull()
  })

  it('mints a fresh account when the invitation was revoked', async () => {
    const before = await accountIds()
    const id = await invite(ACCOUNT_A, OWNER_A)
    await sql`
      update account_invitations
      set revoked_at = now(), revoked_by = ${OWNER_A}::uuid, revoked_reason = 'member'
      where id = ${id}::uuid
    `

    await provisionAccountForUser(sql, { userId: INVITEE, email: INVITEE_EMAIL, name: 'Invitee' })

    expect(await accountsCreatedSince(before)).toHaveLength(1)
    expect((await profileOf(INVITEE))?.account_id).not.toBe(ACCOUNT_A)
  })
})

describe('two accounts invite the same address', () => {
  /**
   * Per-account uniqueness, not platform-wide: refusing account B because
   * account A already invited the address would tell B that somebody else did,
   * which is the cross-tenant leak AC-12 is about. So both invitations may
   * exist, and provisioning must pick deterministically rather than by row
   * order — otherwise a person's tenancy is decided by the planner.
   */
  it('consumes the oldest live invitation and leaves the other untouched', async () => {
    await invite(ACCOUNT_B, OWNER_B, { invitedAgo: 1 })
    await invite(ACCOUNT_A, OWNER_A, { invitedAgo: 30 })

    await provisionAccountForUser(sql, { userId: INVITEE, email: INVITEE_EMAIL, name: 'Invitee' })

    expect((await profileOf(INVITEE))?.account_id).toBe(ACCOUNT_A)
    const rows = await invitations()
    expect(rows).toHaveLength(2)
    expect(rows[0].account_id).toBe(ACCOUNT_A)
    expect(rows[0].accepted_profile_id).toBe(INVITEE)
    expect(rows[1].accepted_at).toBeNull()
  })
})

describe('account_invitations constraints', () => {
  it('refuses an address that is not already normalised', async () => {
    await expect(sql`
      insert into account_invitations (account_id, email, invited_by, expires_at)
      values (${ACCOUNT_A}::uuid, ${'Mixed@Example.com'}, ${OWNER_A}::uuid, now() + interval '1 day')
    `).rejects.toThrow(/account_invitations_email_check/)
  })

  it('refuses a second live invitation for the same address in the same account', async () => {
    await invite(ACCOUNT_A, OWNER_A)
    await expect(invite(ACCOUNT_A, OWNER_A)).rejects.toThrow(/account_invitations_live_email/)
  })

  it('allows a replacement once the first is revoked', async () => {
    const id = await invite(ACCOUNT_A, OWNER_A)
    await sql`
      update account_invitations
      set revoked_at = now(), revoked_by = ${OWNER_A}::uuid, revoked_reason = 'member'
      where id = ${id}::uuid
    `
    await expect(invite(ACCOUNT_A, OWNER_A)).resolves.toBeTruthy()
  })

  it('refuses an inviter from another account', async () => {
    await expect(invite(ACCOUNT_A, OWNER_B)).rejects.toThrow(/account_invitations_inviter_fk/)
  })

  /**
   * 046's rule, restated for this table. Revocation is one fact recorded three
   * ways and none may stand alone — except a `superseded` revocation, which has
   * no human actor by construction and so must be allowed a null `revoked_by`.
   */
  it('refuses a revocation timestamp with no reason', async () => {
    const id = await invite(ACCOUNT_A, OWNER_A)
    await expect(sql`
      update account_invitations set revoked_at = now() where id = ${id}::uuid
    `).rejects.toThrow(/account_invitations_revocation_check/)
  })

  it('refuses a member revocation with no actor', async () => {
    const id = await invite(ACCOUNT_A, OWNER_A)
    await expect(sql`
      update account_invitations
      set revoked_at = now(), revoked_reason = 'member'
      where id = ${id}::uuid
    `).rejects.toThrow(/account_invitations_revocation_check/)
  })

  it('allows a superseded revocation with no actor', async () => {
    const id = await invite(ACCOUNT_A, OWNER_A)
    await expect(sql`
      update account_invitations
      set revoked_at = now(), revoked_reason = 'superseded'
      where id = ${id}::uuid
    `).resolves.toBeTruthy()
  })

  it('refuses an invitation that is both accepted and revoked', async () => {
    const id = await invite(ACCOUNT_A, OWNER_A)
    await expect(sql`
      update account_invitations
      set accepted_at = now(), accepted_profile_id = ${OWNER_A}::uuid,
          revoked_at = now(), revoked_by = ${OWNER_A}::uuid, revoked_reason = 'member'
      where id = ${id}::uuid
    `).rejects.toThrow(/account_invitations_outcome_check/)
  })

  /**
   * The 044/046 trap, checked rather than assumed: a referential action that
   * performs a write a CHECK on the same table forbids makes the delete fail on
   * a constraint naming no profile. `invited_by` is provenance, so it is
   * erasable and takes `set null` — and no CHECK pairs it with anything.
   */
  it('lets the inviting profile be deleted, leaving the invitation readable', async () => {
    const id = await invite(ACCOUNT_A, OWNER_A)

    await expect(sql`delete from profiles where id = ${OWNER_A}::uuid`).resolves.toBeTruthy()

    const rows = (await sql`
      select invited_by, email from account_invitations where id = ${id}::uuid
    `) as Row[]
    expect(rows).toHaveLength(1)
    expect(rows[0].invited_by).toBeNull()
    expect(rows[0].email).toBe(INVITEE_EMAIL)
  })
})

describe('lib/members/store', () => {
  const OUTSIDER_EMAIL = 'outsider-a7@example.com'

  /**
   * Grant an approver role through the same event + state pair `can_decide`
   * reads. Written directly because minting a grant through the product needs
   * a platform admin, which is a capability separate from membership.
   */
  async function grantApprover(accountId: string, profileId: string, administratorId: string) {
    const rows = (await sql`
      insert into account_approver_events
        (account_id, profile_id, action, previous_revision, new_revision,
         administrator_id, administrator, reason, request_id)
      values (
        ${accountId}::uuid, ${profileId}::uuid, 'grant', 0, 1,
        ${administratorId}::uuid,
        jsonb_build_object('profileId', ${administratorId}::text, 'displayName', null, 'role', 'platform_admin'),
        'fixture', gen_random_uuid()
      )
      returning id
    `) as Array<{ id: string }>
    await sql`
      insert into account_approver_state (account_id, profile_id, active, revision, last_event_id)
      values (${accountId}::uuid, ${profileId}::uuid, true, 1, ${rows[0].id}::uuid)
    `
  }

  describe('loadAccountMembers', () => {
    it('returns only this account, and says who may approve', async () => {
      const { loadAccountMembers } = await import('@/lib/members/store')
      await grantApprover(ACCOUNT_A, OWNER_A, OWNER_A)

      const page = await loadAccountMembers(ACCOUNT_A)

      expect(page.members.map(member => member.profileId)).toEqual([OWNER_A])
      expect(page.members[0].approver).toBe(true)
      // OWNER_B is a member of ACCOUNT_B and must not appear here.
      expect(page.members.map(member => member.profileId)).not.toContain(OWNER_B)
    })

    it('reports a member with no grant as not an approver', async () => {
      const { loadAccountMembers } = await import('@/lib/members/store')

      const page = await loadAccountMembers(ACCOUNT_A)

      expect(page.members[0].approver).toBe(false)
    })

    it('lists this account invitations with a derived status, never another account', async () => {
      const { loadAccountMembers } = await import('@/lib/members/store')
      await invite(ACCOUNT_A, OWNER_A)
      await invite(ACCOUNT_B, OWNER_B)

      const page = await loadAccountMembers(ACCOUNT_A)

      expect(page.invitations).toHaveLength(1)
      expect(page.invitations[0].email).toBe(INVITEE_EMAIL)
      // The address has a neon_auth.user row (seeded), so it can never consume
      // an invitation — the listing has to say so rather than show `pending`.
      expect(page.invitations[0].status).toBe('unclaimable')
    })
  })

  describe('createInvitation', () => {
    async function create(accountId: string, invitedBy: string, email = OUTSIDER_EMAIL) {
      const { createInvitation } = await import('@/lib/members/store')
      return createInvitation({ accountId, invitedBy, email })
    }

    it('creates a live invitation for an address nobody has registered', async () => {
      const result = await create(ACCOUNT_A, OWNER_A)

      expect(result.kind).toBe('created')
      const rows = (await sql`
        select account_id, email, invited_by from account_invitations
        where account_id = ${ACCOUNT_A}::uuid and email = ${OUTSIDER_EMAIL}
      `) as Row[]
      expect(rows).toHaveLength(1)
      expect(rows[0].invited_by).toBe(OWNER_A)
    })

    /**
     * The tenancy assertion. `accountId` reaches the store from the caller's
     * own profile, never from the request — but the store must not depend on
     * that, because one route forgetting it would be the whole breach.
     */
    it('denies an actor who is not a member of the account being invited into', async () => {
      const result = await create(ACCOUNT_A, OWNER_B)

      expect(result.kind).toBe('denied')
      const rows = (await sql`
        select id from account_invitations where email = ${OUTSIDER_EMAIL}
      `) as Row[]
      expect(rows).toEqual([])
    })

    it('refuses an address that is already a member of this account', async () => {
      const result = await create(ACCOUNT_A, OWNER_A, OWNER_A_EMAIL)

      expect(result.kind).toBe('already_member')
    })

    /**
     * An invitation is consumed at provisioning time, so an address that has
     * already signed in can never consume one. Accepting the invitation and
     * sending the mail anyway would promise something the product cannot do.
     */
    it('refuses an address that already has an auth user', async () => {
      const result = await create(ACCOUNT_A, OWNER_A, INVITEE_EMAIL)

      expect(result.kind).toBe('already_registered')
    })

    it('refuses a second live invitation for the same address', async () => {
      await create(ACCOUNT_A, OWNER_A)

      const result = await create(ACCOUNT_A, OWNER_A)

      expect(result.kind).toBe('duplicate')
    })

    /**
     * The partial unique index cannot mention now(), so an expired row still
     * occupies the slot. Replacing it must therefore revoke it as `superseded`
     * in the same call — not delete it, because an offered membership stays
     * explainable.
     */
    it('supersedes an expired invitation rather than failing on the unique index', async () => {
      await sql`
        insert into account_invitations (account_id, email, invited_by, invited_at, expires_at)
        values (${ACCOUNT_A}::uuid, ${OUTSIDER_EMAIL}, ${OWNER_A}::uuid,
                now() - interval '8 days', now() - interval '1 day')
      `

      const result = await create(ACCOUNT_A, OWNER_A)

      expect(result.kind).toBe('created')
      const rows = (await sql`
        select revoked_reason, revoked_by from account_invitations
        where account_id = ${ACCOUNT_A}::uuid and email = ${OUTSIDER_EMAIL}
        order by invited_at asc
      `) as Row[]
      expect(rows).toHaveLength(2)
      expect(rows[0].revoked_reason).toBe('superseded')
      // No human withdrew it, so none is recorded.
      expect(rows[0].revoked_by).toBeNull()
      expect(rows[1].revoked_reason).toBeNull()
    })

    it('refuses once members plus live invitations reach the cap', async () => {
      const { MAX_ACCOUNT_MEMBERS } = await import('@/lib/members/schema')
      // One member already exists, so fill the remaining slots with invitations.
      for (let index = 0; index < MAX_ACCOUNT_MEMBERS - 1; index += 1) {
        const result = await create(ACCOUNT_A, OWNER_A, `cap-a7-${index}@example.com`)
        expect(result.kind).toBe('created')
      }

      const result = await create(ACCOUNT_A, OWNER_A, 'cap-a7-overflow@example.com')

      expect(result.kind).toBe('limit_reached')
    })
  })

  describe('revokeInvitation', () => {
    it('revokes an invitation of its own account and names who did it', async () => {
      const { revokeInvitation } = await import('@/lib/members/store')
      const id = await invite(ACCOUNT_A, OWNER_A)

      await expect(
        revokeInvitation({ accountId: ACCOUNT_A, invitationId: id, revokedBy: OWNER_A }),
      ).resolves.toBe(true)

      const rows = (await sql`
        select revoked_reason, revoked_by from account_invitations where id = ${id}::uuid
      `) as Row[]
      expect(rows[0].revoked_reason).toBe('member')
      expect(rows[0].revoked_by).toBe(OWNER_A)
    })

    it('refuses to revoke another account invitation, and leaves it live', async () => {
      const { revokeInvitation } = await import('@/lib/members/store')
      const id = await invite(ACCOUNT_B, OWNER_B)

      await expect(
        revokeInvitation({ accountId: ACCOUNT_A, invitationId: id, revokedBy: OWNER_A }),
      ).resolves.toBe(false)

      const rows = (await sql`
        select revoked_at from account_invitations where id = ${id}::uuid
      `) as Row[]
      expect(rows[0].revoked_at).toBeNull()
    })

    it('is idempotent — revoking twice does not rewrite who withdrew it', async () => {
      const { revokeInvitation } = await import('@/lib/members/store')
      const id = await invite(ACCOUNT_A, OWNER_A)
      await revokeInvitation({ accountId: ACCOUNT_A, invitationId: id, revokedBy: OWNER_A })
      const [first] = (await sql`
        select revoked_at from account_invitations where id = ${id}::uuid
      `) as Row[]

      await expect(
        revokeInvitation({ accountId: ACCOUNT_A, invitationId: id, revokedBy: OWNER_A }),
      ).resolves.toBe(false)

      const [second] = (await sql`
        select revoked_at from account_invitations where id = ${id}::uuid
      `) as Row[]
      expect(second.revoked_at).toEqual(first.revoked_at)
    })
  })
})
