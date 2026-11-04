import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Migration 087 and every lib/staff-grants/store.ts statement, run against
 * real Postgres (PGlite). The parent tables are minimal shapes of the real
 * ones: only the columns and keys 087's foreign keys and the store read.
 */

const state = vi.hoisted(() => ({ pg: null as PGlite | null }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({
  db: () => async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.reduce((out, part, index) => out + (index ? `$${index}` : '') + part, '')
    return (await state.pg!.query(text, values)).rows
  },
}))

import { changeStaffGrant, createStaffGrant, listStaffAudit, listStaffGrants, loadLiveStaffGrant, recordStaffAudit } from '@/lib/staff-grants/store'

const client = '10000000-0000-4000-8000-000000000001' // the client account
const fimmick = '10000000-0000-4000-8000-000000000002' // the staff member's own account
const brand = '20000000-0000-4000-8000-000000000001'
const owner = '30000000-0000-4000-8000-000000000001' // active member of the client account
const removed = '30000000-0000-4000-8000-000000000002' // deactivated member of the client account
const admin = '30000000-0000-4000-8000-000000000003' // platform admin in Fimmick's account
const plain = '30000000-0000-4000-8000-000000000004' // Fimmick member who is not an admin
const ownAdmin = '30000000-0000-4000-8000-000000000005' // admin inside the client account itself

beforeAll(async () => {
  state.pg = await PGlite.create()
  await state.pg.exec(`
    create schema neon_auth;
    create table neon_auth."user"(id uuid primary key, email text);
    create table accounts(id uuid primary key);
    create table profiles(
      id uuid primary key, account_id uuid not null references accounts(id), display_name text,
      is_admin boolean not null default false, deactivated_at timestamptz, unique (id, account_id)
    );
    create table clients(id uuid primary key, account_id uuid not null references accounts(id), brand_name text, unique (id, account_id));
  `)
  await state.pg.exec(readFileSync('supabase/migrations/087_studio_staff_grants.sql', 'utf8'))
  await state.pg.query('insert into accounts values ($1), ($2)', [client, fimmick])
  await state.pg.query('insert into clients values ($1, $2, $3)', [brand, client, 'Bakery'])
  const people: [string, string, string, boolean, boolean][] = [
    [owner, client, 'owner@bakery.hk', false, false],
    [removed, client, 'removed@bakery.hk', false, true],
    [admin, fimmick, 'staff@fimmick.com', true, false],
    [plain, fimmick, 'plain@fimmick.com', false, false],
    [ownAdmin, client, 'admin@bakery.hk', true, false],
  ]
  for (const [id, account, email, isAdmin, gone] of people) {
    await state.pg.query('insert into neon_auth."user" values ($1, $2)', [id, email])
    await state.pg.query(`insert into profiles values ($1, $2, $3, $4, ${gone ? 'now()' : 'null'})`, [id, account, email.split('@')[0], isAdmin])
  }
})

beforeEach(async () => { await state.pg!.exec('delete from studio_staff_audit; delete from studio_staff_grants') })
afterAll(async () => { await state.pg?.close() })

describe('087 + store', () => {
  it('grants a platform admin of another account for 90 days, with its audit row in the same statement', async () => {
    const created = await createStaffGrant(client, owner, 'staff@fimmick.com')
    expect(created.result).toBe('created')
    const [grant] = await listStaffGrants(client)
    expect(grant).toMatchObject({ id: created.id, status: 'active', grantee: { email: 'staff@fimmick.com' }, grantedBy: 'owner' })
    const days = (Date.parse(grant!.expiresAt) - Date.parse(grant!.grantedAt)) / 86_400_000
    expect(days).toBeCloseTo(90, 5)
    expect((await listStaffAudit(client)).map(entry => entry.action)).toEqual(['grant'])
    expect(await loadLiveStaffGrant(client, admin)).toEqual({ id: created.id })
  })

  it('refuses ineligible grantees alike, and refuses a removed member as the granter, writing nothing', async () => {
    for (const email of ['plain@fimmick.com', 'nobody@fimmick.com', 'admin@bakery.hk']) {
      expect((await createStaffGrant(client, owner, email)).result).toBe('not_eligible')
    }
    expect((await createStaffGrant(client, removed, 'staff@fimmick.com')).result).toBe('not_member')
    expect((await createStaffGrant(client, admin, 'staff@fimmick.com')).result).toBe('not_member') // not a member of the client account
    expect(await listStaffGrants(client)).toEqual([])
    expect(await listStaffAudit(client)).toEqual([])
  })

  it('keeps one unrevoked grant per staff member and reports the existing one', async () => {
    const first = await createStaffGrant(client, owner, 'staff@fimmick.com')
    expect(await createStaffGrant(client, owner, 'staff@fimmick.com')).toEqual({ result: 'exists', id: first.id })
    expect(await listStaffGrants(client)).toHaveLength(1)
  })

  it('renews for another 90 days and revokes, each audited, and never touches another account’s grant', async () => {
    const { id } = await createStaffGrant(client, owner, 'staff@fimmick.com')
    expect(await changeStaffGrant(fimmick, plain, id!, 'revoke')).toBe(false)
    expect(await changeStaffGrant(client, removed, id!, 'renew')).toBe(false)
    expect(await changeStaffGrant(client, owner, id!, 'renew')).toBe(true)
    expect(await changeStaffGrant(client, owner, id!, 'revoke')).toBe(true)
    expect(await changeStaffGrant(client, owner, id!, 'revoke')).toBe(false) // already revoked
    expect(await changeStaffGrant(client, owner, id!, 'renew')).toBe(false)
    const [grant] = await listStaffGrants(client)
    expect(grant!.status).toBe('revoked')
    expect(await loadLiveStaffGrant(client, admin)).toBeNull()
    expect((await listStaffAudit(client)).map(entry => entry.action).sort()).toEqual(['grant', 'renew', 'revoke'])
    // A fresh grant after revocation is allowed: the live index covers unrevoked rows only.
    expect((await createStaffGrant(client, owner, 'staff@fimmick.com')).result).toBe('created')
  })

  it('treats an expired, unrevoked grant as not live, and reports it expired', async () => {
    const { id } = await createStaffGrant(client, owner, 'staff@fimmick.com')
    await state.pg!.query(`update studio_staff_grants set granted_at = now() - interval '100 days', expires_at = now() - interval '10 days' where id = $1`, [id])
    expect(await loadLiveStaffGrant(client, admin)).toBeNull()
    expect((await listStaffGrants(client))[0]!.status).toBe('expired')
  })

  it('records staff opens against the brand, readable by the client account only', async () => {
    await recordStaffAudit({ accountId: client, clientId: brand, actorId: admin, action: 'open' })
    expect(await listStaffAudit(client)).toEqual([expect.objectContaining({ action: 'open', actor: 'staff', brand: 'Bakery' })])
    expect(await listStaffAudit(fimmick)).toEqual([])
    // The brand must belong to the account the row is filed under.
    await expect(recordStaffAudit({ accountId: fimmick, clientId: brand, actorId: admin, action: 'open' })).rejects.toThrow()
  })

  it('enforces the 90-day window, an indivisible revocation and the audit shape in the schema itself', async () => {
    const insert = (expires: string) => state.pg!.query(
      `insert into studio_staff_grants (account_id, grantee_profile_id, granted_by, expires_at) values ($1, $2, $3, ${expires})`,
      [client, admin, owner],
    )
    await expect(insert(`now() + interval '91 days'`)).rejects.toThrow(/window_check/)
    await insert(`now() + interval '30 days'`)
    await expect(state.pg!.query('update studio_staff_grants set revoked_at = now()')).rejects.toThrow(/revoke_check/)
    await expect(state.pg!.query(`insert into studio_staff_audit (account_id, actor_profile_id, action) values ($1, $2, 'open')`, [client, admin])).rejects.toThrow(/shape_check/)
    await expect(state.pg!.query(`insert into studio_staff_audit (account_id, client_id, actor_profile_id, action) values ($1, $2, $3, 'delete')`, [client, brand, admin])).rejects.toThrow(/action_check/)
    // The granting member is bound to the client account by the composite FK.
    await expect(state.pg!.query(
      `insert into studio_staff_grants (account_id, grantee_profile_id, granted_by, expires_at) values ($1, $2, $3, now() + interval '1 day')`,
      [client, owner, admin],
    )).rejects.toThrow(/foreign key/)
  })
})
