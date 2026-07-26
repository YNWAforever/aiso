/**
 * Ledger-backed migration runner for the Neon database.
 *
 *   npm run migrate -- --dry-run
 *   npm run migrate
 *   npm run migrate -- --baseline --except 027_client_report_snapshots.sql
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

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations')

/** Files present on disk but absent from the ledger, in filename order. */
export function planMigrations(files: string[], applied: string[]): string[] {
  const done = new Set(applied)
  return [...files].sort().filter((f) => !done.has(f))
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

function connectionString(): string {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  return url
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const dryRun = argv.includes('--dry-run')
  const baseline = argv.includes('--baseline')
  const exceptIndex = argv.indexOf('--except')
  const except = exceptIndex === -1 ? [] : argv.slice(exceptIndex + 1).filter((a) => !a.startsWith('--'))

  neonConfig.webSocketConstructor = globalThis.WebSocket
  const pool = new Pool({ connectionString: connectionString() })

  try {
    await pool.query(`
      create table if not exists schema_migrations (
        filename text primary key,
        applied_at timestamptz not null default now()
      )
    `)

    const files = listMigrationFiles()

    if (baseline) {
      const toRecord = files.filter((f) => !except.includes(f))
      if (dryRun) {
        console.log(`Would baseline ${toRecord.length} migration(s) as already applied.`)
        if (except.length) console.log(`Would leave pending: ${except.join(', ')}`)
        return
      }
      for (const f of toRecord) {
        await pool.query('insert into schema_migrations (filename) values ($1) on conflict do nothing', [f])
      }
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
 * A populated database with no ledger is almost certainly production, where the
 * migrations were applied by hand. Running them again would be destructive, so
 * stop and make the operator baseline it deliberately.
 */
async function assertBaselined(pool: Pool): Promise<void> {
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
      'Applying migrations now would re-run migrations that were applied by hand.\n' +
      'Baseline it first, e.g.:\n' +
      '  npm run migrate -- --baseline --except 027_client_report_snapshots.sql',
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

if (isDirectInvocation()) {
  main().catch((err) => {
    // Never print the raw error: the driver embeds the full connection string,
    // password included, in its messages.
    console.error('Migration failed:', String(err.message).replace(/postgresql:\/\/\S+/g, '[redacted]'))
    process.exit(1)
  })
}
