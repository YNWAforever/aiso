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
    await writeDaily(A, A_CLIENT, [day])
    await writeDaily(A, A_CLIENT, [{ ...day, clicks: 7 }])
    expect(await sql`select clicks from search_console_daily where client_id = ${A_CLIENT}::uuid`).toEqual([{ clicks: 7 }])
  })

  it('replaces only the re-fetched window, leaving a query outside it untouched', async () => {
    const { writePageQueries } = await import('@/lib/integrations/search-console/store')
    const pageUrl = 'https://a-c15.example/page1'
    await sql`
      insert into client_assets (account_id, client_id, url, origin, label)
      values (${A}::uuid, ${A_CLIENT}::uuid, ${pageUrl}, 'https://a-c15.example', 'Page 1')
    `
    const windowA = { startDate: '2026-09-18', endDate: '2026-09-24', pageUrls: [pageUrl] }
    const windowOutside = { startDate: '2026-09-10', endDate: '2026-09-10', pageUrls: [pageUrl] }
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
    ])
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
    await store.writeDaily(A, A_CLIENT, [day('2026-09-20', 'property', 3)])
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
