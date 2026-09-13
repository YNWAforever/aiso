import { beforeEach, describe, expect, it } from 'vitest'
import { neon } from '@neondatabase/serverless'
import { applyAdminGrant, listAdministrators } from '@/scripts/grant-platform-admin'

const sql = neon(process.env.TEST_DATABASE_URL!)

/**
 * The platform-administrator bootstrap, against real Postgres.
 *
 * The parser is unit-tested; what needs a database is the part that matters —
 * that the privilege and the reason for it are written by ONE statement, so a
 * grant cannot exist without its ledger row. A mocked client would only echo
 * back whatever it was told, which is no evidence about that at all.
 *
 * Fixtures are keyed to this file. setup.ts provisions one branch for the
 * whole run and every file shares it, so a query over a whole table would read
 * or delete another file's rows.
 */

const ACCOUNT = 'a8000000-0000-4000-8000-000000000001'
const PERSON = 'a8000000-0000-4000-8000-000000000002'
const ABSENT = 'a8000000-0000-4000-8000-0000000000ff'
const EMAIL = 'admin-a8@example.com'

type Row = Record<string, unknown>

async function ledger(profileId = PERSON): Promise<Row[]> {
  return (await sql`
    select action, reason, operator from platform_admin_grants
    where profile_id = ${profileId}::uuid
    order by created_at asc, id asc
  `) as Row[]
}

async function isAdmin(): Promise<boolean | undefined> {
  const rows = (await sql`select is_admin from profiles where id = ${PERSON}::uuid`) as Row[]
  return rows[0]?.is_admin as boolean | undefined
}

beforeEach(async () => {
  await sql`delete from platform_admin_grants where profile_id in (${PERSON}::uuid, ${ABSENT}::uuid)`
  await sql`delete from profiles where id = ${PERSON}::uuid`
  await sql`delete from accounts where id = ${ACCOUNT}::uuid`
  await sql`delete from neon_auth.user where id = ${PERSON}`
  await sql`insert into accounts (id, plan, status) values (${ACCOUNT}::uuid, 'basic', 'active')`
  await sql`
    insert into neon_auth.user (id, email, name, "emailVerified")
    values (${PERSON}, ${EMAIL}, 'Admin Candidate', false)
  `
  await sql`
    insert into profiles (id, account_id, display_name)
    values (${PERSON}::uuid, ${ACCOUNT}::uuid, 'Admin Candidate')
  `
})

const plan = (action: 'grant' | 'revoke', reason: string) =>
  ({ action, profileId: PERSON, reason, apply: true }) as const

describe('applyAdminGrant', () => {
  it('sets is_admin and records the reason in the same statement', async () => {
    const outcome = await applyAdminGrant(sql, plan('grant', 'AC-14 approver bootstrap'))

    expect(outcome).toMatchObject({ profileExists: true, changed: true })
    expect(outcome.ledgerId).not.toBeNull()
    expect(await isAdmin()).toBe(true)
    const rows = await ledger()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ action: 'grant', reason: 'AC-14 approver bootstrap' })
    // current_user at write time — the connecting role, since the script holds
    // no session and has no profile to name.
    expect(String(rows[0].operator).length).toBeGreaterThan(0)
  })

  it('writes nothing the second time, rather than padding the ledger', async () => {
    await applyAdminGrant(sql, plan('grant', 'first'))

    const outcome = await applyAdminGrant(sql, plan('grant', 'again'))

    expect(outcome).toMatchObject({ profileExists: true, changed: false, ledgerId: null })
    expect(await ledger()).toHaveLength(1)
  })

  it('revokes and records that as its own entry', async () => {
    await applyAdminGrant(sql, plan('grant', 'bootstrap'))

    await applyAdminGrant(sql, plan('revoke', 'left the team'))

    expect(await isAdmin()).toBe(false)
    expect((await ledger()).map(row => row.action)).toEqual(['grant', 'revoke'])
  })

  /**
   * A profile exists only after that person has signed in: profiles.id is a
   * foreign key to neon_auth.user, which only Neon Auth writes. Granting to an
   * id that is not there must write nothing at all — including no ledger row
   * claiming a privilege nobody received.
   */
  it('writes nothing for a profile that does not exist', async () => {
    const outcome = await applyAdminGrant(sql, {
      action: 'grant', profileId: ABSENT, reason: 'typo', apply: true,
    })

    expect(outcome).toMatchObject({ profileExists: false, changed: false, ledgerId: null })
    expect(await ledger(ABSENT)).toEqual([])
  })

  /**
   * 046's rule applied here: the ledger records a decision, so it carries no
   * foreign key and outlives the profile it names. Deleting the person must
   * not erase the record that they once held administrator rights.
   */
  it('keeps the record after the profile is deleted', async () => {
    await applyAdminGrant(sql, plan('grant', 'bootstrap'))

    await sql`delete from profiles where id = ${PERSON}::uuid`

    expect(await ledger()).toHaveLength(1)
  })

  it('refuses a reason the column would not accept', async () => {
    await expect(
      applyAdminGrant(sql, plan('grant', '  untrimmed  ')),
    ).rejects.toThrow(/platform_admin_grants_reason_check/)
  })
})

describe('listAdministrators', () => {
  it('reports only profiles that actually hold the flag', async () => {
    expect((await listAdministrators(sql)).map(row => row.id)).not.toContain(PERSON)

    await applyAdminGrant(sql, plan('grant', 'bootstrap'))

    expect((await listAdministrators(sql)).map(row => row.id)).toContain(PERSON)
  })
})
