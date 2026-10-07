import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { Client, neonConfig } from '@neondatabase/serverless'
import { redactSecrets } from '../../../../../lib/security/redact-secrets.ts'

const out = 'artifacts/aiso/2026-10-07/uat-execution/retry-2'
const privateDir = '.auth/aiso-uat-20261007'
const target = JSON.parse(readFileSync(out + '/target.json', 'utf8'))
const idle = JSON.parse(readFileSync(out + '/idle-observed-2.json', 'utf8'))
const reviewed = JSON.parse(readFileSync('artifacts/aiso/2026-10-07/uat-follow-up/follow-up-receipt.json', 'utf8')).reviewedInitializationSql
const events = []
const startedAtUtc = new Date().toISOString()
let ownerUri = ''
let appPassword = ''
const secrets = []
function save() { writeFileSync(out + '/initialization.json', JSON.stringify({ startedAtUtc, completedAtUtc: new Date().toISOString(), target, events }, null, 2) + '\n') }
function event(step, data) { events.push({ step, atUtc: new Date().toISOString(), ...data }); save() }
function clean(s) { for (const secret of secrets) if (secret) s = s.replaceAll(secret, '[REDACTED]'); return redactSecrets(s) }
function ensure(value, message) { if (!value) throw new Error(message) }
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
neonConfig.webSocketConstructor = globalThis.WebSocket
async function identity(client) {
  return (await client.query(`select current_setting('neon.project_id', true) as project, current_setting('neon.branch_id', true) as branch, current_database() as database, current_user as role`)).rows[0]
}
function guard(id, role) {
  ensure(id.project === target.projectId && id.branch === target.branchId && id.database === 'neondb' && id.role === role, 'Same-session target identity mismatch or missing GUCs')
  ensure(!['weathered-wave-50814522', 'red-firefly-93523049', 'super-unit-14336637'].includes(id.project), 'Forbidden project')
  ensure(!['br-square-mountain-az6f82vi', 'br-hidden-hill-az61ux9z'].includes(id.branch), 'Forbidden branch')
}
async function connected(uri, operation) {
  const client = new Client({ connectionString: uri }); client.on('error', () => {})
  try { await client.connect(); return await operation(client) } finally { await client.end() }
}
function migrate(args) {
  const started = new Date().toISOString()
  const r = spawnSync(process.execPath, ['scripts/migrate.ts', ...args], { encoding: 'utf8', env: { ...process.env, MIGRATE_DATABASE_URL: ownerUri }, timeout: 180000 })
  const output = clean((r.stdout ?? '') + (r.stderr ?? ''))
  const key = args.length ? args[0].replace(/^--/, '') : 'apply'
  writeFileSync(out + '/migrate-' + key + '-' + events.length + '.log', output)
  event('node scripts/migrate.ts ' + args.join(' '), { startedAtUtc: started, exitCode: r.status, output })
  ensure(r.status === 0 && !r.error, 'Migrator exited unsuccessfully; no guard bypass permitted')
  return output
}
try {
  ensure(target.projectId === 'nameless-term-06793418' && target.branchId === 'br-ancient-glitter-b34yew8s' && target.endpointId === 'ep-soft-bird-b3lqgjne', 'Registered fresh target changed')
  ensure(idle.projectId === target.projectId && idle.endpointId === target.endpointId && idle.currentState === 'idle' && idle.elapsedSeconds >= 300, 'Actual automatic inactivity suspension is unproved')
  const currentSha = spawnSync('git', ['-c', 'core.bare=false', 'rev-parse', 'HEAD'], { encoding: 'utf8' })
  ensure(currentSha.status === 0 && currentSha.stdout.trim() === target.sourceSha, 'Source SHA drift')
  for (const file of reviewed) ensure(sha(readFileSync(file.path)) === file.sha256, 'Reviewed SQL checksum mismatch: ' + file.path)
  const expectedPending = reviewed.filter(f => f.path.startsWith('supabase/migrations/')).map(f => f.path.split('/').at(-1)).sort()
  ensure(expectedPending.length === 21 && expectedPending[0].startsWith('039_') && expectedPending.at(-1).startsWith('059_'), 'Expected expansion mismatch')
  const diskPending = readdirSync('supabase/migrations').filter(f => /^0(?:3[9]|[45][0-9])_.*\.sql$/.test(f)).sort()
  ensure(JSON.stringify(diskPending) === JSON.stringify(expectedPending), 'Pending files changed')
  ownerUri = readFileSync(privateDir + '/owner-uri.txt', 'utf8').trim(); secrets.push(ownerUri)
  const owner = new URL(ownerUri)
  ensure(['postgresql:', 'postgres:'].includes(owner.protocol) && owner.hostname === target.host && decodeURIComponent(owner.username) === 'neondb_owner' && owner.pathname === '/neondb', 'Owner credential endpoint/role mismatch')
  secrets.push(decodeURIComponent(owner.password))
  await connected(ownerUri, async client => {
    const id = await identity(client); guard(id, 'neondb_owner')
    const before = (await client.query(`select (select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE')::int as public_tables, to_regclass('neon_auth."user"')::text as auth_user_relation, (select count(*) from neon_auth."user")::int as auth_users`)).rows[0]
    event('same-session baseline preflight', { identity: id, ...before })
    ensure(before.public_tables === 0 && before.auth_user_relation && before.auth_users === 0, 'Fresh empty public/managed Auth target guard failed')
    const raw = readFileSync('supabase/baseline/000_baseline_2026-08-31.sql', 'utf8'); const checksum = sha(raw)
    await client.query(raw.replaceAll(":'baseline_checksum'", "'" + checksum + "'"))
    const lineage = (await client.query('select filename, checksum from schema_migrations order by filename')).rows
    ensure(lineage.length === 37 && lineage.find(r => r.filename === '000_baseline_2026-08-31.sql')?.checksum === checksum, 'Baseline lineage verification failed')
    event('existing consolidated baseline applied as one owner-session query', { sha256: checksum, exitCode: 0, ledgerRows: lineage.length, syntheticSeedApplied: false })
  })
  migrate(['--verify'])
  const dry = migrate(['--dry-run'])
  const pending = dry.split(/\r?\n/).filter(l => /^\s+0\d\d_.*\.sql\s*$/.test(l)).map(l => l.trim())
  ensure(JSON.stringify(pending) === JSON.stringify(expectedPending), 'Migrator pending list differs from approved 039-059')
  migrate([])
  const afterDry = migrate(['--dry-run']); ensure(afterDry.includes('Nothing to apply'), 'Migrations still pending')
  migrate(['--verify'])
  await connected(ownerUri, async client => {
    guard(await identity(client), 'neondb_owner')
    const role = (await client.query(`select rolcanlogin, rolbypassrls, rolcreatedb, rolcreaterole, rolsuper from pg_roles where rolname='aeo_app'`)).rows[0]
    ensure(role && role.rolcanlogin === false && role.rolbypassrls === true && role.rolcreatedb === false && role.rolcreaterole === false && role.rolsuper === false, 'Fresh application role guard failed')
    appPassword = randomBytes(32).toString('base64url'); secrets.push(appPassword)
    ensure(/^[A-Za-z0-9_-]{43}$/.test(appPassword), 'Generated password shape invalid')
    await client.query("alter role aeo_app login password '" + appPassword + "'")
    const ledger = (await client.query('select filename, checksum from schema_migrations order by filename')).rows
    ensure(ledger.length === 58 && expectedPending.every(f => ledger.some(r => r.filename === f)), 'Final ledger mismatch')
    const rows = (await client.query(`select (select count(*) from accounts)::int as accounts, (select count(*) from profiles)::int as profiles, (select count(*) from clients)::int as clients, (select count(*) from scans)::int as scans`)).rows[0]
    ensure(Object.values(rows).every(n => n === 0), 'Unexpected business data before human sign-in')
    event('fresh aeo_app password and ledger readback', { exitCode: 0, ledger, businessRows: rows, previousRole: role })
  })
  const app = new URL(ownerUri); app.username = 'aeo_app'; app.password = appPassword
  const appUri = app.toString(); secrets.push(appUri)
  await connected(appUri, async client => {
    const id = await identity(client); guard(id, 'aeo_app')
    const relations = (await client.query(`select c.relname, has_table_privilege(current_user,c.oid,'SELECT') as can_select, has_table_privilege(current_user,c.oid,'INSERT') as can_insert, has_table_privilege(current_user,c.oid,'UPDATE') as can_update, has_table_privilege(current_user,c.oid,'DELETE') as can_delete from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') order by c.relname`)).rows
    ensure(relations.length > 0 && relations.every(r => ['can_select','can_insert','can_update','can_delete'].every(p => r[p] === true)), 'Application table privilege failure')
    await client.query('begin')
    let denied = false
    try { await client.query('create table public.aiso_uat_ddl_denial_probe (id integer)') } catch (error) { denied = error.code === '42501' } finally { await client.query('rollback') }
    ensure(denied, 'Application role was able to perform forbidden public DDL')
    event('real aeo_app identity/grants and rolled-back DDL denial', { exitCode: 0, identity: id, relationsChecked: relations.length, deniedCode: '42501', tenancyAcceptance: 'Application filtering still requires real human cross-tenant UAT' })
  })
  mkdirSync(privateDir, { recursive: true })
  const runtime = { DATABASE_URL: appUri, NEON_AUTH_COOKIE_SECRET: randomBytes(32).toString('hex'), PUBLIC_SCAN_RATE_LIMIT_SECRET: randomBytes(32).toString('hex'), REPORT_SHARE_SECRET: randomBytes(32).toString('hex'), READINESS_PROBE_SECRET: randomBytes(32).toString('hex'), EXPECTED_NEON_PROJECT_ID: target.projectId, EXPECTED_NEON_BRANCH_ID: target.branchId, EXPECTED_DB_NAME: 'neondb', EXPECTED_DB_ROLE: 'aeo_app', FORBIDDEN_NEON_PROJECT_IDS: 'weathered-wave-50814522,red-firefly-93523049', FORBIDDEN_NEON_BRANCH_IDS: 'br-square-mountain-az6f82vi,br-hidden-hill-az61ux9z', FEATURE_SEARCH_CONSOLE: 'false', FEATURE_PULSE_ATTEMPTS: 'false', READINESS_EXPECTED_TEAM_ID: 'team_qvzlsFmfCsLkgItSypqHjw3z' }
  writeFileSync(privateDir + '/runtime.json', JSON.stringify(runtime), { flag: 'wx', mode: 0o600 })
  event('initialization finished', { status: 'pass', exitCode: 0, privateRuntimeWritten: true, productionChanged: false })
  console.log('Fresh UAT baseline + 21 expansion migrations + isolated aeo_app checks passed. No business rows seeded.')
} catch (error) {
  event('initialization stopped', { status: 'blocked', exitCode: 1, error: clean(String(error?.message ?? error)), code: error?.code ?? null })
  console.error('Fresh UAT initialization stopped: ' + clean(String(error?.message ?? error))); process.exitCode = 1
}
