import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { buildScanEvidence } from '@/lib/scan-evidence'
import { generateImprove } from '@/lib/agents/generate'

const h = vi.hoisted(() => ({ sql: vi.fn(), model: vi.fn(), allowance: vi.fn(), profile: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ db: () => h.sql }))
vi.mock('@/lib/openrouter', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/openrouter')>()), callOpenRouter: h.model }))
vi.mock('@/lib/fix/guard', () => ({ consumeAiToolAllowance: h.allowance }))
vi.mock('@/lib/auth', () => ({ getProfile: h.profile }))

const accountId = '00000000-0000-4000-8000-000000000001'
const clientId = '00000000-0000-4000-8000-000000000002'
const scanId = '00000000-0000-4000-8000-000000000003'
const foreign = '00000000-0000-4000-8000-000000000004'
const scope = { accountId, clientId, scanId }
let pg: PGlite
const evidence = buildScanEvidence({
  requestedUrl: 'https://example.com', evaluatedUrl: 'https://example.com', industry: 'technology', region: 'HK', sitemapSource: 'fetched',
  checks: { c2_llms_txt: { assessment: 'fail', collection: 'complete' }, c3_bot_access: { assessment: 'fail', collection: 'blocked' } },
  observations: [{ check: 'page', collection: 'complete', httpStatus: 200, target: { origin: 'https://example.com' } }],
  collectedAt: '2026-10-14T00:00:00.000Z',
})
const good = JSON.stringify({ recommendations: [{ checkId: 'c2_llms_txt', text: 'Review the llms.txt access evidence and prepare a draft for human review.' }] })

beforeAll(async () => {
  pg = new PGlite()
  await pg.exec(`
    create table accounts(id uuid primary key, plan text, status text, stripe_subscription_id text, trial_ends_at timestamptz, override_plan text, override_expires_at timestamptz);
    create table clients(id uuid primary key, account_id uuid, webhook_url text);
    create table scans(id uuid primary key, client_id uuid, account_id uuid, results jsonb, agent_status text, agent_platforms text[], created_at timestamptz default now());
    create table agent_recommendations(id uuid default gen_random_uuid(), scan_id uuid, platform text, category text, priority text, recommendation text, impact_score smallint, unique(scan_id,platform,category));
    create table agent_progress(id uuid default gen_random_uuid(), scan_id uuid, platform text, metric text, current_value numeric, previous_value numeric, delta numeric, unique(scan_id,platform,metric));
    create table agent_competitors(id uuid default gen_random_uuid(), scan_id uuid, platform text, competitor_domain text, mention_rate numeric, your_rate numeric, gap_analysis text, unique(scan_id,platform,competitor_domain));
    create table pulse_runs(id uuid primary key, client_id uuid, account_id uuid, purpose text);
    create table pulse_run_items(id uuid primary key, run_id uuid, client_id uuid, account_id uuid);
    create table pulse_metrics(id uuid default gen_random_uuid(), client_id uuid, run_item_id uuid, platform text, scan_week date, raw_answer text, classification_status text, brand_mentioned boolean);
  `)
})
afterAll(async () => { await pg.close() })
beforeEach(async () => {
  vi.clearAllMocks()
  await pg.exec('truncate accounts,clients,scans,agent_recommendations,agent_progress,agent_competitors,pulse_metrics,pulse_runs,pulse_run_items')
  await pg.query("insert into accounts(id,plan,status,stripe_subscription_id) values($1,'pro','active','sub_fixture')", [accountId])
  await pg.query('insert into clients(id,account_id) values($1,$2)', [clientId, accountId])
  await pg.query("insert into scans(id,client_id,account_id,results,agent_status) values($1,$2,$3,$4,'pending')", [scanId,clientId,accountId,JSON.stringify({ evidence })])
  h.sql.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => (await pg.query(strings.reduce((s, part, index) => s + (index ? '$' + index : '') + part, ''), values)).rows)
  h.model.mockImplementation(async options => {
    options.onEvidence?.({ actualModel: 'actual-fixture-model', requestId: 'request-fixture', promptTokens: 81, completionTokens: 42, costUsd: 0.0001, httpStatus: 200 })
    return good
  })
  h.allowance.mockResolvedValue(null)
  h.profile.mockResolvedValue({ account_id: accountId, accounts: { plan: 'pro', status: 'active', stripe_subscription_id: 'sub_fixture' } })
})

describe('native Improve on local PostgreSQL', () => {
  it('generates grounded drafts for the retained scan with explicit unavailable evidence receipts', async () => {
    const result = await generateImprove(scope)
    expect(result.state).toBe('complete')
    expect(result.generation?.outcomes).toEqual({ recommendations: 'available', progress: 'unavailable', competitors: 'not-required' })
    expect(result.generation?.provider).toMatchObject({ actualModel: 'actual-fixture-model', requestId: 'request-fixture', promptTokens: 81, completionTokens: 42, costUsd: 0.0001 })
    expect(result.generation?.recommendationBasis).toMatchObject([{ checkId: 'c2_llms_txt', assessment: 'fail', source: { scanId, checkId: 'c2_llms_txt' } }])
    expect(result.generation?.recommendationBasis?.[0].limitations).toContain('no-page-or-provider-excerpts')
    const recommendations = await pg.query<{ category: string; recommendation: string }>('select category,recommendation from agent_recommendations')
    expect(recommendations.rows).toEqual([{ category: 'c2_llms_txt', recommendation: 'Review the llms.txt access evidence and prepare a draft for human review.' }])
    const row = (await pg.query<{ results: Record<string, unknown>; agent_status: string }>('select results,agent_status from scans')).rows[0]!
    expect(row.agent_status).toBe('complete'); expect(row.results.evidence).toEqual(evidence)
    expect(h.model).toHaveBeenCalledTimes(1)
    expect(h.model.mock.calls[0]![0]).toMatchObject({ maxTokens: 1200, label: 'improve.recommendations' })
    expect(JSON.stringify(h.model.mock.calls[0]![0])).not.toContain('c3_bot_access')
  })
  it('returns the saved receipt without spending twice', async () => {
    const first = await generateImprove(scope), second = await generateImprove(scope)
    expect(second.generation?.token).toBe(first.generation?.token)
    expect(second.state).toBe('complete'); expect(h.model).toHaveBeenCalledTimes(1); expect(h.allowance).toHaveBeenCalledTimes(1)
  })
  it('a simultaneous request cannot start another provider call', async () => {
    let finish!: (s: string) => void
    h.model.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const first = generateImprove(scope)
    await vi.waitFor(() => expect(h.model).toHaveBeenCalledTimes(1))
    const second = await generateImprove(scope)
    expect(second.state).toBe('running'); expect(h.model).toHaveBeenCalledTimes(1)
    finish(good); expect((await first).state).toBe('complete')
  })
  it('does not restart an expired lease after a provider request may have started', async () => {
    await pg.query("update scans set agent_status='running',results=results||jsonb_build_object('_agent_generation',$1::jsonb)", [JSON.stringify({ version: 1, producer: 'native-improve.v1', state: 'running', token: 'previous', providerStarted: true, leaseUntil: '2020-01-01T00:00:00Z' })])
    const result = await generateImprove(scope)
    expect(result.state).toBe('error'); expect(result.error).toBe('GENERATION_OUTCOME_UNKNOWN')
    expect((await pg.query<{agent_status:string}>('select agent_status from scans')).rows[0]!.agent_status).toBe('error')
    expect(h.model).not.toHaveBeenCalled(); expect(h.allowance).not.toHaveBeenCalled()
  })
  it('does not write when a worker loses its persisted generation token', async () => {
    let finish!: (s: string) => void
    h.model.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const pending = generateImprove(scope)
    await vi.waitFor(() => expect(h.model).toHaveBeenCalledTimes(1))
    await pg.exec("update scans set results=jsonb_set(results,'{_agent_generation,token}','\"new-owner\"'::jsonb)")
    finish(good)
    expect((await pending).error).toBe('GENERATION_CLAIM_LOST')
    expect((await pg.query('select * from agent_recommendations')).rows).toEqual([])
    expect((await pg.query<{token:string}>("select results#>>'{_agent_generation,token}' as token from scans")).rows[0]!.token).toBe('new-owner')
  })
  it('an uncertain provider request is retained as an error and never automatically charged twice', async () => {
    h.model.mockRejectedValue(new Error('network response lost'))
    expect((await generateImprove(scope)).state).toBe('error')
    expect((await generateImprove(scope)).state).toBe('error')
    expect(h.model).toHaveBeenCalledTimes(1)
  })
  it('a pre-provider allowance refusal can safely be retried', async () => {
    h.allowance.mockResolvedValueOnce(Response.json({error:'AI_TOOL_LIMIT_REACHED'},{status:429}))
    expect((await generateImprove(scope)).status).toBe(429)
    expect(h.model).not.toHaveBeenCalled()
    expect((await generateImprove(scope)).state).toBe('complete')
    expect(h.model).toHaveBeenCalledTimes(1)
  })
  it('an expired lease cannot cross the provider boundary even without a second observer', async () => {
    h.allowance.mockImplementationOnce(async () => {
      await pg.exec("update scans set results=jsonb_set(results,'{_agent_generation,leaseUntil}','\"2020-01-01T00:00:00Z\"'::jsonb)")
      return null
    })
    expect((await generateImprove(scope)).state).toBe('error')
    expect(h.model).not.toHaveBeenCalled()
  })
  it('an expired worker cannot commit after the provider answers even without another observer', async () => {
    h.model.mockImplementationOnce(async () => {
      await pg.exec("update scans set results=jsonb_set(results,'{_agent_generation,leaseUntil}','\"2020-01-01T00:00:00Z\"'::jsonb)")
      return good
    })
    expect((await generateImprove(scope)).state).toBe('error')
    expect((await pg.query('select * from agent_recommendations')).rows).toEqual([])
  })
  it('changed source evidence cannot cross the provider boundary', async () => {
    h.allowance.mockImplementationOnce(async () => {
      await pg.exec("update scans set results=jsonb_set(results,'{evidence}','{}'::jsonb)")
      return null
    })
    expect((await generateImprove(scope)).state).toBe('error')
    expect(h.model).not.toHaveBeenCalled()
  })
  it('changed source evidence during the model request cannot receive old recommendations', async () => {
    h.model.mockImplementationOnce(async () => {
      await pg.exec("update scans set results=jsonb_set(results,'{evidence}','{}'::jsonb)")
      return good
    })
    expect((await generateImprove(scope)).state).toBe('error')
    expect((await pg.query('select * from agent_recommendations')).rows).toEqual([])
    expect((await pg.query<{evidence:unknown}>("select results->'evidence' as evidence from scans")).rows[0]!.evidence).toEqual({})
  })
  it('a cancellation while allowance is checked cannot start the provider', async () => {
    h.allowance.mockImplementationOnce(async () => { await pg.exec("update accounts set status='cancelled'"); return null })
    expect((await generateImprove(scope)).state).toBe('error')
    expect(h.model).not.toHaveBeenCalled()
  })
  it('a downgrade during the model request cannot publish old-plan outputs', async () => {
    h.model.mockImplementationOnce(async () => { await pg.exec("update accounts set plan='basic'"); return good })
    expect((await generateImprove(scope)).state).toBe('error')
    expect((await pg.query('select * from agent_recommendations')).rows).toEqual([])
  })
  it.each(['free', 'cancelled', 'expired-trial'])('refuses %s before allowance or provider spend', async kind => {
    if (kind === 'free') await pg.exec("update accounts set plan='free'")
    if (kind === 'cancelled') await pg.exec("update accounts set status='cancelled'")
    if (kind === 'expired-trial') await pg.exec("update accounts set status='trialing',stripe_subscription_id=null,trial_ends_at='2020-01-01'")
    expect((await generateImprove(scope)).status).toBe(403)
    expect(h.allowance).not.toHaveBeenCalled(); expect(h.model).not.toHaveBeenCalled()
  })
  it('does not reveal or write a foreign client/scan', async () => {
    expect((await generateImprove({ ...scope, accountId: foreign })).status).toBe(404)
    expect(h.allowance).not.toHaveBeenCalled(); expect(h.model).not.toHaveBeenCalled()
    expect((await pg.query('select * from agent_recommendations')).rows).toEqual([])
  })
  it('does not start native generation alongside a configured webhook producer', async () => {
    await pg.exec("update clients set webhook_url='https://external.example/webhook'")
    expect((await generateImprove(scope)).status).toBe(409)
    expect(h.model).not.toHaveBeenCalled()
  })
  it('rejects a recommendation referring to an unmeasured check without persisting suggestions', async () => {
    h.model.mockResolvedValue(JSON.stringify({ recommendations: [{ checkId: 'c3_bot_access', text: 'Open all bots now.' }] }))
    const result = await generateImprove(scope)
    expect(result.state).toBe('error'); expect(result.error).toBe('INVALID_GENERATED_RECOMMENDATIONS')
    expect((await pg.query('select * from agent_recommendations')).rows).toEqual([])
  })
  it('retains measured rates only for classified nonblank canonical observations', async () => {
    await pg.exec(`insert into pulse_runs(id,client_id,account_id,purpose) values('${foreign}','${clientId}','${accountId}','probe');
      insert into pulse_run_items(id,run_id,client_id,account_id) values('${foreign}','${foreign}','${clientId}','${accountId}');
      insert into pulse_metrics(client_id,run_item_id,platform,scan_week,raw_answer,classification_status,brand_mentioned)
        values('${clientId}','${foreign}','gemini','2026-10-12','Probe answer','classified',true)`)
    await pg.exec(`insert into pulse_metrics(client_id,platform,scan_week,raw_answer,classification_status,brand_mentioned) values
      ('${clientId}','gemini','2026-10-12','Answer one','classified',true),
      ('${clientId}','gemini','2026-10-12','Answer two','classified',false),
      ('${clientId}','gemini','2026-10-12','Not classified','unknown',true),
      ('${clientId}','gemini','2026-10-12','   ','classified',true),
      ('${clientId}','off-plan','2026-10-12','Answer','classified',true)`)
    const result = await generateImprove(scope)
    expect(result.generation?.outcomes.progress).toBe('available')
    const metrics = await pg.query<{platform:string;current_value:string;previous_value:string|null;delta:string|null}>('select platform,current_value,previous_value,delta from agent_progress')
    expect(metrics.rows.map(r => ({ ...r, current_value: Number(r.current_value) }))).toEqual([{ platform: 'gemini', current_value: 50, previous_value: null, delta: null }])
    expect((await pg.query('select * from agent_competitors')).rows).toEqual([])
  })
  it('includes entitled Pulse runtime variants without admitting an off-plan platform', async () => {
    await pg.exec(`insert into pulse_metrics(client_id,platform,scan_week,raw_answer,classification_status,brand_mentioned) values
      ('${clientId}','gemini-flash','2026-10-12','Retained Google answer','classified',true),
      ('${clientId}','perplexity-sonar-pro','2026-10-12','Retained Sonar Pro answer','classified',false),
      ('${clientId}','unentitled-model','2026-10-12','Unentitled answer','classified',true)`)
    const result = await generateImprove(scope)
    expect(result.state).toBe('complete')
    expect((await pg.query<{platform:string;current_value:string}>('select platform,current_value from agent_progress order by platform')).rows.map(r=>({...r,current_value:Number(r.current_value)})))
      .toEqual([{platform:'gemini-flash',current_value:100},{platform:'perplexity-sonar-pro',current_value:0}])
  })
  it('completes an Enterprise generation with an honest unavailable competitor section instead of synthetic scores', async () => {
    await pg.exec("update accounts set plan='enterprise'")
    const result = await generateImprove(scope)
    expect(result.state).toBe('complete')
    expect(result.generation?.outcomes.competitors).toBe('unavailable')
    expect(result.generation?.reasons.competitors).toBe('no-sourced-competitor-evidence')
    expect((await pg.query('select * from agent_competitors')).rows).toEqual([])
  })
  it('does not present an older measured week when the newest canonical observations are unclassified', async () => {
    await pg.exec(`insert into pulse_metrics(client_id,platform,scan_week,raw_answer,classification_status,brand_mentioned) values
      ('${clientId}','gemini','2026-10-05','Older measured answer','classified',true),
      ('${clientId}','gemini','2026-10-12','New answer awaiting classification','unknown',null)`)
    const result = await generateImprove(scope)
    expect(result.generation?.outcomes.progress).toBe('unavailable')
    expect((await pg.query('select * from agent_progress')).rows).toEqual([])
  })
  it('rolls back all outputs and refuses success when the fenced commit fails', async () => {
    await pg.exec("alter table agent_recommendations add constraint reject_fixture check (recommendation='reject-all')")
    try {
      const result = await generateImprove(scope)
      expect(result.state).toBe('error'); expect(result.status).toBe(503)
      expect((await pg.query('select * from agent_recommendations')).rows).toEqual([])
      expect((await pg.query<{agent_status:string}>('select agent_status from scans')).rows[0]!.agent_status).not.toBe('complete')
    } finally { await pg.exec('alter table agent_recommendations drop constraint reject_fixture') }
  })
  it('an absent actionable evidence envelope produces no paid call and an explicit receipt', async () => {
    await pg.exec("update scans set results='{}'")
    const result = await generateImprove(scope)
    expect(result.state).toBe('complete'); expect(result.generation?.outcomes.recommendations).toBe('unavailable')
    expect(h.allowance).not.toHaveBeenCalled(); expect(h.model).not.toHaveBeenCalled()
  })
})

describe('authenticated Improve route', () => {
  it('denies anonymous access without database or provider work', async () => {
    h.profile.mockResolvedValue(null)
    const { POST } = await import('@/app/api/clients/[clientId]/agents/generate/route')
    const response = await POST(new Request('https://app.example/generate', { method:'POST', body:JSON.stringify({scanId}) }), { params:Promise.resolve({clientId}) })
    expect(response.status).toBe(401); expect(h.sql).not.toHaveBeenCalled(); expect(h.model).not.toHaveBeenCalled()
  })
  it('uses the session tenant and returns the saved native generation contract', async () => {
    const { POST } = await import('@/app/api/clients/[clientId]/agents/generate/route')
    const response = await POST(new Request('https://app.example/generate', { method:'POST', body:JSON.stringify({scanId,accountId:foreign}) }), { params:Promise.resolve({clientId}) })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({state:'complete',scanId,generation:{producer:'native-improve.v1'}})
  })
})
