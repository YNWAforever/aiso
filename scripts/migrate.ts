/**
 * Ledger-backed migration runner for the Neon database.
 *
 *   npm run migrate -- --verify     # what is actually applied here?
 *   npm run migrate -- --dry-run
 *   npm run migrate
 *   npm run migrate -- --baseline --except <file> [--except <file> ...]
 *
 * Run --verify FIRST on any database whose ledger does not exist yet. It reports
 * which migrations' tables are present, which is the only reliable answer to
 * what has actually been applied — the ledger cannot tell you, and the prose in
 * CLAUDE.md has been wrong about it before.
 *
 * Applies every file in supabase/migrations/ that is absent from the
 * schema_migrations ledger, each inside its own transaction, in filename order.
 *
 * SAFETY: refuses to run against a populated database that has no ledger. See
 * assertBaselined() — this is what stops a fresh runner re-applying 001-026 and
 * 028 to production.
 *
 * On failure, the ledger stays consistent with the schema without any explicit
 * rollback code: each migration's `begin; sql; insert; commit;` travels to
 * Postgres as one string, so if `sql` errors the session enters an aborted
 * transaction; the ledger insert then errors too (ignored — commands in an
 * aborted transaction always error), and the trailing `commit` on an aborted
 * transaction rolls back rather than commits. Neither the schema change nor
 * the ledger row survives. Earlier migrations in the same run already
 * committed in their own prior `pool.query()` call and are unaffected; later
 * ones are never attempted, since the thrown error unwinds the `for` loop.
 */
import { readdirSync, readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool, neonConfig } from '@neondatabase/serverless'
// node needs the explicit .ts extension to resolve this relative import when
// running this file directly (plain node, no bundler); tsc rejects that
// extension under moduleResolution "bundler" without repo-wide
// allowImportingTsExtensions, which would also loosen next build's check on
// app/, lib/ and components/. Suppress narrowly instead of widening globally.
// @ts-expect-error -- see comment above; node requires the extension, tsc forbids it
import { redactSecrets } from '../lib/security/redact-secrets.ts'

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations')

/** Files present on disk but absent from the ledger, in filename order. */
export function planMigrations(files: string[], applied: string[]): string[] {
  const done = new Set(applied)
  return [...files].sort().filter((f) => !done.has(f))
}

/**
 * Every table a migration creates, unqualified and lowercased.
 *
 * Used to check a baseline claim against reality: recording a migration as
 * applied is irreversible in practice — it permanently removes the only path by
 * which its objects would ever be created — so before writing that row the
 * runner confirms the tables actually exist.
 *
 * This is not a general SQL parser and does not need to be. It reads its own
 * repo's migrations, which use `create table [if not exists] [public.]name`
 * uniformly. A table it fails to spot merely goes unchecked; it cannot produce
 * a false accusation, because every name it returns is one the file really does
 * create.
 */
export function migrationCreatedTables(sql: string): string[] {
  const stripped = stripNonStatements(sql)
  const pattern = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/gi
  return [...new Set([...stripped.matchAll(pattern)].map((m) => m[1].toLowerCase()))]
}

/** Every index a migration creates, by name, lowercased. */
export function migrationCreatedIndexes(sql: string): string[] {
  const stripped = stripNonStatements(sql)
  const pattern =
    /create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/gi
  return [...new Set([...stripped.matchAll(pattern)].map((m) => m[1].toLowerCase()))]
}

/**
 * Everything a migration creates that can be probed for afterwards.
 *
 * Tables alone were not enough. A migration that only adds an index or changes a
 * column default creates no table, so the baseline check had nothing to test and
 * waved it through — and two of the four currently-pending migrations are
 * exactly that shape (031 is index-only, 030 sets a default). Indexes close half
 * that gap; a migration that creates neither is still unverifiable this way and
 * is deliberately left alone rather than guessed at.
 */
export function migrationCreatedRelations(sql: string): string[] {
  return [...new Set([...migrationCreatedTables(sql), ...migrationCreatedIndexes(sql)])]
}

/** Every table a migration drops, unqualified and lowercased. */
export function migrationDroppedTables(sql: string): string[] {
  const stripped = stripNonStatements(sql)
  const pattern = /drop\s+table\s+(?:if\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/gi
  return [...new Set([...stripped.matchAll(pattern)].map((m) => m[1].toLowerCase()))]
}

/**
 * Baseline entries that cannot be true, i.e. migrations whose objects are absent.
 *
 * `entries` must be in apply order. A table created by one migration and dropped
 * by a later one is legitimately absent — 028 drops `plan_features`, which 014
 * creates — so a create is only evidence of anything until something later
 * removes it. Ignoring that would accuse 014 of never having run.
 *
 * `existing` is the set of table and index names actually present. A migration
 * creating neither is unverifiable this way and is deliberately left alone:
 * absence of evidence must not read as evidence of absence.
 */
export function unappliedBaselineClaims(
  entries: Array<{ filename: string; creates: string[]; drops: string[] }>,
  existingTables: Set<string>,
): Array<{ filename: string; missing: string[] }> {
  return entries
    .map(({ filename, creates }, index) => {
      const droppedLater = new Set(entries.slice(index + 1).flatMap((e) => e.drops))
      return {
        filename,
        missing: creates.filter((t) => !existingTables.has(t) && !droppedLater.has(t)),
      }
    })
    .filter((e) => e.missing.length > 0)
}

/**
 * Strips spans the transaction-control check below must not look inside:
 *  - Dollar-quoted bodies, which legitimately contain `begin` and `end`. Tags
 *    can be anonymous (`$$`) or named (`$function$`, `$acl$`, ...); a
 *    backreference makes an opening tag close only on its own matching tag,
 *    not the first dollar-quote delimiter that happens to follow.
 *  - SQL line and block comments. These aren't whitespace, so without
 *    stripping them a comment directly above a bare `begin;`/`commit;`/
 *    `rollback;` would hide it from the anchor below and let it slip through
 *    undetected.
 * Order matters: dollar-quoted spans are removed first so a comment-like
 * sequence that's literal content inside one isn't mistaken for a real comment.
 */
function stripNonStatements(sql: string): string {
  return sql
    .replace(/\$([A-Za-z_][A-Za-z0-9_]*)?\$[\s\S]*?\$\1\$/g, '')
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
}

/**
 * Each migration is wrapped in an explicit transaction by the runner, so a file
 * containing its own begin/commit/rollback would break that nesting.
 */
export function assertNoTransactionControl(filename: string, sql: string): void {
  const stripped = stripNonStatements(sql)
  const offender = /(^|;)\s*(begin|commit|rollback)\s*;/i.exec(stripped)
  if (offender) {
    throw new Error(
      `${filename} contains transaction control (${offender[2]}). The runner wraps each ` +
      `migration in a transaction; remove it from the file.`,
    )
  }
}

// Filenames come from readdirSync on our own repo directory, not user input —
// but the apply path below interpolates the filename into a SQL string rather
// than a parameter (see the comment there for why). Constraining the charset
// here is a cheap backstop against that interpolation ever seeing a quote.
const SAFE_FILENAME = /^[\w.-]+\.sql$/

export function listMigrationFiles(): string[] {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
  const unsafe = files.filter((f) => !SAFE_FILENAME.test(f))
  if (unsafe.length) {
    throw new Error(`Unexpected migration filename(s), refusing to run: ${unsafe.join(', ')}`)
  }
  return files
}

/**
 * Migrations run as the OWNER, not as the application role.
 *
 * The app connects as aeo_app (migration 037), which deliberately cannot
 * perform DDL. Deliberately no fallback to DATABASE_URL: falling back would run
 * migrations as the app role, fail partway through the first DDL statement, and
 * leave the operator staring at a permission error with no clue why. Failing
 * here, by name, is strictly better.
 */
function connectionString(): string {
  const url = process.env.MIGRATE_DATABASE_URL
  if (!url) {
    throw new Error(
      'MIGRATE_DATABASE_URL is not set. Migrations run as the database owner, not as the ' +
      'least-privilege application role in DATABASE_URL. Set MIGRATE_DATABASE_URL to the ' +
      'owner connection string.',
    )
  }
  return url
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const dryRun = argv.includes('--dry-run')
  const baseline = argv.includes('--baseline')
  const verify = argv.includes('--verify')
  const exceptIndex = argv.indexOf('--except')
  const except = exceptIndex === -1 ? [] : argv.slice(exceptIndex + 1).filter((a) => !a.startsWith('--'))

  const files = listMigrationFiles()

  // A misspelt --except silently baselines the file it was meant to exclude,
  // which is unrecoverable: the ledger then says a migration ran that never did,
  // and nothing will ever create its objects. Check the names before connecting.
  const unknown = except.filter((f) => !files.includes(f))
  if (unknown.length) {
    throw new Error(
      `--except names no such migration: ${unknown.join(', ')}\n` +
      'Check the spelling against supabase/migrations/.',
    )
  }
  // --except is only consumed by the baseline branch. Without this, passing it
  // alone silently APPLIES everything it was meant to hold back.
  if (except.length && !baseline) {
    throw new Error('--except only applies to --baseline. Refusing to run, since without ' +
      '--baseline it would apply the migrations you asked to exclude.')
  }

  neonConfig.webSocketConstructor = globalThis.WebSocket
  const pool = new Pool({ connectionString: connectionString() })

  try {
    await pool.query(`
      create table if not exists schema_migrations (
        filename text primary key,
        applied_at timestamptz not null default now()
      )
    `)

    if (verify) {
      await reportAppliedState(pool, files)
      return
    }

    if (baseline) {
      const toRecord = files.filter((f) => !except.includes(f))

      // Recording a migration as applied removes the only path by which its
      // objects would ever be created, so prove the claim before writing it.
      // This is the check that catches a migration everyone believes ran.
      const existing = await existingRelationNames(pool)
      const impossible = unappliedBaselineClaims(
        toRecord.map((filename) => {
          const sql = readFileSync(join(MIGRATIONS_DIR, filename), 'utf8')
          return {
            filename,
            creates: migrationCreatedRelations(sql),
            drops: migrationDroppedTables(sql),
          }
        }),
        existing,
      )
      if (impossible.length) {
        throw new Error(
          'Refusing to baseline — these migrations create objects that do not exist, so they\n' +
          'cannot already have been applied. Recording them would strand their objects with\n' +
          'no way to create them:\n' +
          impossible.map((e) => `  ${e.filename} → missing ${e.missing.join(', ')}`).join('\n') +
          '\n\nAdd each to --except so it stays pending and gets applied normally.',
        )
      }

      if (dryRun) {
        console.log(`Would baseline ${toRecord.length} migration(s) as already applied.`)
        if (except.length) console.log(`Would leave pending: ${except.join(', ')}`)
        return
      }
      // One transaction. A partial baseline is worse than none: assertBaselined
      // only checks that the ledger is empty, so a single stray row disarms it
      // permanently and the next run replays applied migrations against
      // production.
      const values = toRecord.map((_, i) => `($${i + 1})`).join(', ')
      await pool.query(
        `insert into schema_migrations (filename) values ${values} on conflict do nothing`,
        toRecord,
      )
      console.log(`Baselined ${toRecord.length} migration(s) as already applied.`)
      if (except.length) console.log(`Left pending: ${except.join(', ')}`)
      return
    }

    await assertBaselined(pool)

    const { rows } = await pool.query('select filename from schema_migrations')
    const pending = planMigrations(files, rows.map((r: { filename: string }) => r.filename))

    if (pending.length === 0) {
      console.log('Nothing to apply — the database is up to date.')
      return
    }

    if (dryRun) {
      console.log(`Would apply ${pending.length} migration(s):`)
      for (const f of pending) console.log(`  ${f}`)
      return
    }

    for (const filename of pending) {
      const sql = readFileSync(join(MIGRATIONS_DIR, filename), 'utf8')
      assertNoTransactionControl(filename, sql)
      process.stdout.write(`Applying ${filename} … `)
      // filename is interpolated, not parameterised, because this whole block
      // (begin / migration SQL / ledger insert / commit) has to travel to
      // Postgres as one multi-statement string over the simple query protocol
      // to run atomically on this Pool — the extended protocol used for
      // parameterised queries rejects more than one statement per call. That's
      // safe here because listMigrationFiles() already rejects any filename
      // outside [A-Za-z0-9_.-]+.sql, so it can't contain a quote.
      await pool.query(
        `begin;\n${sql}\n;\ninsert into schema_migrations (filename) values ('${filename}');\ncommit;`,
      )
      console.log('ok')
    }
    console.log(`Applied ${pending.length} migration(s).`)
  } finally {
    await pool.end()
  }
}

/**
 * Every table AND index name in the public schema, lowercased.
 *
 * One set rather than two: both live in pg_class, the names cannot collide, and
 * a migration's baseline claim is judged the same way whichever it created.
 */
async function existingRelationNames(pool: Pool): Promise<Set<string>> {
  const { rows } = await pool.query(`
    select table_name as name from information_schema.tables where table_schema = 'public'
    union
    select indexname as name from pg_indexes where schemaname = 'public'
  `)
  return new Set(rows.map((r: { name: string }) => r.name.toLowerCase()))
}

/**
 * Reports, per migration, whether the tables it creates are present — the
 * answer to "what is actually applied here?" when the ledger does not exist yet
 * or is not trusted.
 *
 * This exists because three places in this repo disagreed about whether
 * migration 021 had been applied, and the only way to settle it was a query
 * nobody could run. It is read-only.
 */
async function reportAppliedState(pool: Pool, files: string[]): Promise<void> {
  const existing = await existingRelationNames(pool)
  const { rows } = await pool.query('select filename from schema_migrations')
  const ledger = new Set(rows.map((r: { filename: string }) => r.filename))

  console.log('migration                                  objects     ledger')
  for (const filename of files) {
    const creates = migrationCreatedRelations(readFileSync(join(MIGRATIONS_DIR, filename), 'utf8'))
    const missing = creates.filter((t) => !existing.has(t))
    const state = creates.length === 0
      ? 'n/a       '
      : missing.length === 0 ? 'all present' : `MISSING ${missing.length}`.padEnd(11)
    console.log(`${filename.padEnd(42)} ${state} ${ledger.has(filename) ? 'recorded' : '-'}`)
    if (missing.length) console.log(`${' '.repeat(42)}   ↳ ${missing.join(', ')}`)
  }
}

/**
 * A populated database with no ledger is almost certainly production, where the
 * migrations were applied by hand. Running them again would be destructive, so
 * stop and make the operator baseline it deliberately.
 */
export async function assertBaselined(pool: Pick<Pool, 'query'>): Promise<void> {
  const { rows } = await pool.query(`
    select
      (select count(*) from schema_migrations) as ledger_rows,
      (select count(*) from information_schema.tables
        where table_schema = 'public' and table_name = 'accounts') as has_accounts
  `)
  const ledgerRows = Number(rows[0].ledger_rows)
  const hasAccounts = Number(rows[0].has_accounts) > 0
  if (ledgerRows === 0 && hasAccounts) {
    throw new Error(
      'This database has application tables but an empty schema_migrations ledger.\n' +
      'Applying migrations now would re-run migrations that were applied by hand.\n\n' +
      'First find out what is actually applied:\n' +
      '  npm run migrate -- --verify\n\n' +
      'Then baseline, excepting EVERY migration that has not run — anything you\n' +
      'forget is recorded as applied without ever running:\n' +
      '  npm run migrate -- --baseline --except <file> [--except <file> ...]',
    )
  }
}

/**
 * Only run when invoked directly, so the pure helpers can be imported by tests
 * (and, in principle, by other scripts) without triggering a live DB run.
 * Compares the resolved entry-script path to this module's own resolved path,
 * rather than matching a filename suffix — an `.endsWith('migrate.ts')` check
 * would also fire for any *other* entry point whose name happens to end in
 * those characters (e.g. a hypothetical `db-migrate.ts`) if it ever imported
 * these helpers. realpathSync guards against symlinks resolving differently
 * on the two sides of the comparison.
 */
function isDirectInvocation(): boolean {
  if (!process.argv[1]) return false
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
}

/** A thrown value's `.message`, trimmed, or '' when it has none worth printing. */
function messageOf(value: unknown): string {
  if (typeof value !== 'object' || value === null) return ''
  const { message } = value as { message?: unknown }
  return typeof message === 'string' ? message.trim() : ''
}

/**
 * Name a thrown value that carries no message, so output is never empty.
 *
 * Prefers `name`, falling back to the constructor, and appends `code`/`type`
 * when present — for a WebSocket failure those are the only fields with any
 * signal in them.
 */
function errorLabel(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value !== 'object') return `${typeof value} ${String(value)}`

  const e = value as { name?: unknown; code?: unknown; type?: unknown; constructor?: { name?: string } }
  const bits = [
    typeof e.name === 'string' && e.name ? e.name : e.constructor?.name,
    typeof e.code === 'string' || typeof e.code === 'number' ? `code=${e.code}` : undefined,
    typeof e.type === 'string' && e.type ? `type=${e.type}` : undefined,
  ].filter(Boolean) as string[]

  return bits.length ? bits.join(' ') : 'unknown error'
}

/**
 * Render a thrown value as something an operator can act on, always redacted.
 *
 * `String(err.message)` was not enough, and the failure was silent: a suspended
 * Neon compute makes the WebSocket Pool reject with an ErrorEvent-shaped object
 * whose `.message` is the empty string, so the runner printed a bare
 * `Migration failed:` with nothing after it — indistinguishable from a broken
 * migration runner. Observed against production on 2026-08-16; re-running once
 * the compute woke worked unchanged. It also threw a second error outright when
 * the rejection was `null`, since `null.message` is a TypeError.
 *
 * Every branch goes through redactSecrets rather than only the message. The
 * driver embeds the full connection string, password included, in some of these
 * fields, and this is the last point before a live credential reaches a terminal
 * — so the redaction is applied once, at the end, over everything assembled.
 */
export function describeError(err: unknown): string {
  const parts: string[] = []

  const message = messageOf(err)
  parts.push(message || `${errorLabel(err)} (no message)`)

  const cause = typeof err === 'object' && err !== null ? (err as { cause?: unknown }).cause : undefined
  if (cause !== undefined && cause !== null) {
    parts.push(`cause: ${messageOf(cause) || errorLabel(cause)}`)
  }

  // AggregateError — what a Pool raises when every connection attempt fails.
  const aggregate = typeof err === 'object' && err !== null ? (err as { errors?: unknown }).errors : undefined
  if (Array.isArray(aggregate)) {
    aggregate.slice(0, 5).forEach((inner, index) => {
      parts.push(`errors[${index}]: ${messageOf(inner) || errorLabel(inner)}`)
    })
  }

  return redactSecrets(parts.join(' | '))
}

/**
 * The actionable hint for the one failure mode that reads as a bug but is not.
 *
 * Deliberately narrow: only an empty-message ErrorEvent-shaped rejection, which
 * is what an auto-suspended compute produces. A real failure carries a message
 * and must not be dressed up as a cold start.
 */
export function coldStartHint(err: unknown): string | undefined {
  if (messageOf(err)) return undefined

  const label = errorLabel(err).toLowerCase()
  const looksLikeSocket = label.includes('errorevent') || label.includes('type=error') ||
    label.includes('websocket') || label.includes('econnreset')
  if (!looksLikeSocket) return undefined

  return 'The Neon compute may be auto-suspended. A cold start rejects with an empty-message ' +
    'ErrorEvent like this one, and it is usually transient — re-run the same command. ' +
    'Confirm the outcome with `--verify` rather than assuming; if it repeats against a warm ' +
    'compute, the failure is real.'
}

if (isDirectInvocation()) {
  main().catch((err) => {
    // Never print the raw error: the driver embeds the full connection string,
    // password included, in its messages. describeError redacts every branch it
    // walks, not just the message.
    console.error('Migration failed:', describeError(err))
    const hint = coldStartHint(err)
    if (hint) console.error(hint)
    process.exit(1)
  })
}
