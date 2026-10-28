import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { buildScanEvidence } from '@/lib/scan-evidence'

const state = vi.hoisted(() => ({ pg: null as PGlite | null }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ db: () => async (strings: TemplateStringsArray, ...values: unknown[]) => {
  const text = strings.reduce((out, part, index) => out + (index ? `$${index}` : '') + part, '')
  return (await state.pg!.query(text, values)).rows
} }))
import { loadStudioEvidence } from '@/lib/conversation-studio/evidence'
import { composeSavedReply } from '@/lib/conversation-studio/reply'

const account = '10000000-0000-4000-8000-000000000001', foreign = '10000000-0000-4000-8000-000000000002'
const brand = '20000000-0000-4000-8000-000000000001', otherBrand = '20000000-0000-4000-8000-000000000002'
const observation = '30000000-0000-4000-8000-000000000001', scanId = '40000000-0000-4000-8000-000000000001'
beforeAll(async () => {
  state.pg = await PGlite.create()
  await state.pg.exec(`
    create table clients(id uuid primary key, account_id uuid);
    create table prompt_bank(id uuid, client_id uuid, question text, category text, language text, is_active boolean);
    create table pulse_runs(id uuid, client_id uuid, account_id uuid, purpose text, manifest jsonb);
    create table pulse_run_items(id uuid, client_id uuid, account_id uuid, run_id uuid, accepted_attempt_id uuid, snapshot jsonb);
    create table pulse_item_attempts(id uuid, item_id uuid, client_id uuid, account_id uuid, raw_answer text,
      actual_model text, requested_model text, finished_at timestamptz, collector text, collector_version text,
      provider_request_id text, provider_citations jsonb, provider_finish_reason text, grounding text, search_evidence jsonb);
    create table pulse_metrics(id uuid primary key, client_id uuid, prompt_id uuid, run_item_id uuid, question text, platform text,
      scan_week date, created_at timestamptz, raw_answer text, brand_mentioned boolean, classification_status text,
      actual_model text, collected_at timestamptz, prompt_snapshot jsonb, brand_snapshot jsonb, requested_model text,
      provider_request_id text, provider_citations jsonb, provider_finish_reason text, grounding text, search_evidence jsonb,
      classifier_method text, classifier_version text, sentiment text, matched_text jsonb);
    create table scans(id uuid primary key, client_id uuid, account_id uuid, created_at timestamptz, results jsonb);
  `)
  await state.pg.query('insert into clients values($1,$2),($3,$4)', [brand, account, otherBrand, foreign])
  await state.pg.query(`insert into pulse_metrics(id,client_id,question,platform,scan_week,created_at,raw_answer,brand_mentioned,classification_status,provider_citations,grounding)
    values($1,$2,'Sourdough bakery?','chatgpt','2026-10-26','2026-10-27','Saved bakery answer',true,'classified',$3,'web'),
      (gen_random_uuid(),$4,'Foreign secret question','chatgpt','2026-10-26',now(),'FOREIGN SECRET',true,'classified','[]',null)`,
  [observation, brand, JSON.stringify([{ url: 'https://example.com/bakery', title: 'Bakery' }, { url: 'http://127.0.0.1/private' }]), otherBrand])
  const evidence = buildScanEvidence({ requestedUrl: 'https://example.com/', evaluatedUrl: 'https://example.com/',
    industry: 'bakery', region: 'HK', sitemapSource: 'none', checks: { c1_robots: { assessment: 'pass', collection: 'complete' } },
    collectedAt: '2026-10-27T00:00:00.000Z' })
  await state.pg.query('insert into scans values($1,$2,$3,$4,$5)', [scanId, brand, account, '2026-10-27', JSON.stringify({ evidence })])
  // A newer scan with a mismatched account must not mask the valid owned scan.
  await state.pg.query('insert into scans values(gen_random_uuid(),$1,$2,now(),$3)', [brand, foreign, JSON.stringify({ secret: 'FOREIGN SCAN' })])
})
afterAll(async () => { await state.pg?.close() })

it('composes an owned saved answer through real observation SQL, with no outbound HTTP', async () => {
  const outbound = vi.fn(() => { throw new Error('Outbound provider HTTP forbidden') })
  vi.stubGlobal('fetch', outbound)
  const data = await loadStudioEvidence(account, brand)
  expect(data?.observations).toHaveLength(1)
  expect(data?.observations[0]).toMatchObject({ id: observation, excerpt: 'Saved bakery answer', result: 'success',
    links: [{ url: 'https://example.com/bakery', title: 'Bakery', kind: 'provider-citation' }],
    searchEvidence: { execution: 'unknown' } })
  expect(data?.scan?.id).toBe(scanId)
  expect(data?.scan?.evidence.checks).toContainEqual({ key: 'c1_robots', collection: 'complete', assessment: 'pass' })
  expect(composeSavedReply('brief', 'brief', data!).status).toBe('evidenced')
  expect(JSON.stringify(data)).not.toMatch(/FOREIGN|raw_answer|provider_request_id/)
  expect(outbound).not.toHaveBeenCalled()
})
it('denies a foreign account even when the brand exists and has saved evidence', async () => {
  expect(await loadStudioEvidence(foreign, brand)).toBeNull()
  const data = await loadStudioEvidence(foreign, otherBrand)
  expect(data?.observations[0].excerpt).toBe('FOREIGN SECRET')
  expect(data?.scan).toBeNull()
})
it('keeps incomplete legacy classification and missing citations explicit', async () => {
  await state.pg!.query("update pulse_metrics set classification_status=null, provider_citations=null where id=$1", [observation])
  const data = await loadStudioEvidence(account, brand)
  expect(data?.observations[0]).toMatchObject({ result: 'incomplete', brandMentioned: null, links: [] })
  expect(composeSavedReply('pulse', 'pulse', data!).status).toBe('insufficient')
})
