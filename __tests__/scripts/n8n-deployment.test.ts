import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SECRET = 'synthetic-webhook-secret-0000000000000000'
const API_KEY = 'synthetic-n8n-api-key'
const PROVIDER_KEY = 'synthetic-provider-key'
type Call = { method: string; url: string; args: string[]; body?: Record<string, unknown>; mode?: number }

function run(script: string, failure = '', secret = SECRET, securedGraph = true) {
  const dir = mkdtempSync(join(tmpdir(), 'aiso-n8n-deployment-'))
  mkdirSync(join(dir, 'n8n'))
  mkdirSync(join(dir, 'bin'))
  copyFileSync(join(process.cwd(), 'n8n', script), join(dir, 'n8n', script))
  const workflow = {
    name: 'Synthetic secured local graph',
    nodes: [
      { name: 'Webhook Trigger', type: 'n8n-nodes-base.webhook', parameters: { authentication: securedGraph ? 'headerAuth' : 'none' }, credentials: { httpHeaderAuth: { name: 'AISO Scan Webhook' } } },
      { name: 'Query', type: 'n8n-nodes-base.postgres', parameters: { query: 'SELECT $1::uuid' }, credentials: { postgres: { name: 'Neon Postgres' } } },
      { name: 'Provider', type: 'n8n-nodes-base.httpRequest', parameters: { authentication: 'genericCredentialType' }, credentials: { httpHeaderAuth: { name: 'OpenRouter API' } } },
    ],
    connections: {}, settings: {}, staticData: null,
  }
  writeFileSync(join(dir, 'n8n', 'aiso-scan-webhook.json'), JSON.stringify(workflow))
  writeFileSync(join(dir, 'bin', 'curl'), `#!/usr/bin/env python3
import json, os, stat, sys
args = sys.argv[1:]
method = args[args.index('-X') + 1] if '-X' in args else 'GET'
url = next((a for a in args if a.startswith('https://')), '')
call = {'method': method, 'url': url, 'args': args}
for flag in ['--data-binary', '-d', '--data-raw']:
    if flag in args:
        value = args[args.index(flag)+1]
        if value.startswith('@'):
            call['mode'] = stat.S_IMODE(os.stat(value[1:]).st_mode)
            value = open(value[1:]).read()
        try: call['body'] = json.loads(value)
        except ValueError: call['body'] = {'invalid': True}
with open(os.environ['CALLS'], 'a') as out: out.write(json.dumps(call)+'\\n')
step = sum(1 for _ in open(os.environ['CALLS']))
failure = os.environ.get('FAILURE', '')
if failure == 'http-'+str(step): sys.exit(22)
if failure == 'malformed-'+str(step): response = 'not-json'
elif failure == 'missing-id-'+str(step): response = '{}'
elif '/credentials/' in url: response = json.dumps({'id': url.rsplit('/',1)[1]})
elif url.endswith('/credentials'):
    response = json.dumps({'id': {'Neon Postgres':'pg-id','OpenRouter API':'provider-id','AISO Scan Webhook':'webhook-id'}[call['body']['name']]})
elif url.endswith('/deactivate'): response = json.dumps({'id':'synthetic-workflow','active':False})
elif url.endswith('/activate'): response = json.dumps({'id':'synthetic-workflow','active':True})
elif '/workflows/' in url: response = json.dumps({'id':'synthetic-workflow'})
elif url.endswith('/workflows'): response = json.dumps({'id':'created-workflow','active':False})
else: response = '{}'
if '--output' in args: open(args[args.index('--output')+1], 'w').write(response)
elif '-o' in args: open(args[args.index('-o')+1], 'w').write(response)
else: sys.stdout.write(response)
`)
  chmodSync(join(dir, 'bin', 'curl'), 0o700)
  try {
    const result = spawnSync('bash', [join(dir, 'n8n', script)], {
      encoding: 'utf8', timeout: 15_000,
      env: { ...process.env, PATH: join(dir, 'bin') + ':' + process.env.PATH, CALLS: join(dir, 'calls.jsonl'), FAILURE: failure,
        N8N_API_KEY: API_KEY, DATABASE_URL: 'postgresql://synthetic:synthetic-password@example.invalid/synthetic',
        OPENROUTER_KEY: PROVIDER_KEY, N8N_SCAN_WEBHOOK_SECRET: secret, N8N_WORKFLOW_ID: 'synthetic-workflow' },
    })
    const calls = (() => { try { return readFileSync(join(dir, 'calls.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line) as Call) } catch { return [] } })()
    return { status: result.status, output: result.stdout + result.stderr, calls }
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

describe('n8n deployment security', () => {
  it.each(['configure-credentials.sh', 'deploy-workflows.sh'])('%s refuses a missing webhook secret before any remote action', script => {
    const result = run(script, '', '')
    expect(result.status).not.toBe(0)
    expect(result.calls).toEqual([])
  })

  it.each(['configure-credentials.sh', 'deploy-workflows.sh'])('%s refuses short secrets and insecure local graphs before any remote action', script => {
    for (const result of [run(script, '', 'too-short'), run(script, '', SECRET, false)]) {
      expect(result.status).not.toBe(0)
      expect(result.calls).toEqual([])
    }
  })

  it('installs the local graph with all credentials before activation', () => {
    const result = run('configure-credentials.sh')
    expect(result.status, result.output).toBe(0)
    expect(result.calls.some(call => call.method === 'GET')).toBe(false)
    expect(result.calls[0].url.endsWith('/synthetic-workflow/deactivate')).toBe(true)
    const install = result.calls.find(call => call.method === 'PUT')!
    expect(install.body?.name).toBe('Synthetic secured local graph')
    const nodes = install.body?.nodes as { credentials: Record<string, { id: string }> }[]
    expect(nodes[0].credentials.httpHeaderAuth.id).toBe('webhook-id')
    expect(nodes[1].credentials.postgres.id).toBeTruthy()
    expect(nodes[2].credentials.httpHeaderAuth.id).toBe('provider-id')
    expect(result.calls.at(-1)?.url.endsWith('/synthetic-workflow/activate')).toBe(true)
    for (const call of result.calls) {
      expect(call.args.join(' ')).not.toContain(API_KEY)
      expect(call.args.join(' ')).not.toContain(SECRET)
      expect(call.args.join(' ')).not.toContain(PROVIDER_KEY)
      if (call.body) expect(call.mode).toBe(0o600)
    }
    const credential = result.calls.find(call => call.body?.name === 'AISO Scan Webhook')!
    expect(credential.body?.data).toEqual({ name: 'Authorization', value: 'Bearer ' + SECRET })
    expect(result.output).not.toContain(SECRET)
  })

  it.each(['http', 'malformed', 'missing-id'])('never activates after a %s failure in any provisioning step', failure => {
    for (const step of [1, 2, 3, 4, 5]) {
      const result = run('configure-credentials.sh', failure + '-' + step)
      expect(result.status, failure + '-' + step).not.toBe(0)
      expect(result.calls.some(call => call.url.endsWith('/activate'))).toBe(false)
      expect(result.output).not.toContain('All done!')
    }
  })

  it.each(['http-6', 'malformed-6', 'missing-id-6'])('reports activation failure on %s', failure => {
    const result = run('configure-credentials.sh', failure)
    expect(result.status).not.toBe(0)
    expect(result.calls).toHaveLength(6)
    expect(result.output).not.toContain('installed and activated')
  })

  it('creates an inactive workflow and never activates it before credential setup', () => {
    const result = run('deploy-workflows.sh')
    expect(result.status, result.output).toBe(0)
    expect(result.calls).toHaveLength(1)
    expect(result.calls[0].method).toBe('POST')
    expect(result.calls[0].body?.name).toBe('Synthetic secured local graph')
    expect(result.output).toContain('created-workflow')
  })

  it.each(['http-1', 'malformed-1', 'missing-id-1'])('fails inactive deployment on %s', failure => {
    const result = run('deploy-workflows.sh', failure)
    expect(result.status).not.toBe(0)
    expect(result.calls).toHaveLength(1)
  })
})
