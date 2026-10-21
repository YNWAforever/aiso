#!/usr/bin/env node
// Local PostgreSQL integration acceptance. Never accepts a database URL or remote target.
// Usage: node verify-quota-concurrency.mjs <repo-root> <postgres-bin-directory> <evidence-directory>
import assert from 'node:assert/strict'
import { AsyncLocalStorage } from 'node:async_hooks'
import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import vm from 'node:vm'

const [repoArgument, binariesArgument, evidenceArgument] = process.argv.slice(2)
assert(repoArgument && binariesArgument && evidenceArgument,
  'Required: repository root, installed PostgreSQL binary directory, evidence directory')
// PostgreSQL refuses root itself. Preserve that protection; never wrap or bypass it.
assert(process.platform === 'linux' && process.getuid() !== 0,
  'BLOCKED: run under a non-root Linux account with PostgreSQL already installed')
const repo = realpathSync(repoArgument)
const binaries = realpathSync(binariesArgument)
const evidence = resolve(evidenceArgument)
mkdirSync(evidence, { recursive: true })
const uid = process.getuid()
const runId = randomUUID()
const runDirectory = mkdtempSync(join(evidence, 'quota-pg-'))
chmodSync(runDirectory, 0o700)
const dataDirectory = join(runDirectory, 'data')
const socketDirectory = join(runDirectory, 'socket')
mkdirSync(socketDirectory, { mode: 0o700 })
const port = 5432 // Unix socket only; private directory prevents collisions.
const role = 'quota_harness_owner'
const report = { runId, sourceRoot: repo, blobReferenceHead: 'bcd49f29e308b4586a88ddab1e12af18da9cafc7', status: 'running', tests: [], connections: [], limits: [
  'Local PostgreSQL SQL/locking evidence; not Neon transport or production-role grants.',
  'Migration025 with a minimal accounts parent table; not a full application migration replay.',
  'UTC anchoring and prior-period refunds are tested; wall clock is not advanced across a month boundary.',
] }
const clients = []
let started = false
let startAttempted = false
let postmasterPid

function binary(name) {
  const path = realpathSync(join(binaries, name))
  assert(path.startsWith(`${binaries}/`), 'PostgreSQL executable escapes supplied installation')
  const metadata = statSync(path)
  assert(metadata.isFile() && (metadata.mode & 0o022) === 0, 'PostgreSQL executable is writable by group/others')
  return path
}
const executables = Object.fromEntries(['initdb', 'pg_ctl', 'postgres', 'pg_controldata'].map(name => [name, binary(name)]))
const commandEnvironment = { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' }
function command(name, args) {
  const result = spawnSync(executables[name], args, { env: commandEnvironment, encoding: 'utf8', timeout: 60_000, shell: false })
  assert.equal(result.status, 0, `${name} failed: ${result.error?.message ?? result.stderr ?? ''}`)
  return result.stdout
}
function saveReport() {
  writeFileSync(join(runDirectory, 'report.json'), JSON.stringify(report, null, 2))
}
function ownPrivateDirectory(path) {
  const metadata = statSync(path)
  assert(metadata.isDirectory() && metadata.uid === uid && (metadata.mode & 0o077) === 0,
    'Disposable directory ownership or permissions differ from this process')
  assert.equal(realpathSync(path), path, 'Disposable directory must not be a symlink')
}
function gitBlob(contents) {
  return createHash('sha1').update(`blob ${Buffer.byteLength(contents)}\0`).update(contents).digest('hex')
}
function verifySource(path, expectedBlob) {
  const source = readFileSync(join(repo, path), 'utf8')
  assert.equal(gitBlob(source), expectedBlob, `Source identity changed: ${path}; review before changing this pin`)
  return source
}
const quotaSource = verifySource('lib/security/authenticated-scan-quota.ts', '1a28bd4a6c28c695f9c2972780642cab8496c1c5')
const migration = verifySource('supabase/migrations/025_authenticated_scan_quotas.sql', 'ae2e513f138fa327f72127b9c8d324f1a882ec57')
report.sourceBlobs = { quota: gitBlob(quotaSource), migration025: gitBlob(migration) }

// This out-of-band gate runs before loading pg or constructing any DB client.
function verifyOwnedServer() {
  for (const directory of [runDirectory, dataDirectory, socketDirectory]) ownPrivateDirectory(directory)
  const pidLines = readFileSync(join(dataDirectory, 'postmaster.pid'), 'utf8').trimEnd().split('\n')
  const pid = Number(pidLines[0])
  assert(Number.isSafeInteger(pid) && pid > 1)
  assert.equal(pidLines[1], dataDirectory)
  assert.equal(Number(pidLines[3]), port)
  assert.equal(pidLines[4], socketDirectory)
  assert.equal(pidLines[5], '', 'TCP must be disabled')
  assert.equal(pidLines[7].trim(), 'ready')
  assert.equal(realpathSync(`/proc/${pid}/exe`), executables.postgres)
  assert.equal(statSync(`/proc/${pid}`).uid, uid)
  const commandLine = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean)
  assert.deepEqual(commandLine, [executables.postgres, '-D', dataDirectory])
  const config = readFileSync(join(dataDirectory, 'postgresql.conf'), 'utf8')
  assert.equal(config, expectedConfiguration, 'Server configuration changed after this process created it')
  assert.equal(readFileSync(join(dataDirectory, 'postgresql.auto.conf'), 'utf8').replace(/^#.*$/gm, '').trim(), '')
  const socket = statSync(join(socketDirectory, `.s.PGSQL.${port}`))
  assert(socket.isSocket() && socket.uid === uid)
  const control = command('pg_controldata', ['-D', dataDirectory])
  const systemIdentifier = control.match(/^Database system identifier:\s+(\d+)$/m)?.[1]
  assert(systemIdentifier, 'Missing local cluster system identifier')
  postmasterPid = pid
  return { pid, uid, executable: executables.postgres, commandLine, dataDirectory, socketDirectory, port, systemIdentifier,
    database: 'postgres', role, listenAddresses: '', configurationSha256: createHash('sha256').update(config).digest('hex') }
}
let expectedConfiguration

try {
  assert(Buffer.byteLength(join(socketDirectory, `.s.PGSQL.${port}`)) < 108,
    'Unix socket path exceeds the Linux limit; use a short evidence directory such as /tmp/aiso-quota')
  command('initdb', ['-D', dataDirectory, '-U', role, '--auth-local=trust', '--auth-host=reject', '--no-locale', '--encoding=UTF8'])
  // Paths are local generated paths. Reject quote/backslash rather than interpolate unsafe configuration.
  assert(!/[\\'\r\n]/.test(socketDirectory))
  expectedConfiguration = `listen_addresses = ''\nport = ${port}\nunix_socket_directories = '${socketDirectory}'\nunix_socket_permissions = 0700\nmax_connections = 32\nshared_buffers = '32MB'\ntimezone = 'UTC'\n`
  writeFileSync(join(dataDirectory, 'postgresql.conf'), expectedConfiguration, { mode: 0o600 })
  startAttempted = true
  command('pg_ctl', ['-D', dataDirectory, '-l', join(runDirectory, 'postgres.log'), '-w', 'start'])
  started = true
  postmasterPid = Number(readFileSync(join(dataDirectory, 'postmaster.pid'), 'utf8').split('\n')[0])
  report.identity = verifyOwnedServer()
  writeFileSync(join(runDirectory, 'identity-before-client.json'), JSON.stringify(report.identity, null, 2))

  const require = createRequire(join(repo, 'package.json'))
  const { Client } = require('pg')
  const ts = require('typescript')
  const activeConnection = new AsyncLocalStorage()
  const compiled = ts.transpileModule(quotaSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const compiledModule = { exports: {} }
  const load = vm.runInNewContext(`(function(exports, require, module) { ${compiled}\n})`, {}, { filename: 'actual-authenticated-scan-quota.ts' })
  load(compiledModule.exports, (specifier) => {
    assert.equal(specifier, '@/lib/db', 'Unexpected dependency in quota module')
    return { db: () => async (strings, ...values) => {
      const connection = activeConnection.getStore()
      assert(connection, 'Quota query requires an explicitly selected verified session')
      const text = strings.reduce((query, part, index) => query + (index ? `$${index}` : '') + part, '')
      return (await connection.query(text, values)).rows
    } }
  }, compiledModule)
  const { consumeAuthenticatedScanQuota, releaseAuthenticatedScanQuota, AUTHENTICATED_BASIC_SCAN_LIMIT: limit } = compiledModule.exports
  assert.equal(limit, 3)

  async function connect(label) {
    verifyOwnedServer() // Every new session is aimed at the still-owned process.
    const client = new Client({ host: socketDirectory, port, user: role, database: 'postgres', password: '',
      application_name: `quota-${runId}-${label}`, connectionTimeoutMillis: 5_000,
      options: '-c statement_timeout=15000 -c lock_timeout=12000', ssl: false })
    clients.push(client)
    await client.connect()
    const { rows: [identity] } = await client.query(`select current_database() as database, current_user as role,
      current_setting('data_directory') as data_directory, current_setting('listen_addresses') as listen_addresses,
      current_setting('unix_socket_directories') as socket_directory, pg_backend_pid() as pid,
      inet_server_addr() is null as unix_socket, (pg_control_system()).system_identifier::text as system_identifier`)
    assert.equal(identity.database, 'postgres')
    assert.equal(identity.role, role)
    assert.equal(identity.data_directory, dataDirectory)
    assert.equal(identity.listen_addresses, '')
    assert.equal(identity.socket_directory, socketDirectory)
    assert.equal(identity.unix_socket, true)
    assert.equal(identity.system_identifier, report.identity.systemIdentifier)
    report.connections.push({ label, pid: identity.pid, systemIdentifier: identity.system_identifier })
    return Object.assign(client, { verifiedPid: identity.pid })
  }
  const control = await connect('control')
  const sessions = await Promise.all(Array.from({ length: 16 }, (_, index) => connect(`worker-${index}`)))
  assert.equal(new Set(report.connections.map(connection => connection.pid)).size, 17, 'Requires distinct live PostgreSQL backends')
  await control.query('create table accounts (id uuid primary key)')
  await control.query(migration) // Actual migration025, verbatim, only after identity checks.
  report.serverVersion = (await control.query('show server_version')).rows[0].server_version
  const month = (await control.query("select to_char(date_trunc('month', now() at time zone 'UTC'), 'YYYY-MM-DD') as value")).rows[0].value
  const monthDate = new Date(`${month}T00:00:00Z`)
  const resetAt = Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + 1, 1) / 1000
  const reservation = { allowed: true, resetAt }
  const accounts = []
  async function account() {
    const id = randomUUID()
    await control.query('insert into accounts (id) values ($1)', [id])
    accounts.push(id)
    return id
  }
  async function seed(id, count, period = month) {
    await control.query('insert into authenticated_scan_monthly_usage (account_id, month_start, request_count) values ($1, $2, $3)', [id, period, count])
  }
  async function count(id, period = month) {
    const rows = (await control.query('select request_count from authenticated_scan_monthly_usage where account_id=$1 and month_start=$2', [id, period])).rows
    return rows[0]?.request_count ?? 0
  }
  function consume(client, id) {
    return activeConnection.run(client, () => consumeAuthenticatedScanQuota(id))
  }
  function refund(client, id, claim = reservation) {
    return activeConnection.run(client, () => releaseAuthenticatedScanQuota(id, claim))
  }
  async function test(name, execute) {
    const startedAt = Date.now()
    const details = await execute()
    report.tests.push({ name, status: 'passed', milliseconds: Date.now() - startedAt, ...details })
    saveReport()
    process.stdout.write(`PASS ${name}\n`)
  }
  async function waitForRowLock(client) {
    const deadline = Date.now() + 5_000
    while (Date.now() < deadline) {
      const { rows } = await control.query('select wait_event_type, wait_event from pg_stat_activity where pid=$1', [client.verifiedPid])
      if (rows[0]?.wait_event_type === 'Lock') return rows[0]
      await setTimeout(20)
    }
    throw new Error(`Expected a real blocked backend for ${client.verifiedPid}`)
  }
  async function orderedRace(initialCount, firstOperation, secondOperation) {
    const id = await account()
    await seed(id, initialCount)
    const [first, second] = sessions
    await first.query('begin')
    let pending
    try {
      const firstResult = await (firstOperation === 'consume' ? consume(first, id) : refund(first, id))
      pending = (secondOperation === 'consume' ? consume(second, id) : refund(second, id))
        .then(value => ({ value }), error => ({ error }))
      const observedWait = await waitForRowLock(second)
      await first.query('commit')
      const secondResult = await pending
      if (secondResult.error) throw secondResult.error
      return { id, firstResult, secondResult: secondResult.value, finalCount: await count(id), observedWait }
    } finally {
      await first.query('rollback')
      if (pending) await pending
    }
  }

  await test('16 concurrent admissions accept exactly three', async () => {
    const id = await account()
    const decisions = await Promise.all(sessions.map(client => consume(client, id)))
    assert.equal(decisions.filter(decision => decision.allowed).length, limit)
    assert.deepEqual(decisions.filter(decision => decision.allowed).map(decision => decision.remaining).sort(), [0, 1, 2])
    assert(decisions.every(decision => decision.resetAt === resetAt))
    assert.equal(await count(id), limit)
    return { accepted: 3, rejected: 13, finalCount: 3 }
  })
  await test('full quota: refund locks first, admission then succeeds', async () => {
    const result = await orderedRace(3, 'refund', 'consume')
    assert.equal(result.secondResult.allowed, true)
    assert.equal(result.finalCount, 3)
    return result
  })
  await test('full quota: admission locks first and is denied before refund', async () => {
    const result = await orderedRace(3, 'consume', 'refund')
    assert.equal(result.firstResult.allowed, false)
    assert.equal(result.finalCount, 2)
    return result
  })
  await test('one remaining slot: refund first preserves one subsequent admission', async () => {
    const result = await orderedRace(2, 'refund', 'consume')
    assert.equal(result.secondResult.allowed, true)
    assert.equal(result.finalCount, 2)
    return result
  })
  await test('one remaining slot: admission first remains below cap after refund', async () => {
    const result = await orderedRace(2, 'consume', 'refund')
    assert.equal(result.firstResult.allowed, true)
    assert.equal(result.finalCount, 2)
    return result
  })
  await test('last reservation: refund deletion first allows waiting admission', async () => {
    const result = await orderedRace(1, 'refund', 'consume')
    assert.equal(result.secondResult.allowed, true)
    assert.equal(result.finalCount, 1)
    return result
  })
  await test('last reservation: admission first is not deleted by waiting refund', async () => {
    const result = await orderedRace(1, 'consume', 'refund')
    assert.equal(result.firstResult.allowed, true)
    assert.equal(result.finalCount, 1)
    return result
  })
  await test('three simultaneous valid refunds remove the row without zero or negative count', async () => {
    const id = await account()
    await seed(id, 3)
    const [first, second, third] = sessions
    await first.query('begin')
    const pending = []
    try {
      await refund(first, id)
      pending.push(...[second, third].map(client => refund(client, id).then(() => ({}), error => ({ error }))))
      const observedWaits = await Promise.all([second, third].map(waitForRowLock))
      await first.query('commit')
      for (const result of await Promise.all(pending)) if (result.error) throw result.error
      assert.equal(await count(id), 0)
      return { finalCount: 0, observedWaits }
    } finally {
      await first.query('rollback')
      await Promise.all(pending)
    }
  })
  await test('different accounts have independent caps across real concurrent sessions', async () => {
    const ids = await Promise.all([account(), account()])
    const results = await Promise.all(ids.map(async (id, group) => {
      const decisions = await Promise.all(sessions.slice(group * 8, group * 8 + 8).map(client => consume(client, id)))
      assert.equal(decisions.filter(decision => decision.allowed).length, 3)
      assert.equal(await count(id), 3)
      return { accepted: 3, rejected: 5, finalCount: 3 }
    }))
    return { accounts: results }
  })
  await test('UTC month, prior-month refund, and expiry cleanup stay account and period scoped', async () => {
    const id = await account()
    const other = await account()
    const previous = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() - 1, 1)).toISOString().slice(0, 10)
    const expired = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() - 15, 1)).toISOString().slice(0, 10)
    await seed(id, 2, previous)
    await seed(id, 1, expired)
    await seed(other, 1, expired)
    await sessions[0].query("set timezone = 'Pacific/Kiritimati'")
    await sessions[1].query("set timezone = 'America/Adak'")
    const decisions = await Promise.all([consume(sessions[0], id), consume(sessions[1], id)])
    assert(decisions.every(decision => decision.allowed && decision.resetAt === resetAt))
    assert.equal(await count(id), 2)
    assert.equal(await count(id, previous), 2)
    assert.equal(await count(id, expired), 0)
    assert.equal(await count(other, expired), 1)
    await refund(sessions[2], id, { allowed: true, resetAt: monthDate.getTime() / 1000 })
    assert.equal(await count(id, previous), 1)
    assert.equal(await count(id), 2)
    return { utcMonth: month, currentCount: 2, previousCount: 1, ownExpiredCount: 0, otherExpiredCount: 1 }
  })
  const finalRows = (await control.query('select account_id, month_start::text, request_count from authenticated_scan_monthly_usage where account_id = any($1::uuid[]) order by account_id, month_start', [accounts])).rows
  assert(finalRows.every(row => row.request_count > 0 && row.request_count <= limit))
  report.finalRows = finalRows
  report.ownedAccounts = accounts
  assert.equal(report.tests.length, 10)
  report.status = 'passed'
} catch (error) {
  report.status = 'failed'
  report.error = error instanceof Error ? error.stack : String(error)
  process.exitCode = 1
} finally {
  const closed = await Promise.allSettled(clients.map(client => client.end()))
  if (closed.some(result => result.status === 'rejected')) {
    report.status = 'failed'
    report.connectionCloseFailure = true
    process.exitCode = 1
  }
  // pg_ctl can fail or time out after launching a postmaster. Inspect the
  // private, process-created cluster on that path too; do not assume failure
  // means no process was started.
  if (startAttempted && existsSync(join(dataDirectory, 'postmaster.pid'))) {
    try {
      ownPrivateDirectory(runDirectory)
      ownPrivateDirectory(dataDirectory)
      const pidLines = readFileSync(join(dataDirectory, 'postmaster.pid'), 'utf8').split('\n')
      const currentPid = Number(pidLines[0])
      assert(Number.isSafeInteger(currentPid) && currentPid > 1)
      assert.equal(pidLines[1], dataDirectory)
      if (postmasterPid !== undefined) assert.equal(currentPid, postmasterPid)
      assert.equal(realpathSync(`/proc/${currentPid}/exe`), executables.postgres)
      assert.equal(statSync(`/proc/${currentPid}`).uid, uid)
      assert.deepEqual(readFileSync(`/proc/${currentPid}/cmdline`, 'utf8').split('\0').filter(Boolean),
        [executables.postgres, '-D', dataDirectory])
      // On startup failure, this fresh private directory plus exact owner,
      // executable and data-directory command line identifies our own server.
      if (!started) report.startupFailureOwnedPostmaster = currentPid
      command('pg_ctl', ['-D', dataDirectory, '-m', 'fast', '-w', 'stop'])
      assert(!existsSync(join(dataDirectory, 'postmaster.pid')))
      report.clusterStopped = true
    } catch (error) {
      report.status = 'failed'
      report.stopError = String(error)
      process.exitCode = 1
    }
  } else if (startAttempted) {
    report.noPostmasterPidAtCleanup = true
    if (started) {
      report.status = 'failed'
      report.stopError = 'Started cluster lost its PID file before owned-process cleanup could be verified'
      process.exitCode = 1
    }
  }
  saveReport()
  process.stdout.write(`${report.status.toUpperCase()}: ${report.tests.length}/10 cases; evidence ${join(runDirectory, 'report.json')}\n`)
}
