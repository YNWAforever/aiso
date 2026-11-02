import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ pg: null as PGlite | null }))

vi.mock('@/lib/db', () => ({
  db: () => async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.reduce((out, part, index) => out + (index ? `$${index}` : '') + part, '')
    return (await state.pg!.query(text, values)).rows
  },
}))

const accountA = '10000000-0000-4000-8000-000000000001'
const accountB = '10000000-0000-4000-8000-000000000002'
const profileA = '30000000-0000-4000-8000-000000000001'
const profileA2 = '30000000-0000-4000-8000-000000000002'
const profileB = '30000000-0000-4000-8000-000000000003'
const sealed = (byte: number) => ({ ciphertext: Buffer.from([byte, byte, byte]), keyId: 'key-1' })

beforeAll(async () => {
  state.pg = await PGlite.create()
  await state.pg.exec(`
    create table accounts(id uuid primary key);
    create table profiles(id uuid primary key, account_id uuid not null, unique (id, account_id));
  `)
  await state.pg.query('insert into accounts(id) values($1),($2)', [accountA, accountB])
  await state.pg.query('insert into profiles(id, account_id) values($1,$2),($3,$2),($4,$5)', [profileA, accountA, profileA2, profileB, accountB])
  await state.pg.exec(readFileSync('supabase/migrations/084_google_drive_connections.sql', 'utf8'))
})

beforeEach(async () => {
  vi.resetModules()
  await state.pg!.exec('delete from google_drive_connections')
})

afterAll(async () => { await state.pg?.close() })

const store = () => import('@/lib/integrations/google-drive/store')

it('creates the table with RLS on', async () => {
  const rows = (await state.pg!.query<{ relrowsecurity: boolean }>(
    `select relrowsecurity from pg_class where relname = 'google_drive_connections' and relkind = 'r'`,
  )).rows
  expect(rows).toEqual([{ relrowsecurity: true }])
})

it('keeps one connection per member, scoped by account and profile', async () => {
  const { upsertDriveConnection, loadDriveConnection, loadDriveSecret } = await store()
  await upsertDriveConnection({ accountId: accountA, profileId: profileA, subject: 's1', email: 'a@example.com', scopes: ['x'], sealed: sealed(1) })
  await upsertDriveConnection({ accountId: accountA, profileId: profileA, subject: 's2', email: 'a2@example.com', scopes: ['x'], sealed: sealed(2) })
  expect((await state.pg!.query('select count(*)::int as n from google_drive_connections')).rows).toEqual([{ n: 1 }])
  expect(await loadDriveConnection(accountA, profileA)).toEqual({ status: 'active', googleEmail: 'a2@example.com' })
  expect((await loadDriveSecret(accountA, profileA))?.ciphertext).toEqual(Buffer.from([2, 2, 2]))
  // Another member of the same account, and another account, see nothing.
  expect(await loadDriveConnection(accountA, profileA2)).toBeNull()
  expect(await loadDriveConnection(accountB, profileA)).toBeNull()
  expect(await loadDriveSecret(accountB, profileA)).toBeNull()
})

it('refuses to pair a profile with a foreign account', async () => {
  const { upsertDriveConnection } = await store()
  await expect(upsertDriveConnection({ accountId: accountB, profileId: profileA, subject: 's', email: null, scopes: [], sealed: sealed(1) }))
    .rejects.toThrow()
})

it('revoking deletes the credential, keeps the row, and only touches the caller’s own row', async () => {
  const { upsertDriveConnection, revokeDriveConnectionRow, loadDriveConnection, loadDriveSecret } = await store()
  await upsertDriveConnection({ accountId: accountA, profileId: profileA, subject: 's', email: null, scopes: [], sealed: sealed(1) })
  expect(await revokeDriveConnectionRow(accountB, profileA)).toBe(false)
  expect(await revokeDriveConnectionRow(accountA, profileA)).toBe(true)
  expect(await revokeDriveConnectionRow(accountA, profileA)).toBe(false)
  expect(await loadDriveConnection(accountA, profileA)).toBeNull()
  expect(await loadDriveSecret(accountA, profileA)).toBeNull()
  expect((await state.pg!.query('select status, token_ciphertext, token_key_id from google_drive_connections')).rows)
    .toEqual([{ status: 'revoked', token_ciphertext: null, token_key_id: null }])
  // Reconnecting after a revoke reactivates the same row.
  await upsertDriveConnection({ accountId: accountA, profileId: profileA, subject: 's', email: null, scopes: [], sealed: sealed(3) })
  expect(await loadDriveConnection(accountA, profileA)).toEqual({ status: 'active', googleEmail: null })
})

it('enforces the status vocabulary and the credential/status pairing', async () => {
  await expect(state.pg!.query(
    `insert into google_drive_connections (account_id, profile_id, google_subject, scopes, token_ciphertext, token_key_id, status)
     values ($1, $2, 's', '{}', '\\x01', 'k', 'paused')`, [accountA, profileA],
  )).rejects.toThrow()
  await expect(state.pg!.query(
    `insert into google_drive_connections (account_id, profile_id, google_subject, scopes, status)
     values ($1, $2, 's', '{}', 'active')`, [accountA, profileA],
  )).rejects.toThrow()
  await expect(state.pg!.query(
    `insert into google_drive_connections (account_id, profile_id, google_subject, scopes, token_ciphertext, token_key_id, status)
     values ($1, $2, 's', '{}', '\\x01', 'k', 'revoked')`, [accountA, profileA],
  )).rejects.toThrow()
})
