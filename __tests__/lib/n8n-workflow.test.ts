import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { validateDispatch, summaryRequest, completionFromProvider, confirmSaved, buildScanWorkflow } from '../../n8n/build-scan-workflow.mjs'
import { verifyExecutionReceipt } from '../../n8n/verify-execution.mjs'
import { prepareScanWorkflow } from '../../n8n/prepare-scan-workflow.mjs'
import { createSummaryReceipt, parseExecutionIdentity, parseSummaryCompletion } from '@/lib/n8n/schema'

const scanId = '7d7948df-84d1-4891-a77a-21a46b602bea'
const payload = { version: 1, scanId, accountId: null, clientId: null,
  dispatchId: 'd030c4ed-b850-4e76-bdf9-56550ea1525b', token: 'a'.repeat(64) }
const context = validateDispatch(payload, 'https://app.example.test', '123', 'wf')
const providerResponse = { statusCode: 200, body: { id: 'gen-test', model: 'test-model',
  choices: [{ message: { content: '• Review the supplied saved check evidence.' }, finish_reason: 'stop' }] } }

describe('n8n workflow boundaries', () => {
  it('reproduces the checked-in export in the actual Node runtime without Vite rewriting embedded functions', () => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e',
      'import {buildScanWorkflow} from "./n8n/build-scan-workflow.mjs";process.stdout.write(JSON.stringify(buildScanWorkflow()))'],
    { cwd: process.cwd(), encoding: 'utf8' })
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual(JSON.parse(readFileSync(new URL('../../n8n/aiso-scan-webhook.json', import.meta.url), 'utf8')))
  })
  it('derives callback origin from operator configuration, never from webhook payload', () => {
    const result = validateDispatch({ ...payload, callbackUrl: 'http://127.0.0.1/private', score: 999,
      results: { injected: 'instructions' } }, 'https://app.example.test', '123', 'wf')
    expect(result.callbackUrl).toBe('https://app.example.test/api/scans/' + scanId + '/n8n')
    expect(result).not.toHaveProperty('results')
    expect(result.identity).not.toHaveProperty('score')
  })
  it.each(['http://localhost', 'https://app.example.test/path', 'https://app.example.test/?secret=a', 'https://a:b@app.example.test'])('refuses unsafe configured callback origin %s', origin => {
    expect(() => validateDispatch(payload, origin, '123', 'wf')).toThrow()
  })
  it('requires the claim before provider work and acknowledgement is explicitly 202', () => {
    const workflow = buildScanWorkflow()
    expect(workflow.nodes.map(n => n.id)).toEqual(['node-webhook', 'node-validate', 'node-claim', 'node-respond-ok',
      'node-gate', 'node-ai-summary', 'node-outcome', 'node-complete', 'node-confirm'])
    expect(workflow.nodes.find(n => n.id === 'node-respond-ok')!.parameters.options.responseCode).toBe(202)
    expect(workflow.nodes.filter(n => n.type === 'n8n-nodes-base.httpRequest').every(n => 'retryOnFail' in n && n.retryOnFail === false)).toBe(true)
    expect(JSON.stringify(workflow)).not.toMatch(/hooks\.slack\.com|ai_summary|Supabase Postgres|UPDATE scans|SELECT .*clients/)
  })
  it('limits model work to the frozen measured input', () => {
    const request = summaryRequest({ domain: 'example.test', score: 10, grade: 'F',
      checks: [{ id: 'c1_robots', status: 'fail', message: 'robots_not_found' }, { id: 'c3_bot_access', status: 'pass', message: 'ok' }] })
    expect(request.max_tokens).toBe(400)
    expect(request.messages[0].content).toContain('untrusted')
    expect(request.messages[1].content).toContain('c1_robots')
    expect(request.messages[1].content).not.toContain('c3_bot_access')
  })
  it('does not present failed collection or unsupported checks to the summary model as measured failures', () => {
    const { receipt } = createSummaryReceipt({ domain: 'example.test', score: 10, grade: 'F', results: {
      c1_robots: { status: 'fail', message: 'robots_missing' },
      c18_factual_density: { status: 'fail', message: 'provider_unavailable' },
      c19_topical_authority: { status: 'warn', message: 'no_sitemap_input' },
      evidence: { checks: { c1_robots: { collection: 'complete' },
        c18_factual_density: { collection: 'failed' }, c19_topical_authority: { collection: 'unsupported' } } },
    } })
    expect(receipt.input.checks.map(c => c.id)).toEqual(['c1_robots'])
  })
  it('does not queue paid summary work without any sourced check finding', () => {
    const { receipt } = createSummaryReceipt({ domain: 'example.test', score: 0, grade: 'F', results: {} })
    expect(receipt).toMatchObject({ state: 'failed', error: 'NO_SOURCED_CHECKS' })
  })
  it.each([{ statusCode: 503, body: providerResponse.body }, { error: 'private error' }, { statusCode: 200, body: '<html>error</html>' }])('records explicit provider failure for %j', response => {
    const result = completionFromProvider(response, context)
    expect(result.phase).toBe('failed')
    expect(result).not.toHaveProperty('summary')
    expect(JSON.stringify(result)).not.toContain('private error')
    expect(parseSummaryCompletion(result)).toEqual({ phase: 'failed', error: 'PROVIDER_FAILED' })
  })
  it.each(['', 'tiny', 'x'.repeat(6001)])('refuses empty or unbounded provider output', content => {
    expect(completionFromProvider({ statusCode: 200, body: { choices: [{ message: { content } }] } }, context).phase).toBe('failed')
  })
  it('does not invent missing provider usage or cost', () => {
    const result = completionFromProvider(providerResponse, context)
    expect(parseSummaryCompletion(result)).toMatchObject({ phase: 'succeeded', provider: {
      actualModel: 'test-model', requestId: 'gen-test', promptTokens: null, completionTokens: null, costUsd: null,
    } })
  })
  it('rejects missing execution identity rather than storing the string undefined', () => {
    expect(parseExecutionIdentity(scanId, { ...context.identity, executionId: undefined })).toBeNull()
    expect(parseExecutionIdentity(scanId, { ...context.identity, workflowId: 42 })).toBeNull()
  })
  it('requires a persisted receipt for the same execution before confirming workflow success', () => {
    expect(() => confirmSaved({ ok: true }, context, { phase: 'succeeded' })).toThrow('SUMMARY_PERSISTENCE_UNCONFIRMED')
  })
  it('prepares only an update to an existing workflow and an existing provider credential', () => {
    const plan = prepareScanWorkflow('existing_workflow', 'existing_credential')
    expect(plan).toMatchObject({ mode: 'LOCAL_PREPARATION_ONLY', method: 'PUT', path: '/api/v1/workflows/existing_workflow' })
    expect(JSON.stringify(plan.body)).toContain('"id":"existing_credential"')
    expect(JSON.stringify(plan.body)).not.toMatch(/DATABASE_URL|MIGRATE_DATABASE_URL|\/activate|\/credentials/)
    expect(() => prepareScanWorkflow(null, null)).toThrow('EXISTING_WORKFLOW')
  })
  it('the preparation CLI refuses deployment rather than interpreting an apply flag', () => {
    const result = spawnSync(process.execPath, ['n8n/prepare-scan-workflow.mjs', '--apply'],
      { cwd: process.cwd(), encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('NO_DEPLOYMENT_OR_ACTIVATION_SUPPORTED')
  })
  it('the execution reader stops before HTTP when read credentials are unavailable', () => {
    mkdirSync('artifacts/n8n-receipts', { recursive: true })
    const file = 'artifacts/n8n-receipts/cli-owner-fixture.json'
    writeFileSync(file, JSON.stringify({ scanId, receipt: { executionId: '123' } }))
    const result = spawnSync(process.execPath, ['n8n/verify-execution.mjs', '--receipt', file],
      { cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, N8N_API_KEY: '' } })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('N8N_API_KEY_REQUIRED_NO_REQUEST_SENT')
    expect(result.stdout).not.toContain('verified')
  })
  it.each(['identity', 'unfinished', 'different-scan', 'different-source', 'missing-output'])('cannot independently verify %s execution data', kind => {
    const receipt = { id: payload.dispatchId, executionId: '123', workflowId: 'wf', state: 'succeeded',
      snapshotHash: 'a'.repeat(64), summary: { hash: 'b'.repeat(64) } }
    const saved = { scanId, receipt }
    const output = { scanId: kind === 'different-scan' ? 'foreign' : scanId,
      receipt: { ...receipt, snapshotHash: kind === 'different-source' ? 'c'.repeat(64) : receipt.snapshotHash } }
    const execution = { id: kind === 'identity' ? 'other' : '123', workflowId: 'wf',
      status: kind === 'unfinished' ? 'running' : 'success', startedAt: '2026-10-16T00:00:00Z', stoppedAt: '2026-10-16T00:01:00Z',
      data: { resultData: { runData: kind === 'missing-output' ? {} : { 'Persist Summary': [{ data: { main: [[{ json: output }]] } }] } } } }
    expect(verifyExecutionReceipt(saved, execution).verified).toBe(false)
  })
})
