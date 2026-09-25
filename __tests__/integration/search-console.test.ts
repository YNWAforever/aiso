import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { neon } from '@neondatabase/serverless'
import { assertApprovedTarget } from './approved-target'
import { TENANCY_TARGET_VARIABLES, approvedTenancyTarget, assertDisposableTenancyTarget } from './tenancy-target'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', async () => {
  const { neon: connect } = await import('@neondatabase/serverless')
  return { db: () => connect(process.env.TEST_DATABASE_URL!) }
})

const sql = neon(process.env.TEST_DATABASE_URL!)

/**
 * Migration 054 and the Search Console store against real Postgres (spec §7).
 * Run through scripts/ci/run-exact-target-suites.mjs, which provisions one
 * disposable branch and derives the C9F_TENANCY_* approval from it.
 */

const A = 'c1500000-0000-4000-8000-00000000000a'
const B = 'c1500000-0000-4000-8000-00000000000b'
const A_CLIENT = 'c1500000-0000-4000-8000-0000000000a1'
const B_CLIENT = 'c1500000-0000-4000-8000-0000000000b1'
const A_USER = 'c1500000-0000-4000-8000-0000000000a9'
const B_USER = 'c1500000-0000-4000-8000-0000000000b9'
const sealed = { ciphertext: Buffer.from([0, 1, 2, 250, 251, 252, 0x5c, 0x78]), keyId: '0123456789abcdef' }

async function teardown() {
  await sql`delete from search_console_sync_runs where account_id in (${A}::uuid, ${B}::uuid)`
  await sql`delete from search_console_page_queries where account_id in (${A}::uuid, ${B}::uuid)`
  await sql`delete from search_console_daily where account_id in (${A}::uuid, ${B}::uuid)`
  await sql`delete from search_console_bindings where account_id in (${A}::uuid, ${B}::uuid)`
  await sql`delete from google_connections where account_id in (${A}::uuid, ${B}::uuid)`
  await sql`delete from clients where account_id in (${A}::uuid, ${B}::uuid)`
  await sql`delete from profiles where id in (${A_USER}::uuid, ${B_USER}::uuid)`
  await sql`delete from neon_auth.user where id in (${A_USER}, ${B_USER})`
  await sql`delete from accounts where id in (${A}::uuid, ${B}::uuid)`
}

beforeAll(async () => {
  const target = approvedTenancyTarget()
  assertApprovedTarget(target, TENANCY_TARGET_VARIABLES)
  await assertDisposableTenancyTarget(sql, target!)
})

beforeEach(async () => {
  await teardown()
  for (const [account, client, user, domain] of [
    [A, A_CLIENT, A_USER, 'a-c15.example'], [B, B_CLIENT, B_USER, 'b-c15.example'],
  ]) {
    // Whole uuid: stripe_subscription_id is unique and suites share a branch.
    await sql`insert into accounts (id, plan, status, stripe_subscription_id)
              values (${account}::uuid, 'pro', 'active', ${'sub_' + account})`
    await sql`insert into neon_auth.user (id, email, name, "emailVerified")
              values (${user}, ${user + '@example.com'}, 'Owner', true)`
    await sql`insert into profiles (id, account_id, display_name) values (${user}::uuid, ${account}::uuid, 'Owner')`
    await sql`insert into clients (id, account_id, brand_name, status, competitors, domain)
              values (${client}::uuid, ${account}::uuid, 'Brand', 'active', ${[]}::text[], ${domain})`
  }
})

describe('migration 054 on real Postgres', () => {
  it('round-trips the ciphertext byte for byte through bytea', async () => {
    const store = await import('@/lib/integrations/search-console/store')
    const id = await store.upsertConnection({ accountId: A, profileId: A_USER, subject: 'g-a', email: null, scopes: [], sealed })
    const [len] = await sql`select octet_length(token_ciphertext) as n from google_connections where id = ${id}::uuid`
    expect(len!.n).toBe(sealed.ciphertext.length)
    const loaded = await store.loadConnectionSecret(A, id)
    expect(loaded?.sealed?.ciphertext.equals(sealed.ciphertext)).toBe(true)
    expect(loaded?.sealed?.keyId).toBe(sealed.keyId)
  })

  it('stores a real vault-sealed token that opens again for its own account only', async () => {
    const { sealToken, openToken } = await import('@/lib/integrations/google/vault')
    const store = await import('@/lib/integrations/search-console/store')
    const env = { GOOGLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') }
    const first = sealToken('1//first-refresh-token', { accountId: A }, env)
    const id = await store.upsertConnection({ accountId: A, profileId: A_USER, subject: 'g-v', email: null, scopes: [], sealed: first })
    const loaded = await store.loadConnectionSecret(A, id)
    expect(openToken(loaded!.sealed!, { accountId: A }, env)).toBe('1//first-refresh-token')
    expect(() => openToken(loaded!.sealed!, { accountId: B }, env)).toThrow()

    // Reconnecting the same Google login overwrites the credential (the on-conflict path).
    const second = sealToken('1//second-refresh-token', { accountId: A }, env)
    expect(await store.upsertConnection({ accountId: A, profileId: A_USER, subject: 'g-v', email: null, scopes: [], sealed: second }))
      .toBe(id)
    expect(openToken((await store.loadConnectionSecret(A, id))!.sealed!, { accountId: A }, env)).toBe('1//second-refresh-token')

    // Revoking removes the credential entirely.
    expect(await store.revokeConnectionRow(A, id)).toBe(true)
    expect((await store.loadConnectionSecret(A, id))?.sealed).toBeNull()
  })

  it('overwrites a re-synced day instead of double-counting property rows', async () => {
    const { writeDaily } = await import('@/lib/integrations/search-console/store')
    const day = { date: '2026-09-20', scope: 'property' as const, pageUrl: null, clicks: 1, impressions: 10, ctr: 0.1, position: 4 }
    await writeDaily(A, A_CLIENT, [day])
    await writeDaily(A, A_CLIENT, [{ ...day, clicks: 7 }])
    expect(await sql`select clicks from search_console_daily where client_id = ${A_CLIENT}::uuid`).toEqual([{ clicks: 7 }])
  })

  it('refuses a property row that names a page', async () => {
    await expect(sql`
      insert into search_console_daily (account_id, client_id, date, scope, page_url, clicks, impressions, ctr, position)
      values (${A}::uuid, ${A_CLIENT}::uuid, '2026-09-20', 'property', 'https://x', 0, 0, 0, 0)
    `).rejects.toMatchObject({ code: '23514' })
  })

  it('refuses an outcome outside the vocabulary', async () => {
    await expect(sql`
      insert into search_console_sync_runs (account_id, client_id, outcome) values (${A}::uuid, ${A_CLIENT}::uuid, 'nearly_ok')
    `).rejects.toMatchObject({ code: '23514' })
  })

  it('gives aeo_app no DELETE on history, and DELETE on bindings', async () => {
    const [grants] = await sql`select
      has_table_privilege('aeo_app', 'public.search_console_daily', 'DELETE') as daily,
      has_table_privilege('aeo_app', 'public.search_console_sync_runs', 'DELETE') as runs,
      has_table_privilege('aeo_app', 'public.search_console_bindings', 'DELETE') as bindings`
    expect(grants).toEqual({ daily: false, runs: false, bindings: true })
  })

  it('keeps the account when the connecting profile is deleted (column-list set null)', async () => {
    const { upsertConnection } = await import('@/lib/integrations/search-console/store')
    const id = await upsertConnection({ accountId: A, profileId: A_USER, subject: 'g-a', email: null, scopes: [], sealed })
    await sql`delete from profiles where id = ${A_USER}::uuid`
    const [row] = await sql`select account_id, connected_by from google_connections where id = ${id}::uuid`
    expect(row).toEqual({ account_id: A, connected_by: null })
  })
})

describe('cross-account, as B against A', () => {
  it('lists none of A\'s connections', async () => {
    const store = await import('@/lib/integrations/search-console/store')
    await store.upsertConnection({ accountId: A, profileId: A_USER, subject: 'g-a', email: 'a@e.com', scopes: [], sealed })
    expect(await store.listConnections(B)).toEqual([])
    expect(await store.listConnections(A)).toHaveLength(1)
  })

  it('cannot bind its own brand through A\'s connection', async () => {
    const store = await import('@/lib/integrations/search-console/store')
    const aConn = await store.upsertConnection({ accountId: A, profileId: A_USER, subject: 'g-a', email: null, scopes: [], sealed })
    expect(await store.bindProperty({
      accountId: B, clientId: B_CLIENT, connectionId: aConn, siteUrl: 'sc-domain:b-c15.example',
      permissionLevel: 'siteOwner', boundDomain: 'b-c15.example', profileId: B_USER,
    })).toBe(false)
    expect(await sql`select 1 from search_console_bindings where client_id = ${B_CLIENT}::uuid`).toHaveLength(0)
  })

  it('cannot bind A\'s brand through its own connection', async () => {
    const store = await import('@/lib/integrations/search-console/store')
    const bConn = await store.upsertConnection({ accountId: B, profileId: B_USER, subject: 'g-b', email: null, scopes: [], sealed })
    expect(await store.bindProperty({
      accountId: B, clientId: A_CLIENT, connectionId: bConn, siteUrl: 'sc-domain:a-c15.example',
      permissionLevel: 'siteOwner', boundDomain: 'a-c15.example', profileId: B_USER,
    })).toBe(false)
  })

  it('refuses the pairing at the database even if app code tried', async () => {
    const store = await import('@/lib/integrations/search-console/store')
    const aConn = await store.upsertConnection({ accountId: A, profileId: A_USER, subject: 'g-a', email: null, scopes: [], sealed })
    await expect(sql`
      insert into search_console_bindings (account_id, client_id, connection_id, site_url, permission_level, bound_domain)
      values (${B}::uuid, ${B_CLIENT}::uuid, ${aConn}::uuid, 'x', 'siteOwner', 'b-c15.example')
    `).rejects.toMatchObject({ code: '23503' })
  })

  it('cannot revoke A\'s connection', async () => {
    const store = await import('@/lib/integrations/search-console/store')
    const aConn = await store.upsertConnection({ accountId: A, profileId: A_USER, subject: 'g-a', email: null, scopes: [], sealed })
    expect(await store.revokeConnectionRow(B, aConn)).toBe(false)
    const [row] = await sql`select status from google_connections where id = ${aConn}::uuid`
    expect(row!.status).toBe('active')
  })

  it('writes each brand\'s metrics only to its own account during a sync', async () => {
    const store = await import('@/lib/integrations/search-console/store')
    const { syncBinding } = await import('@/lib/integrations/search-console/sync')
    for (const [account, client, user, domain, clicks] of [
      [A, A_CLIENT, A_USER, 'a-c15.example', 11], [B, B_CLIENT, B_USER, 'b-c15.example', 22],
    ] as const) {
      const conn = await store.upsertConnection({
        accountId: account, profileId: user, subject: `g-${client}`, email: null, scopes: [], sealed,
      })
      await store.bindProperty({
        accountId: account, clientId: client, connectionId: conn, siteUrl: `sc-domain:${domain}`,
        permissionLevel: 'siteOwner', boundDomain: domain, profileId: user,
      })
      const due = (await store.loadDueBindings(50)).find(b => b.clientId === client)
      expect(due).toBeDefined()
      await syncBinding(due!, {
        loadSecret: store.loadConnectionSecret,
        open: () => '1//r',
        refresh: async () => 'ya29.a',
        query: async () => [{ keys: ['2026-09-20'], clicks, impressions: 100, ctr: clicks / 100, position: 3 }],
        listPages: store.listSyncPages,
        writeDaily: store.writeDaily,
        writePageQueries: store.writePageQueries,
        markConnection: store.markConnection,
        recordRun: store.recordRun,
        today: () => '2026-09-24',
      })
    }
    const rows = await sql`
      select account_id, client_id, clicks from search_console_daily
      where account_id in (${A}::uuid, ${B}::uuid) order by clicks`
    expect(rows).toEqual([
      { account_id: A, client_id: A_CLIENT, clicks: 11 },
      { account_id: B, client_id: B_CLIENT, clicks: 22 },
    ])
    expect((await store.loadPanelData(B, A_CLIENT)).property).toBeNull()
    expect((await store.loadPanelData(A, A_CLIENT)).property?.clicks).toBe(11)
  })
})
