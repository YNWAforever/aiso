import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { randomUUID } from 'node:crypto'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { createSummaryReceipt, presentSummaryReceipt } from '@/lib/n8n/schema'
import { beginSummaryDispatch, recordSummaryDispatch, beginSummaryExecution, finishSummaryExecution, readOwnedSummary } from '@/lib/n8n/store'
import { dispatchScanSummary } from '@/lib/n8n/dispatch'
import { verifyExecutionReceipt } from '../../n8n/verify-execution.mjs'

const mock = vi.hoisted(() => ({ query: vi.fn(), accountId: '' }))
vi.mock('@/lib/db', () => ({ db: () => mock.query }))
vi.mock('@/lib/auth', () => ({ getProfile: async () => mock.accountId ? { account_id: mock.accountId } : null }))
let pg: PGlite
const accountId = randomUUID(), clientId = randomUUID()
const input = { domain: 'example.test', score: 14.17, grade: 'F', results: {
  c1_robots: { status: 'fail', message: 'robots_not_found', raw: 'NEVER_SEND_RAW' },
  c2_llms_txt: { status: 'warn', message: 'llms_missing' },
  _agent_generation: { token: 'PRIVATE_NATIVE_CLAIM' },
} }
const provider = { httpStatus: 200, actualModel: 'openai/gpt-4o-mini', requestId: 'gen-offline',
  promptTokens: 90, completionTokens: 30, costUsd: null }

beforeAll(async () => {
  // In-memory PostgreSQL only: no environment file, network, real auth or DB client.
  pg = new PGlite()
  await pg.exec('create table scans(id uuid primary key,account_id uuid,client_id uuid,domain text,score numeric,grade text,results jsonb,agent_status text)')
  mock.query.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.reduce((text, part, i) => text + part + (i < values.length ? `$${i + 1}` : ''), '')
    return (await pg.query(query, values)).rows
  })
})
afterAll(async () => { await pg?.close() })
beforeEach(async () => { await pg.exec('truncate scans'); mock.accountId = accountId })

async function fixture(anonymous = false) {
  const { token, receipt } = createSummaryReceipt(input)
  const scope = { scanId: randomUUID(), accountId: anonymous ? null : accountId, clientId: anonymous ? null : clientId }
  await pg.query('insert into scans values($1,$2,$3,$4,$5,$6,$7,$8)', [
    scope.scanId, scope.accountId, scope.clientId, input.domain, input.score, input.grade,
    JSON.stringify({ ...input.results, _n8n: receipt }), 'complete',
  ])
  const identity = { ...scope, dispatchId: receipt.id, executionId: '123', workflowId: 'workflow_offline' }
  return { scope, token, receipt, identity }
}
async function stored(id: string) {
  return (await pg.query<{ results: Record<string, unknown>; agent_status: string }>('select results,agent_status from scans where id=$1', [id])).rows[0]!
}
async function runWorkflow(payload: unknown, providerStatus = 200, executionId = '123') {
  const workflow = JSON.parse(readFileSync(new URL('../../n8n/aiso-scan-webhook.json', import.meta.url), 'utf8'))
  const named: Record<string, unknown> = {}, runData: Record<string, unknown> = {}
  let current: unknown = { body: payload }, ack: Response | undefined, providerCalls = 0, status = 'success', failure: string | undefined
  const evaluate = (source: string, code = false) => new Function('$input', '$', '$json', '$vars', '$execution', '$workflow',
    code ? source : 'return (' + source.replace(/^=\{\{\s*/, '').replace(/\s*\}\}$/, '') + ')')(
    { first: () => ({ json: current }) }, (name: string) => ({ first: () => ({ json: named[name] }) }),
    current, { AISO_APP_ORIGIN: 'https://app.example.test' }, { id: executionId }, { id: 'workflow_offline' })
  try {
    for (const node of workflow.nodes) {
      if (node.type === 'n8n-nodes-base.code') {
        const result = evaluate(node.parameters.jsCode, true)
        if (!result.length) break
        current = result[0].json
      } else if (node.id === 'node-claim' || node.id === 'node-complete') {
        const url = evaluate(node.parameters.url)
        expect(url).toMatch(/^https:\/\/app\.example\.test\/api\/scans\/[a-f0-9-]+\/n8n$/)
        const authorization = evaluate(node.parameters.headerParameters.parameters[0].value)
        const { POST } = await import('@/app/api/scans/[id]/n8n/route')
        const response = await POST(new Request(url, { method: 'POST', headers: { authorization },
          body: evaluate(node.parameters.jsonBody) }), { params: Promise.resolve({ id: url.split('/')[5] }) })
        current = await response.json()
        if (!response.ok) throw new Error('CALLBACK_REFUSED_' + response.status)
      } else if (node.id === 'node-respond-ok') {
        ack = Response.json(evaluate(node.parameters.responseBody), { status: node.parameters.options.responseCode })
      } else if (node.id === 'node-ai-summary') {
        providerCalls++
        const request = JSON.parse(evaluate(node.parameters.jsonBody))
        expect(request.max_tokens).toBe(400)
        expect(JSON.stringify(request)).not.toMatch(/NEVER_SEND_RAW|PRIVATE_NATIVE_CLAIM/)
        current = { statusCode: providerStatus, body: { id: 'gen-offline', model: 'openai/gpt-4o-mini',
          choices: [{ finish_reason: 'stop', message: { content: '• Review c1_robots against its saved evidence.\n• Review c2_llms_txt against its saved evidence.\n• Confirm the proposed changes before publishing.' } }],
          usage: { prompt_tokens: 90, completion_tokens: 30 } } }
      }
      named[node.name] = current
      runData[node.name] = [{ data: { main: [[{ json: current }]] } }]
    }
  } catch (error) { status = 'error'; failure = error instanceof Error ? error.message : 'UNKNOWN' }
  return { ack, providerCalls, failure, execution: { id: executionId, workflowId: 'workflow_offline', status,
    startedAt: new Date(Date.now() - 1000).toISOString(), stoppedAt: new Date().toISOString(),
    data: { resultData: { runData } } } }
}

describe('n8n persisted execution receipts (offline PostgreSQL)', () => {
  it('retains only bounded check facts; client projection never reveals capability material', async () => {
    const f = await fixture()
    expect(JSON.stringify(f.receipt)).not.toContain(f.token)
    expect(JSON.stringify(f.receipt)).not.toContain('NEVER_SEND_RAW')
    expect(JSON.stringify(f.receipt)).not.toContain('PRIVATE_NATIVE_CLAIM')
    const view = presentSummaryReceipt(f.receipt)
    expect(JSON.stringify(view)).not.toContain('tokenHash')
    expect(view).toMatchObject({ state: 'queued', executionVerified: false })
    expect(await readOwnedSummary({ scanId: f.scope.scanId, accountId: randomUUID() })).toBeNull()
  })
  it('claims dispatch once and refuses a second send', async () => {
    const f = await fixture()
    expect(await beginSummaryDispatch(f.scope, f.token)).toBe(true)
    expect(await beginSummaryDispatch(f.scope, f.token)).toBe(false)
  })
  it.each(['account', 'client', 'token', 'dispatch'])('rejects forged %s identity before any provider permission', async kind => {
    const f = await fixture()
    const identity = { ...f.identity, ...(kind === 'account' ? { accountId: randomUUID() } : {}),
      ...(kind === 'client' ? { clientId: randomUUID() } : {}),
      ...(kind === 'dispatch' ? { dispatchId: randomUUID() } : {}) }
    const result = await beginSummaryExecution(identity, kind === 'token' ? '0'.repeat(64) : f.token)
    expect(result.status).toBe(404)
    expect((await stored(f.scope.scanId)).results._n8n).toEqual(f.receipt)
  })
  it('allows exactly one execution to cross the provider boundary under concurrent duplicate deliveries', async () => {
    const f = await fixture()
    const attempts = await Promise.all([
      beginSummaryExecution(f.identity, f.token),
      beginSummaryExecution({ ...f.identity, executionId: 'other' }, f.token),
    ])
    expect(attempts.filter(r => r.mayProcess)).toHaveLength(1)
    expect(attempts.map(r => r.status).sort()).toEqual([200, 409])
    const repeated = await beginSummaryExecution(f.identity, f.token)
    expect(repeated.mayProcess).toBe(false)
  })
  it('returns the frozen canonical facts instead of trusting webhook-supplied results', async () => {
    const f = await fixture()
    const start = await beginSummaryExecution(f.identity, f.token)
    expect(start.input).toMatchObject({ domain: input.domain, score: 14.17, grade: 'F' })
    expect(JSON.stringify(start.input)).not.toMatch(/NEVER_SEND_RAW|PRIVATE_NATIVE_CLAIM|tokenHash/)
    expect(start.input?.checks).toHaveLength(2)
  })
  it('saves summary, source hash and execution identity atomically; never changes native Improve completion', async () => {
    const f = await fixture()
    await beginSummaryExecution(f.identity, f.token)
    const result = await finishSummaryExecution(f.identity, f.token, { phase: 'succeeded', summary: '• Review the recorded robots policy.', provider })
    expect(result.status).toBe(200)
    const row = await stored(f.scope.scanId)
    expect(row.agent_status).toBe('complete')
    expect(row.results._agent_generation).toEqual(input.results._agent_generation)
    const view = await readOwnedSummary({ scanId: f.scope.scanId, accountId })
    expect(view).toMatchObject({ state: 'succeeded', executionId: '123', workflowId: 'workflow_offline',
      executionVerified: false, summary: { text: '• Review the recorded robots policy.', provider } })
  })
  it('makes identical completion idempotent and rejects conflicting replay content', async () => {
    const f = await fixture()
    await beginSummaryExecution(f.identity, f.token)
    const completion = { phase: 'succeeded' as const, summary: 'Recorded evidence review draft.', provider }
    expect((await finishSummaryExecution(f.identity, f.token, completion)).status).toBe(200)
    const before = await stored(f.scope.scanId)
    expect((await finishSummaryExecution(f.identity, f.token, completion)).status).toBe(200)
    expect((await finishSummaryExecution(f.identity, f.token, { ...completion, summary: 'Changed content is not the same callback.' })).status).toBe(409)
    expect(await stored(f.scope.scanId)).toEqual(before)
  })
  it('cannot complete before a valid claim or with a different execution identity', async () => {
    const f = await fixture()
    const completion = { phase: 'succeeded' as const, summary: 'Evidence based summary.', provider }
    expect((await finishSummaryExecution(f.identity, f.token, completion)).status).toBe(409)
    await beginSummaryExecution(f.identity, f.token)
    expect((await finishSummaryExecution({ ...f.identity, executionId: 'foreign' }, f.token, completion)).status).toBe(409)
    expect((await readOwnedSummary({ scanId: f.scope.scanId, accountId }))?.state).toBe('running')
  })
  it('retains provider failure explicitly and rejects false success later', async () => {
    const f = await fixture()
    await beginSummaryExecution(f.identity, f.token)
    expect((await finishSummaryExecution(f.identity, f.token, { phase: 'failed', error: 'PROVIDER_FAILED' })).status).toBe(200)
    expect((await finishSummaryExecution(f.identity, f.token, { phase: 'succeeded', summary: 'A later invented success.', provider })).status).toBe(409)
    expect(await readOwnedSummary({ scanId: f.scope.scanId, accountId })).toMatchObject({ state: 'failed', error: 'PROVIDER_FAILED' })
  })
  it('retains late authenticated completion after a lost acknowledgement; dispatch cannot overwrite it', async () => {
    const f = await fixture()
    await beginSummaryDispatch(f.scope, f.token)
    await recordSummaryDispatch(f.scope, f.token, { state: 'outcome_unknown', httpStatus: null })
    await beginSummaryExecution(f.identity, f.token)
    await finishSummaryExecution(f.identity, f.token, { phase: 'succeeded', summary: 'Completion after an acknowledgement timeout.', provider })
    await recordSummaryDispatch(f.scope, f.token, { state: 'accepted', httpStatus: 202 })
    expect(await readOwnedSummary({ scanId: f.scope.scanId, accountId })).toMatchObject({ state: 'succeeded' })
  })
  it('supports an anonymous scan capability without granting an authenticated tenant read', async () => {
    const f = await fixture(true)
    expect((await beginSummaryExecution(f.identity, f.token)).mayProcess).toBe(true)
    expect(await readOwnedSummary({ scanId: f.scope.scanId, accountId })).toBeNull()
  })
  it('reports an expired pending execution as unknown without making another write or collection', async () => {
    const f = await fixture()
    const old = { ...f.receipt, expiresAt: new Date(Date.now() - 1000).toISOString() }
    await pg.query("update scans set results=jsonb_set(results,'{_n8n}',$1::jsonb) where id=$2", [JSON.stringify(old), f.scope.scanId])
    expect((await beginSummaryExecution(f.identity, f.token)).status).toBe(409)
    const before = await stored(f.scope.scanId)
    expect(await readOwnedSummary({ scanId: f.scope.scanId, accountId })).toMatchObject({ state: 'outcome_unknown' })
    expect(await stored(f.scope.scanId)).toEqual(before)
  })
  it.each(['running', 'succeeded'])('an expired capability cannot finish or read back a %s execution', async state => {
    const f = await fixture()
    await beginSummaryExecution(f.identity, f.token)
    const completion = { phase: 'succeeded' as const, summary: 'A retained source-grounded summary.', provider }
    if (state === 'succeeded') await finishSummaryExecution(f.identity, f.token, completion)
    await pg.query("update scans set results=jsonb_set(results,'{_n8n,expiresAt}',to_jsonb($1::text)) where id=$2",
      [new Date(Date.now() - 1000).toISOString(), f.scope.scanId])
    const before = await stored(f.scope.scanId)
    const finish = await finishSummaryExecution(f.identity, f.token, completion)
    expect(finish.status).toBe(409)
    expect(finish).not.toHaveProperty('receipt')
    const restarted = await beginSummaryExecution(f.identity, f.token)
    expect(restarted.status).toBe(409)
    expect(restarted.mayProcess).toBe(false)
    expect(restarted).not.toHaveProperty('receipt')
    expect(await stored(f.scope.scanId)).toEqual(before)
    expect(await readOwnedSummary({ scanId: f.scope.scanId, accountId })).toMatchObject({
      state: state === 'running' ? 'outcome_unknown' : 'succeeded',
    })
  })
  it('a lost database write never reports persisted completion', async () => {
    const f = await fixture()
    await beginSummaryExecution(f.identity, f.token)
    mock.query.mockRejectedValueOnce(new Error('offline injected storage failure'))
    await expect(finishSummaryExecution(f.identity, f.token, { phase: 'succeeded', summary: 'Must not be acknowledged over a failed write.', provider })).rejects.toThrow()
    expect(await readOwnedSummary({ scanId: f.scope.scanId, accountId })).toMatchObject({ state: 'running' })
  })
  it('validates, saves and reads the complete callback through actual route handlers', async () => {
    const f = await fixture()
    const { GET, POST } = await import('@/app/api/scans/[id]/n8n/route')
    const context = { params: Promise.resolve({ id: f.scope.scanId }) }
    const request = (body: unknown, token = f.token) => new Request('https://app.example.test/api/receipt', {
      method: 'POST', headers: { authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const start = await POST(request({ ...f.identity, phase: 'start' }), context)
    expect(start.status).toBe(200)
    expect((await start.json()).mayProcess).toBe(true)
    const done = await POST(request({ ...f.identity, phase: 'succeeded', summary: 'Three saved source-grounded review suggestions.', provider }), context)
    expect(done.status).toBe(200)
    const owner = await GET(new Request('https://app.example.test/api/receipt'), context)
    expect(owner.status).toBe(200)
    expect(owner.headers.get('cache-control')).toBe('no-store')
    const body = await owner.text()
    expect(body).toContain('"state":"succeeded"')
    expect(body).not.toMatch(/tokenHash|PRIVATE_NATIVE_CLAIM/)
    expect(body).not.toContain(f.token)
    mock.accountId = randomUUID()
    expect((await GET(new Request('https://app.example.test/api/receipt'), context)).status).toBe(404)
    mock.accountId = ''
    expect((await GET(new Request('https://app.example.test/api/receipt'), context)).status).toBe(401)
  })
  it.each(['invalid-token', 'malformed', 'oversize', 'bad-provider', 'unknown-phase'])('rejects %s callback data without changing the stored scan', async kind => {
    const f = await fixture()
    const { POST } = await import('@/app/api/scans/[id]/n8n/route')
    const before = await stored(f.scope.scanId)
    const body = kind === 'malformed' ? '{' : JSON.stringify({ ...f.identity, phase: kind === 'unknown-phase' ? 'invented' : 'succeeded',
      summary: kind === 'oversize' ? 'x'.repeat(17_000) : 'A summary that must not be saved.',
      provider: { ...provider, httpStatus: 503 } })
    const response = await POST(new Request('https://app.example.test/api/receipt', { method: 'POST', body,
      headers: { authorization: 'Bearer ' + (kind === 'invalid-token' ? 'bad' : f.token) } }),
      { params: Promise.resolve({ id: f.scope.scanId }) })
    expect(response.status).toBe(kind === 'invalid-token' ? 401 : kind === 'oversize' ? 413 : 400)
    expect(await stored(f.scope.scanId)).toEqual(before)
  })
  it('returns 503 over a failed completion write instead of a success response', async () => {
    const f = await fixture()
    await beginSummaryExecution(f.identity, f.token)
    const { POST } = await import('@/app/api/scans/[id]/n8n/route')
    mock.query.mockRejectedValueOnce(new Error('private connection details'))
    const response = await POST(new Request('https://app.example.test/api/receipt', {
      method: 'POST', headers: { authorization: 'Bearer ' + f.token },
      body: JSON.stringify({ ...f.identity, phase: 'succeeded', summary: 'Unacknowledged failed write must remain running.', provider }),
    }), { params: Promise.resolve({ id: f.scope.scanId }) })
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('private connection')
    expect(await readOwnedSummary({ scanId: f.scope.scanId, accountId })).toMatchObject({ state: 'running' })
  })
  it.each([200, 503])('runs the actual exported workflow through local routes and PostgreSQL with provider HTTP %s', async providerStatus => {
    const f = await fixture()
    let execution: Awaited<ReturnType<typeof runWorkflow>> | undefined
    await dispatchScanSummary(f.scope, f.token, f.receipt, 'https://n8n.example.test/webhook/scan', async (_url, init) => {
      execution = await runWorkflow(JSON.parse(init!.body as string), providerStatus)
      if (!execution.ack) throw new Error('No acknowledgement')
      return execution.ack
    })
    expect(execution?.providerCalls, execution?.failure).toBe(1)
    const receipt = await readOwnedSummary({ scanId: f.scope.scanId, accountId })
    expect(receipt?.state).toBe(providerStatus === 200 ? 'succeeded' : 'failed')
    const saved = { scanId: f.scope.scanId, receipt }
    const verified = verifyExecutionReceipt(saved, execution!.execution)
    expect(verified.verified).toBe(true)
    expect(execution!.execution.status).toBe(providerStatus === 200 ? 'success' : 'error')
    const duplicate = await runWorkflow({ version: 1, ...f.scope, dispatchId: f.receipt.id, token: f.token }, providerStatus, 'duplicate')
    expect(duplicate.providerCalls).toBe(0)
    expect(await readOwnedSummary({ scanId: f.scope.scanId, accountId })).toEqual(receipt)
    expect((await stored(f.scope.scanId)).agent_status).toBe('complete')
    if (providerStatus === 200) {
      mkdirSync('artifacts/n8n-receipts', { recursive: true })
      writeFileSync('artifacts/n8n-receipts/OFFLINE-EXECUTION-RECEIPT.json', JSON.stringify({
        mode: 'OFFLINE_SIMULATION_NOT_A_LIVE_N8N_RECEIPT', networkCalls: 0, paidCalls: 0, saved, verified,
      }, null, 2))
    }
  })
})
