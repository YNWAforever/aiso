import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ db: () => sql }))
import { claimOwnedScan } from '@/lib/scans/request-claim'

// In-process PostgreSQL WASM with no data directory, DSN, socket, or external client.
let pg: PGlite
type Statement = { text: string; values: unknown[] }
const sql = Object.assign((strings: TemplateStringsArray, ...values: unknown[]): Statement => ({
  text: strings.reduce((text, piece, index) => text + (index ? `$${index}` : '') + piece, ''), values,
}), {
  transaction: async (statements: Statement[]) => pg.transaction(async tx => {
    const rows = []
    for (const statement of statements) rows.push((await tx.query(statement.text, statement.values)).rows)
    return rows
  }),
})
beforeAll(async () => {
  pg = new PGlite()
  await pg.exec(`create table clients(id text, account_id text);
    create table scans(id uuid default gen_random_uuid(), url text, domain text, score numeric, results jsonb,
      industry text, region text, grade text, account_id text, agent_status text, client_id text,
      created_at timestamptz default now());
    insert into clients values ('synthetic-client','synthetic-account'),('other-client','synthetic-account'),('foreign-client','foreign-account');`)
})
afterAll(async () => { await pg?.close() })
const input = { accountId: 'synthetic-account', clientId: 'synthetic-client', key: 'same-request',
  url: 'https://example.test', domain: 'example.test', industry: 'general_b2b', region: 'HK',
  results: { _scan_request: { key: 'same-request', state: 'processing' } } }
it('two concurrent initial intents create one row; reentry reads the same persisted claim', async () => {
  const [a, b] = await Promise.all([claimOwnedScan(input), claimOwnedScan(input)])
  expect(a.row.id).toBe(b.row.id)
  expect([a.created, b.created].filter(Boolean)).toHaveLength(1)
  const reread = await claimOwnedScan(input)
  expect(reread.created).toBe(false)
  expect(reread.row.id).toBe(a.row.id)
  expect((await pg.query('select * from scans')).rows).toHaveLength(1)
})
it('same key in a second workspace remains distinct and foreign scope cannot create a claim', async () => {
  const other = await claimOwnedScan({ ...input, clientId: 'other-client' })
  expect(other.created).toBe(true)
  await expect(claimOwnedScan({ ...input, accountId: 'foreign-account' })).rejects.toThrow('SCAN_CLAIM_UNAVAILABLE')
  expect((await pg.query('select * from scans')).rows).toHaveLength(2)
})
