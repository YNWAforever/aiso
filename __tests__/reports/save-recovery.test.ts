import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { reportSnapshot } from '../components/report-builder-fixtures'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ db: () => sql }))
vi.mock('@/lib/auth', () => ({ getProfile: async () => profile }))
vi.mock('@/lib/openrouter', () => ({ callOpenRouter: () => { throw new Error('Paid providers forbidden') } }))
import { GET as READ_RECEIPT } from '@/app/api/clients/[clientId]/report-save-requests/[requestId]/route'
import { POST as CREATE_REPORT } from '@/app/api/clients/[clientId]/reports/route'
import { POST as APPEND_REPORT } from '@/app/api/client-reports/[reportId]/versions/route'
import { saveClientReportRequest } from '@/lib/reports/save-store'
import { buildScanEvidence } from '@/lib/scan-evidence'

let pg: PGlite
const account = '10000000-0000-4000-8000-000000000001'
const actor = '10000000-0000-4000-8000-000000000002'
const client = '10000000-0000-4000-8000-000000000003'
const scan = '10000000-0000-4000-8000-000000000004'
const otherClient = '10000000-0000-4000-8000-000000000005'
const summary = 'Synthetic receipt summary: use only this selected scan evidence before making any changes.'
const owner = {
  id: actor, account_id: account,
  accounts: { plan: 'pro', status: 'active', stripe_subscription_id: 'synthetic-subscription', trial_ends_at: null },
}
let profile: typeof owner | null = owner
const statements: string[] = []
const sql = async (parts: TemplateStringsArray, ...values: unknown[]) => {
  const text = parts.reduce((all, part, index) => all + (index ? `$${index}` : '') + part, '')
  statements.push(text)
  return (await pg.query(text, values)).rows
}
beforeAll(async () => {
  // In-memory WASM engine; no DSN, sockets, environment credentials or Neon client.
  pg = await PGlite.create({ extensions: { pgcrypto } })
  await pg.exec(`create role aeo_app bypassrls;
    create table accounts(id uuid primary key);
    create table clients(id uuid primary key,account_id uuid references accounts(id),domain text);
    create table profiles(id uuid primary key,account_id uuid references accounts(id));
    create table scans(id uuid primary key,account_id uuid references accounts(id),domain text,created_at timestamptz default now());
    insert into accounts values('${account}');
    insert into clients values('${client}','${account}','example.test'),('${otherClient}','${account}','other.test');
    insert into profiles values('${actor}','${account}');
    insert into scans(id,account_id,domain) values('${scan}','${account}','example.test');
    alter table clients add column brand_name text not null default 'Synthetic brand';`)
  await pg.exec(readFileSync('supabase/migrations/027_client_report_snapshots.sql', 'utf8'))
  await pg.exec('alter default privileges in schema public grant select,insert,update,delete on tables to aeo_app')
  const file = 'supabase/migrations/071_report_save_receipts.sql'
  // An absent migration leaves the old schema intact for the first RED run.
  if (existsSync(file)) await pg.exec(readFileSync(file, 'utf8'))
  await pg.exec(`alter table scans add column score numeric default 40,add column grade text default 'D',add column results jsonb;
    create table agent_recommendations(id uuid,scan_id uuid,category text,priority text,recommendation text,impact_score numeric);
    insert into account_report_branding(account_id,agency_name) values('${account}','Synthetic agency');`)
  const evidence = buildScanEvidence({
    requestedUrl: 'https://example.test', evaluatedUrl: 'https://example.test',
    industry: null, region: null, sitemapSource: null, checks: {},
    observations: [{ check: 'page', collection: 'complete', httpStatus: 200, target: { origin: 'https://example.test' }, provenance: 'validated-fetch' }],
  })
  await pg.query('update scans set results=$1::jsonb', [JSON.stringify({ evidence, c1_robots: { status: 'warn' } })])
  vi.stubEnv('REPORT_SHARE_SECRET', 'synthetic-report-only-'.repeat(3))
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://fixture.invalid')
})
afterAll(async () => { await pg?.close(); vi.unstubAllEnvs() })

async function save(requestId: string, reportId: string | null = null, text = summary, clientId = client) {
  const result = await pg.query<{ result: { report: { id: string; latest_version_id: string }; version: { id: string; version_number: number } } }>(`
    select public.save_client_report_draft_request(
      p_request_id=>$1::uuid,p_report_id=>$2::uuid,p_account_id=>$3::uuid,p_client_id=>$4::uuid,
      p_source_scan_id=>$5::uuid,p_previous_scan_id=>null::uuid,p_locale=>'en',
      p_executive_summary=>$6,p_snapshot_schema_version=>1,p_snapshot=>$7::jsonb,p_created_by=>$8::uuid) as result`,
  [requestId, reportId, account, clientId, scan, text, JSON.stringify({ ...reportSnapshot('en'), executiveSummary: text }), actor])
  return result.rows[0].result
}
async function counts() {
  return (await pg.query(`select
    (select count(*)::int from client_reports) reports,
    (select count(*)::int from client_report_versions) versions,
    (select count(*)::int from report_save_receipts) receipts`)).rows[0]
}
it('replays the same create receipt with the same immutable report/version, without another insert', async () => {
  const before = await pg.query<{ n: number }>('select count(*)::int n from client_reports')
  const id = crypto.randomUUID()
  const first = await save(id)
  const replay = await save(id)
  expect(replay).toEqual(first)
  expect(first.version.version_number).toBe(1)
  expect((await pg.query<{ n: number }>('select count(*)::int n from client_reports')).rows[0].n)
    .toBe(before.rows[0].n + 1)
  const row = (await pg.query<{ result: unknown; request_payload: unknown }>(
    'select result,request_payload from report_save_receipts where account_id=$1 and client_id=$2 and actor_id=$3 and request_id=$4',
    [account, client, actor, id])).rows[0]
  expect(row.result).toEqual(first)
  expect(row.request_payload).toEqual({ reportId: null, scanId: scan, locale: 'en', executiveSummary: summary })
})
it('replays an append after later versions without overwriting the frozen acknowledgement or published state', async () => {
  const created = await save(crypto.randomUUID()), reportId = created.report.id
  await pg.query('select public.publish_client_report_latest($1::uuid,$2::uuid,$3::uuid,$4::uuid)',
    [reportId, account, client, created.version.id])
  const id = crypto.randomUUID()
  const appended = await save(id, reportId, summary + ' Version two.')
  await save(crypto.randomUUID(), reportId, summary + ' Version three.')
  const before = await counts()
  expect(await save(id, reportId, summary + ' Version two.')).toEqual(appended)
  expect(appended.version.version_number).toBe(2)
  expect(await counts()).toEqual(before)
  const current = (await pg.query<{ n: number; published: string | null }>(`
    select v.version_number n,r.published_version_id published from client_reports r
    join client_report_versions v on v.id=r.latest_version_id where r.id=$1`, [reportId])).rows[0]
  expect(current).toEqual({ n: 3, published: created.version.id })
})
it('rejects reusing an identity for changed content, operation or client without inserting', async () => {
  const id = crypto.randomUUID(), original = await save(id), before = await counts()
  await expect(save(id, null, summary + ' Changed.')).rejects.toThrow('CLIENT_REPORT_SAVE_CONFLICT')
  await expect(save(id, original.report.id)).rejects.toThrow('CLIENT_REPORT_SAVE_CONFLICT')
  await expect(save(id, null, summary, otherClient)).rejects.toThrow('CLIENT_REPORT_SAVE_CONFLICT')
  expect(await counts()).toEqual(before)
})
it('rolls back both the report/version and receipt if receipt persistence fails', async () => {
  const before = await counts()
  await pg.exec(`create function fail_synthetic_receipt() returns trigger language plpgsql as $$
    begin raise exception 'SYNTHETIC_RECEIPT_WRITE_FAILURE'; end $$;
    create trigger synthetic_receipt_failure before insert on report_save_receipts
    for each row execute function fail_synthetic_receipt();`)
  try { await expect(save(crypto.randomUUID())).rejects.toThrow('SYNTHETIC_RECEIPT_WRITE_FAILURE') }
  finally { await pg.exec('drop trigger synthetic_receipt_failure on report_save_receipts; drop function fail_synthetic_receipt();') }
  expect(await counts()).toEqual(before)
})
it('keeps receipts private and immutable for the runtime role, including inherited default table grants', async () => {
  const acl = (await pg.query(`select
    has_table_privilege('aeo_app','report_save_receipts','SELECT') can_read,
    has_table_privilege('aeo_app','report_save_receipts','INSERT') can_insert,
    has_table_privilege('aeo_app','report_save_receipts','UPDATE') can_update,
    has_table_privilege('aeo_app','report_save_receipts','DELETE') can_delete,
    has_function_privilege('public','save_client_report_draft_request(uuid,uuid,uuid,uuid,uuid,uuid,text,text,integer,jsonb,uuid)','EXECUTE') public_execute`)).rows[0]
  expect(acl).toEqual({ can_read: true, can_insert: false, can_update: false, can_delete: false, public_execute: false })
  await pg.exec('set role aeo_app')
  try {
    await expect(pg.exec("update report_save_receipts set result='{}'::jsonb")).rejects.toMatchObject({ code: '42501' })
    await expect(pg.exec('delete from report_save_receipts')).rejects.toMatchObject({ code: '42501' })
  } finally { await pg.exec('reset role') }
})
it('uses the production tagged-template store to save and replay one receipt', async () => {
  const input = {
    requestId: crypto.randomUUID(), reportId: null, accountId: account, clientId: client,
    sourceScanId: scan, previousScanId: null, locale: 'en' as const, executiveSummary: summary,
    snapshotSchemaVersion: 1 as const, snapshot: { ...reportSnapshot('en'), executiveSummary: summary }, createdBy: actor,
  }
  const first = await saveClientReportRequest(input)
  const before = await counts()
  expect(await saveClientReportRequest(input)).toEqual(first)
  expect(first?.version.source_scan_id).toBe(scan)
  expect(await counts()).toEqual(before)
})
it('allows only the receipt transaction RPC to write under the existing least-privilege runtime role', async () => {
  const id = crypto.randomUUID()
  let result: Awaited<ReturnType<typeof save>>
  await pg.exec('set role aeo_app')
  try { result = await save(id) } finally { await pg.exec('reset role') }
  expect(result.version.version_number).toBe(1)
  expect(await save(id)).toEqual(result)
})
async function readReceipt(clientId: string, requestId: string) {
  return READ_RECEIPT(new Request('https://fixture.invalid'), { params: Promise.resolve({ clientId, requestId }) })
}
it('reads the exact saved snapshot through the real owner service/API without writes or private report fields', async () => {
  profile = owner
  const id = crypto.randomUUID(), saved = await save(id), before = await counts()
  statements.length = 0
  const response = await readReceipt(client, id), data = await response.json()
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(data.receipt).toMatchObject({
    requestId: id, request: { reportId: null, scanId: scan, locale: 'en', executiveSummary: summary },
    result: { report: { id: saved.report.id }, reviewArtifact: { versionId: saved.version.id, snapshot: { executiveSummary: summary } } },
  })
  expect(JSON.stringify(data)).not.toMatch(/public_slug|account_id|actor_id|share_version/)
  expect(await (await readReceipt(client, id)).json()).toEqual(data)
  expect(statements.every(text => /^\s*select/i.test(text))).toBe(true)
  expect(await counts()).toEqual(before)
})
it('denies anonymous/foreign accounts and never exposes another actor or client receipt', async () => {
  const id = crypto.randomUUID()
  await save(id)
  const before = await counts()
  try {
    profile = null
    expect((await readReceipt(client, id)).status).toBe(401)
    profile = { ...owner, accounts: { ...owner.accounts, status: 'past_due' } }
    expect((await readReceipt(client, id)).status).toBe(403)
    profile = { ...owner, account_id: crypto.randomUUID() }
    expect((await readReceipt(client, id)).status).toBe(404)
    profile = { ...owner, id: crypto.randomUUID() }
    expect(await (await readReceipt(client, id)).json()).toEqual({ receipt: null })
    profile = owner
    expect(await (await readReceipt(otherClient, id)).json()).toEqual({ receipt: null })
    expect(await (await readReceipt(client, crypto.randomUUID())).json()).toEqual({ receipt: null })
    expect((await readReceipt(client, 'invalid')).status).toBe(400)
    expect(await counts()).toEqual(before)
  } finally { profile = owner }
})
it('replays an acknowledged POST through the real service and rejects changed request content', async () => {
  profile = owner
  const id = crypto.randomUUID(), first = await save(id), before = await counts()
  const post = (text: string) => CREATE_REPORT(new Request('https://fixture.invalid', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Report-Request-Id': id, 'X-Report-Scan-Id': scan },
    body: JSON.stringify({ scanId: scan, locale: 'en', executiveSummary: text }),
  }), { params: Promise.resolve({ clientId: client }) })
  const response = await post(summary)
  expect(response.status).toBe(201)
  expect((await response.json()).reviewArtifact.versionId).toBe(first.version.id)
  expect((await post(summary + ' Changed.')).status).toBe(409)
  expect(await counts()).toEqual(before)
})
it('rejects unpaired or mismatched save headers before any database request', async () => {
  statements.length = 0
  const headerCases: Record<string, string>[] = [
    { 'X-Report-Request-Id': crypto.randomUUID() },
    { 'X-Report-Request-Id': crypto.randomUUID(), 'X-Report-Scan-Id': crypto.randomUUID() },
  ]
  for (const headers of headerCases) {
    const response = await CREATE_REPORT(new Request('https://fixture.invalid', {
      method: 'POST', headers,
      body: JSON.stringify({ scanId: scan, locale: 'en', executiveSummary: summary }),
    }), { params: Promise.resolve({ clientId: client }) })
    expect(response.status).toBe(400)
  }
  expect(statements).toEqual([])
})
it('creates, appends, replays and reads both acknowledgements through real API/service/store SQL', async () => {
  profile = owner
  const before = await counts() as { reports: number; versions: number; receipts: number }
  const createId = crypto.randomUUID()
  const headers = (id: string) => ({ 'Content-Type': 'application/json', 'X-Report-Request-Id': id, 'X-Report-Scan-Id': scan })
  const create = () => CREATE_REPORT(new Request('https://fixture.invalid', {
    method: 'POST', headers: headers(createId), body: JSON.stringify({ scanId: scan, locale: 'en', executiveSummary: summary }),
  }), { params: Promise.resolve({ clientId: client }) })
  const created = await create(), first = await created.json()
  expect(created.status).toBe(201)
  expect(first.reviewArtifact).toMatchObject({ versionNumber: 1, snapshot: { executiveSummary: summary, client: { domain: 'example.test' } } })
  expect(await (await create()).json()).toEqual(first)
  expect((await (await readReceipt(client, createId)).json()).receipt.result).toEqual(first)
  const appendId = crypto.randomUUID(), secondText = summary + ' Human revision.'
  const append = () => APPEND_REPORT(new Request('https://fixture.invalid', {
    method: 'POST', headers: headers(appendId), body: JSON.stringify({ locale: 'en', executiveSummary: secondText }),
  }), { params: Promise.resolve({ reportId: first.report.id }) })
  const appended = await append(), second = await appended.json()
  expect(appended.status).toBe(201)
  expect(second.reviewArtifact).toMatchObject({ versionNumber: 2, snapshot: { executiveSummary: secondText } })
  expect(await (await append()).json()).toEqual(second)
  expect((await (await readReceipt(client, appendId)).json()).receipt.result).toEqual(second)
  expect((await (await readReceipt(client, createId)).json()).receipt.result).toEqual(first)
  expect(await counts()).toEqual({ reports: before.reports + 1, versions: before.versions + 2, receipts: before.receipts + 2 })
})
it('replays the same whitespace normalization request through the API without inserting twice', async () => {
  profile = owner
  const id = crypto.randomUUID(), before = await counts() as { reports: number; versions: number; receipts: number }
  const raw = `  ${summary.replace('receipt summary', 'receipt   summary')}  `
  const post = () => CREATE_REPORT(new Request('https://fixture.invalid', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Report-Request-Id': id, 'X-Report-Scan-Id': scan },
    body: JSON.stringify({ scanId: scan, locale: 'en', executiveSummary: raw }),
  }), { params: Promise.resolve({ clientId: client }) })
  const first = await post()
  expect(first.status).toBe(201)
  const body = await first.json()
  expect(body.reviewArtifact.snapshot.executiveSummary).toBe(summary)
  const replay = await post()
  expect(replay.status).toBe(201)
  expect(await replay.json()).toEqual(body)
  expect(await counts()).toEqual({ reports: before.reports + 1, versions: before.versions + 1, receipts: before.receipts + 1 })
})
