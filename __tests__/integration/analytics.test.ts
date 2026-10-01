import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertApprovedTarget } from './approved-target'
import { TENANCY_TARGET_VARIABLES, approvedTenancyTarget, assertDisposableTenancyTarget } from './tenancy-target'
import { ANALYTICS_SYNC_OUTCOMES } from '@/lib/integrations/analytics/state'

/**
 * Migration 055 and the GA4 conversions store against real Postgres (spec section 7).
 * Run through scripts/ci/run-exact-target-suites.mjs, which provisions one
 * disposable branch and derives the C9F_TENANCY_* approval from it.
 *
 * Two connections, on purpose:
 *   - `sql` is the branch owner. It writes fixtures, tears them down, and seeds rows
 *     the store never would (a stale synced_at, a ledger row from before a bind).
 *   - `app` is aeo_app, the role the application really runs as. The STORE runs on
 *     it, so every statement it issues is proved against the grants 055 gives
 *     (including `for share of g`, which needs more than SELECT), and the permission
 *     assertions below use it directly.
 * The aeo_app url is the C9E_TEST_APP_DATABASE_URL the wrapper derives for every
 * exact-target suite; it is verified in-band against the same branch before use.
 */

const storeConnection = vi.hoisted(() => ({ sql: null as NeonQueryFunction<false, false> | null }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({
  db: () => {
    if (!storeConnection.sql) throw new Error('ANALYTICS_TARGET_NOT_VERIFIED')
    return storeConnection.sql
  },
}))

const sql = neon(process.env.TEST_DATABASE_URL!)
const appUrl = process.env.C9E_TEST_APP_DATABASE_URL
let app: NeonQueryFunction<false, false>

const A = 'c1600000-0000-4000-8000-00000000000a'
const B = 'c1600000-0000-4000-8000-00000000000b'
const A_CLIENT = 'c1600000-0000-4000-8000-0000000000a1'
const B_CLIENT = 'c1600000-0000-4000-8000-0000000000b1'
const A_USER = 'c1600000-0000-4000-8000-0000000000a9'
const B_USER = 'c1600000-0000-4000-8000-0000000000b9'
const sealed = { ciphertext: Buffer.from([0, 1, 2, 250, 251, 252, 0x5c, 0x78]), keyId: '0123456789abcdef' }
const SCOPES = ['https://www.googleapis.com/auth/analytics.readonly', 'openid', 'email']

async function teardown() {
  await sql`delete from analytics_sync_runs where account_id in (${A}::uuid, ${B}::uuid)`
  await sql`delete from analytics_daily where account_id in (${A}::uuid, ${B}::uuid)`
  await sql`delete from analytics_bindings where account_id in (${A}::uuid, ${B}::uuid)`
  await sql`delete from local_trust_profiles where account_id in (${A}::uuid, ${B}::uuid)`
  await sql`delete from google_connections where account_id in (${A}::uuid, ${B}::uuid)`
  await sql`delete from clients where account_id in (${A}::uuid, ${B}::uuid)`
  await sql`delete from profiles where id in (${A_USER}::uuid, ${B_USER}::uuid)`
  await sql`delete from neon_auth.user where id in (${A_USER}, ${B_USER})`
  await sql`delete from accounts where id in (${A}::uuid, ${B}::uuid)`
}

beforeAll(async () => {
  const target = approvedTenancyTarget()
  assertApprovedTarget(target && appUrl, `${TENANCY_TARGET_VARIABLES} and C9E_TEST_APP_DATABASE_URL`)
  await assertDisposableTenancyTarget(sql, target!)

  // The app connection must be aeo_app on the very same branch, or the permission
  // assertions below would prove nothing about the role the application runs as.
  app = neon(appUrl!)
  const [identity] = await app`
    select current_setting('neon.project_id', true) as project,
           current_setting('neon.branch_id', true) as branch,
           current_user as role`
  if (identity?.project !== target!.project || identity?.branch !== target!.branch || identity?.role !== 'aeo_app') {
    throw new Error('The application connection is not aeo_app on the approved disposable branch — refusing to run.')
  }
  storeConnection.sql = app
})

beforeEach(async () => {
  await teardown()
  for (const [account, client, user, domain] of [
    [A, A_CLIENT, A_USER, 'a-c16.example'], [B, B_CLIENT, B_USER, 'b-c16.example'],
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

const gaStore = () => import('@/lib/integrations/analytics/store')
const scStore = () => import('@/lib/integrations/search-console/store')

async function connect(account: string, user: string, subject: string, scopes: string[] = SCOPES) {
  const store = await scStore()
  return store.upsertConnection({ accountId: account, profileId: user, subject, email: null, scopes, sealed })
}

const bindingOf = (over: Partial<Parameters<Awaited<ReturnType<typeof gaStore>>['bindStream']>[0]> & { connectionId: string }) => ({
  accountId: A, clientId: A_CLIENT, propertyId: '111', streamId: '222', streamHost: 'a-c16.example',
  keyEvents: ['generate_lead'], ...over,
})

async function rawBinding(account = A, client = A_CLIENT) {
  const [row] = await sql`
    select connection_id, property_id, stream_id, key_events, backfill_pending,
           bound_at::text as bound_at, events_chosen_at::text as events_chosen_at
    from analytics_bindings where account_id = ${account}::uuid and client_id = ${client}::uuid`
  return row
}

const names = (n: number) => Array.from({ length: n }, (_, i) => `event_${i}`)

describe('migration 055 on real Postgres', () => {
  it('applies after 054 and creates the three tables and the CHECK helper', async () => {
    const files = (await sql`select filename from schema_migrations order by filename`).map(r => String(r.filename))
    expect(files.some(f => f.startsWith('054_'))).toBe(true)
    const at055 = files.findIndex(f => f.startsWith('055_'))
    expect(at055).toBeGreaterThan(files.findIndex(f => f.startsWith('054_')))

    const tables = await sql`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_name like 'analytics\\_%' order by table_name`
    expect(tables.map(t => t.table_name)).toEqual(['analytics_bindings', 'analytics_daily', 'analytics_sync_runs'])
    const [fn] = await sql`select to_regprocedure('public.analytics_event_names_valid(text[])') is not null as present`
    expect(fn).toEqual({ present: true })
  })

  it('rejects a mismatched (client_id, account_id) with 23503 on all three tables', async () => {
    const aConn = await connect(A, A_USER, 'g-fk')
    // A's brand under B's account id: the composite client FK is the tenancy backstop.
    await expect(sql`
      insert into analytics_bindings (account_id, client_id, connection_id, property_id, stream_id, stream_host, key_events)
      values (${B}::uuid, ${A_CLIENT}::uuid, ${aConn}::uuid, '1', '2', 'x', array['e'])
    `).rejects.toMatchObject({ code: '23503', message: expect.stringContaining('analytics_bindings_client_fk') })
    // B's brand through A's connection: the composite connection FK.
    await expect(sql`
      insert into analytics_bindings (account_id, client_id, connection_id, property_id, stream_id, stream_host, key_events)
      values (${B}::uuid, ${B_CLIENT}::uuid, ${aConn}::uuid, '1', '2', 'x', array['e'])
    `).rejects.toMatchObject({ code: '23503', message: expect.stringContaining('analytics_bindings_connection_fk') })
    await expect(sql`
      insert into analytics_daily (account_id, client_id, date, event_name, source_class, count)
      values (${B}::uuid, ${A_CLIENT}::uuid, '2026-09-20', 'e', 'other', 1)
    `).rejects.toMatchObject({ code: '23503', message: expect.stringContaining('analytics_daily_client_fk') })
    await expect(sql`
      insert into analytics_sync_runs (account_id, client_id, connection_id, property_id, stream_id, outcome)
      values (${B}::uuid, ${A_CLIENT}::uuid, ${aConn}::uuid, '1', '2', 'ok')
    `).rejects.toMatchObject({ code: '23503', message: expect.stringContaining('analytics_sync_runs_client_fk') })
  })

  describe('the key_events, property and stream CHECKs', () => {
    async function insertBinding(keyEvents: string, property = '1', stream = '2', host = 'x') {
      const conn = await connect(A, A_USER, 'g-check')
      // The array literal is a bound text parameter cast to text[], so a null or
      // empty element reaches the CHECK exactly as the application would send it.
      return sql`
        insert into analytics_bindings (account_id, client_id, connection_id, property_id, stream_id, stream_host, key_events)
        values (${A}::uuid, ${A_CLIENT}::uuid, ${conn}::uuid, ${property}, ${stream}, ${host}, ${keyEvents}::text[])
        returning client_id`
    }
    const pgArray = (items: Array<string | null>) =>
      `{${items.map(i => (i === null ? 'NULL' : `"${i}"`)).join(',')}}`

    it('accepts the boundary: 20 names, and a 40-character name', async () => {
      await expect(insertBinding(pgArray(names(20)))).resolves.toHaveLength(1)
      await sql`delete from analytics_bindings where account_id = ${A}::uuid`
      await expect(insertBinding(pgArray(['a'.repeat(40)]))).resolves.toHaveLength(1)
    })

    it('rejects 21 names (count check)', async () => {
      await expect(insertBinding(pgArray(names(21)))).rejects.toMatchObject({
        code: '23514', message: expect.stringContaining('analytics_bindings_key_events_count_check'),
      })
    })

    it('rejects no names at all', async () => {
      await expect(insertBinding('{}')).rejects.toMatchObject({
        code: '23514', message: expect.stringContaining('analytics_bindings_key_events_count_check'),
      })
    })

    it('rejects a 41-character name (helper)', async () => {
      await expect(insertBinding(pgArray(['a'.repeat(41)]))).rejects.toMatchObject({
        code: '23514', message: expect.stringContaining('analytics_bindings_key_events_names_check'),
      })
    })

    it('rejects an empty-string element, and a null element', async () => {
      await expect(insertBinding(pgArray(['ok', '']))).rejects.toMatchObject({
        code: '23514', message: expect.stringContaining('analytics_bindings_key_events_names_check'),
      })
      await expect(insertBinding(pgArray(['ok', null]))).rejects.toMatchObject({
        code: '23514', message: expect.stringContaining('analytics_bindings_key_events_names_check'),
      })
    })

    it('answers the helper directly: valid, empty-string, null element, over-long', async () => {
      const [r] = await sql`
        select public.analytics_event_names_valid(array['a', 'Generate_Lead']) as ok,
               public.analytics_event_names_valid(array['a', '']) as empty_el,
               public.analytics_event_names_valid(array['a', null]::text[]) as null_el,
               public.analytics_event_names_valid(array[repeat('a', 41)]) as too_long,
               public.analytics_event_names_valid(array[repeat('a', 40)]) as at_limit`
      expect(r).toEqual({ ok: true, empty_el: false, null_el: false, too_long: false, at_limit: true })
    })

    it.each(['abc', '12a', '', '-1', ' 1', '1 '])('rejects the non-digit property_id %j', async bad => {
      await expect(insertBinding(pgArray(['e']), bad, '2')).rejects.toMatchObject({
        code: '23514', message: expect.stringContaining('analytics_bindings_property_id_check'),
      })
    })

    it.each(['abc', '12a', '', '-1', '1.5'])('rejects the non-digit stream_id %j', async bad => {
      await expect(insertBinding(pgArray(['e']), '1', bad)).rejects.toMatchObject({
        code: '23514', message: expect.stringContaining('analytics_bindings_stream_id_check'),
      })
    })

    it('rejects a stream_host over 253 characters', async () => {
      await expect(insertBinding(pgArray(['e']), '1', '2', 'h'.repeat(254))).rejects.toMatchObject({
        code: '23514', message: expect.stringContaining('analytics_bindings_stream_host_check'),
      })
    })
  })

  it('holds the analytics_daily and ledger vocabularies at the database', async () => {
    const insertDaily = (event: string, cls: string, count: number) => sql`
      insert into analytics_daily (account_id, client_id, date, event_name, source_class, count)
      values (${A}::uuid, ${A_CLIENT}::uuid, '2026-09-20', ${event}, ${cls}, ${count})`
    await expect(insertDaily('e', 'referral', 1)).rejects.toMatchObject({ code: '23514' })
    await expect(insertDaily('e', 'other', -1)).rejects.toMatchObject({ code: '23514' })
    await expect(insertDaily('', 'other', 1)).rejects.toMatchObject({ code: '23514' })
    await expect(insertDaily('e'.repeat(41), 'other', 1)).rejects.toMatchObject({ code: '23514' })
    await insertDaily('e', 'other', 1)
    // A duplicate key is refused loudly, never summed: the caller aggregates.
    await expect(insertDaily('e', 'other', 1)).rejects.toMatchObject({ code: '23505' })

    const conn = await connect(A, A_USER, 'g-vocab')
    const insertRun = (outcome: string) => sql`
      insert into analytics_sync_runs (account_id, client_id, connection_id, property_id, stream_id, outcome)
      values (${A}::uuid, ${A_CLIENT}::uuid, ${conn}::uuid, '1', '2', ${outcome})`
    await expect(insertRun('nearly_ok')).rejects.toMatchObject({ code: '23514' })
    // The TypeScript vocabulary and the CHECK are mirrors: every code value must be accepted.
    for (const outcome of ANALYTICS_SYNC_OUTCOMES) await insertRun(outcome)
    const [n] = await sql`select count(*)::int as n from analytics_sync_runs where account_id = ${A}::uuid`
    expect(n).toEqual({ n: ANALYTICS_SYNC_OUTCOMES.length })
  })

  it('keeps the ledger when the connection is deleted (no FK, on purpose), and drops the binding', async () => {
    const store = await gaStore()
    const conn = await connect(A, A_USER, 'g-ledger')
    expect(await store.bindStream(bindingOf({ connectionId: conn }))).toBe('bound')
    await store.recordAnalyticsRun({
      accountId: A, clientId: A_CLIENT, connectionId: conn, propertyId: '111', streamId: '222',
      eventsChosenAt: new Date().toISOString(), outcome: 'ok', rowsWritten: 1, dataThrough: '2026-09-20',
      dataWithheld: false, clearBackfill: false,
    })
    await sql`delete from google_connections where id = ${conn}::uuid`
    expect(await sql`select 1 from analytics_bindings where client_id = ${A_CLIENT}::uuid`).toHaveLength(0)
    expect(await sql`select 1 from analytics_sync_runs where client_id = ${A_CLIENT}::uuid`).toHaveLength(1)
  })
})

describe('what aeo_app may and may not do', () => {
  it('holds the documented grants on all three tables', async () => {
    const priv = async (table: string) => {
      const [r] = await sql`select
        has_table_privilege('aeo_app', ${'public.' + table}, 'SELECT') as s,
        has_table_privilege('aeo_app', ${'public.' + table}, 'INSERT') as i,
        has_table_privilege('aeo_app', ${'public.' + table}, 'UPDATE') as u,
        has_table_privilege('aeo_app', ${'public.' + table}, 'DELETE') as d`
      return r
    }
    expect(await priv('analytics_bindings')).toEqual({ s: true, i: true, u: true, d: true })
    expect(await priv('analytics_daily')).toEqual({ s: true, i: true, u: false, d: true })
    expect(await priv('analytics_sync_runs')).toEqual({ s: true, i: true, u: false, d: false })
  })

  it('lets aeo_app INSERT into the ledger but not UPDATE or DELETE it (42501)', async () => {
    const conn = await connect(A, A_USER, 'g-ledger-grants')
    await app`
      insert into analytics_sync_runs (account_id, client_id, connection_id, property_id, stream_id, outcome)
      values (${A}::uuid, ${A_CLIENT}::uuid, ${conn}::uuid, '1', '2', 'ok')`
    await expect(app`update analytics_sync_runs set outcome = 'quota' where account_id = ${A}::uuid`)
      .rejects.toMatchObject({ code: '42501' })
    await expect(app`delete from analytics_sync_runs where account_id = ${A}::uuid`)
      .rejects.toMatchObject({ code: '42501' })
    expect(await sql`select outcome from analytics_sync_runs where account_id = ${A}::uuid`).toEqual([{ outcome: 'ok' }])
  })

  it('lets aeo_app INSERT and DELETE analytics_daily but not UPDATE it (42501)', async () => {
    await app`
      insert into analytics_daily (account_id, client_id, date, event_name, source_class, count)
      values (${A}::uuid, ${A_CLIENT}::uuid, '2026-09-20', 'e', 'other', 1)`
    await expect(app`update analytics_daily set count = 9 where account_id = ${A}::uuid`)
      .rejects.toMatchObject({ code: '42501' })
    await app`delete from analytics_daily where account_id = ${A}::uuid`
    expect(await sql`select 1 from analytics_daily where account_id = ${A}::uuid`).toHaveLength(0)
  })

  it('lets aeo_app run the CHECK helper: the grant is explicit and PUBLIC no longer has it', async () => {
    const [asOwner] = await sql`select
      has_function_privilege('aeo_app', 'public.analytics_event_names_valid(text[])', 'EXECUTE') as app_role,
      has_function_privilege('public', 'public.analytics_event_names_valid(text[])', 'EXECUTE') as public_pseudo_role`
    expect(asOwner).toEqual({ app_role: true, public_pseudo_role: false })

    // From aeo_app's own session, and through a real INSERT: a CHECK calls its
    // function as the writing role, so a missing EXECUTE would surface here as 42501.
    const [self] = await app`select has_function_privilege('public.analytics_event_names_valid(text[])', 'EXECUTE') as ok`
    expect(self).toEqual({ ok: true })
    const conn = await connect(A, A_USER, 'g-check-app')
    const insert = (keyEvents: string[]) => app`
      insert into analytics_bindings (account_id, client_id, connection_id, property_id, stream_id, stream_host, key_events)
      values (${A}::uuid, ${A_CLIENT}::uuid, ${conn}::uuid, '1', '2', 'x', ${keyEvents}::text[])
      returning client_id`
    await expect(insert(['generate_lead'])).resolves.toHaveLength(1)
    await app`delete from analytics_bindings where account_id = ${A}::uuid`
    // The function was reached and said no — a 23514, not a permission error.
    await expect(insert([''])).rejects.toMatchObject({ code: '23514' })
  })
})

describe('bindStream and the binding lifecycle', () => {
  it('refuses another account\'s connection, or another account\'s brand, and writes nothing', async () => {
    const store = await gaStore()
    const aConn = await connect(A, A_USER, 'g-a')
    const bConn = await connect(B, B_USER, 'g-b')
    // B's brand through A's connection.
    expect(await store.bindStream(bindingOf({
      accountId: B, clientId: B_CLIENT, connectionId: aConn, streamHost: 'b-c16.example',
    }))).toBe('not_found')
    // A's brand as account B, through B's own connection.
    expect(await store.bindStream(bindingOf({ accountId: B, clientId: A_CLIENT, connectionId: bConn }))).toBe('not_found')
    // A brand that does not exist.
    expect(await store.bindStream(bindingOf({
      clientId: 'c1600000-0000-4000-8000-0000000000ff', connectionId: aConn,
    }))).toBe('not_found')
    expect(await sql`select 1 from analytics_bindings where account_id in (${A}::uuid, ${B}::uuid)`).toHaveLength(0)
  })

  it('binds, then re-binds through the same locking on-conflict path', async () => {
    const store = await gaStore()
    const conn = await connect(A, A_USER, 'g-rebind')
    expect(await store.bindStream(bindingOf({ connectionId: conn }))).toBe('bound')
    expect(await store.bindStream(bindingOf({ connectionId: conn, keyEvents: ['generate_lead', 'purchase'] }))).toBe('bound')
    const rows = await sql`select key_events from analytics_bindings where client_id = ${A_CLIENT}::uuid`
    expect(rows).toEqual([{ key_events: ['generate_lead', 'purchase'] }])
  })

  it('binds against a connection that needs reconnecting, and reports its status', async () => {
    const store = await gaStore()
    const conn = await connect(A, A_USER, 'g-status')
    await sql`update google_connections set status = 'needs_reconnect' where id = ${conn}::uuid`
    expect(await store.bindStream(bindingOf({ connectionId: conn }))).toBe('bound')
    expect((await store.loadAnalyticsBinding(A, A_CLIENT))?.connectionStatus).toBe('needs_reconnect')
  })

  it('leaves bound_at alone on a same-stream re-save, and moves it on a connection, property or stream change', async () => {
    const store = await gaStore()
    const conn = await connect(A, A_USER, 'g-bound-1')
    const conn2 = await connect(A, A_USER, 'g-bound-2')
    await store.bindStream(bindingOf({ connectionId: conn }))
    const first = await rawBinding()

    // Same connection, property and stream; different events.
    await store.bindStream(bindingOf({ connectionId: conn, keyEvents: ['purchase'] }))
    const resave = await rawBinding()
    expect(resave!.bound_at).toBe(first!.bound_at)
    expect(resave!.events_chosen_at).not.toBe(first!.events_chosen_at)
    expect(resave!.backfill_pending).toBe(true)

    // A different property.
    await store.bindStream(bindingOf({ connectionId: conn, propertyId: '999' }))
    const property = await rawBinding()
    expect(property!.bound_at).not.toBe(resave!.bound_at)

    // A different stream.
    await store.bindStream(bindingOf({ connectionId: conn, propertyId: '999', streamId: '888' }))
    const stream = await rawBinding()
    expect(stream!.bound_at).not.toBe(property!.bound_at)

    // A different connection.
    await store.bindStream(bindingOf({ connectionId: conn2, propertyId: '999', streamId: '888' }))
    const connection = await rawBinding()
    expect(connection!.bound_at).not.toBe(stream!.bound_at)
    expect(connection!.connection_id).toBe(conn2)
    // events_chosen_at moves on every save, even those that moved bound_at.
    expect(connection!.events_chosen_at).not.toBe(stream!.events_chosen_at)
  })

  it('moves events_chosen_at but not bound_at on updateKeyEvents, and re-arms the backfill', async () => {
    const store = await gaStore()
    const conn = await connect(A, A_USER, 'g-events')
    await store.bindStream(bindingOf({ connectionId: conn }))
    await sql`update analytics_bindings set backfill_pending = false where client_id = ${A_CLIENT}::uuid`
    const before = await rawBinding()

    expect(await store.updateKeyEvents(A, A_CLIENT, ['purchase', 'sign_up'])).toBe(true)
    const after = await rawBinding()
    expect(after!.key_events).toEqual(['purchase', 'sign_up'])
    expect(after!.bound_at).toBe(before!.bound_at)
    expect(after!.events_chosen_at).not.toBe(before!.events_chosen_at)
    expect(after!.backfill_pending).toBe(true)
  })

  it('cannot re-pick, read or unbind another account\'s binding', async () => {
    const store = await gaStore()
    const conn = await connect(A, A_USER, 'g-x')
    await store.bindStream(bindingOf({ connectionId: conn }))
    expect(await store.updateKeyEvents(B, A_CLIENT, ['purchase'])).toBe(false)
    expect(await store.loadAnalyticsBinding(B, A_CLIENT)).toBeNull()
    expect(await store.unbindStream(B, A_CLIENT)).toBe(false)
    expect((await rawBinding())!.key_events).toEqual(['generate_lead'])
    expect(await store.unbindStream(A, A_CLIENT)).toBe(true)
    expect(await store.loadAnalyticsBinding(A, A_CLIENT)).toBeNull()
  })

  it('round-trips a non-empty scopes array through the connection', async () => {
    const store = await scStore()
    const id = await connect(A, A_USER, 'g-scopes', SCOPES)
    expect((await store.loadConnectionSecret(A, id))?.scopes).toEqual(SCOPES)
    // Reconnecting with a different grant overwrites it (the on-conflict path).
    const narrower = [SCOPES[0]!]
    expect(await connect(A, A_USER, 'g-scopes', narrower)).toBe(id)
    expect((await store.loadConnectionSecret(A, id))?.scopes).toEqual(narrower)
    expect(await store.loadConnectionSecret(B, id)).toBeNull()
  })
})

describe('replaceDailyWindow', () => {
  const window = { startDate: '2026-09-10', endDate: '2026-09-16' }
  const count = (date: string, eventName: string, sourceClass: 'organic_search' | 'ai_assistant' | 'other', n: number) =>
    ({ date, eventName, sourceClass, count: n })
  const read = (account = A, client = A_CLIENT) => sql`
    select date::text as date, event_name, source_class, count::int as count from analytics_daily
    where account_id = ${account}::uuid and client_id = ${client}::uuid order by date, event_name, source_class`

  it('removes a class that disappeared from the window and leaves rows outside it alone', async () => {
    const store = await gaStore()
    await store.replaceDailyWindow(A, A_CLIENT, { startDate: '2026-09-01', endDate: '2026-09-16' }, [
      count('2026-09-09', 'generate_lead', 'other', 5), // before this window
      count('2026-09-10', 'generate_lead', 'ai_assistant', 3), // window start (inclusive)
      count('2026-09-13', 'generate_lead', 'ai_assistant', 4),
      count('2026-09-13', 'generate_lead', 'organic_search', 6),
      count('2026-09-16', 'generate_lead', 'other', 2), // window end (inclusive)
      count('2026-09-17', 'generate_lead', 'other', 8), // after this window
    ])

    // Google now reports no AI traffic in the window, and the day-10 numbers moved.
    const written = await store.replaceDailyWindow(A, A_CLIENT, window, [
      count('2026-09-13', 'generate_lead', 'organic_search', 7),
      count('2026-09-16', 'generate_lead', 'other', 1),
    ])
    expect(written).toBe(2)
    expect(await read()).toEqual([
      { date: '2026-09-09', event_name: 'generate_lead', source_class: 'other', count: 5 },
      { date: '2026-09-13', event_name: 'generate_lead', source_class: 'organic_search', count: 7 },
      { date: '2026-09-16', event_name: 'generate_lead', source_class: 'other', count: 1 },
      { date: '2026-09-17', event_name: 'generate_lead', source_class: 'other', count: 8 },
    ])
  })

  it('still clears the window when the fetch came back empty', async () => {
    const store = await gaStore()
    await store.replaceDailyWindow(A, A_CLIENT, window, [count('2026-09-12', 'e', 'other', 1)])
    await store.replaceDailyWindow(A, A_CLIENT, { startDate: '2026-09-20', endDate: '2026-09-20' }, [count('2026-09-20', 'e', 'other', 2)])
    expect(await store.replaceDailyWindow(A, A_CLIENT, window, [])).toBe(0)
    expect(await read()).toEqual([{ date: '2026-09-20', event_name: 'e', source_class: 'other', count: 2 }])
  })

  it('rolls the delete back when the insert fails, and never sums a duplicate', async () => {
    const store = await gaStore()
    await store.replaceDailyWindow(A, A_CLIENT, window, [count('2026-09-12', 'e', 'other', 1)])
    await expect(store.replaceDailyWindow(A, A_CLIENT, window, [
      count('2026-09-13', 'e', 'other', 5), count('2026-09-13', 'e', 'other', 5),
    ])).rejects.toMatchObject({ code: '23505' })
    expect(await read()).toEqual([{ date: '2026-09-12', event_name: 'e', source_class: 'other', count: 1 }])
  })

  it('cannot write or clear another account\'s rows', async () => {
    const store = await gaStore()
    await store.replaceDailyWindow(A, A_CLIENT, window, [count('2026-09-12', 'e', 'other', 1)])
    // B naming A's brand: the DELETE is scoped to B and finds nothing; the INSERT hits the composite FK.
    await expect(store.replaceDailyWindow(B, A_CLIENT, window, [count('2026-09-12', 'e', 'other', 99)]))
      .rejects.toMatchObject({ code: '23503' })
    expect(await store.replaceDailyWindow(B, A_CLIENT, window, [])).toBe(0)
    expect(await read()).toEqual([{ date: '2026-09-12', event_name: 'e', source_class: 'other', count: 1 }])
    expect(await read(B, A_CLIENT)).toEqual([])
  })
})

describe('recordAnalyticsRun', () => {
  const run = (over: Record<string, unknown>) => ({
    accountId: A, clientId: A_CLIENT, propertyId: '111', streamId: '222',
    outcome: 'ok' as const, rowsWritten: 3, dataThrough: '2026-09-20', dataWithheld: false, clearBackfill: true,
    ...over,
  })
  const pending = async () => (await rawBinding())!.backfill_pending as boolean
  const ledgerRows = async () => (await sql`select count(*)::int as n from analytics_sync_runs where account_id = ${A}::uuid`)[0]!.n as number

  async function bound() {
    const store = await gaStore()
    const conn = await connect(A, A_USER, 'g-run')
    await store.bindStream(bindingOf({ connectionId: conn }))
    const binding = (await store.loadAnalyticsBinding(A, A_CLIENT))!
    return { store, conn, binding }
  }

  it('clears backfill_pending when the run still matches the binding and its events', async () => {
    const { store, conn, binding } = await bound()
    expect(await pending()).toBe(true)
    await store.recordAnalyticsRun(run({ connectionId: conn, eventsChosenAt: binding.eventsChosenAt }) as never)
    expect(await pending()).toBe(false)
    expect(await ledgerRows()).toBe(1)
  })

  it('does NOT clear it when events_chosen_at changed mid-sync, but still records the run', async () => {
    const { store, conn, binding } = await bound()
    // The owner re-picks events while a sync of the old ones is in flight.
    expect(await store.updateKeyEvents(A, A_CLIENT, ['purchase'])).toBe(true)
    await store.recordAnalyticsRun(run({ connectionId: conn, eventsChosenAt: binding.eventsChosenAt }) as never)
    expect(await pending()).toBe(true)
    expect(await ledgerRows()).toBe(1)

    // A run of the new events clears it.
    const fresh = (await store.loadAnalyticsBinding(A, A_CLIENT))!
    await store.recordAnalyticsRun(run({ connectionId: conn, eventsChosenAt: fresh.eventsChosenAt }) as never)
    expect(await pending()).toBe(false)
  })

  it('does NOT clear it for a stale property, stream or connection, or when clearBackfill is false', async () => {
    const { store, conn, binding } = await bound()
    const other = await connect(A, A_USER, 'g-run-other')
    for (const over of [
      { propertyId: '999' }, { streamId: '999' }, { connectionId: other }, { clearBackfill: false },
    ]) {
      await store.recordAnalyticsRun(run({ connectionId: conn, eventsChosenAt: binding.eventsChosenAt, ...over }) as never)
      expect(await pending()).toBe(true)
    }
    expect(await ledgerRows()).toBe(4)
  })

  it('cannot clear another account\'s backfill', async () => {
    const { store, conn, binding } = await bound()
    // B's ledger insert names A's brand, so the composite FK refuses the whole transaction.
    await expect(store.recordAnalyticsRun(run({
      accountId: B, connectionId: conn, eventsChosenAt: binding.eventsChosenAt,
    }) as never)).rejects.toMatchObject({ code: '23503' })
    expect(await pending()).toBe(true)
  })
})

describe('loadAnalyticsPanel', () => {
  async function bindWithEvents(keyEvents: string[]) {
    const store = await gaStore()
    const conn = await connect(A, A_USER, 'g-panel')
    await store.bindStream(bindingOf({ connectionId: conn, keyEvents }))
    const binding = (await store.loadAnalyticsBinding(A, A_CLIENT))!
    return { store, conn, binding }
  }
  /** `offset` seconds from now: negative lands before the binding, zero after it. */
  const seed = (account: string, client: string, date: string, event: string, cls: string, n: number, offset = 0) => sql`
    insert into analytics_daily (account_id, client_id, date, event_name, source_class, count, synced_at)
    values (${account}::uuid, ${client}::uuid, ${date}::date, ${event}, ${cls}, ${n}, now() + make_interval(secs => ${offset}))`
  /**
   * A run of the current binding, recorded through the store as the sync records
   * it. An `ok` run's data_through is the window end the sync asked for, rows or not.
   */
  const recordRun = async (
    { store, conn, binding }: Awaited<ReturnType<typeof bindWithEvents>>,
    over: { outcome?: (typeof ANALYTICS_SYNC_OUTCOMES)[number]; dataThrough?: string | null; dataWithheld?: boolean } = {},
  ) => store.recordAnalyticsRun({
    accountId: A, clientId: A_CLIENT, connectionId: conn, propertyId: '111', streamId: '222',
    eventsChosenAt: binding.eventsChosenAt, outcome: over.outcome ?? 'ok', rowsWritten: 0,
    dataThrough: over.dataThrough === undefined ? '2026-09-20' : over.dataThrough,
    dataWithheld: over.dataWithheld ?? false, clearBackfill: false,
  })
  const ZERO = { total: 0, bySource: { organic_search: 0, ai_assistant: 0, other: 0 }, byEvent: [] }

  it('counts chosen events under the current binding only, and never another account\'s rows', async () => {
    const bound = await bindWithEvents(['generate_lead', 'sign_up'])
    const { store, binding } = bound
    await recordRun(bound, { dataThrough: '2026-09-20' })
    await seed(A, A_CLIENT, '2026-09-20', 'generate_lead', 'organic_search', 10)
    await seed(A, A_CLIENT, '2026-09-20', 'generate_lead', 'ai_assistant', 4)
    await seed(A, A_CLIENT, '2026-09-19', 'sign_up', 'other', 1)
    await seed(A, A_CLIENT, '2026-09-20', 'purchase', 'organic_search', 500) // not chosen
    await seed(A, A_CLIENT, '2026-09-20', 'generate_lead', 'other', 700, -3600) // synced before the bind
    await seed(B, B_CLIENT, '2026-09-20', 'generate_lead', 'organic_search', 900) // B's own brand

    const panel = await store.loadAnalyticsPanel(A, A_CLIENT, binding.keyEvents, binding.boundAt)
    expect(panel.last28).toEqual({
      total: 15,
      bySource: { organic_search: 10, ai_assistant: 4, other: 1 },
      byEvent: [{ eventName: 'generate_lead', count: 14 }, { eventName: 'sign_up', count: 1 }],
    })

    // B asking for A's brand sees nothing of A's, and A's numbers do not include B's.
    const cross = await store.loadAnalyticsPanel(B, A_CLIENT, binding.keyEvents, binding.boundAt)
    expect(cross.last28).toBeNull()
    expect(cross.latest).toBeNull()
    expect(cross.lastGoodDataThrough).toBeNull()
    expect(cross.owner).toEqual({ leadValue: null, closeRate: null })
  })

  it('shows nothing, not zeros, before any good run of this binding, whatever rows exist', async () => {
    const bound = await bindWithEvents(['generate_lead'])
    await seed(A, A_CLIENT, '2026-09-20', 'generate_lead', 'other', 5)
    await recordRun(bound, { outcome: 'quota', dataThrough: null })
    const panel = await bound.store.loadAnalyticsPanel(A, A_CLIENT, bound.binding.keyEvents, bound.binding.boundAt)
    expect(panel.lastGoodDataThrough).toBeNull()
    expect(panel.last28).toBeNull()
  })

  it('shows real zeros after a good run when the only rows are un-chosen or predate the binding', async () => {
    const bound = await bindWithEvents(['generate_lead'])
    await recordRun(bound, { dataThrough: '2026-09-20' })
    await seed(A, A_CLIENT, '2026-09-20', 'purchase', 'other', 5)
    await seed(A, A_CLIENT, '2026-09-20', 'generate_lead', 'other', 5, -3600)
    const panel = await bound.store.loadAnalyticsPanel(A, A_CLIENT, bound.binding.keyEvents, bound.binding.boundAt)
    expect(panel.last28).toEqual(ZERO)
    expect(panel.lastGoodDataThrough).toBe('2026-09-20')
  })

  it('shows a good run that found no enquiries at all as 0, dated by its window end', async () => {
    const bound = await bindWithEvents(['generate_lead'])
    await recordRun(bound, { dataThrough: '2026-09-24' })
    const panel = await bound.store.loadAnalyticsPanel(A, A_CLIENT, bound.binding.keyEvents, bound.binding.boundAt)
    expect(panel.last28).toEqual(ZERO)
    expect(panel.lastGoodDataThrough).toBe('2026-09-24')
  })

  it('makes the 28-day window exactly 28 days ending at the last good run: day 28 counts, day 29 and later do not', async () => {
    const bound = await bindWithEvents(['generate_lead'])
    // The last good run's window end is 2026-09-20, inclusive, and the window runs
    // back 28 days: 2026-09-20 is day 1, 2026-08-24 is day 28, 2026-08-23 is day 29.
    await recordRun(bound, { dataThrough: '2026-09-20' })
    await seed(A, A_CLIENT, '2026-09-20', 'generate_lead', 'other', 1)
    await seed(A, A_CLIENT, '2026-08-24', 'generate_lead', 'other', 10)
    await seed(A, A_CLIENT, '2026-08-23', 'generate_lead', 'other', 100)
    // After the anchor: outside a window that ends at 2026-09-20.
    await seed(A, A_CLIENT, '2026-09-21', 'generate_lead', 'other', 1000)
    const panel = await bound.store.loadAnalyticsPanel(A, A_CLIENT, bound.binding.keyEvents, bound.binding.boundAt)
    expect(panel.last28?.total).toBe(11)
  })

  it('anchors the window on the last good run, not on the newest stored row: an enquiry 40 days back is 0', async () => {
    const bound = await bindWithEvents(['generate_lead'])
    // GA4 omitted every zero day since, so the newest row is 40 days old. The old
    // rule anchored on it and summed those 28 days under a "last 28 days" label.
    await seed(A, A_CLIENT, '2026-08-15', 'generate_lead', 'other', 5)
    await recordRun(bound, { dataThrough: '2026-09-24' })
    const panel = await bound.store.loadAnalyticsPanel(A, A_CLIENT, bound.binding.keyEvents, bound.binding.boundAt)
    expect(panel.last28).toEqual(ZERO)
    expect(panel.lastGoodDataThrough).toBe('2026-09-24')
  })

  it('anchors on this binding\'s newest ok run: a later failure, or an ok run from before the bind, never moves it', async () => {
    const bound = await bindWithEvents(['generate_lead'])
    await seed(A, A_CLIENT, '2026-09-20', 'generate_lead', 'other', 1)
    await seed(A, A_CLIENT, '2026-08-01', 'generate_lead', 'other', 50) // 50 days before the anchor
    // An ok run from a previous binding, dated far later: not this binding's anchor.
    await sql`
      insert into analytics_sync_runs (account_id, client_id, connection_id, property_id, stream_id, outcome, data_through, ran_at)
      values (${A}::uuid, ${A_CLIENT}::uuid, ${bound.conn}::uuid, '1', '2', 'ok', '2026-12-31', ${bound.binding.boundAt}::timestamptz - interval '1 hour')`
    await recordRun(bound, { dataThrough: '2026-09-20' })
    await recordRun(bound, { outcome: 'quota', dataThrough: null })
    const panel = await bound.store.loadAnalyticsPanel(A, A_CLIENT, bound.binding.keyEvents, bound.binding.boundAt)
    expect(panel.last28?.total).toBe(1)
    expect(panel.lastGoodDataThrough).toBe('2026-09-20')
  })

  it('reads the ledger: the newest row, and the last good date and withheld flag only from this binding', async () => {
    const { store, conn, binding } = await bindWithEvents(['generate_lead'])
    // A withheld ok run from before this binding: its data_through and its
    // withheld flag are about another stream.
    await sql`
      insert into analytics_sync_runs (account_id, client_id, connection_id, property_id, stream_id, outcome, data_through, data_withheld, ran_at)
      values (${A}::uuid, ${A_CLIENT}::uuid, ${conn}::uuid, '1', '2', 'ok', '2026-09-01', true, ${binding.boundAt}::timestamptz - interval '1 hour')`
    let panel = await store.loadAnalyticsPanel(A, A_CLIENT, binding.keyEvents, binding.boundAt)
    expect(panel.latest?.outcome).toBe('ok') // still the newest row...
    expect(panel.lastGoodDataThrough).toBeNull() // ...but not a good date for this binding
    expect(panel.lastGoodDataWithheld).toBe(false) // ...nor its withheld note

    await store.recordAnalyticsRun({
      accountId: A, clientId: A_CLIENT, connectionId: conn, propertyId: '111', streamId: '222',
      eventsChosenAt: binding.eventsChosenAt, outcome: 'ok', rowsWritten: 2, dataThrough: '2026-09-20',
      dataWithheld: true, clearBackfill: true,
    })
    await store.recordAnalyticsRun({
      accountId: A, clientId: A_CLIENT, connectionId: conn, propertyId: '111', streamId: '222',
      eventsChosenAt: binding.eventsChosenAt, outcome: 'quota', rowsWritten: 0, dataThrough: null,
      dataWithheld: false, clearBackfill: false,
    })
    panel = await store.loadAnalyticsPanel(A, A_CLIENT, binding.keyEvents, binding.boundAt)
    expect(panel.latest).toEqual({ outcome: 'quota', dataThrough: null, ranAt: expect.any(String) })
    expect(panel.lastGoodDataThrough).toBe('2026-09-20')
    // The figures shown are the withheld ok run's, so its note stays after a quota run.
    expect(panel.lastGoodDataWithheld).toBe(true)
  })

  it('round-trips the owner figures as text, and tells "not entered" from a stored zero', async () => {
    const { store, binding } = await bindWithEvents(['generate_lead'])
    const owner = () => store.loadAnalyticsPanel(A, A_CLIENT, binding.keyEvents, binding.boundAt).then(p => p.owner)
    expect(await owner()).toEqual({ leadValue: null, closeRate: null })

    await sql`
      insert into local_trust_profiles (client_id, account_id, average_lead_value, close_rate)
      values (${A_CLIENT}::uuid, ${A}::uuid, 150.5, 0.25)`
    expect(await owner()).toEqual({ leadValue: '150.5', closeRate: '0.25' })

    await sql`update local_trust_profiles set close_rate = 0, average_lead_value = null where client_id = ${A_CLIENT}::uuid`
    expect(await owner()).toEqual({ leadValue: null, closeRate: '0' })

    // B's profile for its own brand is never read for A's.
    await sql`
      insert into local_trust_profiles (client_id, account_id, average_lead_value, close_rate)
      values (${B_CLIENT}::uuid, ${B}::uuid, 999, 0.99)`
    expect(await owner()).toEqual({ leadValue: null, closeRate: '0' })
  })
})

describe('loadDueAnalyticsBindings', () => {
  it('selects across accounts, pairs each binding with its own account, and drops a brand once it has run', async () => {
    const store = await gaStore()
    for (const [account, client, user, domain] of [
      [A, A_CLIENT, A_USER, 'a-c16.example'], [B, B_CLIENT, B_USER, 'b-c16.example'],
    ] as const) {
      const conn = await connect(account, user, `g-due-${client}`)
      await store.bindStream(bindingOf({ accountId: account, clientId: client, connectionId: conn, streamHost: domain }))
    }
    const due = await store.loadDueAnalyticsBindings(200)
    const mine = due.filter(b => b.clientId === A_CLIENT || b.clientId === B_CLIENT)
    expect(mine.map(b => [b.clientId, b.accountId]).sort()).toEqual([[A_CLIENT, A], [B_CLIENT, B]].sort())
    expect(mine[0]!.account).toMatchObject({ plan: 'pro', status: 'active' })
    expect(mine.find(b => b.clientId === A_CLIENT)!.currentDomain).toBe('a-c16.example')

    const a = mine.find(b => b.clientId === A_CLIENT)!
    await store.recordAnalyticsRun({
      accountId: A, clientId: A_CLIENT, connectionId: a.connectionId, propertyId: a.propertyId, streamId: a.streamId,
      eventsChosenAt: a.eventsChosenAt, outcome: 'ok', rowsWritten: 0, dataThrough: null, dataWithheld: false, clearBackfill: true,
    })
    const after = (await store.loadDueAnalyticsBindings(200)).filter(b => b.clientId === A_CLIENT || b.clientId === B_CLIENT)
    expect(after.map(b => b.clientId)).toEqual([B_CLIENT])
  })
})
