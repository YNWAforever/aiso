import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Client, neonConfig } from '@neondatabase/serverless'

// Relative, with the explicit .ts extension, as scripts/schema-equivalence.mjs
// already imports it: this runs under plain node, which resolves neither the
// '@/' alias nor extensionless .ts files.
import { redactSecrets } from '../lib/security/redact-secrets.ts'

const BASELINE_FILE = join(process.cwd(), 'supabase', 'baseline', '000_baseline_2026-08-31.sql')
const SEED_FILE = join(process.cwd(), 'supabase', 'seeds', '001_synthetic.sql')

/**
 * Installs the greenfield schema baseline onto ONE named, empty target.
 *
 *   BOOTSTRAP_PROJECT_ID=... BOOTSTRAP_BRANCH_ID=... BOOTSTRAP_DATABASE_URL=... \
 *     npm run bootstrap:project
 *
 * Deliberately NOT the same shape as scripts/schema-equivalence.mjs. That script
 * must refuse anything but a disposable branch it created itself; this one must
 * ACCEPT a real branch by name while refusing a database that already has
 * content. Merging them would mean weakening the guard least worth weakening.
 *
 * The guards below are exported and unit-tested without a database, because they
 * are the decisions that could destroy data.
 */

/** Production. Refused by id, never by convention. */
export const PRODUCTION_PROJECT_ID = 'red-firefly-93523049'

/**
 * The target, read from the environment. There is NO default and there must
 * never be one: a defaulted target is how a stale variable reaches a database
 * nobody meant to touch.
 *
 * Deploy environments substitute '' for a variable that is declared but has no
 * value, and '' is not a target -- so every read is coerced, trimmed, and then
 * tested for emptiness. `String(... ?? '')` rather than `?.trim()`: optional
 * chaining short-circuits only on null/undefined, so a non-string value would
 * reach .trim() and throw a raw TypeError instead of this guard's message.
 */
export function resolveTarget(env = process.env) {
  const projectId = String(env.BOOTSTRAP_PROJECT_ID ?? '').trim()
  const branchId = String(env.BOOTSTRAP_BRANCH_ID ?? '').trim()
  const connectionUri = String(env.BOOTSTRAP_DATABASE_URL ?? '').trim()

  const missing = [
    !projectId && 'BOOTSTRAP_PROJECT_ID',
    !branchId && 'BOOTSTRAP_BRANCH_ID',
    !connectionUri && 'BOOTSTRAP_DATABASE_URL',
  ].filter(Boolean)

  if (missing.length) {
    throw new Error(
      `Refusing to run: ${missing.join(', ')} not set (or empty). This script has no ` +
      'default target, deliberately -- name the project, branch and connection explicitly.',
    )
  }
  return { projectId, branchId, connectionUri }
}

/**
 * Asks the connection who it is, and compares that to who we meant to reach.
 *
 * Neon exposes neon.project_id / neon.branch_id as GUCs, so the target
 * identifies itself IN BAND on the very session that will run the statements,
 * rather than being inferred from a variable that could be stale. Absent GUCs
 * read as null and fail the comparison -- it fails closed.
 */
export function assertTargetIdentity(target, reported) {
  const onProject = reported?.projectId ?? null
  const onBranch = reported?.branchId ?? null

  if (!onProject || !onBranch) {
    throw new Error(
      'Refusing to act: the connection did not report neon.project_id / neon.branch_id. ' +
      'Absent GUCs read as null and this check fails closed rather than guessing.',
    )
  }
  if (onProject === PRODUCTION_PROJECT_ID) {
    throw new Error(
      `Refusing to act: the connection reports project ${onProject}, which is production. ` +
      'This script never touches production, whatever it was asked to do.',
    )
  }
  if (onProject !== target.projectId || onBranch !== target.branchId) {
    throw new Error(
      `Refusing to act: the connection reports branch ${onBranch} in project ${onProject}, ` +
      `but the target is ${target.branchId} in ${target.projectId}.`,
    )
  }
}

/**
 * A baseline installs onto an empty schema. Anything already there means this
 * is not a fresh project, and applying 3200 lines of DDL over it is not a
 * recovery procedure.
 */
export function assertEmptyPublicSchema(tableCount) {
  // Number() is far too permissive for a "did we actually read a value" check:
  // Number(null), Number(''), Number([]) and Number(false) are all 0, so an
  // unreadable count would sail through as "empty" and the caller would apply
  // the whole baseline over a database it never actually inspected. Reject
  // anything that is not a string or a number before coercing -- and reject
  // an empty (or whitespace-only) string explicitly, because it is still a
  // `string` and Number('') is *also* 0, so the typeof check alone does not
  // catch it.
  if (typeof tableCount !== 'string' && typeof tableCount !== 'number') {
    throw new Error(
      `Refusing to act: could not read the public table count (got ${JSON.stringify(tableCount)}).`,
    )
  }
  if (typeof tableCount === 'string' && tableCount.trim() === '') {
    throw new Error(
      `Refusing to act: could not read the public table count (got ${JSON.stringify(tableCount)}).`,
    )
  }
  const count = Number(tableCount)
  if (!Number.isInteger(count)) {
    throw new Error(
      `Refusing to act: could not read the public table count (got ${JSON.stringify(tableCount)}).`,
    )
  }
  if (count !== 0) {
    throw new Error(
      `Refusing to act: schema public already has ${count} table(s), so this is not a fresh ` +
      'project. To rebuild one deliberately, reset it first: ' +
      'drop schema public cascade; create schema public;',
    )
  }
}

/**
 * One session, on the named target, after the identity check.
 *
 * A single Client rather than a Pool, so the session that answers the identity
 * question is unambiguously the session that runs the statements. The error
 * listener is not optional: without it the driver rethrows connection failures
 * on the process and dumps the client -- password included -- to the log.
 */
async function withTargetClient(target, fn) {
  neonConfig.webSocketConstructor = globalThis.WebSocket
  const client = new Client({ connectionString: target.connectionUri })
  client.on('error', () => {})
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

/** What the connection says it is, plus what is already in public. */
async function inspect(client) {
  const { rows } = await client.query(
    "select current_setting('neon.project_id', true) as project_id, " +
    "current_setting('neon.branch_id', true) as branch_id, " +
    "current_user as role, " +
    "(select count(*) from information_schema.tables where table_schema = 'public') as tables",
  )
  return {
    projectId: rows[0]?.project_id ?? null,
    branchId: rows[0]?.branch_id ?? null,
    role: rows[0]?.role ?? null,
    tables: rows[0]?.tables,
  }
}

/**
 * `migrate --dry-run` against the target, as text.
 *
 * Captures stdout so the caller can assert on it. Both paths go through
 * redactSecrets -- the driver embeds the full connection URL, password
 * included, in some error fields.
 */
function migrateDryRun(connectionUri) {
  try {
    return redactSecrets(execFileSync('node', ['scripts/migrate.ts', '--dry-run'], {
      env: { ...process.env, MIGRATE_DATABASE_URL: connectionUri },
      encoding: 'utf8',
    }))
  } catch (err) {
    const stdout = typeof err?.stdout === 'string' ? err.stdout : ''
    const stderr = typeof err?.stderr === 'string' ? err.stderr : ''
    return redactSecrets(`${stdout}${stderr}` || String(err?.message ?? err))
  }
}

/** Everything the baseline must have produced. Reported as a table, not a boolean. */
async function verify(client) {
  const { rows } = await client.query(`
    select
      (select count(*) from information_schema.tables where table_schema = 'public') as tables,
      (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public') as functions,
      (select count(*) from schema_migrations) as ledger_rows,
      (select count(*) from pg_roles where rolname = 'aeo_app') as aeo_app,
      (select coalesce(bool_or(rolbypassrls), false) from pg_roles
        where rolname = 'aeo_app') as aeo_app_bypassrls,
      (select count(*) from information_schema.role_table_grants
        where grantee = 'aeo_app' and table_schema = 'public') as aeo_app_table_grants
  `)
  return rows[0]
}

async function main() {
  const target = resolveTarget()
  console.log(`Target: branch ${target.branchId} in project ${target.projectId}`)

  await withTargetClient(target, async (client) => {
    const before = await inspect(client)
    console.log(`Connection reports: project ${before.projectId} branch ${before.branchId} ` +
      `role ${before.role} public_tables ${before.tables}`)

    assertTargetIdentity(target, before)
    assertEmptyPublicSchema(before.tables)

    // The hash is over the file AS READ, before substitution -- that is the
    // digest the lineage row records, and .gitattributes pins the file to LF so
    // it is the same on Windows and CI.
    const raw = readFileSync(BASELINE_FILE, 'utf8')
    const checksum = createHash('sha256').update(raw).digest('hex')
    console.log(`Applying baseline (sha256 ${checksum.slice(0, 12)}...)`)

    // One client.query(). Postgres wraps a multi-statement simple Query in an
    // implicit transaction, so this is all-or-nothing: a failure anywhere leaves
    // the database untouched rather than half-built.
    await client.query(raw.replaceAll(":'baseline_checksum'", `'${checksum}'`))

    const after = await verify(client)
    console.log('\nVerification:')
    for (const [k, v] of Object.entries(after)) console.log(`  ${String(k).padEnd(22)} ${v}`)

    if (Number(after.aeo_app) !== 1) throw new Error('Baseline applied but aeo_app does not exist.')
    if (after.aeo_app_bypassrls !== true) {
      throw new Error('aeo_app exists without BYPASSRLS. The seven RLS-enabled, zero-policy ' +
        'tables would return zero rows silently to every app query.')
    }

    // Applied inside the same session, after verification: a seed over an
    // unverified schema tells you nothing about either.
    console.log('\nApplying synthetic seed')
    await client.query(readFileSync(SEED_FILE, 'utf8'))

    // Re-run it immediately. `on conflict do nothing` does NOT make the client
    // insert idempotent on its own -- the BEFORE INSERT brand-limit trigger runs
    // before the arbiter -- so the only honest check is to do it twice here,
    // where a failure is loud, rather than discover it on someone's second run.
    await client.query(readFileSync(SEED_FILE, 'utf8'))
    const seeded = await client.query(
      'select (select count(*) from accounts) as accounts, ' +
      '(select count(*) from clients) as clients, ' +
      '(select count(*) from scans) as scans',
    )
    console.log(`Seed applied twice: ${JSON.stringify(seeded.rows[0])}`)
  })

  // Outside the session on purpose: this shells out to the real runner, which
  // opens its own connection, exactly as the equivalence proof does.
  const dry = migrateDryRun(target.connectionUri)
  const ok = dry.includes('Nothing to apply')
  console.log(`\nBootstrap proof: ${ok ? 'ok -- runner finds nothing pending' : 'FAILED'}`)
  if (!ok) {
    console.log(dry.trim())
    throw new Error('The runner still reports pending migrations against a baselined database.')
  }
}

main().catch((error) => {
  // Never print the raw error: the driver embeds the full connection string,
  // password included, in its messages.
  console.error('Bootstrap failed:', redactSecrets(String(error?.message ?? error)))
  process.exitCode = 1
})
