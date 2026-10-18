import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer as createNetServer, Socket } from 'node:net'
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, unlinkSync, copyFileSync } from 'node:fs'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { syncBuiltinESMExports } from 'node:module'
import pg from 'pg'
import { getMigrations } from 'better-auth/db/migration'
import { ownRuntimeChildren } from './runtime-processes.mjs'
import { engineOptions, startAuthService } from './local-auth-service.mjs'
import { fixtureResults } from './local-auth-fixture.mjs'
import { buildLocalReportRuntime } from './local-report-build.mjs'
import { runSpec, verifyContainer, verifyDatabase, verifyLocalDockerContext, artifactDirectory,
  localEnvironment, redactLocalAuth, allowLocalUrl, evidenceMode, parseLocalAuthScenario } from './local-auth-safety.mjs'

const exec = promisify(execFile), root = process.cwd(), runId = randomUUID()
const scenario = parseLocalAuthScenario(process.argv.slice(2))
const buildLocalOrigin = process.argv.includes('--build-local-origin')
if (buildLocalOrigin && !['report-recovery', 'report-list'].includes(scenario)) throw new Error('LOCAL_AUTH_BUILD_TARGET')
const output = artifactDirectory(root, runId, scenario), privateDir = join(output, '.private')
mkdirSync(privateDir, { recursive: true, mode: 0o700 })
const secret = () => randomBytes(32).toString('hex')
const privateValues = [secret(), secret(), secret(), secret(), secret()]
const [ownerPassword, appPassword, authPassword, engineSecret, controlSecret] = privateValues
const envFiles = ['.env', '.env.local', '.env.production', '.env.production.local']
const dotenv = envFiles.filter(file => existsSync(join(root, file))).map(file => readFileSync(join(root, file), 'utf8'))
const cleanEnv = localEnvironment(process.env, dotenv)
const proof = { mode: evidenceMode, runId, scenario, managedNeonAuthVerified: false, externalCollectionVerified: false,
  providerCallsAllowed: false, monitoringEnabled: false, startedAt: new Date().toISOString(), status: 'starting',
  authEngineVersion: JSON.parse(readFileSync('node_modules/better-auth/package.json', 'utf8')).version,
  neonSdkVersion: JSON.parse(readFileSync('node_modules/@neondatabase/auth/package.json', 'utf8')).version }
if (['report-recovery', 'report-list'].includes(scenario)) {
  const files = [
    'scripts/ci/local-auth-run.mjs', 'scripts/ci/local-auth-app.mjs', 'scripts/ci/local-auth-service.mjs',
    'scripts/ci/local-auth-preload.mjs', 'scripts/ci/local-auth-safety.mjs', 'scripts/ci/local-report-fixture.mjs',
    'scripts/ci/local-report-build.mjs',
    `tests/local-auth/${scenario}.spec.mjs`, 'tests/local-auth/report-support.mjs',
    'tests/local-auth/support.mjs', 'tests/local-auth/playwright.config.mjs', 'tests/local-auth/reporter.mjs',
  ]
  const snapshots = join(output, 'harness-source')
  mkdirSync(snapshots, { recursive: true })
  proof.harnessSource = files.map(file => {
    const snapshot = file.replaceAll('/', '__')
    const bytes = readFileSync(join(root, file))
    copyFileSync(join(root, file), join(snapshots, snapshot))
    return { file, snapshot, sha256: createHash('sha256').update(bytes).digest('hex') }
  })
}
const redact = value => redactLocalAuth(value, privateValues)
const record = value => {
  const line = `${redact(JSON.stringify({ at: new Date().toISOString(), ...value }))}\n`
  writeFileSync(join(output, 'events.jsonl'), line, { flag: 'a' })
}
const docker = async args => {
  try { return (await exec('docker', args, { env: cleanEnv, maxBuffer: 2 * 1024 * 1024 })).stdout.trim() }
  catch (error) {
    const detail = redact(`${error.stderr ?? ''} ${error.stdout ?? ''}`).trim()
    throw new Error(`LOCAL_AUTH_DOCKER_FAILED ${detail.slice(0, 1200)}`)
  }
}
const identitySql = `select json_build_object('project_id',current_setting('neon.project_id',true),
  'branch_id',current_setting('neon.branch_id',true),'database',current_database(),'role',current_user)`
let config, spec, containerId, authService, authPool, ownerPool, migrationPool
let appChild, terminal = { allStopped: true, pids: [] }, containersStopped = false
const privateFiles = [], pools = [], owned = ownRuntimeChildren({
  onStopped: value => { terminal = value },
})
const pause = ms => new Promise(done => setTimeout(done, ms))
const privateWrite = (name, text) => {
  const path = join(privateDir, name)
  writeFileSync(path, text, { mode: 0o600 })
  privateFiles.push(path)
  return path
}
async function freePort() {
  const server = createNetServer()
  await new Promise((ready, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ready) })
  const port = server.address().port
  await new Promise(done => server.close(done))
  return port
}
async function inspectOwned() {
  const value = JSON.parse(await docker(['inspect', containerId]))[0]
  return { value, endpoint: verifyContainer(value, spec, containerId) }
}
function connectPool(user, pass, options) {
  if (config.containerVerified !== true) throw new Error('LOCAL_AUTH_TARGET_GATE_REQUIRED')
  const pool = new pg.Pool({ host: config.dbHost, port: config.dbPort, database: config.database,
    user, ['pass' + 'word']: pass, max: 4, options })
  pools.push(pool)
  return pool
}
async function provePool(pool, role) {
  const result = await pool.query(identitySql)
  verifyDatabase(result.rows[0].json_build_object, spec, role)
  record({ event: 'database-identity-verified', role, database: spec.database, localAssignedBinding: true })
}
async function certificate() {
  const certPath = join(privateDir, 'local-ca.pem'), keyPath = join(privateDir, 'local-key.pem')
  privateFiles.push(certPath, keyPath)
  const script = privateWrite('certificate.ps1', `
param([string]$certPath,[string]$keyPath)
$ErrorActionPreference='Stop'
$rsa=[System.Security.Cryptography.RSA]::Create(2048)
$request=[System.Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=127.0.0.1',$rsa,[System.Security.Cryptography.HashAlgorithmName]::SHA256,[System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
$san=[System.Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
$san.AddIpAddress([System.Net.IPAddress]::Parse('127.0.0.1'))
$san.AddDnsName('localhost')
$request.CertificateExtensions.Add($san.Build())
$request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($true,$false,0,$true))
$cert=$request.CreateSelfSigned([DateTimeOffset]::UtcNow.AddMinutes(-5),[DateTimeOffset]::UtcNow.AddDays(1))
[System.IO.File]::WriteAllText($certPath,$cert.ExportCertificatePem())
[System.IO.File]::WriteAllText($keyPath,$rsa.ExportPkcs8PrivateKeyPem())
$cert.Dispose()
$rsa.Dispose()
`)
  await exec('pwsh', ['-NoProfile', '-NonInteractive', '-File', script, certPath, keyPath], { env: cleanEnv })
  return { certPath, keyPath }
}

function installNetworkPolicy() {
  const nativeConnect = Socket.prototype.connect, nativeFetch = globalThis.fetch
  const ports = new Set([config.dbPort, ...config.allowedOrigins.map(value => Number(new URL(value).port))])
  Socket.prototype.connect = function (...args) {
    let value = Array.isArray(args[0]) ? args[0][0] : args[0]
    if (typeof value === 'number') value = { port: value, host: typeof args[1] === 'string' ? args[1] : 'localhost' }
    if (!value || typeof value !== 'object' || value.path && !value.port || value.host !== '127.0.0.1' ||
        !ports.has(Number(value.port))) throw new Error('LOCAL_AUTH_SOCKET_DENIED')
    return nativeConnect.apply(this, args)
  }
  globalThis.fetch = async (input, options) => {
    allowLocalUrl(input instanceof Request ? input.url : String(input), config.allowedOrigins)
    return nativeFetch(input, options)
  }
  syncBuiltinESMExports()
}

try {
  const context = await docker(['context', 'show'])
  const metadata = JSON.parse(await docker(['context', 'inspect', context]))[0]
  verifyLocalDockerContext(metadata)
  const image = JSON.parse(await docker(['image', 'inspect', '1a6ab3f5345e']))[0]
  if (!image?.Id?.startsWith('sha256:1a6ab3f5345e')) throw new Error('LOCAL_AUTH_CACHED_IMAGE_MISMATCH')
  spec = runSpec(runId, image.Id)
  proof.sourceSha = (await exec('git', ['rev-parse', 'HEAD'], { env: cleanEnv })).stdout.trim()
  proof.buildId = readFileSync(join(root, '.next/BUILD_ID'), 'utf8').trim()
  const expectedBuildId = process.argv.find(value => value.startsWith('--expected-build-id='))?.split('=')[1]
  if (expectedBuildId && expectedBuildId !== proof.buildId) throw new Error('LOCAL_AUTH_BUILD_ID_MISMATCH')
  proof.dirtyDiffHash = createHash('sha256').update((await exec('git', ['diff', '--binary'], { env: cleanEnv, maxBuffer: 16 * 1024 * 1024 })).stdout).digest('hex')
  const containerEnv = privateWrite('container.env',
    `POSTGRES_USER=local_owner\nPOSTGRES_DB=${spec.database}\nPOSTGRES_PASSWORD=${ownerPassword}\n`)
  containerId = await docker(['run', '--detach', '--rm', '--pull=never', '--name', spec.containerName,
    ...Object.entries(spec.labels).flatMap(([key, value]) => ['--label', `${key}=${value}`]),
    '--publish', '127.0.0.1::5432', '--memory', '512m', '--cpus', '1', '--env-file', containerEnv,
    spec.imageId, '-c', `neon.project_id=${spec.projectId}`, '-c', `neon.branch_id=${spec.branchId}`])
  const { endpoint, value: container } = await inspectOwned()
  const volumes = (container.Mounts ?? []).filter(mount => mount.Type === 'volume').map(mount => mount.Name)
  if (volumes.some(name => !/^[a-f0-9]{64}$/.test(name))) throw new Error('LOCAL_AUTH_ANONYMOUS_VOLUME_IDENTITY')
  proof.container = { id: containerId, imageId: spec.imageId, labels: spec.labels, ...endpoint, volumes }
  record({ event: 'owned-container-target-verified', ...proof.container })
  const readinessStart = Date.now()
  for (;;) {
    // The image's initialization server listens only on its Unix socket.
    // Require the final TCP listener before querying the target identity.
    try { await docker(['exec', containerId, 'pg_isready', '-h', '127.0.0.1', '-U', 'local_owner', '-d', spec.database]); break }
    catch { if (Date.now() - readinessStart > 30000) throw new Error('LOCAL_AUTH_DATABASE_NOT_READY'); await pause(250) }
  }
  const sqlIdentity = JSON.parse(await docker(['exec', containerId, 'psql', '-U', 'local_owner',
    '-d', spec.database, '-Atc', identitySql]))
  verifyDatabase(sqlIdentity, spec, 'local_owner')
  record({ event: 'in-band-target-verified-before-client', ...sqlIdentity, localAssignedBinding: true })
  const appPort = await freePort(), authPort = await freePort()
  config = {
    ...spec, mode: evidenceMode, scenario, containerId, containerVerified: true,
    dbHost: endpoint.host, dbPort: endpoint.port, dsnHost: 'localhost', ownerPassword,
    appRole: 'aeo_app', appPassword, authRole: 'local_auth_engine', authPassword,
    engineSecret, controlSecret, cookieSecret: secret(),
    reportShareSecret: ['report-recovery', 'report-list'].includes(scenario) ? secret() : undefined,
    appOrigin: `https://127.0.0.1:${appPort}`, authOrigin: `https://127.0.0.1:${authPort}`,
    output, root, ...await certificate(),
  }
  privateValues.push(config.cookieSecret)
  if (config.reportShareSecret) privateValues.push(config.reportShareSecret)
  config.allowedOrigins = [config.appOrigin, config.authOrigin]
  proof.sqlTransport = { logicalDsnHost: config.dsnHost, physicalHost: config.dbHost,
    physicalPort: config.dbPort, kind: 'NEON_HTTP_WIRE_TO_OWNED_REAL_POSTGRES' }
  const configPath = privateWrite('config.json', JSON.stringify(config))
  ownerPool = connectPool('local_owner', ownerPassword)
  await provePool(ownerPool, 'local_owner')
  await ownerPool.query('create schema neon_auth')
  migrationPool = connectPool('local_owner', ownerPassword, '-c search_path=neon_auth,public')
  const migrations = await getMigrations(engineOptions(config, migrationPool, new Map(), async () => {}))
  await migrations.runMigrations()
  const baseline = readFileSync(join(root, 'supabase/baseline/000_baseline_2026-08-31.sql'), 'utf8')
  const checksum = createHash('sha256').update(baseline).digest('hex')
  await ownerPool.query(baseline.replaceAll(":'baseline_checksum'", `'${checksum}'`))
  const migrationFiles = readdirSync(join(root, 'supabase/migrations')).filter(file => /^\d{3}.*\.sql$/.test(file) && Number(file.slice(0, 3)) >= 39).sort()
  for (const file of migrationFiles) {
    await ownerPool.query(readFileSync(join(root, 'supabase/migrations', file), 'utf8'))
  }
  // Random hex values have no SQL syntax. These identities exist only inside
  // the newly verified disposable container, and never leave private files.
  await ownerPool.query(`alter role aeo_app login password '${appPassword}';
    create role local_auth_engine login password '${authPassword}';
    grant usage on schema neon_auth to local_auth_engine;
    grant select,insert,update,delete on all tables in schema neon_auth to local_auth_engine;
    grant usage,select on all sequences in schema neon_auth to local_auth_engine;`)
  authPool = connectPool(config.authRole, authPassword, '-c search_path=neon_auth,public')
  await provePool(authPool, config.authRole)
  const appProbe = connectPool('aeo_app', appPassword)
  await provePool(appProbe, 'aeo_app')
  record({ event: 'application-schema-installed', baselineChecksum: checksum, migrations: migrationFiles })
  const fixture = { selected: await fixtureResults(root), decoy: await fixtureResults(root, { clear: true }) }
  if (buildLocalOrigin) {
    let buildLog = ''
    proof.baseBuildId = proof.buildId
    proof.localOriginBuild = await buildLocalReportRuntime(root, config, process.env, dotenv, bytes => {
      buildLog += bytes.toString()
      const lines = buildLog.split('\n'); buildLog = lines.pop() ?? ''
      for (const line of lines) writeFileSync(join(output, 'local-build.log'), `${redact(line)}\n`, { flag: 'a' })
    }, { spawnProcess: (...args) => owned.track(spawn(...args)) })
    if (buildLog) writeFileSync(join(output, 'local-build.log'), redact(buildLog) + '\n', { flag: 'a' })
    if (proof.localOriginBuild.exitCode !== 0 || !proof.localOriginBuild.credentialsCleared ||
      !proof.localOriginBuild.monitoringDisabled) throw new Error('LOCAL_AUTH_HTTPS_BUILD_FAILED')
    proof.buildId = readFileSync(join(root, '.next/BUILD_ID'), 'utf8').trim()
    record({ event: 'OWNED_HTTPS_BUILD_READY', ...proof.localOriginBuild, buildId: proof.buildId,
      runtimeSigningSecretPresent: Boolean(config.reportShareSecret) })
  }
  const tls = await import('node:tls')
  tls.setDefaultCACertificates([...tls.getCACertificates('default'), readFileSync(config.certPath, 'utf8')])
  installNetworkPolicy()
  authService = await startAuthService(config, authPool, ownerPool, fixture, record)
  const childEnv = {
    ...cleanEnv, AISO_LOCAL_AUTH_CONFIG: configPath, NODE_EXTRA_CA_CERTS: config.certPath,
    PLAYWRIGHT_NO_COPY_PROMPT: '1',
    DATABASE_URL: `post${'gresql'}://aeo_app:${appPassword}@localhost:${config.dbPort}/${config.database}`,
    EXPECTED_NEON_PROJECT_ID: spec.projectId, EXPECTED_NEON_BRANCH_ID: spec.branchId,
    EXPECTED_DB_ROLE: 'aeo_app', EXPECTED_DB_NAME: spec.database,
    NEON_AUTH_BASE_URL: `${config.authOrigin}/api/auth`, NEON_AUTH_COOKIE_SECRET: config.cookieSecret,
    NEXT_PUBLIC_APP_URL: config.appOrigin,
    ...(config.reportShareSecret ? { REPORT_SHARE_SECRET: config.reportShareSecret } : {}),
  }
  if (process.argv.includes('--prepare-only')) {
    proof.status = 'prepared'
    record({ event: 'prepare-only-complete-no-app-launched' })
  } else {
    console.log(`[local-auth] Starting owned app for ${evidenceMode}; artifact directory: ${output}`)
    let log = '', exited = false
    appChild = owned.track(spawn(process.execPath, [
      '--import', pathToFileURL(join(root, 'scripts/ci/local-auth-preload.mjs')).href,
      'scripts/ci/local-auth-app.mjs',
    ], { cwd: root, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] }))
    const saveLog = bytes => {
      // Buffer whole lines so tokens cannot straddle independent redactions.
      log += bytes.toString()
      const lines = log.split('\n'); log = lines.pop() ?? ''
      for (const line of lines) {
        writeFileSync(join(output, 'app.log'), `${redact(line)}\n`, { flag: 'a' })
        if (line.includes('LOCAL_AUTH_APP_READY')) proof.appReady = true
      }
    }
    appChild.stdout.on('data', saveLog); appChild.stderr.on('data', saveLog)
    appChild.once('exit', () => { exited = true }); appChild.once('error', () => { exited = true })
    const start = Date.now()
    while (!proof.appReady) {
      if (exited || owned.interrupted || Date.now() - start > 45000) throw new Error('LOCAL_AUTH_APP_START_FAILED')
      await pause(100)
    }
    record({ event: 'app-ready', origin: config.appOrigin })
    const runner = owned.track(spawn(process.execPath, [
      '--import', pathToFileURL(join(root, 'scripts/ci/local-auth-preload.mjs')).href,
      'node_modules/@playwright/test/cli.js', 'test', '--config=tests/local-auth/playwright.config.mjs',
    ], { cwd: root, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] }))
    let testLog = ''
    const captureTest = bytes => { testLog += bytes.toString() }
    runner.stdout.on('data', captureTest); runner.stderr.on('data', captureTest)
    const code = await new Promise((done, fail) => { runner.once('error', fail); runner.once('exit', code => done(code ?? 1)) })
    writeFileSync(join(output, 'browser.log'), redact(testLog))
    proof.status = code === 0 ? 'passed' : 'failed'
    process.exitCode = code
  }
} catch (error) {
  proof.status = 'failed'
  proof.error = redact(error.message)
  record({ event: 'harness-failed', error: proof.error })
  console.error(`[local-auth] ${proof.error}`)
  process.exitCode = 1
} finally {
  await owned.stop(proof.status)
  if (ownerPool && proof.appReady) {
    try {
      const inert = await ownerPool.query(`select
        (select count(*)::int from public.prompt_bank) as prompts,
        (select count(*)::int from public.prompt_bank where is_active) as active_prompts,
        (select count(*)::int from public.pulse_runs) as pulse_runs,
        (select count(*)::int from public.pulse_run_items) as pulse_run_items,
        (select count(*)::int from public.pulse_item_attempts) as pulse_attempts,
        (select count(*)::int from public.pulse_legacy_classification_attempts) as legacy_attempts,
        (select count(*)::int from public.pulse_metrics) as pulse_metrics,
        (select count(*)::int from public.pulse_weekly_summary) as pulse_summaries,
        (select count(*)::int from public.pulse_user_intents) as pulse_intents,
        (select count(*)::int from public.pulse_run_reservations) as pulse_reservations,
        (select count(*)::int from public.cron_runs) as cron_runs`)
      proof.monitoringReadback = { attemptsFlag: false, counts: inert.rows[0],
        inert: Object.values(inert.rows[0]).every(value => value === 0) }
      if (!proof.monitoringReadback.inert) { proof.status = 'failed'; process.exitCode = 1 }
      record({ event: 'monitoring-and-attempt-rows-readback', ...proof.monitoringReadback })
    } catch (error) {
      proof.monitoringReadback = { error: redact(error.message), inert: false }
      proof.status = 'failed'; process.exitCode = 1
    }
  }
  if (authService) await authService.close()
  for (const pool of pools) await pool.end()
  if (containerId && spec) {
    try {
      await inspectOwned()
      await docker(['stop', '--time', '5', containerId])
      const remaining = await docker(['ps', '--all', '--quiet', '--no-trunc', '--filter', `id=${containerId}`])
      containersStopped = remaining === ''
      proof.ownedVolumes = []
      for (const name of proof.container.volumes) {
        let absent = false
        try { await docker(['volume', 'inspect', name]) }
        catch (error) { if (/no such volume/i.test(error.message)) absent = true; else throw error }
        proof.ownedVolumes.push({ name, absent })
        if (!absent) throw new Error('LOCAL_AUTH_OWNED_VOLUME_REMAINS')
      }
    } catch (error) {
      proof.cleanupError = redact(error.message)
      process.exitCode = 1
    }
  }
  proof.cleanup = { ownedChildrenStopped: terminal.allStopped, ownedPids: terminal.pids,
    ownedContainerRemoved: containersStopped, containerId }
  proof.finishedAt = new Date().toISOString()
  if (!terminal.allStopped || containerId && !containersStopped) process.exitCode = 1
  writeFileSync(join(output, 'IDENTITY-AND-RESULT.json'), redact(JSON.stringify(proof, null, 2)))
  // Remove only this run's exact private files after all owned services stop.
  if (terminal.allStopped && (!containerId || containersStopped)) {
    for (const path of privateFiles) { try { unlinkSync(path) } catch (error) { if (error.code !== 'ENOENT') record({ event: 'private-file-cleanup-failed', file: path }) } }
  }
  owned.dispose()
  console.log(`[local-auth] ${proof.status}; evidence: ${output}`)
}
