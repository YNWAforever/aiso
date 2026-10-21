import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { offlineBuildEnvironment, assertBuildIpc } from './build-offline.mjs'
import { ownRuntimeChildren } from './runtime-processes.mjs'

await assertBuildIpc()
const root = process.cwd(), runId = randomUUID()
const output = resolve(process.env.AISO_RUNTIME_ARTIFACT_DIR || join('artifacts', 'isolated-runtime', runId))
mkdirSync(output, { recursive: true })
const contents = []
for (const file of ['.env', '.env.local', '.env.production', '.env.production.local']) {
  try { contents.push(readFileSync(join(root, file), 'utf8')) }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('RUNTIME_ENV_UNREADABLE') }
}
const env = { ...offlineBuildEnvironment(process.env, contents), CI: '', START_DEV_SERVER: '',
  E2E_FIXTURE_MODE: '1', AISO_RUNTIME_RUN_ID: runId,
  AISO_RUNTIME_IDENTITY_FILE: join(output, 'RUNTIME-IDENTITY.json') }
const proof = { mode: 'REAL_NEXT_RUNTIME_NO_DB_NO_NORMAL_AUTH', runId,
  buildId: readFileSync('.next/BUILD_ID', 'utf8').trim(), dbConfigured: Boolean(env.DATABASE_URL),
  providerConfigured: Boolean(env.OPENROUTER_API_KEY || env.N8N_SCAN_WEBHOOK_URL),
  authIsTestOnly: env.NEON_AUTH_BASE_URL === 'https://fixture.invalid',
  authMode: 'existing-unauthenticated-fixture-mode', outboundGuard: true,
  monitoringEnabled: env.FEATURE_PULSE_ATTEMPTS === 'true' }
if (proof.dbConfigured || proof.providerConfigured || !proof.authIsTestOnly || proof.monitoringEnabled) throw new Error('RUNTIME_ISOLATION_FAILED')

let log = '', exited = false, runner
const owned=ownRuntimeChildren({onStopped:terminal=>{
  writeFileSync(join(output,'server.log'),log)
  writeFileSync(env.AISO_RUNTIME_IDENTITY_FILE,JSON.stringify({...proof,stopped:terminal.allStopped,outcome:terminal.reason,ownedPids:terminal.pids},null,2))
}})
const server = owned.track(spawn(process.execPath, ['--import', pathToFileURL(join(root, 'tests/fixtures/no-outbound-runtime.mjs')).href,
  'node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '0'], {
  cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'],
}))
proof.pid = server.pid
const record=bytes=>{log+=bytes;appendFileSync(join(output,'server.log'),bytes)}
server.stdout.on('data', record)
server.stderr.on('data', record)
server.once('error', () => { exited = true })
server.once('exit', () => { exited = true; if(!owned.stopping)void owned.stop('server-exited') })
const started = Date.now()
try {
  while (!log.includes('Ready in')) {
    if (exited || Date.now() - started > 30_000) throw new Error('OWNED_RUNTIME_START_FAILED')
    await new Promise(done => setTimeout(done, 100))
  }
  if(owned.stopping)throw new Error('OWNED_RUNTIME_INTERRUPTED')
  const origin = log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]
  if (!origin || origin.endsWith(':0')) throw new Error('OWNED_RUNTIME_ORIGIN_UNCONFIRMED')
  proof.origin = origin
  writeFileSync(env.AISO_RUNTIME_IDENTITY_FILE, JSON.stringify(proof, null, 2))
  console.log(`[isolated-runtime] Evidence: ${output}`)
  runner = owned.track(spawn(process.execPath, ['node_modules/@playwright/test/cli.js', 'test',
    'tests/e2e/isolated-runtime-readonly.spec.ts', '--project=chromium', '--project=mobile', '--workers=1',
    `--output=${join(output, 'test-results')}`, '--reporter=list,json'], {
    cwd: root, env: { ...env, BASE_URL: origin, PLAYWRIGHT_JSON_OUTPUT_NAME: join(output, 'browser.json') }, stdio: 'inherit',
  }))
  const code = await new Promise((done, fail) => {
    runner.once('error', fail)
    runner.once('exit', code => done(code ?? 1))
  })
  if(!owned.interrupted)process.exitCode=code
} finally {
  await owned.stop(process.exitCode===0?'completed':'failed')
  owned.dispose()
}
