import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ db: () => sql }))
vi.mock('@/lib/auth', () => ({ getProfile: async () => profile }))
import { saveAuthenticatedDraft, editAuthenticatedDraft, readAuthenticatedDraft } from '@/lib/work-items/service'
import { buildScanEvidence } from '@/lib/scan-evidence'
import { deriveSuggestions } from '@/lib/opportunities/rules'
import { freezeReview } from '@/lib/change-sets/validation'
import { listOwnedDrafts } from '@/lib/work-items/store'

let pg: PGlite
const owner = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', account_id: '11111111-1111-4111-8111-111111111111' }
let profile: typeof owner | null = owner
const client = '22222222-2222-4222-8222-222222222222'
type Statement = { text: string; values: unknown[]; then: Promise<unknown[]>['then'] }
const sql = Object.assign((strings: TemplateStringsArray, ...values: unknown[]): Statement => {
  const text = strings.reduce((all, part, index) => all + (index ? `$${index}` : '') + part, '')
  return { text, values, then: (resolve, reject) => pg.query(text, values).then(result => result.rows).then(resolve, reject) }
}, {
  transaction: async (statements: Statement[]) => pg.transaction(async tx => {
    const results = []
    for (const statement of statements) results.push((await tx.query(statement.text, statement.values)).rows)
    return results
  }),
})
beforeAll(async () => {
  // Explicitly in-memory WASM. No env/DSN/socket or Neon client is constructed.
  pg = new PGlite()
  await pg.exec(`create table clients(id uuid primary key,account_id uuid);
    create table scans(id uuid primary key,client_id uuid,account_id uuid,created_at timestamptz default now(),results jsonb);
    create table evidence_work_items(
      id uuid primary key default gen_random_uuid(),account_id uuid,client_id uuid,opportunity_key text,
      source_kind text,source_id uuid,rule_version text,check_key text,evidence_fingerprint text,evidence_snapshot jsonb,
      status text,title text,action text,notes text,locale text,revision bigint,created_by uuid,updated_by uuid,
      created_at timestamptz default now(),updated_at timestamptz default now(),unique(account_id,client_id,opportunity_key));
    create table work_item_sources(
      id uuid primary key default gen_random_uuid(),account_id uuid,client_id uuid,work_item_id uuid,
      opportunity_key text,source_kind text,source_id uuid,rule_version text,check_key text,
      evidence_fingerprint text,evidence_snapshot jsonb,attached_by uuid,withdrawn_at timestamptz);
    insert into clients values('${client}','${owner.account_id}');`)
})
afterAll(async () => { await pg?.close() })
const request = (value: unknown) => new Request('https://fixture.invalid', { method: 'POST', body: JSON.stringify(value) })
it.each(['en', 'zh-HK'] as const)('real production draft SQL saves one source-bound draft, replays and rejects stale/foreign writes in %s', async locale => {
  profile = owner
  const scanId = crypto.randomUUID()
  const envelope = buildScanEvidence({ requestedUrl: 'https://example.test', evaluatedUrl: 'https://example.test',
    industry: 'general_b2b', region: 'HK', sitemapSource: 'unknown', checks: { c9_meta_desc: { assessment: 'fail', collection: 'complete' } } })
  await pg.query('insert into scans(id,client_id,account_id,results) values($1,$2,$3,$4::jsonb)',
    [scanId, client, owner.account_id, JSON.stringify({ evidence: envelope })])
  const recorded = (await pg.query<{ stamp: string }>(`select to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') stamp from scans where id=$1`, [scanId])).rows[0].stamp
  const suggestion = deriveSuggestions({ kind: 'scan-check', scanId, envelope, recordedAt: recorded })[0]
  const input = { source: suggestion.source, ruleVersion: suggestion.ruleVersion, fingerprint: suggestion.fingerprint, locale }
  const attempts = await Promise.all([saveAuthenticatedDraft(client, request(input)), saveAuthenticatedDraft(client, request(input))])
  expect(attempts.filter(value => value.created)).toHaveLength(1)
  const first = attempts.find(value => value.created)!
  const replay = await saveAuthenticatedDraft(client, request(input))
  expect(first.created).toBe(true)
  expect(replay).toEqual({ item: first.item, created: false })
  expect(first.item.evidenceSnapshot.source).toEqual({ kind: 'scan-check', id: scanId, checkKey: 'c9_meta_desc' })
  const edit = { title: 'Synthetic reviewed metadata', action: '<meta name="description" content="Synthetic fixture page.">',
    notes: 'Synthetic human review required. Not applied.', expectedRevision: 1 }
  const saved = (await editAuthenticatedDraft(client, first.item.id, request(edit))).item
  expect(saved.revision).toBe(2)
  expect(saved.evidenceSnapshot).toEqual(first.item.evidenceSnapshot)
  expect((await editAuthenticatedDraft(client, first.item.id, request(edit))).item).toEqual(saved)
  await expect(editAuthenticatedDraft(client, first.item.id, request({ ...edit, notes: 'Stale tab' })))
    .rejects.toMatchObject({ code: 'WORK_ITEM_CONFLICT', status: 409 })
  const frozen = freezeReview(saved)
  expect(frozen.content).toMatchObject({ draftRevision: 2, action: edit.action, evidenceSnapshot: saved.evidenceSnapshot })
  profile = null
  await expect(readAuthenticatedDraft(client, saved.id)).rejects.toMatchObject({ status: 401 })
  profile = { ...owner, account_id: '99999999-9999-4999-8999-999999999999' }
  await expect(readAuthenticatedDraft(client, saved.id)).rejects.toMatchObject({ status: 404 })
  await expect(editAuthenticatedDraft(client, saved.id, request({ ...edit, expectedRevision: 2 }))).rejects.toMatchObject({ status: 404 })
  profile = owner
  expect((await readAuthenticatedDraft(client, saved.id)).item).toEqual(saved)
  const sources = await pg.query<{ source_id: string }>('select source_id from work_item_sources where work_item_id=$1', [saved.id])
  expect(sources.rows).toEqual([{ source_id: scanId }])
  const secondScanId = crypto.randomUUID()
  const attachedSnapshot=structuredClone(saved.evidenceSnapshot)
  attachedSnapshot.source.id=secondScanId
  if(attachedSnapshot.evidence.kind==='scan-check')attachedSnapshot.evidence.scanId=secondScanId
  await pg.query(`insert into work_item_sources(account_id,client_id,work_item_id,source_kind,source_id,opportunity_key,evidence_snapshot)
    values($1,$2,$3,'scan-check',$4,$5,$6::jsonb)`,
    [owner.account_id,client,saved.id,secondScanId,`second:${secondScanId}`,JSON.stringify(attachedSnapshot)])
  expect((await readAuthenticatedDraft(client,saved.id)).item).toMatchObject({ sourceScanIds: expect.arrayContaining([scanId,secondScanId]) })
  expect((await listOwnedDrafts(owner.account_id,client,{limit:50,cursor:null})).items.find(row=>row.id===saved.id))
    .toMatchObject({ sourceScanIds: expect.arrayContaining([secondScanId]) })
  await pg.query('update work_item_sources set withdrawn_at=now() where source_id=$1',[secondScanId])
  expect((await readAuthenticatedDraft(client,saved.id)).item).toMatchObject({ sourceScanIds: [scanId] })
})
