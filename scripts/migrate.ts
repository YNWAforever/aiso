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
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Pool, neonConfig } from '@neondatabase/serverless'

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations')

/** Files present on disk but absent from the ledger, in filename order. */
export function planMigrations(files: string[], applied: string[]): string[] {
  const done = new Set(applied)
  return [...files].sort().filter((f) => !done.has(f))
}

/**
 * Each migration is wrapped in an explicit transaction by the runner, so a file
 * containing its own begin/commit/rollback would break that nesting. Dollar-quoted
 * function bodies legitimately contain `begin` and `end`, so only match statement
 * starts, not occurrences inside a $$ ... $$ block.
 */
export function assertNoTransactionControl(filename: string, sql: string): void {
  const withoutDollarQuotes = sql.replace(/\$\$[\s\S]*?\$\$/g, '')
  const offender = /(^|;)\s*(begin|commit|rollback)\s*;/i.exec(withoutDollarQuotes)
  if (offender) {
    throw new Error(
      `${filename} contains transaction control (${offender[2]}). The runner wraps each ` +
      `migration in a transaction; remove it from the file.`,
    )
  }
}

export function listMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
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

// Only run when invoked directly, so the pure helpers can be imported by tests.
if (process.argv[1]?.endsWith('migrate.ts')) {
  main().catch((err) => {
    // Never print the raw error: the driver embeds the full connection string,
    // password included, in its messages.
    console.error('Migration failed:', String(err.message).replace(/postgresql:\/\/\S+/g, '[redacted]'))
    process.exit(1)
  })
}
