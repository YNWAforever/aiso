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
  await sql`delete from search_console_coverage where account_id in (${A}::uuid, ${B}::uuid)`
  await sql`delete from search_console_page_queries where account_id in (${A}::uuid, ${B}::uuid)`
  await sql`delete from search_console_daily where account_id in (${A}::uuid, ${B}::uuid)`
  await sql`delete from search_console_bindings where account_id in (${A}::uuid, ${B}::uuid)`
  await sql`delete from google_connections where account_id in (${A}::uuid, ${B}::uuid)`
  await sql`delete from client_assets where account_id in (${A}::uuid, ${B}::uuid)`
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
    await writeDaily(A, A_CLIENT, [day], [])
    await writeDaily(A, A_CLIENT, [{ ...day, clicks: 7 }], [])
    expect(await sql`select clicks from search_console_daily where client_id = ${A_CLIENT}::uuid`).toEqual([{ clicks: 7 }])
  })

  it("replaces each page's queries over that page's own window, not the neighbour's", async () => {
    const { writePageQueries } = await import('@/lib/integrations/search-console/store')
    const fresh = 'https://a-c15.example/fresh'
    const older = 'https://a-c15.example/older'
    const row = (pageUrl: string, query: string, date: string) =>
      ({ pageUrl, date, query, clicks: 1, impressions: 10, ctr: 0.1, position: 3 })
    await writePageQueries(A, A_CLIENT, [row(fresh, 'stale-fresh', '2026-08-01'), row(older, 'old-keep', '2026-08-01'), row(older, 'old-drop', '2026-09-20')], {
      endDate: '2026-09-24',
      pages: [{ pageUrl: fresh, startDate: '2026-06-27' }, { pageUrl: older, startDate: '2026-09-18' }],
    })
    // fresh is re-fetched over 90 days, older over 7: 08-01 is inside fresh's window and outside older's.
    await writePageQueries(A, A_CLIENT, [row(fresh, 'new-fresh', '2026-08-01')], {
      endDate: '2026-09-24',
      pages: [{ pageUrl: fresh, startDate: '2026-06-27' }, { pageUrl: older, startDate: '2026-09-18' }],
    })
    expect(await sql`
      select page_url, query from search_console_page_queries
      where account_id = ${A}::uuid and client_id = ${A_CLIENT}::uuid order by page_url, query`)
      .toEqual([{ page_url: fresh, query: 'new-fresh' }, { page_url: older, query: 'old-keep' }])
  })

  it('replaces only the re-fetched window, leaving a query outside it untouched', async () => {
    const { writePageQueries } = await import('@/lib/integrations/search-console/store')
    const pageUrl = 'https://a-c15.example/page1'
    await sql`
      insert into client_assets (account_id, client_id, url, origin, label)
      values (${A}::uuid, ${A_CLIENT}::uuid, ${pageUrl}, 'https://a-c15.example', 'Page 1')
    `
    const windowA = { endDate: '2026-09-24', pages: [{ pageUrl, startDate: '2026-09-18' }] }
    const windowOutside = { endDate: '2026-09-10', pages: [{ pageUrl, startDate: '2026-09-10' }] }
    const row = (query: string, clicks: number, date = '2026-09-20') =>
      ({ pageUrl, date, query, clicks, impressions: 40, ctr: clicks / 40, position: 6 })

    // First fetch of the window: two queries on the same day.
    await writePageQueries(A, A_CLIENT, [row('q1', 3), row('q2', 4)], windowA)
    // A separate, narrower window for a day outside the first: must survive the
    // later re-fetch of windowA, since the delete predicate is bounded by date.
    await writePageQueries(A, A_CLIENT, [row('qout', 1, '2026-09-10')], windowOutside)
    // Re-fetch of windowA: q1 dropped out of the top ranks, q2's numbers changed.
    await writePageQueries(A, A_CLIENT, [row('q2', 9)], windowA)

    const inWindow = await sql`
      select query, clicks from search_console_page_queries
      where account_id = ${A}::uuid and client_id = ${A_CLIENT}::uuid and page_url = ${pageUrl} and date = '2026-09-20'
    `
    expect(inWindow).toEqual([{ query: 'q2', clicks: 9 }])

    const outsideWindow = await sql`
      select query, clicks from search_console_page_queries
      where account_id = ${A}::uuid and client_id = ${A_CLIENT}::uuid and page_url = ${pageUrl} and date = '2026-09-10'
    `
    expect(outsideWindow).toEqual([{ query: 'qout', clicks: 1 }])
  })

  it('clears backfill_pending only when the recorded run matches the current binding', async () => {
    const store = await import('@/lib/integrations/search-console/store')
    const conn = await store.upsertConnection({ accountId: A, profileId: A_USER, subject: 'g-rebind', email: null, scopes: [], sealed })
    expect(await store.bindProperty({
      accountId: A, clientId: A_CLIENT, connectionId: conn, siteUrl: 'sc-domain:a-c15.example',
      permissionLevel: 'siteOwner', boundDomain: 'a-c15.example', profileId: A_USER,
    })).toBe(true)
    const pending = async () => {
      const [row] = await sql`select backfill_pending from search_console_bindings where account_id = ${A}::uuid and client_id = ${A_CLIENT}::uuid`
      return row!.backfill_pending as boolean
    }
    expect(await pending()).toBe(true)

    // A run for a different siteUrl than the current binding (e.g. a stale run
    // racing a rebind) must not clear this binding's backfill flag.
    await store.recordRun({
      accountId: A, clientId: A_CLIENT, siteUrl: 'sc-domain:stale.example', connectionId: conn,
      outcome: 'ok', rowsWritten: 5, dataThrough: '2026-09-20', clearBackfill: true,
    })
    expect(await pending()).toBe(true)

    // A run for the binding's actual siteUrl and connection clears it.
    await store.recordRun({
      accountId: A, clientId: A_CLIENT, siteUrl: 'sc-domain:a-c15.example', connectionId: conn,
      outcome: 'ok', rowsWritten: 5, dataThrough: '2026-09-20', clearBackfill: true,
    })
    expect(await pending()).toBe(false)
  })

  it('accepts a deferred run and leaves the backfill pending', async () => {
    const store = await import('@/lib/integrations/search-console/store')
    const conn = await store.upsertConnection({ accountId: A, profileId: A_USER, subject: 'g-deferred', email: null, scopes: [], sealed })
    await store.bindProperty({
      accountId: A, clientId: A_CLIENT, connectionId: conn, siteUrl: 'sc-domain:a-c15.example',
      permissionLevel: 'siteOwner', boundDomain: 'a-c15.example', profileId: A_USER,
    })
    await store.recordRun({
      accountId: A, clientId: A_CLIENT, siteUrl: 'sc-domain:a-c15.example', connectionId: conn,
      outcome: 'deferred', rowsWritten: 3, dataThrough: null, clearBackfill: false,
    })
    const [row] = await sql`
      select r.outcome, b.backfill_pending from search_console_sync_runs r
      join search_console_bindings b on b.account_id = r.account_id and b.client_id = r.client_id
      where r.account_id = ${A}::uuid and r.client_id = ${A_CLIENT}::uuid`
    expect(row).toEqual({ outcome: 'deferred', backfill_pending: true })
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

  it('keeps the ledger insert-only for aeo_app: INSERT yes, UPDATE no', async () => {
    const [grants] = await sql`select
      has_table_privilege('aeo_app', 'public.search_console_sync_runs', 'INSERT') as runs_insert,
      has_table_privilege('aeo_app', 'public.search_console_sync_runs', 'UPDATE') as runs_update`
    expect(grants).toEqual({ runs_insert: true, runs_update: false })
  })

  it('gives aeo_app DELETE on page_queries, the one history table that keeps it', async () => {
    // writePageQueries replaces a re-fetched window in one transaction (store.ts):
    // that is not deleting history, so this table alone among the three history
    // tables grants DELETE.
    const [grants] = await sql`select
      has_table_privilege('aeo_app', 'public.search_console_page_queries', 'DELETE') as page_queries`
    expect(grants).toEqual({ page_queries: true })
  })

  it('keeps the account when the connecting profile is deleted (column-list set null)', async () => {
    const { upsertConnection } = await import('@/lib/integrations/search-console/store')
    const id = await upsertConnection({ accountId: A, profileId: A_USER, subject: 'g-a', email: null, scopes: [], sealed })
    await sql`delete from profiles where id = ${A_USER}::uuid`
    const [row] = await sql`select account_id, connected_by from google_connections where id = ${id}::uuid`
    expect(row).toEqual({ account_id: A, connected_by: null })
  })
})

/** The GET route's own derivation, over what the store returns. */
async function ownerState(accountId: string, clientId: string) {
  const store = await import('@/lib/integrations/search-console/store')
  const { deriveOwnerState } = await import('@/lib/integrations/search-console/state')
  const { bindingMatchesDomain } = await import('@/lib/integrations/search-console/binding')
  const [binding, panel] = await Promise.all([store.loadBinding(accountId, clientId), store.loadPanelData(accountId, clientId)])
  return {
    panel,
    state: deriveOwnerState({
      bound: binding !== null, entitled: true, connectionStatus: binding?.connectionStatus ?? null,
      domainMatches: binding ? bindingMatchesDomain(binding, binding.currentDomain) : true,
      boundAt: binding?.boundAt ?? null, latest: panel.latest, lastGoodDataThrough: panel.lastGoodDataThrough,
    }),
  }
}

describe('owner state after a rebind', () => {
  it('reads a rebind after a domain_mismatch run as awaiting the first sync', async () => {
    const store = await import('@/lib/integrations/search-console/store')
    const conn = await store.upsertConnection({ accountId: A, profileId: A_USER, subject: 'g-state', email: null, scopes: [], sealed })
    await store.bindProperty({
      accountId: A, clientId: A_CLIENT, connectionId: conn, siteUrl: 'sc-domain:a-c15.example',
      permissionLevel: 'siteOwner', boundDomain: 'a-c15.example', profileId: A_USER,
    })
    // The brand's domain changes and the next run skips it.
    await sql`update clients set domain = 'new-a-c15.example' where id = ${A_CLIENT}::uuid and account_id = ${A}::uuid`
    await store.recordRun({
      accountId: A, clientId: A_CLIENT, siteUrl: 'sc-domain:a-c15.example', connectionId: conn,
      outcome: 'domain_mismatch', rowsWritten: 0, dataThrough: null, clearBackfill: false,
    })
    expect((await ownerState(A, A_CLIENT)).state).toEqual({ kind: 'rebind', dataThrough: null })

    // The owner rebinds to a property for the new domain; no run has happened since.
    await store.bindProperty({
      accountId: A, clientId: A_CLIENT, connectionId: conn, siteUrl: 'sc-domain:new-a-c15.example',
      permissionLevel: 'siteOwner', boundDomain: 'new-a-c15.example', profileId: A_USER,
    })
    const { state, panel } = await ownerState(A, A_CLIENT)
    expect(panel.latest?.outcome).toBe('domain_mismatch') // the row is still the newest...
    expect(state).toEqual({ kind: 'awaiting_first_sync' }) // ...but it predates the binding
  })

  it('never shows the previous property\'s numbers after a rebind, and shows the new property\'s', async () => {
    const store = await import('@/lib/integrations/search-console/store')
    const conn = await store.upsertConnection({ accountId: A, profileId: A_USER, subject: 'g-panel', email: null, scopes: [], sealed })
    const bind = (siteUrl: string) => store.bindProperty({
      accountId: A, clientId: A_CLIENT, connectionId: conn, siteUrl,
      permissionLevel: 'siteOwner', boundDomain: 'a-c15.example', profileId: A_USER,
    })
    const pageUrl = 'https://a-c15.example/p'
    const day = (date: string, scope: 'property' | 'page', clicks: number) =>
      ({ date, scope, pageUrl: scope === 'page' ? pageUrl : null, clicks, impressions: 100, ctr: clicks / 100, position: 5 })

    // The first property syncs two days, for the whole site and a page.
    await bind('sc-domain:a-c15.example')
    await store.writeDaily(A, A_CLIENT, [
      day('2026-09-19', 'property', 70), day('2026-09-20', 'property', 80), day('2026-09-19', 'page', 7),
    ], [])
    await store.recordRun({
      accountId: A, clientId: A_CLIENT, siteUrl: 'sc-domain:a-c15.example', connectionId: conn,
      outcome: 'ok', rowsWritten: 3, dataThrough: '2026-09-20', clearBackfill: true,
    })
    expect((await store.loadPanelData(A, A_CLIENT)).property?.clicks).toBe(150)

    // Rebound to another property: nothing from before the rebind is shown.
    await bind('https://a-c15.example/')
    const rebound = await ownerState(A, A_CLIENT)
    expect(rebound.panel.property).toBeNull()
    expect(rebound.panel.pages).toEqual([])
    expect(rebound.panel.lastGoodDataThrough).toBeNull()
    expect(rebound.state).toEqual({ kind: 'awaiting_first_sync' })

    // The new property returns 2026-09-20 only; Google omits its zero-traffic
    // 2026-09-19, so that day keeps the old site's row in the table — and must
    // still not be shown.
    await store.writeDaily(A, A_CLIENT, [day('2026-09-20', 'property', 3)], [])
    await store.recordRun({
      accountId: A, clientId: A_CLIENT, siteUrl: 'https://a-c15.example/', connectionId: conn,
      outcome: 'ok', rowsWritten: 1, dataThrough: '2026-09-20', clearBackfill: true,
    })
    const after = await ownerState(A, A_CLIENT)
    expect(after.panel.property?.clicks).toBe(3)
    expect(after.panel.pages).toEqual([])
    expect(after.state).toEqual({ kind: 'synced', dataThrough: '2026-09-20' })
    const [stale] = await sql`
      select clicks from search_console_daily
      where account_id = ${A}::uuid and client_id = ${A_CLIENT}::uuid and date = '2026-09-19' and scope = 'property'`
    expect(stale).toEqual({ clicks: 70 }) // kept as history, just not shown
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
        deadline: Number.POSITIVE_INFINITY,
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

describe('Search Console coverage (migration 056) on real Postgres', () => {
  const P1 = 'https://a-c15.example/p1'
  const P2 = 'https://a-c15.example/p2'
  const mark = (scope: 'property' | 'page', pageUrl: string | null, windowStart: string, contiguous: boolean) =>
    ({ scope, pageUrl, windowStart, contiguous })
  const coverage = (account = A, client = A_CLIENT) => sql`
    select scope, page_url, covered_from::text as covered_from from search_console_coverage
    where account_id = ${account}::uuid and client_id = ${client}::uuid order by scope desc, page_url`

  async function bound(siteUrl = 'sc-domain:a-c15.example') {
    const store = await import('@/lib/integrations/search-console/store')
    const conn = await store.upsertConnection({ accountId: A, profileId: A_USER, subject: 'g-cov', email: null, scopes: [], sealed })
    const bind = (url: string) => store.bindProperty({
      accountId: A, clientId: A_CLIENT, connectionId: conn, siteUrl: url,
      permissionLevel: 'siteOwner', boundDomain: 'a-c15.example', profileId: A_USER,
    })
    await bind(siteUrl)
    return { store, conn, bind }
  }

  it('records coverage with no daily rows, and a non-contiguous mark restarts it at the window start', async () => {
    const { writeDaily } = await import('@/lib/integrations/search-console/store')
    // A property with no activity in the window still has coverage: the whole point.
    expect(await writeDaily(A, A_CLIENT, [], [mark('property', null, '2026-06-27', false), mark('page', P1, '2026-06-27', false)])).toBe(0)
    expect(await coverage()).toEqual([
      { scope: 'property', page_url: null, covered_from: '2026-06-27' },
      { scope: 'page', page_url: P1, covered_from: '2026-06-27' },
    ])
    // A later non-contiguous window (the history before it may have a hole) moves coverage LATER.
    await writeDaily(A, A_CLIENT, [], [mark('property', null, '2026-09-01', false)])
    expect((await coverage())[0]).toEqual({ scope: 'property', page_url: null, covered_from: '2026-09-01' })
  })

  it('a contiguous mark only ever moves covered_from earlier', async () => {
    const { writeDaily } = await import('@/lib/integrations/search-console/store')
    await writeDaily(A, A_CLIENT, [], [mark('property', null, '2026-08-01', false)])
    await writeDaily(A, A_CLIENT, [], [mark('property', null, '2026-09-18', true)]) // later window: no change
    expect((await coverage())[0]!.covered_from).toBe('2026-08-01')
    await writeDaily(A, A_CLIENT, [], [mark('property', null, '2026-07-01', true)]) // earlier: moves
    expect((await coverage())[0]!.covered_from).toBe('2026-07-01')
    expect(await sql`select count(*)::int as n from search_console_coverage where account_id = ${A}::uuid`).toEqual([{ n: 1 }])
  })

  it('writes the daily rows and the coverage together, or neither', async () => {
    const { writeDaily } = await import('@/lib/integrations/search-console/store')
    const day = { date: '2026-09-20', scope: 'property' as const, pageUrl: null, clicks: 1, impressions: 10, ctr: 0.1, position: 4 }
    // A coverage row the database refuses (page scope with no url) must roll the daily row back.
    await expect(writeDaily(A, A_CLIENT, [day], [mark('page', null, '2026-09-18', false)])).rejects.toBeDefined()
    expect(await sql`select 1 from search_console_daily where account_id = ${A}::uuid`).toHaveLength(0)
    expect(await coverage()).toEqual([])
  })

  it('lists a page uncovered until its coverage is written, per brand and account', async () => {
    const { listSyncPages, writeDaily } = await import('@/lib/integrations/search-console/store')
    for (const url of [P1, P2]) {
      await sql`insert into client_assets (account_id, client_id, url, origin, label)
                values (${A}::uuid, ${A_CLIENT}::uuid, ${url}, 'https://a-c15.example', 'Page')`
    }
    expect(await listSyncPages(A, A_CLIENT, 20)).toEqual([
      { url: P1, coveredFrom: null }, { url: P2, coveredFrom: null },
    ])
    await writeDaily(A, A_CLIENT, [], [mark('page', P2, '2026-07-04', false)])
    expect(await listSyncPages(A, A_CLIENT, 20)).toEqual([
      { url: P1, coveredFrom: null }, { url: P2, coveredFrom: '2026-07-04' },
    ])
    // The property's own row (page_url null) is never mistaken for a page's, and B sees none of it.
    await writeDaily(A, A_CLIENT, [], [mark('property', null, '2026-06-27', false)])
    expect((await listSyncPages(A, A_CLIENT, 20)).map(p => p.coveredFrom)).toEqual([null, '2026-07-04'])
    expect(await listSyncPages(B, A_CLIENT, 20)).toEqual([])
  })

  it('reports the UTC date of the newest ok run since the binding, and null before any', async () => {
    const { store } = await bound()
    const due = async () => (await store.loadDueBindings(50)).find(b => b.clientId === A_CLIENT)!.lastOkDate
    expect(await due()).toBeNull()
    const run = (outcome: string, ranAt: string) => sql`
      insert into search_console_sync_runs (account_id, client_id, outcome, ran_at)
      values (${A}::uuid, ${A_CLIENT}::uuid, ${outcome}, ${ranAt}::timestamptz)`
    // Before bound_at: about a previous binding, ignored. A failed run is not an ok run either.
    await run('ok', '2020-01-01T10:00:00Z')
    expect(await due()).toBeNull()
    // Backdate the binding so runs can sit after bound_at, near a UTC midnight boundary.
    await sql`update search_console_bindings set bound_at = '2026-09-01T00:00:00Z' where account_id = ${A}::uuid and client_id = ${A_CLIENT}::uuid`
    await run('ok', '2026-09-12T23:59:30-05:00') // 2026-09-13T04:59:30Z: the UTC date, not the local one
    await run('ok', '2026-09-10T00:00:00Z')
    await run('quota', '2026-09-20T00:00:00Z') // newer, but not ok
    expect(await due()).toBe('2026-09-13')
  })

  it('a rebind to a different site URL deletes coverage; the same URL keeps it', async () => {
    const { store, bind } = await bound()
    await store.writeDaily(A, A_CLIENT, [], [mark('property', null, '2026-06-27', false), mark('page', P1, '2026-06-27', false)])
    expect(await bind('sc-domain:a-c15.example')).toBe(true) // same property again
    expect(await coverage()).toHaveLength(2)
    expect(await bind('https://a-c15.example/')).toBe(true) // different property
    expect(await coverage()).toEqual([])
  })

  it('a refused bind leaves coverage alone', async () => {
    const { store, conn } = await bound()
    await store.writeDaily(A, A_CLIENT, [], [mark('property', null, '2026-06-27', false)])
    await sql`update google_connections set status = 'needs_reconnect' where id = ${conn}::uuid`
    expect(await store.bindProperty({
      accountId: A, clientId: A_CLIENT, connectionId: conn, siteUrl: 'https://other.example/',
      permissionLevel: 'siteOwner', boundDomain: 'a-c15.example', profileId: A_USER,
    })).toBe(false)
    expect(await coverage()).toHaveLength(1)
  })

  it('unbinding deletes coverage, and only for that brand and account', async () => {
    const { store } = await bound()
    await store.writeDaily(A, A_CLIENT, [], [mark('property', null, '2026-06-27', false)])
    await store.writeDaily(B, B_CLIENT, [], [mark('property', null, '2026-06-27', false)])
    expect(await store.unbindProperty(B, A_CLIENT)).toBe(false) // not B's brand
    expect(await coverage()).toHaveLength(1)
    expect(await store.unbindProperty(A, A_CLIENT)).toBe(true)
    expect(await coverage()).toEqual([])
    expect(await coverage(B, B_CLIENT)).toHaveLength(1)
  })

  it('revoking the connection deletes the coverage of the brands it was bound to', async () => {
    const { store, conn } = await bound()
    await store.writeDaily(A, A_CLIENT, [], [mark('property', null, '2026-06-27', false)])
    expect(await store.revokeConnectionRow(A, conn)).toBe(true)
    expect(await coverage()).toEqual([])
  })

  it('end to end: a newly registered page is backfilled while a covered page gets the routine window', async () => {
    const { store } = await bound()
    const { syncBinding } = await import('@/lib/integrations/search-console/sync')
    for (const url of [P1, P2]) {
      await sql`insert into client_assets (account_id, client_id, url, origin, label)
                values (${A}::uuid, ${A_CLIENT}::uuid, ${url}, 'https://a-c15.example', 'Page')`
    }
    await store.writeDaily(A, A_CLIENT, [], [mark('page', P1, '2026-06-27', false)]) // P1 covered, P2 never seen
    await sql`update search_console_bindings set backfill_pending = false where account_id = ${A}::uuid and client_id = ${A_CLIENT}::uuid`
    const starts: Array<{ page: string | null; start: string }> = []
    const due = (await store.loadDueBindings(50)).find(b => b.clientId === A_CLIENT)!
    expect(await syncBinding(due, {
      loadSecret: store.loadConnectionSecret, open: () => '1//r', refresh: async () => 'ya29.a',
      query: async (_t, _s, q) => { starts.push({ page: q.pageEquals ?? null, start: q.startDate }); return [] },
      listPages: store.listSyncPages, writeDaily: store.writeDaily, writePageQueries: store.writePageQueries,
      markConnection: store.markConnection, recordRun: store.recordRun,
      today: () => '2026-09-24', deadline: Number.POSITIVE_INFINITY,
    })).toBe('ok')
    expect(starts).toEqual([
      { page: null, start: '2026-09-18' }, { page: P1, start: '2026-09-18' }, { page: P2, start: '2026-06-27' },
    ])
    // No Google rows at all, yet every fetched target now has recorded coverage. No ok run since the bind
    // means the property window is not contiguous, so P1 restarts at it; P2 at its own 90-day start.
    expect(await coverage()).toEqual([
      { scope: 'property', page_url: null, covered_from: '2026-09-18' },
      { scope: 'page', page_url: P1, covered_from: '2026-09-18' },
      { scope: 'page', page_url: P2, covered_from: '2026-06-27' },
    ])
  })
})
