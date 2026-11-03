/**
 * Schema gate: refuse a production build whose code ships migrations the
 * target database has not recorded.
 *
 * Why it exists (2026-11-03): three times in one day code that read a new
 * column or table reached production before its migration did. #143 and #145
 * read `evidence_work_items.edit_spec` before 086 was applied, and every work
 * item and Studio request returned 503; 071–085 had shipped without their
 * tables too. Migrations are applied by hand (`npm run migrate`, an owner
 * credential, a named approval), so "merged" never implied "applied".
 *
 * `npm run build` runs this before `next build`. On a Vercel *production*
 * build it compares supabase/migrations/*.sql with the `schema_migrations`
 * ledger of the database DATABASE_URL points at, and fails the build if any
 * shipped migration is unrecorded. A failed build never replaces the live
 * deployment, so the previous one keeps serving.
 *
 * Modes:
 * - production (VERCEL=1, VERCEL_ENV=production): enforce.
 * - other Vercel builds (preview): warn only. Migrations ship file-only and
 *   are applied after review, so a preview against a database without them is
 *   expected and must not turn every migration PR's preview red.
 * - anywhere else (local, CI): skip. CI builds use a fixture DATABASE_URL.
 * - SCHEMA_GATE=off: skip. An emergency valve, set deliberately in Vercel.
 *
 * If the ledger cannot be read (no DATABASE_URL, connection or permission
 * error) the gate warns and lets the build through: a Neon blip must not
 * block an urgent fix. A definite "these migrations are missing" is what
 * fails the build.
 *
 * A migration whose objects exist but whose ledger row does not (hand-applied
 * SQL) also fails the gate. That is deliberate: record it with
 * `npm run migrate -- --verify` and an `insert into schema_migrations`.
 */
import { neon } from '@neondatabase/serverless'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
// Same explicit-extension imports as scripts/migrate.ts (see its comment):
// plain node needs the .ts extension, tsc under "bundler" resolution forbids it.
// @ts-expect-error -- node requires the extension, tsc forbids it
import { listMigrationFiles, planMigrations } from './migrate.ts'
// @ts-expect-error -- node requires the extension, tsc forbids it
import { redactSecrets } from '../lib/security/redact-secrets.ts'

export type GateMode = 'enforce' | 'warn' | 'skip'
type Env = Record<string, string | undefined>
type Log = { info(message: string): void; warn(message: string): void; error(message: string): void }

export function gateMode(env: Env): GateMode {
  if (env.SCHEMA_GATE === 'off') return 'skip'
  if (env.VERCEL !== '1') return 'skip'
  return env.VERCEL_ENV === 'production' ? 'enforce' : 'warn'
}

export type GateInput = {
  env: Env
  files: string[]
  /** Reads `schema_migrations.filename`. May throw; the gate redacts and degrades. */
  readLedger(url: string): Promise<string[]>
  log: Log
}

/** Returns the process exit code. Only an enforced, definite gap returns 1. */
export async function runGate({ env, files, readLedger, log }: GateInput): Promise<number> {
  const mode = gateMode(env)
  if (mode === 'skip') {
    log.info(env.SCHEMA_GATE === 'off' ? 'schema gate: skipped (SCHEMA_GATE=off)' : 'schema gate: skipped (not a Vercel build)')
    return 0
  }
  const url = env.DATABASE_URL
  if (!url) {
    log.warn('schema gate: DATABASE_URL is not set, so the migration ledger could not be checked. Continuing.')
    return 0
  }
  let ledger: string[]
  try {
    ledger = await readLedger(url)
  } catch (error) {
    const message = redactSecrets(error instanceof Error ? error.message : String(error))
    log.warn(`schema gate: could not read schema_migrations (${message}). Continuing without the check.`)
    return 0
  }
  const missing = planMigrations(files, ledger)
  if (!missing.length) {
    log.info(`schema gate: all ${files.length} shipped migrations are recorded.`)
    return 0
  }
  const lines = [
    `schema gate: the database has not recorded ${missing.length} migration(s) this code ships:`,
    ...missing.map((file) => `  ${file}`),
    'Apply them first (npm run migrate, with a named approval), then redeploy.',
    'If the objects already exist, record the ledger row instead (see npm run migrate -- --verify).',
  ]
  if (mode === 'enforce') {
    log.error([...lines, 'Failing the production build so the current deployment keeps serving.'].join('\n'))
    return 1
  }
  log.warn([...lines, 'Preview build: warning only.'].join('\n'))
  return 0
}

async function readLedger(url: string): Promise<string[]> {
  const sql = neon(url)
  const rows = (await sql`select filename from schema_migrations`) as Array<{ filename: string }>
  return rows.map((row) => row.filename)
}

function isDirectInvocation(): boolean {
  if (!process.argv[1]) return false
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
}

if (isDirectInvocation()) {
  Promise.resolve()
    .then(() => runGate({ env: process.env, files: listMigrationFiles(), readLedger, log: console }))
    .then((code) => { process.exitCode = code })
    .catch((error: unknown) => {
      // Unexpected bug in the gate itself: never block a deploy on it.
      console.warn(`schema gate: internal error (${redactSecrets(error instanceof Error ? error.message : String(error))}). Continuing.`)
      process.exitCode = 0
    })
}
