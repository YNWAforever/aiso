# Critical Path to Production — Slices 0–2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a migration runner and a real-database test harness, fence every off-funnel feature behind an honest 503, restore sign-out, and make brand creation work — moving `clients` from 0 rows to holding a real brand.

**Architecture:** A `scripts/migrate.ts` runner applies `supabase/migrations/*.sql` in filename order against any `DATABASE_URL`, tracking them in a `schema_migrations` ledger and refusing to run against a populated database that has no ledger. A second Vitest config provisions an ephemeral Neon branch per run, migrates it, and runs integration tests against real Postgres. Off-funnel routes lose their dead Supabase code entirely and return `503 FEATURE_UNAVAILABLE`.

**Tech Stack:** Next.js 16.2 App Router, TypeScript 5.9, `@neondatabase/serverless` (`neon()` HTTP for app queries, `Pool` for multi-statement migrations), Neon Auth, `neonctl` 2.26.6, Vitest 4, Node 24.

**Spec:** `docs/superpowers/specs/2026-07-26-critical-path-to-production-design.md`

---

## Critical context for the implementer

Read this before starting. Each item has already caused a production bug in this repository.

1. **The Neon driver is tagged-template only.** `` sql`select …` `` works; `sql('select …')` throws `"This function can now be called only as a tagged-template function"`. That error reads like a missing table — do not misdiagnose it.

2. **`supabase-js` does not throw on a dead host.** It resolves to `{ data: null, error }`. Neon **throws**. Every handler you migrate must wrap its database work in `try`/`catch` and return 5xx. Routes that used to return HTTP 200 over a dead database will now fail loudly, and that is the point.

3. **RLS is inert.** 22 of 27 public tables have `relrowsecurity = true` and 21 leftover Supabase-era policies calling `auth.uid()`, but the app connects as `neondb_owner` (`rolbypassrls = true`) and nothing sets FORCE ROW LEVEL SECURITY. **Every query must filter by `account_id` explicitly**, taken from the session — never from the request body or a URL parameter.

4. **Never print a connection string.** The driver echoes the full URL, password included, in error messages. Pipe scripted output through `2>&1 | grep -v "postgresql://"`.

5. **Production has migrations 001–026 and 028 applied with no ledger. `027` is not applied.** Note that this is *not* a contiguous prefix — the baseline command must exclude `027` explicitly.

6. **Do not modify any file in `supabase/migrations/`.** They are a historical record; several have already been applied.

7. **`npm run lint` is not `npx eslint .`** — the ignores are CLI flags in `package.json`.

---

## File Structure

| File | Responsibility |
|---|---|
| `scripts/migrate.ts` **(create)** | Ledger-backed migration runner: `--dry-run`, `--baseline`, `--except` |
| `__tests__/helpers/neon-branch.ts` **(create)** | Create and drop an ephemeral Neon branch via `neonctl` |
| `vitest.integration.config.ts` **(create)** | Integration-only Vitest config with branch provisioning |
| `__tests__/integration/setup.ts` **(create)** | `globalSetup`: provision branch, migrate it, export `TEST_DATABASE_URL` |
| `__tests__/integration/migrate.test.ts` **(create)** | Proves the runner applies every migration including `027` |
| `__tests__/integration/brand-creation.test.ts` **(create)** | Proves brand creation against real Postgres |
| `lib/unavailable.ts` **(create)** | `featureUnavailable(feature)` → `503 FEATURE_UNAVAILABLE` |
| `app/[lang]/auth/logout/page.tsx` **(create)** | Neon Auth sign-out, then redirect to the localised login |
| 18 fenced route files **(modify)** | Dead Supabase code removed; handlers return 503 |
| `app/[lang]/pulse/[clientId]/page.tsx`, `app/[lang]/admin/authority/page.tsx` **(modify)** | Localised unavailable state |
| `app/api/dashboard/clients/route.ts` **(modify)** | Brand creation on `db()` |
| `components/dashboard/DashboardSidebar.tsx` **(modify)** | Fix the logout href; drop `monitor` and `roi` nav |
| `components/dashboard/Sidebar.tsx`, `TopBar.tsx`, `lib/authority/layer5-dynamic.ts`, `lib/localTrust/store.ts` **(delete)** | Orphaned or dead |
| `scripts/seed-packs.ts` **(modify)** | Port to `db()` |
| `vercel.json` **(modify)** | Remove the `trial-emails` cron |
| `eslint.config.mjs` **(modify)** | `no-restricted-imports` guard on `@supabase/*` |
| `package.json` **(modify)** | `migrate`, `test:unit`, `test:integration` scripts |

---

## Task 1: Migration runner

**Files:**
- Create: `scripts/migrate.ts`
- Create: `__tests__/lib/migrate-planning.test.ts`
- Modify: `package.json`

The runner has two responsibilities worth separating: deciding *what* to apply (pure, unit-testable) and *applying* it (needs a database). Task 1 builds and tests the pure part plus the runner shell; Task 3 proves the applying part against a real branch.

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/migrate-planning.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { planMigrations, assertNoTransactionControl } from '@/scripts/migrate'

describe('planMigrations', () => {
  const all = ['001_a.sql', '007_b.sql', '027_c.sql', '028_d.sql']

  it('returns every file when the ledger is empty', () => {
    expect(planMigrations(all, [])).toEqual(all)
  })

  it('returns only files absent from the ledger, in filename order', () => {
    expect(planMigrations(all, ['001_a.sql', '028_d.sql'])).toEqual(['007_b.sql', '027_c.sql'])
  })

  it('sorts by filename regardless of input order', () => {
    expect(planMigrations(['028_d.sql', '001_a.sql'], [])).toEqual(['001_a.sql', '028_d.sql'])
  })

  it('ignores ledger entries with no matching file', () => {
    expect(planMigrations(['001_a.sql'], ['001_a.sql', '999_gone.sql'])).toEqual([])
  })
})

describe('assertNoTransactionControl', () => {
  it('accepts a migration with a dollar-quoted function body', () => {
    const sql = `create or replace function f() returns int as $$ begin return 1; end; $$ language plpgsql;`
    expect(() => assertNoTransactionControl('x.sql', sql)).not.toThrow()
  })

  it('rejects a migration that opens its own transaction', () => {
    expect(() => assertNoTransactionControl('x.sql', 'begin;\ncreate table t();')).toThrow(/transaction control/i)
  })

  it('rejects a migration that commits', () => {
    expect(() => assertNoTransactionControl('x.sql', 'create table t();\ncommit;')).toThrow(/transaction control/i)
  })

  it('does not mistake a column named begin_at for transaction control', () => {
    expect(() => assertNoTransactionControl('x.sql', 'create table t(begin_at timestamptz);')).not.toThrow()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/lib/migrate-planning.test.ts`

Expected: FAIL — `Failed to resolve import "@/scripts/migrate"`.

- [ ] **Step 3: Write the implementation**

Create `scripts/migrate.ts`:

```ts
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
```

- [ ] **Step 4: Add the npm script**

In `package.json`, add to `"scripts"`:

```json
"migrate": "node --env-file=.env.local scripts/migrate.ts",
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run __tests__/lib/migrate-planning.test.ts`

Expected: PASS, 8 tests.

- [ ] **Step 6: Verify the production safety guard fires**

Run: `npm run migrate -- --dry-run 2>&1 | grep -v "postgresql://"`

Expected: it **fails** with `This database has application tables but an empty schema_migrations ledger.` This is the guard working — `.env.local` points at production, which has no ledger yet. Do not baseline production in this task; Task 4 does that deliberately.

- [ ] **Step 7: Commit**

```bash
git add scripts/migrate.ts __tests__/lib/migrate-planning.test.ts package.json
git commit -m "feat(db): add a ledger-backed migration runner

Refuses to run against a populated database with no ledger, which is what
stops a fresh runner re-applying migrations that were applied by hand."
```

---

## Task 2: Neon branch test harness

**Files:**
- Create: `__tests__/helpers/neon-branch.ts`
- Create: `__tests__/integration/setup.ts`
- Create: `vitest.integration.config.ts`
- Modify: `package.json`

The Neon project id is `red-firefly-93523049`. `neonctl` 2.26.6 is installed and already authenticated.

- [ ] **Step 1: Write the branch helper**

Create `__tests__/helpers/neon-branch.ts`:

```ts
import { execFileSync } from 'node:child_process'

const PROJECT_ID = 'red-firefly-93523049'

function neonctl(args: string[]): string {
  try {
    return execFileSync('neonctl', [...args, '--output', 'json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(
      `neonctl failed: ${detail.replace(/postgresql:\/\/\S+/g, '[redacted]')}\n` +
      'Integration tests need an authenticated neonctl. Run `neonctl auth` and retry.',
    )
  }
}

export type TestBranch = { id: string; connectionUri: string }

export function createTestBranch(name: string): TestBranch {
  const out = neonctl(['branches', 'create', '--project-id', PROJECT_ID, '--name', name])
  const parsed = JSON.parse(out) as {
    branch: { id: string }
    connection_uris?: { connection_uri: string }[]
  }
  const uri = parsed.connection_uris?.[0]?.connection_uri
  if (!uri) throw new Error(`Branch ${name} was created but returned no connection uri`)
  return { id: parsed.branch.id, connectionUri: uri }
}

export function deleteTestBranch(id: string): void {
  neonctl(['branches', 'delete', id, '--project-id', PROJECT_ID])
}
```

- [ ] **Step 2: Write the global setup**

Create `__tests__/integration/setup.ts`:

```ts
import { execFileSync } from 'node:child_process'
import { createTestBranch, deleteTestBranch } from '../helpers/neon-branch'

let branchId: string | null = null

export async function setup(): Promise<void> {
  const name = `test-${process.pid}-${Date.now()}`
  const branch = createTestBranch(name)
  branchId = branch.id
  process.env.TEST_DATABASE_URL = branch.connectionUri

  // Migrate the fresh branch. It is empty, so the runner's baseline guard
  // does not fire and every migration — including 027 — is applied.
  // Node 24 strips TypeScript natively; no flag is needed.
  execFileSync('node', ['scripts/migrate.ts'], {
    env: { ...process.env, DATABASE_URL: branch.connectionUri },
    stdio: 'inherit',
  })
}

export async function teardown(): Promise<void> {
  if (branchId) deleteTestBranch(branchId)
}
```

- [ ] **Step 3: Write the integration Vitest config**

Create `vitest.integration.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['__tests__/integration/**/*.test.ts'],
    globalSetup: ['__tests__/integration/setup.ts'],
    // One shared branch per run: parallel files would race on the same schema.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, '.'),
      'next/headers': resolve(__dirname, '__tests__/stubs/next-headers.ts'),
    },
  },
})
```

- [ ] **Step 4: Wire up the scripts**

In `package.json`, replace the `"test"` entry and add two more:

```json
"test": "vitest run --exclude '__tests__/integration/**' && vitest run --config vitest.integration.config.ts",
"test:unit": "vitest run --exclude '__tests__/integration/**'",
"test:integration": "vitest run --config vitest.integration.config.ts",
```

`npm test` runs both suites, so a green `npm test` means the database queries actually ran. `npm run test:unit` stays fast for the inner loop.

- [ ] **Step 5: Commit**

```bash
git add __tests__/helpers/neon-branch.ts __tests__/integration/setup.ts vitest.integration.config.ts package.json
git commit -m "test(db): provision an ephemeral Neon branch for integration tests"
```

---

## Task 3: Prove the runner applies every migration, including 027

**Files:**
- Create: `__tests__/integration/migrate.test.ts`

This is the task that retires the largest unknown in the phase: migration `027` is ~830 lines and 7 Postgres functions, and has never run against a live database.

- [ ] **Step 1: Write the failing test**

Create `__tests__/integration/migrate.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { neon } from '@neondatabase/serverless'
import { listMigrationFiles } from '@/scripts/migrate'

const sql = neon(process.env.TEST_DATABASE_URL!)

describe('migration runner against a real branch', () => {
  beforeAll(() => {
    if (!process.env.TEST_DATABASE_URL) {
      throw new Error('TEST_DATABASE_URL is not set — globalSetup did not provision a branch')
    }
  })

  it('records every migration file in the ledger', async () => {
    const rows = await sql`select filename from schema_migrations order by filename`
    expect(rows.map((r) => r.filename)).toEqual(listMigrationFiles())
  })

  it('creates the client report tables from 027', async () => {
    const rows = await sql`
      select table_name from information_schema.tables
      where table_schema = 'public'
        and table_name in ('client_reports', 'client_report_versions', 'account_report_branding')
      order by table_name
    `
    expect(rows.map((r) => r.table_name)).toEqual([
      'account_report_branding', 'client_report_versions', 'client_reports',
    ])
  })

  it('creates the client report functions from 027', async () => {
    const rows = await sql`
      select routine_name from information_schema.routines
      where routine_schema = 'public' and routine_name like '%client_report%'
      order by routine_name
    `
    expect(rows.map((r) => r.routine_name)).toContain('publish_client_report_latest')
    expect(rows.map((r) => r.routine_name)).toContain('revoke_client_report')
    expect(rows.map((r) => r.routine_name)).toContain('rotate_client_report_link')
  })

  it('creates the account override columns from 028', async () => {
    const rows = await sql`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'accounts'
        and column_name in ('override_plan', 'override_expires_at')
      order by column_name
    `
    expect(rows.map((r) => r.column_name)).toEqual(['override_expires_at', 'override_plan'])
  })

  it('is idempotent — running it again applies nothing', async () => {
    const before = await sql`select count(*)::int as n from schema_migrations`

    const output = execFileSync('node', ['scripts/migrate.ts'], {
      env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
      encoding: 'utf8',
    })
    expect(output).toContain('Nothing to apply')

    const after = await sql`select count(*)::int as n from schema_migrations`
    expect(after[0].n).toBe(before[0].n)
    expect(after[0].n).toBe(listMigrationFiles().length)
  })
})
```

- [ ] **Step 2: Run the test**

Run: `npm run test:integration 2>&1 | grep -v "postgresql://"`

Expected on first run: globalSetup creates a branch and applies all 26 migrations. If `027` has a genuine SQL error this is where it surfaces — fix the error in a **new** migration file, never by editing `027`, unless `027` has still never been applied anywhere (it has not, so editing it is permitted here; note that decision in the commit message).

Expected outcome: PASS, 5 tests.

- [ ] **Step 3: Commit**

```bash
git add __tests__/integration/migrate.test.ts
git commit -m "test(db): prove every migration applies to a clean database

027 had never run against a live Postgres. It does now, on every test run."
```

---

## Task 4: Baseline the production ledger

**Files:** none — this is an operational step run by Willy.

- [ ] **Step 1: Confirm what production actually has**

```bash
npm run migrate -- --dry-run 2>&1 | grep -v "postgresql://"
```

Expected: the baseline guard error from Task 1, Step 6.

- [ ] **Step 2: Baseline everything except 027**

```bash
npm run migrate -- --baseline --except 027_client_report_snapshots.sql 2>&1 | grep -v "postgresql://"
```

Expected: `Baselined 25 migration(s) as already applied.` followed by `Left pending: 027_client_report_snapshots.sql`.

- [ ] **Step 3: Verify exactly one migration is now pending**

```bash
npm run migrate -- --dry-run 2>&1 | grep -v "postgresql://"
```

Expected: `Would apply 1 migration(s):` followed by `027_client_report_snapshots.sql`.

**Do not apply it.** `027` belongs to Slice 6, and applying it before the code that uses it is harmless while applying it in the wrong order relative to that deploy is not. Leaving it pending is the correct end state for this plan.

---

## Task 5: The 503 helper and the fenced routes

**Files:**
- Create: `lib/unavailable.ts`
- Create: `__tests__/api/fenced-routes.test.ts`
- Modify: the 18 route files listed below

- [ ] **Step 1: Write the failing test**

Create `__tests__/api/fenced-routes.test.ts`:

```ts
import { describe, it, expect } from 'vitest'

const FENCED: { path: string; feature: string; methods: string[] }[] = [
  { path: '@/app/api/pulse/onboard/route', feature: 'pulse', methods: ['POST'] },
  { path: '@/app/api/pulse/run/route', feature: 'pulse', methods: ['POST'] },
  { path: '@/app/api/pulse/suggest-questions/route', feature: 'pulse', methods: ['POST'] },
  { path: '@/app/api/pulse/[clientId]/summary/route', feature: 'pulse', methods: ['GET'] },
  { path: '@/app/api/pulse/[clientId]/missed/route', feature: 'pulse', methods: ['GET'] },
  { path: '@/app/api/fix/cluster-map/route', feature: 'content-tools', methods: ['POST'] },
  { path: '@/app/api/fix/content-brief/route', feature: 'content-tools', methods: ['POST'] },
  { path: '@/app/api/clients/[clientId]/agents/competitors/route', feature: 'agents', methods: ['POST'] },
  { path: '@/app/api/clients/[clientId]/agents/progress/route', feature: 'agents', methods: ['POST'] },
  { path: '@/app/api/clients/[clientId]/agents/recommendations/route', feature: 'agents', methods: ['POST'] },
  { path: '@/app/api/notifications/route', feature: 'notifications', methods: ['GET'] },
  { path: '@/app/api/notifications/read-all/route', feature: 'notifications', methods: ['PUT'] },
  { path: '@/app/api/dashboard/clients/[clientId]/alerts/route', feature: 'alerts', methods: ['GET', 'PUT'] },
  { path: '@/app/api/dashboard/clients/[clientId]/prompts/route', feature: 'prompt-bank', methods: ['GET', 'POST'] },
  { path: '@/app/api/dashboard/clients/[clientId]/prompts/[promptId]/route', feature: 'prompt-bank', methods: ['PATCH', 'DELETE'] },
  { path: '@/app/api/dashboard/clients/[clientId]/local-trust/export/route', feature: 'local-trust', methods: ['GET'] },
  { path: '@/app/api/cron/trial-emails/route', feature: 'trial-emails', methods: ['GET'] },
  { path: '@/app/api/cron/evaluate-alerts/route', feature: 'alerts', methods: ['POST'] },
]

describe('fenced routes', () => {
  for (const { path, feature, methods } of FENCED) {
    for (const method of methods) {
      it(`${path} ${method} returns 503 FEATURE_UNAVAILABLE`, async () => {
        const mod = await import(path)
        const handler = mod[method]
        expect(handler, `${path} must still export ${method}`).toBeTypeOf('function')
        const res = await handler()
        expect(res.status).toBe(503)
        await expect(res.json()).resolves.toEqual({ error: 'FEATURE_UNAVAILABLE', feature })
      })
    }
  }
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/api/fenced-routes.test.ts`

Expected: FAIL — the current handlers require a request argument and reach for Supabase.

- [ ] **Step 3: Write the helper**

Create `lib/unavailable.ts`:

```ts
import { NextResponse } from 'next/server'

/**
 * An honest 503 for a feature whose implementation was removed during the
 * Supabase to Neon migration. Fenced routes fail fast and legibly instead of
 * hanging against a hostname that no longer resolves.
 *
 * Restoring a fenced feature means porting its queries to db() — see
 * docs/superpowers/specs/2026-07-26-critical-path-to-production-design.md.
 */
export function featureUnavailable(feature: string): NextResponse {
  return NextResponse.json({ error: 'FEATURE_UNAVAILABLE', feature }, { status: 503 })
}
```

- [ ] **Step 4: Fence each route**

For every entry in the test's `FENCED` list, replace the whole file with the pattern below, substituting the feature name and keeping **exactly** the methods that file currently exports — a missing export produces a 405, not a 503.

Example for `app/api/pulse/run/route.ts`:

```ts
import { featureUnavailable } from '@/lib/unavailable'

export const dynamic = 'force-dynamic'

// Fenced during the Supabase to Neon migration. The Supabase implementation is
// in git history at the parent of this commit. Restoring it means porting the
// queries to db(), not reviving code that targets a deleted project.
export async function POST() {
  return featureUnavailable('pulse')
}
```

Record the commit SHA once, after Step 6, rather than guessing it now: the comment says "the parent of this commit", which stays true.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run __tests__/api/fenced-routes.test.ts`

Expected: PASS, 21 tests.

- [ ] **Step 6: Delete the suites that tested the fenced implementations**

These suites mock the Supabase client and assert behaviour that no longer exists:

```bash
git rm __tests__/api/agent-routes.test.ts __tests__/api/alerts.test.ts \
       __tests__/api/cron-trial-emails.test.ts __tests__/api/local-trust-routes.test.ts \
       __tests__/api/prompts.test.ts __tests__/api/pulse-flow.test.ts \
       __tests__/api/pulse-weekly.test.ts __tests__/api/suggest-questions.test.ts
```

- [ ] **Step 7: Run the full unit suite**

Run: `npm run test:unit`

Expected: PASS. If a remaining suite imports a fenced route, update it to assert the 503 rather than restoring the old behaviour.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(api): fence off-funnel routes behind an honest 503

Pulse, agents, notifications, alerts, prompt bank, local-trust export, the
content tools, and both crons lose their dead Supabase implementations and
return 503 FEATURE_UNAVAILABLE. The implementations remain in git history."
```

---

## Task 6: Fenced pages, deletions, and the Supabase guard

**Files:**
- Modify: `app/[lang]/pulse/[clientId]/page.tsx`, `app/[lang]/admin/authority/page.tsx`, `components/dashboard/DashboardSidebar.tsx`, `scripts/seed-packs.ts`, `vercel.json`, `eslint.config.mjs`, `messages/en.json`, `messages/zh-HK.json`
- Delete: `components/dashboard/Sidebar.tsx`, `components/dashboard/TopBar.tsx`, `lib/authority/layer5-dynamic.ts`, `lib/localTrust/store.ts`

`app/[lang]/dashboard/[clientId]/prompts/page.tsx` needs no change: it holds no data and only redirects to `/{lang}/pulse/{clientId}#question-bank`, which now renders the unavailable state.

- [ ] **Step 1: Add the translation strings**

In `messages/en.json`, inside the existing top-level object, add:

```json
"unavailable": {
  "title": "Temporarily unavailable",
  "body": "This feature is being migrated and is not available right now. Everything else in your workspace works normally.",
  "back": "Back to dashboard"
}
```

In `messages/zh-HK.json`, add the same key with:

```json
"unavailable": {
  "title": "暫時無法使用",
  "body": "此功能正在移轉中，暫時無法使用。工作區的其他功能不受影響。",
  "back": "返回儀表板"
}
```

- [ ] **Step 2: Replace the fenced pages**

Replace `app/[lang]/pulse/[clientId]/page.tsx` entirely:

```tsx
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'

export default async function PulseUnavailablePage({
  params,
}: {
  params: Promise<{ lang: string; clientId: string }>
}) {
  const { lang } = await params
  const t = await getTranslations('unavailable')

  return (
    <main className="mx-auto max-w-lg px-6 py-24 text-center">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <p className="mt-4 text-muted-foreground">{t('body')}</p>
      <Link href={`/${lang}/dashboard`} className="mt-8 inline-block underline">
        {t('back')}
      </Link>
    </main>
  )
}
```

Replace `app/[lang]/admin/authority/page.tsx` with the same component body, renamed `AuthorityUnavailablePage`, and typed `params: Promise<{ lang: string }>` with `const { lang } = await params`.

- [ ] **Step 3: Fix the sidebar**

In `components/dashboard/DashboardSidebar.tsx`:

1. Remove the `monitor` and `roi` entries from the steps array at lines 11–15, leaving `scan`, `results`, and `improve`.
2. Remove the two Pulse links (the `/${lang}/pulse/${brandId}` and `#question-bank` anchors around lines 99 and 109).
3. Change the sign-out link at line 164 from `href="/auth/logout"` to `href={`/${lang}/auth/logout`}`. Without the locale prefix, next-intl's `localePrefix: 'always'` redirects it to a route that does not exist.

- [ ] **Step 4: Delete the dead files**

```bash
git rm components/dashboard/Sidebar.tsx components/dashboard/TopBar.tsx \
       lib/authority/layer5-dynamic.ts lib/localTrust/store.ts
```

`Sidebar.tsx` and `TopBar.tsx` are imported by nothing — only `DashboardSidebar` is used. `layer5-dynamic.ts` is not called by `computeAuthority()`, which wires layers 1–4 and takes layer 5 as an optional argument no caller supplies. `localTrust/store.ts` is orphaned once its routes are fenced.

- [ ] **Step 5: Port the seed script**

Replace `scripts/seed-packs.ts` entirely. Column types confirmed against Neon:
`industry_packs.authority_domains` is `jsonb`, `topical_keywords` is a text array, and
`regional_packs.tiers` is `jsonb`.

```ts
import { db } from '@/lib/db'
import { INDUSTRY_PACKS, REGIONAL_PACKS } from '../lib/authority/packs'

async function seed() {
  const sql = db()

  console.log('Seeding industry packs...')
  for (const pack of Object.values(INDUSTRY_PACKS)) {
    await sql`
      insert into industry_packs (code, display_name, multiplier, authority_domains, topical_keywords, updated_at)
      values (
        ${pack.code}, ${pack.displayName}, ${pack.multiplier},
        ${JSON.stringify(pack.authorityDomains)}::jsonb,
        ${pack.topicalKeywords},
        now()
      )
      on conflict (code) do update set
        display_name      = excluded.display_name,
        multiplier        = excluded.multiplier,
        authority_domains = excluded.authority_domains,
        topical_keywords  = excluded.topical_keywords,
        updated_at        = now()
    `
    console.log(`  ✓ ${pack.code}`)
  }

  console.log('Seeding regional packs...')
  for (const pack of Object.values(REGIONAL_PACKS)) {
    await sql`
      insert into regional_packs (code, display_name, tiers, updated_at)
      values (
        ${pack.code}, ${pack.displayName},
        ${JSON.stringify({
          tier1: pack.tier1Local,
          tier2: pack.tier2Local,
          tier3: pack.tier3Local,
          community: pack.community,
        })}::jsonb,
        now()
      )
      on conflict (code) do update set
        display_name = excluded.display_name,
        tiers        = excluded.tiers,
        updated_at   = now()
    `
    console.log(`  ✓ ${pack.code}`)
  }
  console.log('Done.')
}

seed().catch((err) => {
  console.error(String(err.message).replace(/postgresql:\/\/\S+/g, '[redacted]'))
  process.exit(1)
})
```

Note the behaviour change: the Supabase version logged errors and carried on, so a
fully failed seed still exited 0. This one exits non-zero.

- [ ] **Step 6: Remove the dead cron**

In `vercel.json`, delete the entire `"crons"` array — its only entry fires `/api/cron/trial-emails` daily at 09:00, which is now fenced. The file becomes:

```json
{
  "functions": {
    "app/api/scan/route.ts": { "maxDuration": 60 },
    "app/api/fix/route.ts":  { "maxDuration": 30 }
  }
}
```

- [ ] **Step 7: Guard against reintroducing Supabase**

In `eslint.config.mjs`, add to the rules object of the main config block:

```js
'no-restricted-imports': ['error', {
  patterns: [
    { group: ['@supabase/*'], message: 'The Supabase project is deleted. Use db() from @/lib/db.' },
    { group: ['@/lib/supabase', '@/lib/supabase-server'], message: 'Removed. Use db() from @/lib/db.' },
  ],
}],
```

An ECC config-protection hook may block editing `eslint.config.mjs`. If it does, stop and tell Willy rather than working around it — the rule is worth an approval prompt.

- [ ] **Step 8: Verify nothing imports Supabase any more**

```bash
grep -rn "lib/supabase\|@supabase/" --include="*.ts" --include="*.tsx" app lib components scripts
```

Expected: only `lib/supabase.ts` and `lib/supabase-server.ts` themselves, plus the files Slices 3–6 still own — `app/[lang]/dashboard/[clientId]/page.tsx`, `.../result/[scanId]/page.tsx`, `app/[lang]/onboarding/page.tsx`, `app/api/clients/[clientId]/overview/route.ts`, `app/api/onboarding/complete/route.ts`, `app/api/scan/route.ts`, `app/api/scans/[id]/claim/route.ts`, `app/api/fix/route.ts`, `app/api/stripe/webhook/route.ts`, `lib/reports/store.ts`.

That is 10 files remaining, down from 38. The shims and the packages are deleted at the end of Slice 6, not here.

- [ ] **Step 9: Run the gates**

```bash
npm run test:unit && npm run lint && npx tsc --noEmit
```

Expected: tests pass, 0 lint errors, 0 type errors. If `tsc` reports errors referencing `.next/dev/types/`, run `rm -rf .next/dev` — those are stale generated route types, not source errors.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: remove dead Supabase surface and unschedule the dead cron

Deletes four orphaned modules, renders unavailable states for the fenced
pages, restores a locale-prefixed sign-out href, and adds an ESLint guard
so the deleted Supabase clients cannot be imported again."
```

---

## Task 7: Sign out

**Files:**
- Create: `app/[lang]/auth/logout/page.tsx`

Sign-out does not currently exist. `DashboardSidebar` links to `/auth/logout`, which has no page, and the only `signOut()` implementation lived in the orphaned `Sidebar.tsx` deleted in Task 6. Neon Auth signs out through the browser client, so this is a Client Component.

- [ ] **Step 1: Write the page**

Create `app/[lang]/auth/logout/page.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth-client'

export default function LogoutPage() {
  const router = useRouter()
  const params = useParams<{ lang: string }>()
  const lang = params?.lang ?? 'en'
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        await authClient.signOut()
        if (!cancelled) router.replace(`/${lang}/auth/login`)
      } catch {
        // The session cookie may already be gone. Send the user to login either
        // way rather than stranding them on a blank page.
        if (!cancelled) setFailed(true)
      }
    })()
    return () => { cancelled = true }
  }, [lang, router])

  return (
    <main className="mx-auto max-w-sm px-6 py-24 text-center">
      {failed ? (
        <a href={`/${lang}/auth/login`} className="underline">Continue to sign in</a>
      ) : (
        <p className="text-muted-foreground">Signing out…</p>
      )}
    </main>
  )
}
```

- [ ] **Step 2: Verify the build compiles the new route**

Run: `npx tsc --noEmit`

Expected: 0 errors.

- [ ] **Step 3: Verify live**

Start the dev server (`npm run dev`), sign in with a magic link, click sign out in the sidebar, and confirm you land on `/en/auth/login` and that visiting `/en/dashboard` redirects back to login rather than rendering.

This is the first slice-level live check. A passing type-check is not the verification — completing the round trip is.

- [ ] **Step 4: Commit**

```bash
git add app/[lang]/auth/logout/page.tsx
git commit -m "feat(auth): add the sign-out route

DashboardSidebar linked to /auth/logout, which never existed; the only
signOut() lived in an orphaned component. Signs out via Neon Auth."
```

---

## Task 8: Brand creation on Neon

**Files:**
- Modify: `app/api/dashboard/clients/route.ts`
- Create: `__tests__/integration/brand-creation.test.ts`
- Modify: `__tests__/api/dashboard-clients.test.ts`

This is the task that moves `clients` off zero rows.

- [ ] **Step 1: Write the failing integration test**

Create `__tests__/integration/brand-creation.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.TEST_DATABASE_URL!)

const ACCOUNT = '11111111-1111-1111-1111-111111111111'

async function seedAccount(plan: string): Promise<void> {
  await sql`delete from clients where account_id = ${ACCOUNT}`
  await sql`delete from accounts where id = ${ACCOUNT}`
  await sql`insert into accounts (id, plan, status) values (${ACCOUNT}, ${plan}, 'active')`
}

async function createBrand(name: string): Promise<{ id: string }[]> {
  return sql`
    insert into clients (brand_name, domain, industry, competitors, account_id, status)
    values (${name}, null, null, ${JSON.stringify([])}::jsonb, ${ACCOUNT}, 'active')
    returning id
  ` as unknown as Promise<{ id: string }[]>
}

describe('brand creation against real Postgres', () => {
  beforeEach(async () => {
    await seedAccount('pro')
  })

  it('inserts a brand scoped to the account', async () => {
    const rows = await createBrand('Acme')
    expect(rows[0].id).toBeTruthy()

    const found = await sql`select brand_name, account_id from clients where id = ${rows[0].id}`
    expect(found[0].brand_name).toBe('Acme')
    expect(found[0].account_id).toBe(ACCOUNT)
  })

  it('lets the check_brand_limit trigger reject the fourth brand on pro', async () => {
    await createBrand('One')
    await createBrand('Two')
    await createBrand('Three')
    await expect(createBrand('Four')).rejects.toThrow(/BRAND_LIMIT_REACHED/)
  })

  it('lets a basic account create only one brand', async () => {
    await seedAccount('basic')
    await createBrand('Only')
    await expect(createBrand('Second')).rejects.toThrow(/BRAND_LIMIT_REACHED/)
  })
})
```

- [ ] **Step 2: Run it to verify the trigger contract**

Run: `npm run test:integration 2>&1 | grep -v "postgresql://"`

Expected: PASS. If the limit tests fail, the `check_brand_limit()` trigger's effective-entitlement logic disagrees with `lib/plans/catalog.ts` (`max_brands` is 1 for free and basic, 3 for pro, 10 for enterprise). Fix the test's expectation only if the catalog says so; otherwise the trigger is the bug and it belongs in a new migration.

- [ ] **Step 3: Migrate the route**

Replace the body of `app/api/dashboard/clients/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { getProfile } from '@/lib/auth'
import { db } from '@/lib/db'
import { resolveCommercialEntitlement } from '@/lib/tier'

export const dynamic = 'force-dynamic'

// POST /api/dashboard/clients — self-service brand creation
export async function POST(req: NextRequest) {
  const profile = await getProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const entitlement = resolveCommercialEntitlement(profile.accounts)
  const { plan } = entitlement
  const limit = entitlement.features.max_brands

  const body = await req.json()
  const { brand_name, domain, industry, competitors } = body

  if (!brand_name || typeof brand_name !== 'string') {
    return NextResponse.json({ error: 'brand_name required' }, { status: 400 })
  }

  const sql = db()

  try {
    // Application-level check for a clear error before hitting the database.
    // The check_brand_limit() trigger is the authority and catches the race.
    const counted = await sql`
      select count(*)::int as n from clients where account_id = ${profile.account_id}
    `
    if ((counted[0]?.n ?? 0) >= limit) {
      return NextResponse.json({ error: 'BRAND_LIMIT_REACHED', plan, limit }, { status: 403 })
    }

    const rows = await sql`
      insert into clients (brand_name, domain, industry, competitors, account_id, status)
      values (
        ${brand_name.trim()},
        ${domain?.trim() ?? null},
        ${industry ?? null},
        ${JSON.stringify(Array.isArray(competitors) ? competitors : [])}::jsonb,
        ${profile.account_id},
        'active'
      )
      returning id
    `
    return NextResponse.json({ id: rows[0].id })
  } catch (err) {
    // Neon throws where supabase-js resolved { data, error }. The trigger raises
    // BRAND_LIMIT_REACHED when a concurrent request won the race.
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('BRAND_LIMIT_REACHED')) {
      return NextResponse.json({ error: 'BRAND_LIMIT_REACHED', plan, limit }, { status: 403 })
    }
    console.error('Brand creation failed:', message.replace(/postgresql:\/\/\S+/g, '[redacted]'))
    return NextResponse.json({ error: 'Failed to create brand' }, { status: 500 })
  }
}
```

- [ ] **Step 4: Update the existing unit suite**

`__tests__/api/dashboard-clients.test.ts` mocks the Supabase client. Replace those mocks
with a `db()` mock, keeping the existing unauthorised and validation cases — they never
touch the database. Add the failure case, which is the behaviour change that matters most
in this migration: a database error must now produce a 500, not a cheerful 200.

The Neon client is a tagged-template function, so the mock is a function that receives
`(strings, ...values)` and returns rows:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const queries: string[] = []
let nextResults: unknown[][] = []

const mockSql = vi.fn((strings: TemplateStringsArray) => {
  queries.push(strings.join('?'))
  const result = nextResults.shift()
  if (result instanceof Error) throw result
  return Promise.resolve(result ?? [])
})

vi.mock('@/lib/db', () => ({ db: () => mockSql }))
vi.mock('@/lib/auth', () => ({ getProfile: vi.fn() }))

import { POST } from '@/app/api/dashboard/clients/route'
import { getProfile } from '@/lib/auth'

function request(body: unknown) {
  return new Request('http://localhost/api/dashboard/clients', {
    method: 'POST',
    body: JSON.stringify(body),
  }) as never
}

const PRO_PROFILE = {
  account_id: 'acc-1',
  accounts: { id: 'acc-1', plan: 'pro', status: 'active' },
}

describe('POST /api/dashboard/clients', () => {
  beforeEach(() => {
    queries.length = 0
    nextResults = []
    vi.mocked(getProfile).mockResolvedValue(PRO_PROFILE as never)
  })

  it('creates a brand and returns its id', async () => {
    nextResults = [[{ n: 0 }], [{ id: 'client-1' }]]
    const res = await POST(request({ brand_name: 'Acme' }))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ id: 'client-1' })
  })

  it('scopes the brand count to the caller account', async () => {
    nextResults = [[{ n: 0 }], [{ id: 'client-1' }]]
    await POST(request({ brand_name: 'Acme' }))
    expect(queries[0]).toContain('account_id')
  })

  it('returns 403 when the plan limit is already reached', async () => {
    nextResults = [[{ n: 3 }]]
    const res = await POST(request({ brand_name: 'Fourth' }))
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toMatchObject({ error: 'BRAND_LIMIT_REACHED', limit: 3 })
  })

  it('returns 403 when the trigger raises BRAND_LIMIT_REACHED on the race', async () => {
    nextResults = [[{ n: 0 }], new Error('BRAND_LIMIT_REACHED') as never]
    const res = await POST(request({ brand_name: 'Racer' }))
    expect(res.status).toBe(403)
  })

  it('returns 500 when the database fails, not a silent success', async () => {
    nextResults = [new Error('connection terminated') as never]
    const res = await POST(request({ brand_name: 'Acme' }))
    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toEqual({ error: 'Failed to create brand' })
  })

  it('rejects a missing brand_name before touching the database', async () => {
    const res = await POST(request({}))
    expect(res.status).toBe(400)
    expect(queries).toHaveLength(0)
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getProfile).mockResolvedValue(null)
    const res = await POST(request({ brand_name: 'Acme' }))
    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 5: Run both suites**

```bash
npm test 2>&1 | grep -v "postgresql://"
```

Expected: unit suite passes, integration suite passes.

- [ ] **Step 6: Verify live — the milestone**

Deploy to `fimmick-aeo-oitb`, sign in, and create a brand through the Add Brand wizard. Then confirm against production:

```bash
cd "/Users/willylai/Documents/Claude/Projects/Fimmick AEOGEO" && node --env-file=.env.local --input-type=module -e '
import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL);
const r = await sql`select id, brand_name, account_id, created_at from clients order by created_at desc limit 5`;
console.log(r);
' 2>&1 | grep -v "postgresql://"
```

Expected: at least one row. `clients` has left zero for the first time in the project's history.

Creating a **fourth** brand on a pro account must return `403 BRAND_LIMIT_REACHED`, not a 500.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(dashboard): create brands on Neon

The Add Brand button has been writing to a deleted Supabase project, which
is why clients held zero rows. Ports the count and insert to db(), returns
5xx on database failure instead of a silent success, and keeps the
check_brand_limit trigger as the authority on the race."
```

---

## Definition of done for Slices 0–2

- `npm test` runs unit and integration suites, the latter against a freshly migrated Neon branch.
- Migration `027` applies cleanly to a clean database on every test run, and is the single pending migration on production.
- The 18 fenced routes return `503 FEATURE_UNAVAILABLE`; no dashboard navigation points at one.
- Ten files still import Supabase, down from 38; all ten belong to Slices 3–6.
- Sign-out works end to end on the deployed application.
- `clients` holds at least one real brand, created through the UI.

Slice 3 (brand workspace) gets its own plan, written once this one is live.
