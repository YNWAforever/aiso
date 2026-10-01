import { randomUUID } from 'node:crypto'
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest'
import { assertApprovedTarget } from './approved-target'
import { TENANCY_TARGET_VARIABLES, approvedTenancyTarget, assertDisposableTenancyTarget } from './tenancy-target'
import { draft } from '../change-sets/fixtures'
import { freezeReview } from '@/lib/change-sets/validation'
import { attestDelivery, withdrawDelivery } from '@/lib/delivery/store'
import { loadAttributionInput } from '@/lib/attribution/store'
import type { AttestInput, DeliveryScope, MeasureInput } from '@/lib/delivery/types'

/**
 * Migration 056 and the Attribution store against real Postgres (spec section 7).
 * Run through scripts/ci/run-exact-target-suites.mjs, which provisions one
 * disposable branch and derives the C9F_TENANCY_* approval from it.
 *
 * Two connections, on purpose (the same split analytics.test.ts uses):
 *   - `sql` is the branch owner. It writes fixtures, seeds rows the stores never
 *     would (a stale synced_at, a ledger row from before a bind) and tears down.
 *   - `app` is aeo_app, the role the application really runs as. The STORES run on
 *     it, so every statement is proved against the grants 056 gives, and the
 *     permission assertions use it directly.
 *
 * Errors are asserted by SQLSTATE. The shape trigger raises 23514 under the label
 * work_item_delivery_measures_shape, but its catalog name is
 * work_item_delivery_measures_shape_trg; a test that matched a name would be
 * matching one of the two by luck, so the code is the contract.
 *
 * Teardown is as the OWNER and in foreign-key order: measures reference
 * client_assets and delivery events with on delete restrict and aeo_app cannot
 * delete them, so deleting the assets or events first would fail. These accounts
 * are this file's own (c17 prefix), so no other suite's cleanup meets them.
 */

const storeConnection = vi.hoisted(() => ({ sql: null as NeonQueryFunction<false, false> | null }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({
  db: () => {
    if (!storeConnection.sql) throw new Error('ATTRIBUTION_TARGET_NOT_VERIFIED')
    return storeConnection.sql
  },
}))

const sql = neon(process.env.TEST_DATABASE_URL!)
const appUrl = process.env.C9E_TEST_APP_DATABASE_URL
let app: NeonQueryFunction<false, false>

const A = 'c1700000-0000-4000-8000-00000000000a'
const B = 'c1700000-0000-4000-8000-00000000000b'
const A_CLIENT = 'c1700000-0000-4000-8000-0000000000a1'
const A_CLIENT2 = 'c1700000-0000-4000-8000-0000000000a2'
const B_CLIENT = 'c1700000-0000-4000-8000-0000000000b1'
const AUTHOR = 'c1700000-0000-4000-8000-0000000000a9'
const REVIEWER = 'c1700000-0000-4000-8000-0000000000a8'
const ITEM = 'c1700000-0000-4000-8000-0000000000e1'
const GRANT = 'c1700000-0000-4000-8000-0000000000f1'
const CONNECTION = 'c1700000-0000-4000-8000-0000000000c1'
const ACCOUNTS = [A, B]

const P1 = 'https://a-c17.example/p1'
const P2 = 'https://a-c17.example/p2'
const P3 = 'https://a-c17.example/p3'
const PX = 'https://x-c17.example/other-brand'
const PB = 'https://b-c17.example/other-account'

// Delivered at 18:00 Hong Kong on 2026-09-01: D = 2026-09-01, so the before window
// is 2026-08-04..2026-08-31 and the after window 2026-09-02..2026-09-29.
const DELIVERED = '2026-09-01T10:00:00.000Z'
const DECIDED = '2026-08-01T00:00:00Z'
const BOUND = '2026-08-20T00:00:00Z'
const BOUND_ISO = '2026-08-20T00:00:00.000000Z'

const actor = (profileId: string, role = 'account_member') => ({ profileId, displayName: 'Attribution fixture', role })

async function teardown() {
  const ids = ACCOUNTS
  await sql`delete from work_item_delivery_measures where account_id = any(${ids}::uuid[])`
  // A withdraw targets an attest with on delete restrict, so withdraws go first.
  await sql`delete from work_item_delivery_events where account_id = any(${ids}::uuid[]) and kind = 'withdraw'`
  await sql`delete from work_item_delivery_events where account_id = any(${ids}::uuid[])`
  await sql`delete from work_item_decisions where account_id = any(${ids}::uuid[])`
  await sql`delete from work_item_versions where account_id = any(${ids}::uuid[])`
  await sql`delete from evidence_work_items where account_id = any(${ids}::uuid[])`
  await sql`delete from account_approver_events where account_id = any(${ids}::uuid[])`
  await sql`delete from analytics_sync_runs where account_id = any(${ids}::uuid[])`
  await sql`delete from analytics_daily where account_id = any(${ids}::uuid[])`
  await sql`delete from analytics_bindings where account_id = any(${ids}::uuid[])`
  await sql`delete from search_console_sync_runs where account_id = any(${ids}::uuid[])`
  await sql`delete from search_console_coverage where account_id = any(${ids}::uuid[])`
  await sql`delete from search_console_daily where account_id = any(${ids}::uuid[])`
  await sql`delete from search_console_bindings where account_id = any(${ids}::uuid[])`
  await sql`delete from google_connections where account_id = any(${ids}::uuid[])`
  await sql`delete from client_assets where account_id = any(${ids}::uuid[])`
  await sql`delete from clients where account_id = any(${ids}::uuid[])`
  await sql`delete from profiles where id in (${AUTHOR}::uuid, ${REVIEWER}::uuid)`
  await sql`delete from neon_auth.user where id in (${AUTHOR}, ${REVIEWER})`
  await sql`delete from accounts where id = any(${ids}::uuid[])`
}

let version: string
let hash: string
const assetIds: Record<string, string> = {}

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

afterAll(async () => {
  // Left clean for whichever suite shares the branch next. Skipped when the
  // target was never approved (beforeAll already failed loudly).
  if (storeConnection.sql) await teardown()
})

beforeEach(async () => {
  await teardown()
  await sql`insert into accounts (id, plan, status, stripe_subscription_id)
            values (${A}::uuid, 'pro', 'active', ${'sub_' + A}), (${B}::uuid, 'pro', 'active', ${'sub_' + B})`
  await sql`insert into clients (id, account_id, brand_name, status, competitors, domain) values
    (${A_CLIENT}::uuid, ${A}::uuid, 'Brand', 'active', ${[]}::text[], 'a-c17.example'),
    (${A_CLIENT2}::uuid, ${A}::uuid, 'Sibling', 'active', ${[]}::text[], 'x-c17.example'),
    (${B_CLIENT}::uuid, ${B}::uuid, 'Other', 'active', ${[]}::text[], 'b-c17.example')`
  for (const user of [AUTHOR, REVIEWER]) {
    await sql`insert into neon_auth.user (id, email, name, "emailVerified")
              values (${user}, ${user + '@example.com'}, 'Attribution fixture', true)`
    await sql`insert into profiles (id, account_id, display_name) values (${user}::uuid, ${A}::uuid, 'Attribution fixture')`
  }

  // The approved version chain, exactly as delivery-attestations.test.ts builds it.
  const value = { ...draft(), id: ITEM, clientId: A_CLIENT }
  await sql`insert into evidence_work_items (id,account_id,client_id,opportunity_key,source_kind,source_id,rule_version,evidence_fingerprint,evidence_snapshot,title,action,notes,locale)
    values (${ITEM},${A},${A_CLIENT},${randomUUID()},'pulse-metric',${value.evidenceSnapshot.source.id},'pulse-brand-absent.v1',${'a'.repeat(64)},${JSON.stringify(value.evidenceSnapshot)}::jsonb,${value.title},${value.action},${value.notes},${value.locale})`
  await sql`insert into account_approver_events (id,account_id,profile_id,action,previous_revision,new_revision,administrator_id,administrator,reason,request_id)
    values (${GRANT},${A},${REVIEWER},'grant',0,1,${AUTHOR},${JSON.stringify(actor(AUTHOR, 'platform_admin'))}::jsonb,'Fixture grant',${randomUUID()})`
  const frozen = freezeReview({ ...draft(), id: ITEM, clientId: A_CLIENT, revision: 1 })
  version = randomUUID()
  hash = frozen.contentHash
  await sql`insert into work_item_versions (id,account_id,client_id,work_item_id,version_number,draft_revision,content,content_hash,validation,submitter)
    values (${version},${A},${A_CLIENT},${ITEM},1,1,${JSON.stringify(frozen.content)}::jsonb,${frozen.contentHash},${JSON.stringify(frozen.validation)}::jsonb,${JSON.stringify(actor(AUTHOR))}::jsonb)`
  await sql`insert into work_item_decisions (id,account_id,client_id,work_item_id,version_id,content_hash,decision,reason,actor_id,actor,grant_revision,grant_event_id,request_id,decided_at)
    values (${randomUUID()},${A},${A_CLIENT},${ITEM},${version},${frozen.contentHash},'approved','Fixture review',${REVIEWER},${JSON.stringify(actor(REVIEWER, 'account_approver'))}::jsonb,1,${GRANT},${randomUUID()},${DECIDED}::timestamptz)`

  // Registered pages: two on the measured brand, one on a sibling brand of the
  // same account, one on another account's brand.
  for (const [key, account, client, url, label] of [
    ['p1', A, A_CLIENT, P1, 'Page 1'], ['p2', A, A_CLIENT, P2, 'Page 2'], ['p3', A, A_CLIENT, P3, 'Page 3'],
    ['px', A, A_CLIENT2, PX, 'Sibling page'], ['pb', B, B_CLIENT, PB, 'Other account page'],
  ] as const) {
    const [row] = await sql`
      insert into client_assets (account_id, client_id, url, origin, label)
      values (${account}::uuid, ${client}::uuid, ${url}, ${new URL(url).origin}, ${label}) returning id`
    assetIds[key] = String(row!.id)
  }
})

const scope = (over: Partial<DeliveryScope> = {}): DeliveryScope => (
  { accountId: A, clientId: A_CLIENT, itemId: ITEM, versionId: version, actorId: AUTHOR, ...over }
)
const attestInput = (measure?: MeasureInput, over: Partial<AttestInput> = {}): AttestInput => ({
  contentHash: hash, destination: 'Client CMS', deliveredAt: DELIVERED, note: 'Declared manual delivery',
  requestId: randomUUID(), ...(measure ? { measure } : {}), ...over,
})
const attest = (measure?: MeasureInput, over: Partial<AttestInput> = {}) => attestDelivery(scope(), attestInput(measure, over))

async function attested(measure?: MeasureInput, over: Partial<AttestInput> = {}): Promise<string> {
  const result = await attest(measure, over)
  if (result.kind !== 'created') throw new Error(`Expected a created attestation, got ${result.kind}`)
  return result.value.eventId
}

async function withdraw(attestation: string) {
  const result = await withdrawDelivery(scope(), attestation, { reason: 'Correcting', requestId: randomUUID() })
  if (result.kind !== 'created') throw new Error(`Expected a created withdrawal, got ${result.kind}`)
}
async function withdrawThenAttest(attestation: string, measure?: MeasureInput, over: Partial<AttestInput> = {}) {
  await withdraw(attestation)
  return attested(measure, over)
}

const counts = async () => {
  const [row] = await sql`
    select (select count(*)::int from work_item_delivery_events where account_id = ${A}::uuid) as events,
           (select count(*)::int from work_item_delivery_measures where account_id = any(${ACCOUNTS}::uuid[])) as measures`
  return row as { events: number; measures: number }
}
const measureRows = (attestation: string) => sql`
  select scope, asset_id from work_item_delivery_measures
  where account_id = ${A}::uuid and attestation_id = ${attestation}::uuid order by scope desc, asset_id`

const insertMeasure = (
  db: NeonQueryFunction<false, false>,
  attestation: string,
  measureScope: string,
  asset: string | null,
  over: { account?: string; client?: string; kind?: string } = {},
) => db`
  insert into work_item_delivery_measures (account_id,client_id,work_item_id,version_id,content_hash,attestation_id,attestation_kind,scope,asset_id)
  values (${over.account ?? A}::uuid, ${over.client ?? A_CLIENT}::uuid, ${ITEM}::uuid, ${version}::uuid, ${hash}, ${attestation}::uuid,
          ${over.kind ?? 'attest'}, ${measureScope}, ${asset}::uuid) returning id`

describe('migration 056 on real Postgres', () => {
  it('applies after 055 and creates both tables and the column', async () => {
    const files = (await sql`select filename from schema_migrations order by filename`).map(r => String(r.filename))
    expect(files.findIndex(f => f.startsWith('056_'))).toBeGreaterThan(files.findIndex(f => f.startsWith('055_')))
    const tables = await sql`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_name in ('work_item_delivery_measures', 'search_console_coverage') order by table_name`
    expect(tables.map(t => t.table_name)).toEqual(['search_console_coverage', 'work_item_delivery_measures'])
    const [column] = await sql`
      select data_type, is_nullable from information_schema.columns
      where table_schema = 'public' and table_name = 'analytics_bindings' and column_name = 'covered_from'`
    expect(column).toEqual({ data_type: 'date', is_nullable: 'YES' })
    // The trigger's catalog name differs from the label it raises under; pinned so
    // nobody maps errors by either name.
    const [trigger] = await sql`select tgname, tgdeferrable, tginitdeferred from pg_trigger
      where tgrelid = 'public.work_item_delivery_measures'::regclass and tgname = 'work_item_delivery_measures_shape_trg'`
    expect(trigger).toEqual({ tgname: 'work_item_delivery_measures_shape_trg', tgdeferrable: true, tginitdeferred: true })
  })

  it('refuses a measure naming another account\'s attestation, another brand\'s page, or a withdraw, by foreign key', async () => {
    const attestation = await attested()
    // Account B naming account A's attestation: the composite FK ends in account_id.
    await expect(insertMeasure(app, attestation, 'site', null, { account: B }))
      .rejects.toMatchObject({ code: '23503' })
    // A sibling brand of the same account: the (account, client, id) asset key.
    await expect(insertMeasure(app, attestation, 'page', assetIds.px!))
      .rejects.toMatchObject({ code: '23503', message: expect.stringContaining('work_item_delivery_measures_asset_fk') })
    // Another account's page.
    await expect(insertMeasure(app, attestation, 'page', assetIds.pb!))
      .rejects.toMatchObject({ code: '23503', message: expect.stringContaining('work_item_delivery_measures_asset_fk') })
    // A page of this brand under another brand's id.
    await expect(insertMeasure(app, attestation, 'page', assetIds.p1!, { client: A_CLIENT2 }))
      .rejects.toMatchObject({ code: '23503' })
    expect((await counts()).measures).toBe(0)
  })

  it('refuses a measure that targets a withdraw event, with or without saying so', async () => {
    const attestation = await attested()
    const withdrawn = await withdrawDelivery(scope(), attestation, { reason: 'Wrong destination', requestId: randomUUID() })
    if (withdrawn.kind !== 'created') throw new Error('Expected a created withdrawal')
    // Default attestation_kind: no attest event has the withdraw's id.
    await expect(insertMeasure(app, withdrawn.value.eventId, 'site', null)).rejects.toMatchObject({ code: '23503' })
    // Saying 'withdraw': the CHECK pins the column to 'attest' first.
    await expect(insertMeasure(app, withdrawn.value.eventId, 'site', null, { kind: 'withdraw' }))
      .rejects.toMatchObject({ code: '23514', message: expect.stringContaining('work_item_delivery_measures_attestation_kind_check') })
  })

  it('keeps site and page rows structurally apart, and each target once', async () => {
    const attestation = await attested()
    await expect(insertMeasure(app, attestation, 'site', assetIds.p1!)).rejects.toMatchObject({ code: '23514' })
    await expect(insertMeasure(app, attestation, 'page', null)).rejects.toMatchObject({ code: '23514' })
    await expect(insertMeasure(app, attestation, 'brand', null)).rejects.toMatchObject({ code: '23514' })
    await insertMeasure(app, attestation, 'page', assetIds.p1!)
    await expect(insertMeasure(app, attestation, 'page', assetIds.p1!)).rejects.toMatchObject({ code: '23505' })
    // Two site rows never compare equal under a plain unique; nulls-not-distinct is the point.
    const other = await withdrawThenAttest(attestation)
    await insertMeasure(app, other, 'site', null)
    await expect(insertMeasure(app, other, 'site', null)).rejects.toMatchObject({ code: '23505' })
  })

  describe('the deferred shape trigger', () => {
    it('rejects a site row plus a page row at commit with 23514, and leaves nothing behind', async () => {
      const attestation = await attested()
      await expect(app.transaction([
        insertMeasure(app, attestation, 'site', null),
        insertMeasure(app, attestation, 'page', assetIds.p1!),
      ])).rejects.toMatchObject({ code: '23514', message: expect.stringContaining('must have exactly one site measure') })
      expect((await counts()).measures).toBe(0)
    })

    it('rejects 21 page rows at commit with 23514, and accepts 20', async () => {
      const attestation = await attested()
      await sql`insert into client_assets (account_id, client_id, url, origin, label)
        select ${A}::uuid, ${A_CLIENT}::uuid, 'https://a-c17.example/bulk/' || g, 'https://a-c17.example', 'Bulk ' || g
        from generate_series(1, 21) g`
      const bulk = (limit: number) => app`
        insert into work_item_delivery_measures (account_id,client_id,work_item_id,version_id,content_hash,attestation_id,scope,asset_id)
        select ${A}::uuid, ${A_CLIENT}::uuid, ${ITEM}::uuid, ${version}::uuid, ${hash}, ${attestation}::uuid, 'page', a.id
        from (select id from client_assets where account_id = ${A}::uuid and client_id = ${A_CLIENT}::uuid
                and url like 'https://a-c17.example/bulk/%' order by url limit ${limit}) a`
      await expect(bulk(21)).rejects.toMatchObject({ code: '23514' })
      expect((await counts()).measures).toBe(0)
      await bulk(20)
      expect((await counts()).measures).toBe(20)
    })

    it('judges a multi-row insert once, when whole: two pages in one transaction commit', async () => {
      const attestation = await attested()
      await app.transaction([
        insertMeasure(app, attestation, 'page', assetIds.p1!),
        insertMeasure(app, attestation, 'page', assetIds.p2!),
      ])
      expect((await counts()).measures).toBe(2)
    })

    it('accepts a lone site row, and an attestation with no measure at all', async () => {
      const attestation = await attested()
      expect((await counts()).measures).toBe(0)
      await insertMeasure(app, attestation, 'site', null)
      expect((await counts()).measures).toBe(1)
    })
  })

  it('lets aeo_app read and insert measures but never update or delete them (42501)', async () => {
    const attestation = await attested({ scope: 'site' })
    const [grants] = await sql`select
      has_table_privilege('aeo_app','public.work_item_delivery_measures','SELECT') s,
      has_table_privilege('aeo_app','public.work_item_delivery_measures','INSERT') i,
      has_table_privilege('aeo_app','public.work_item_delivery_measures','UPDATE') u,
      has_table_privilege('aeo_app','public.work_item_delivery_measures','DELETE') d,
      has_table_privilege('aeo_app','public.work_item_delivery_measures','TRUNCATE') t`
    expect(grants).toEqual({ s: true, i: true, u: false, d: false, t: false })
    await expect(app`update work_item_delivery_measures set scope = 'page' where account_id = ${A}::uuid and attestation_id = ${attestation}::uuid`)
      .rejects.toMatchObject({ code: '42501' })
    await expect(app`delete from work_item_delivery_measures where account_id = ${A}::uuid and attestation_id = ${attestation}::uuid`)
      .rejects.toMatchObject({ code: '42501' })
    expect((await counts()).measures).toBe(1)
  })

  it('restricts deleting the page or the attestation a measure points at, even for the owner', async () => {
    const attestation = await attested({ scope: 'page', assetIds: [assetIds.p1!] })
    await expect(sql`delete from client_assets where account_id = ${A}::uuid and id = ${assetIds.p1!}::uuid`)
      .rejects.toMatchObject({ code: '23001' })
    await expect(sql`delete from work_item_delivery_events where account_id = ${A}::uuid and id = ${attestation}::uuid`)
      .rejects.toMatchObject({ code: '23001' })
  })
})

describe('attestDelivery records what to measure (real statement, as aeo_app)', () => {
  it('writes a site attestation and exactly one site measure, in the same statement', async () => {
    const result = await attest({ scope: 'site' })
    expect(result.kind).toBe('created')
    if (result.kind !== 'created') return
    expect(await measureRows(result.value.eventId)).toEqual([{ scope: 'site', asset_id: null }])
    expect(await counts()).toEqual({ events: 1, measures: 1 })
  })

  it('writes a 2-page attestation and exactly those two page measures', async () => {
    const id = await attested({ scope: 'page', assetIds: [assetIds.p2!, assetIds.p1!] })
    const rows = await measureRows(id)
    expect(rows.map(r => r.asset_id).sort()).toEqual([assetIds.p1!, assetIds.p2!].sort())
    expect(rows.every(r => r.scope === 'page')).toBe(true)
    expect(await counts()).toEqual({ events: 1, measures: 2 })
  })

  it('writes an attestation with no measure and no measure rows', async () => {
    await attested()
    expect(await counts()).toEqual({ events: 1, measures: 0 })
  })

  it('replays an identical request (same measure) without writing again, in any page order', async () => {
    const requestId = randomUUID()
    const first = await attest({ scope: 'page', assetIds: [assetIds.p1!, assetIds.p2!] }, { requestId })
    const second = await attest({ scope: 'page', assetIds: [assetIds.p2!, assetIds.p1!] }, { requestId })
    expect(first.kind).toBe('created')
    expect(second).toEqual({ kind: 'replayed', value: (first as { value: unknown }).value })
    expect(await counts()).toEqual({ events: 1, measures: 2 })

    const siteId = randomUUID()
    // The first attestation is active, so withdraw it before the site one.
    await withdraw((first as { value: { eventId: string } }).value.eventId)
    expect((await attest({ scope: 'site' }, { requestId: siteId })).kind).toBe('created')
    expect((await attest({ scope: 'site' }, { requestId: siteId })).kind).toBe('replayed')
    expect(await counts()).toEqual({ events: 3, measures: 3 })
  })

  it('conflicts when the request id is reused with a different measure, and writes nothing', async () => {
    const requestId = randomUUID()
    await attest({ scope: 'page', assetIds: [assetIds.p1!, assetIds.p2!] }, { requestId })
    const before = await counts()
    for (const measure of [
      { scope: 'site' } as MeasureInput,
      { scope: 'page', assetIds: [assetIds.p1!] } as MeasureInput,
      { scope: 'page', assetIds: [assetIds.p1!, assetIds.p3!] } as MeasureInput,
      undefined,
    ]) {
      expect(await attest(measure, { requestId })).toEqual({ kind: 'conflict' })
    }
    expect(await counts()).toEqual(before)

    // And the other direction: an attestation that measured nothing is not replayed by one that asks for a site.
    const bare = randomUUID()
    const [active] = await sql`select id from work_item_delivery_events where account_id = ${A}::uuid and kind = 'attest'`
    await withdraw(String(active!.id))
    expect((await attest(undefined, { requestId: bare })).kind).toBe('created')
    const mid = await counts()
    expect(await attest({ scope: 'site' }, { requestId: bare })).toEqual({ kind: 'conflict' })
    expect(await counts()).toEqual(mid)
  })

  it.each([
    ['an unknown page', () => [randomUUID()]],
    ['a sibling brand\'s page', () => [assetIds.px!]],
    ['another account\'s page', () => [assetIds.pb!]],
    ['a valid page beside a foreign one', () => [assetIds.p1!, assetIds.pb!]],
    ['a valid page beside an unknown one', () => [assetIds.p1!, randomUUID()]],
  ])('answers unknown_page for %s and writes no attestation and no measure', async (_name, ids) => {
    expect(await attest({ scope: 'page', assetIds: ids() })).toEqual({ kind: 'unknown_page' })
    expect(await counts()).toEqual({ events: 0, measures: 0 })
    // Nothing was left active, so a correct request goes straight through.
    expect((await attest({ scope: 'page', assetIds: [assetIds.p1!] })).kind).toBe('created')
    expect(await counts()).toEqual({ events: 1, measures: 1 })
  })

  it('does not let a replay or a refused request add measures to an existing attestation', async () => {
    const requestId = randomUUID()
    await attest({ scope: 'site' }, { requestId })
    expect(await attest({ scope: 'site' }, { requestId })).toMatchObject({ kind: 'replayed' })
    // A new request while one is active is a conflict, and that writes no measure either.
    expect(await attest({ scope: 'site' })).toEqual({ kind: 'conflict' })
    expect(await counts()).toEqual({ events: 1, measures: 1 })
  })
})

// Search Console and GA4 fixtures for the read side. All written as the owner: the
// stores that would write them are other suites' business, and several rows here
// (a stale synced_at, a pre-bind ledger row) are ones no store would write.
async function seedConnection() {
  await sql`insert into google_connections (id, account_id, google_subject, scopes, token_ciphertext, token_key_id, status, connected_by)
    values (${CONNECTION}::uuid, ${A}::uuid, 'g-c17', ${['openid']}::text[], ${'\\x00'}::bytea, '0123456789abcdef', 'active', ${AUTHOR}::uuid)`
}
async function seedSearchBinding() {
  await seedConnection()
  await sql`insert into search_console_bindings (account_id, client_id, connection_id, site_url, permission_level, bound_domain, backfill_pending, bound_at)
    values (${A}::uuid, ${A_CLIENT}::uuid, ${CONNECTION}::uuid, 'sc-domain:a-c17.example', 'siteOwner', 'a-c17.example', false, ${BOUND}::timestamptz)`
}
const searchRun = (client: string, outcome: string, ranAt: string, account = A) => sql`
  insert into search_console_sync_runs (account_id, client_id, outcome, ran_at)
  values (${account}::uuid, ${client}::uuid, ${outcome}, ${ranAt}::timestamptz)`
const searchDay = (account: string, client: string, date: string, scopeName: 'property' | 'page', url: string | null, clicks: number, syncedAt: string) => sql`
  insert into search_console_daily (account_id, client_id, date, scope, page_url, clicks, impressions, ctr, position, synced_at)
  values (${account}::uuid, ${client}::uuid, ${date}::date, ${scopeName}, ${url}, ${clicks}, ${clicks * 10}, 0.1, 3, ${syncedAt}::timestamptz)`

describe('loadAttributionInput on real Postgres (as aeo_app)', () => {
  const load = (over: { account?: string; client?: string; analytics?: boolean } = {}) =>
    loadAttributionInput(over.account ?? A, over.client ?? A_CLIENT, ITEM, version, { analytics: over.analytics ?? false })

  async function seedSearchData() {
    await seedSearchBinding()
    // Ledger: one ok before the bind (ignored), two since, a failure and then a deferred.
    await searchRun(A_CLIENT, 'ok', '2026-08-19T05:00:00Z')
    await searchRun(A_CLIENT, 'ok', '2026-09-10T03:00:00Z')
    // 16:30 UTC is 00:30 the next day in Hong Kong: the UTC date would be 2026-09-11.
    await searchRun(A_CLIENT, 'ok', '2026-09-11T16:30:00Z')
    await searchRun(A_CLIENT, 'quota', '2026-09-11T17:00:00Z')
    await searchRun(A_CLIENT, 'deferred', '2026-09-11T18:00:00Z')
    // Property rows: inside both windows, on the delivery day (the store reads the whole D-28..D+28 span and
    // leaves the day itself to compareTarget), past the after window, and before the before window.
    await searchDay(A, A_CLIENT, '2026-08-10', 'property', null, 5, '2026-08-21T00:00:00Z')
    await searchDay(A, A_CLIENT, '2026-09-05', 'property', null, 8, '2026-09-12T00:00:00Z')
    await searchDay(A, A_CLIENT, '2026-09-01', 'property', null, 11, '2026-09-12T00:00:00Z')
    await searchDay(A, A_CLIENT, '2026-09-30', 'property', null, 99, '2026-09-12T00:00:00Z')
    await searchDay(A, A_CLIENT, '2026-08-03', 'property', null, 99, '2026-09-12T00:00:00Z')
    // Written for a PREVIOUS binding: synced before bound_at.
    await searchDay(A, A_CLIENT, '2026-08-11', 'property', null, 99, '2026-08-19T00:00:00Z')
    // Pages.
    await searchDay(A, A_CLIENT, '2026-09-05', 'page', P1, 3, '2026-09-12T00:00:00Z')
    await searchDay(A, A_CLIENT, '2026-09-05', 'page', P2, 4, '2026-09-12T00:00:00Z')
    await searchDay(A, A_CLIENT, '2026-08-12', 'page', P1, 99, '2026-08-19T00:00:00Z')
    // Another brand of the same account, and another account, on the same dates.
    await searchDay(A, A_CLIENT2, '2026-09-05', 'property', null, 77, '2026-09-12T00:00:00Z')
    await searchDay(A, A_CLIENT2, '2026-09-05', 'page', PX, 77, '2026-09-12T00:00:00Z')
    await searchDay(B, B_CLIENT, '2026-09-05', 'property', null, 66, '2026-09-12T00:00:00Z')
    // Coverage.
    for (const [clientScope, url, from] of [['property', null, '2026-07-01'], ['page', P1, '2026-07-15'], ['page', P2, '2026-07-20']] as const) {
      await sql`insert into search_console_coverage (account_id, client_id, scope, page_url, covered_from)
        values (${A}::uuid, ${A_CLIENT}::uuid, ${clientScope}, ${url}, ${from}::date)`
    }
    await sql`insert into search_console_coverage (account_id, client_id, scope, page_url, covered_from)
      values (${A}::uuid, ${A_CLIENT2}::uuid, 'property', null, '2026-01-01'::date), (${B}::uuid, ${B_CLIENT}::uuid, 'property', null, '2026-01-01'::date)`
  }

  async function seedAnalytics() {
    await sql`insert into analytics_bindings (account_id, client_id, connection_id, property_id, stream_id, stream_host, key_events, bound_at, events_chosen_at, covered_from)
      values (${A}::uuid, ${A_CLIENT}::uuid, ${CONNECTION}::uuid, '111', '222', 'a-c17.example', ${['generate_lead', 'book_call']}::text[],
              ${BOUND}::timestamptz, '2026-08-25T00:00:00Z'::timestamptz, '2026-08-10'::date)`
    const run = (outcome: string, ranAt: string) => sql`
      insert into analytics_sync_runs (account_id, client_id, connection_id, property_id, stream_id, outcome, ran_at)
      values (${A}::uuid, ${A_CLIENT}::uuid, ${CONNECTION}::uuid, '111', '222', ${outcome}, ${ranAt}::timestamptz)`
    // After the bind but BEFORE the events were re-chosen: a different event set was synced.
    await run('ok', '2026-08-24T10:00:00Z')
    await run('ok', '2026-09-11T16:30:00Z')
    await run('internal_error', '2026-09-11T17:30:00Z')
    await run('deferred', '2026-09-11T18:30:00Z')
    const day = (client: string, date: string, event: string, cls: string, count: number, syncedAt: string, account = A) => sql`
      insert into analytics_daily (account_id, client_id, date, event_name, source_class, count, synced_at)
      values (${account}::uuid, ${client}::uuid, ${date}::date, ${event}, ${cls}, ${count}, ${syncedAt}::timestamptz)`
    await day(A_CLIENT, '2026-09-05', 'generate_lead', 'organic_search', 3, '2026-09-12T00:00:00Z')
    await day(A_CLIENT, '2026-09-05', 'book_call', 'organic_search', 2, '2026-09-12T00:00:00Z')
    await day(A_CLIENT, '2026-09-05', 'generate_lead', 'ai_assistant', 1, '2026-09-12T00:00:00Z')
    await day(A_CLIENT, '2026-08-10', 'generate_lead', 'other', 4, '2026-08-26T00:00:00Z')
    await day(A_CLIENT, '2026-09-06', 'not_chosen', 'other', 9, '2026-09-12T00:00:00Z')
    // Synced after the bind but before the events were re-chosen.
    await day(A_CLIENT, '2026-08-12', 'generate_lead', 'other', 7, '2026-08-22T00:00:00Z')
    await day(A_CLIENT, '2026-09-01', 'generate_lead', 'other', 7, '2026-09-12T00:00:00Z')
    await day(A_CLIENT2, '2026-09-05', 'generate_lead', 'other', 50, '2026-09-12T00:00:00Z')
    await day(B_CLIENT, '2026-09-05', 'generate_lead', 'other', 50, '2026-09-12T00:00:00Z', B)
  }

  it('reads a site measure: the live checks, Hong Kong run dates, and only this brand\'s current-binding rows', async () => {
    await attested({ scope: 'site' })
    await seedSearchData()
    const input = await load()
    expect(input).toMatchObject({
      schemaVersion: 1,
      attestation: { deliveredAt: '2026-09-01T10:00:00.000000Z', withdrawn: false },
      measures: [{ scope: 'site', asset: null }],
    })
    const sources = input!.sources!
    expect(sources.search).toEqual({
      boundAt: BOUND_ISO,
      // 2026-09-11T16:30Z is 2026-09-12 in Hong Kong. The pre-bind ok run never counts.
      okRunDates: ['2026-09-12'],
      // The deferred run ran out of time and says nothing; the newest real outcome is the quota.
      latestOutcome: 'quota',
    })
    expect(sources.coverage).toEqual([{ scope: 'property', pageUrl: null, coveredFrom: '2026-07-01' }])
    expect(sources.searchDays).toEqual([
      { scope: 'property', pageUrl: null, date: '2026-08-10', clicks: 5, impressions: 50, position: 3 },
      { scope: 'property', pageUrl: null, date: '2026-09-01', clicks: 11, impressions: 110, position: 3 },
      { scope: 'property', pageUrl: null, date: '2026-09-05', clicks: 8, impressions: 80, position: 3 },
    ])
    // The caller did not ask for analytics.
    expect(sources.enquiries).toBeNull()
  })

  it('reads a page measure: only the measured pages\' rows and coverage, and no GA4 even when allowed', async () => {
    await attested({ scope: 'page', assetIds: [assetIds.p1!] })
    await seedSearchData()
    await seedAnalytics()
    const sources = (await load({ analytics: true }))!.sources!
    expect(sources.coverage).toEqual([{ scope: 'page', pageUrl: P1, coveredFrom: '2026-07-15' }])
    expect(sources.searchDays).toEqual([
      { scope: 'page', pageUrl: P1, date: '2026-09-05', clicks: 3, impressions: 30, position: 3 },
    ])
    expect(sources.enquiries).toBeNull()
  })

  it('returns the page measures with their registered pages, site first when both could exist', async () => {
    await attested({ scope: 'page', assetIds: [assetIds.p2!, assetIds.p1!] })
    await seedSearchData()
    const input = await load()
    expect(input!.measures).toEqual([
      { scope: 'page', asset: { id: assetIds.p1, url: P1, label: 'Page 1' } },
      { scope: 'page', asset: { id: assetIds.p2, url: P2, label: 'Page 2' } },
    ])
  })

  it('reads GA4 for a site measure: the binding, ok dates since the event choice, and summed chosen events', async () => {
    await attested({ scope: 'site' })
    await seedSearchData()
    await seedAnalytics()
    const enquiries = (await load({ analytics: true }))!.sources!.enquiries!
    expect(enquiries.state).toEqual({
      boundAt: BOUND_ISO,
      coveredFrom: '2026-08-10',
      // The 2026-08-24 ok run synced the previous event choice and does not count.
      okRunDates: ['2026-09-12'],
      latestOutcome: 'internal_error',
    })
    // book_call and generate_lead sum per class; rows synced before the re-pick,
    // an unchosen event, and other brands/accounts are out. The delivery day is in the read span.
    expect(enquiries.days).toEqual([
      { date: '2026-08-10', sourceClass: 'other', count: 4 },
      { date: '2026-09-01', sourceClass: 'other', count: 7 },
      { date: '2026-09-05', sourceClass: 'ai_assistant', count: 1 },
      { date: '2026-09-05', sourceClass: 'organic_search', count: 5 },
    ])
  })

  it('reports no GA4 binding as a null state with no days', async () => {
    await attested({ scope: 'site' })
    await seedSearchData()
    expect((await load({ analytics: true }))!.sources!.enquiries).toEqual({ state: null, days: [] })
  })

  it('reports no Search Console binding as null, never an invented state', async () => {
    await attested({ scope: 'site' })
    const sources = (await load())!.sources!
    expect(sources.search).toBeNull()
    expect(sources.searchDays).toEqual([])
  })

  it('ignores ledger rows recorded before the binding', async () => {
    await attested({ scope: 'site' })
    await seedSearchBinding()
    await searchRun(A_CLIENT, 'ok', '2026-08-19T05:00:00Z')
    await searchRun(A_CLIENT, 'revoked', '2026-08-19T06:00:00Z')
    const sources = (await load())!.sources!
    expect(sources.search).toEqual({ boundAt: BOUND_ISO, okRunDates: [], latestOutcome: null })
  })

  it('treats a binding whose only run is deferred as having no information', async () => {
    await attested({ scope: 'site' })
    await seedSearchBinding()
    await searchRun(A_CLIENT, 'deferred', '2026-09-11T18:00:00Z')
    expect((await load())!.sources!.search).toEqual({ boundAt: BOUND_ISO, okRunDates: [], latestOutcome: null })
  })

  it('never answers for another account or another brand', async () => {
    await attested({ scope: 'site' })
    await seedSearchData()
    // The version is account A's and brand A_CLIENT's; any other pairing is "not yours" (null), not an empty result.
    expect(await load({ account: B })).toBeNull()
    expect(await load({ account: B, client: B_CLIENT })).toBeNull()
    expect(await load({ client: A_CLIENT2 })).toBeNull()
    expect(await loadAttributionInput(A, A_CLIENT, ITEM, randomUUID(), { analytics: false })).toBeNull()
  })

  it('says nothing to compare for a version that was never attested', async () => {
    expect(await load()).toEqual({ schemaVersion: 1, attestation: null, measures: [], sources: null })
  })

  it('says nothing to compare for an attestation that measured nothing', async () => {
    await attested()
    expect(await load()).toMatchObject({ attestation: { withdrawn: false }, measures: [], sources: null })
  })

  it('reports a withdrawn attestation as withdrawn and reads no sources', async () => {
    const id = await attested({ scope: 'site' })
    await seedSearchData()
    await withdrawDelivery(scope(), id, { reason: 'Wrong destination', requestId: randomUUID() })
    expect(await load()).toMatchObject({ attestation: { id, withdrawn: true }, measures: [{ scope: 'site' }], sources: null })
  })

  it('after withdraw then re-attest returns only the new attestation\'s measures', async () => {
    const first = await attested({ scope: 'page', assetIds: [assetIds.p1!, assetIds.p2!] })
    await seedSearchData()
    const second = await withdrawThenAttest(first, { scope: 'site' }, { deliveredAt: '2026-09-03T10:00:00.000Z' })
    const input = (await load())!
    expect(input.attestation).toEqual({ id: second, deliveredAt: '2026-09-03T10:00:00.000000Z', withdrawn: false })
    expect(input.measures).toEqual([{ scope: 'site', asset: null }])
    // The retired attestation's measures are still on file, insert-only, and simply not read.
    expect((await counts()).measures).toBe(3)
    // And the read span moved with the new delivery day (D = 2026-09-03, so up to 2026-10-01): the
    // 2026-09-30 row, outside the first attestation's span, is now inside it.
    expect(input.sources!.searchDays.map(d => d.date)).toEqual(['2026-08-10', '2026-09-01', '2026-09-05', '2026-09-30'])
  })

  it('runs its snapshot reads as one read-only repeatable-read transaction on this driver', async () => {
    await attested({ scope: 'site' })
    await seedSearchData()
    const transaction = vi.spyOn(app, 'transaction')
    try {
      await load({ analytics: true })
      expect(transaction).toHaveBeenCalledTimes(1)
      expect(transaction.mock.calls[0]![1]).toEqual({ isolationLevel: 'RepeatableRead', readOnly: true })
    } finally { transaction.mockRestore() }
    // The same options, against the real server: the statements really ran inside it.
    const [probe] = await app.transaction([
      app`select current_setting('transaction_isolation') as isolation, current_setting('transaction_read_only') as read_only`,
    ], { isolationLevel: 'RepeatableRead', readOnly: true })
    expect(probe).toEqual([{ isolation: 'repeatable read', read_only: 'on' }])
  })
})
