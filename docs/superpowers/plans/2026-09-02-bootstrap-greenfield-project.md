# Bootstrap the Greenfield Neon Project — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install the proven schema baseline onto the empty greenfield Neon project "AISO", verify it end to end, and seed it with synthetic tenant data — leaving credentials to a human.

**Architecture:** One new script applies the baseline to a target named explicitly by environment variables, behind fail-closed guards. It is rehearsed on a disposable branch of the same project and only then run against that project's production branch, using the identical code path. Pure guard predicates are exported and unit-tested without a database, matching how `scripts/migrate.ts` and `scripts/run-tests.mjs` are already structured.

**Tech Stack:** Node 24 (ESM `.mjs`), `@neondatabase/serverless` (`Client` over WebSocket), Vitest 4, PostgreSQL 16 on Neon.

**Spec:** `docs/superpowers/specs/2026-09-02-bootstrap-greenfield-project-design.md`

---

## Read this first

**The target project.** Neon project `weathered-wave-50814522` ("AISO"), `aws-ap-southeast-1`. Verified 2026-09-02: schema `public` has 0 tables, role `aeo_app` does not exist, the legacy `auth` schema does not exist, and `neon_auth` **does** exist with a `neon_auth."user"` table (Neon Auth is enabled).

**Production is `red-firefly-93523049`, branch `br-rough-butterfly-aojtgi92`, and must never be touched by anything in this plan.**

**Do not try to run `npm run schema:equivalence` against AISO.** Migration `003_phase3a_accounts.sql:15` declares `REFERENCES auth.users(id)`, and `scripts/schema-equivalence.mjs` never creates the legacy `auth` schema — it only drops and recreates `public` (line 65), relying on branches of the *production* project inheriting `auth`. Equivalence is a property of the SQL files and is already proven. AISO needs the bootstrap half only.

**The brand-limit trap, which dictates the seed's shape.** `public.clients` carries a `BEFORE INSERT` trigger `enforce_brand_limit` (baseline `:2993`). PostgreSQL fires row triggers **before** the `ON CONFLICT` arbiter, so `on conflict do nothing` alone does **not** make a client insert idempotent — on a second run the trigger counts existing rows and raises `BRAND_LIMIT_REACHED` before the arbiter can skip anything. See Task 4 for the invariant that makes re-runs safe. Do not "simplify" it away.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `scripts/bootstrap-project.mjs` | Create | Exported pure guard predicates + `main()` that applies and verifies |
| `__tests__/scripts/bootstrap-project.test.mjs` | Create | Guards tested with no database, including that they refuse production |
| `supabase/seeds/001_synthetic.sql` | Create | Idempotent accounts → clients → scans |
| `__tests__/db/synthetic-seed.test.ts` | Create | Pins the brand-limit invariant statically |
| `docs/runbooks/bootstrap-greenfield-project.md` | Create | Credential handoff: password, Vercel bindings, `.env.local` |
| `package.json` | Modify | `bootstrap:project` script |

`scripts/migrate.ts` and `scripts/schema-equivalence.mjs` are **not** modified.

---

### Task 1: Guard predicates

Pure functions first, with tests, before any database code exists. These are the decisions that could destroy data, so they must be testable without one.

**Files:**
- Create: `scripts/bootstrap-project.mjs`
- Test: `__tests__/scripts/bootstrap-project.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/scripts/bootstrap-project.test.mjs`:

```js
import { describe, expect, it } from 'vitest'

import {
  PRODUCTION_PROJECT_ID,
  assertEmptyPublicSchema,
  assertTargetIdentity,
  resolveTarget,
} from '../../scripts/bootstrap-project.mjs'

const TARGET = {
  projectId: 'weathered-wave-50814522',
  branchId: 'br-example-target',
  connectionUri: 'postgresql://user:pw@host/db',
}

const env = (over = {}) => ({
  BOOTSTRAP_PROJECT_ID: TARGET.projectId,
  BOOTSTRAP_BRANCH_ID: TARGET.branchId,
  BOOTSTRAP_DATABASE_URL: TARGET.connectionUri,
  ...over,
})

describe('resolveTarget', () => {
  it('returns the target when all three are set', () => {
    expect(resolveTarget(env())).toEqual(TARGET)
  })

  // No default, ever. A defaulted target is exactly how a stale environment
  // variable reaches a database nobody meant to touch.
  it.each(['BOOTSTRAP_PROJECT_ID', 'BOOTSTRAP_BRANCH_ID', 'BOOTSTRAP_DATABASE_URL'])(
    'refuses when %s is missing',
    (name) => {
      expect(() => resolveTarget(env({ [name]: undefined }))).toThrow(name)
    },
  )

  // Deploy environments substitute '' for a declared-but-valueless variable.
  it.each(['BOOTSTRAP_PROJECT_ID', 'BOOTSTRAP_BRANCH_ID', 'BOOTSTRAP_DATABASE_URL'])(
    'treats an empty %s as missing',
    (name) => {
      expect(() => resolveTarget(env({ [name]: '   ' }))).toThrow(name)
    },
  )
})

describe('assertTargetIdentity', () => {
  it('accepts a connection that reports the intended target', () => {
    expect(() =>
      assertTargetIdentity(TARGET, { projectId: TARGET.projectId, branchId: TARGET.branchId }),
    ).not.toThrow()
  })

  // Absent GUCs read as null. Fail closed rather than guess.
  it.each([
    ['project', { projectId: null, branchId: TARGET.branchId }],
    ['branch', { projectId: TARGET.projectId, branchId: null }],
  ])('refuses when the connection does not report its %s', (_label, reported) => {
    expect(() => assertTargetIdentity(TARGET, reported)).toThrow(/did not report/i)
  })

  // The one that matters most: production is refused by id, even if the caller
  // asked for it explicitly and the identity check would otherwise agree.
  it('refuses production even when it is the requested target', () => {
    const asking = { ...TARGET, projectId: PRODUCTION_PROJECT_ID }
    expect(() =>
      assertTargetIdentity(asking, {
        projectId: PRODUCTION_PROJECT_ID,
        branchId: TARGET.branchId,
      }),
    ).toThrow(/production/i)
  })

  it('refuses when the connection is somewhere other than the target', () => {
    expect(() =>
      assertTargetIdentity(TARGET, { projectId: 'other-project', branchId: 'br-elsewhere' }),
    ).toThrow(/but the target is/i)
  })
})

describe('assertEmptyPublicSchema', () => {
  it('accepts an empty schema', () => {
    expect(() => assertEmptyPublicSchema(0)).not.toThrow()
    expect(() => assertEmptyPublicSchema('0')).not.toThrow()
  })

  it('refuses a populated schema and says how to rebuild deliberately', () => {
    expect(() => assertEmptyPublicSchema(34)).toThrow(/34 table/)
    expect(() => assertEmptyPublicSchema(34)).toThrow(/drop schema public cascade/)
  })

  // Number() is the trap: Number(null), Number(''), Number([]) and
  // Number(false) are all 0, so without an explicit type check each of these
  // would read as "empty schema" and let the baseline apply over a database
  // that was never actually inspected. undefined is the only one Number()
  // rejects on its own.
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['an empty string', ''],
    ['an array', []],
    ['false', false],
    ['a non-numeric string', 'many'],
  ])('refuses %s rather than assuming zero', (_label, value) => {
    expect(() => assertEmptyPublicSchema(value)).toThrow(/could not read/i)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run __tests__/scripts/bootstrap-project.test.mjs`

Expected: the whole file fails to collect, with an error resolving `../../scripts/bootstrap-project.mjs` — the module does not exist yet.

- [ ] **Step 3: Write the guards**

Create `scripts/bootstrap-project.mjs`:

```js
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
 * `?.trim() ||` rather than `??` -- deploy environments substitute '' for a
 * variable that is declared but has no value, and '' is not a target.
 */
export function resolveTarget(env = process.env) {
  // String(... ?? '') rather than `?.trim()`: optional chaining short-circuits
  // only on null/undefined, so a non-string value would reach .trim() and throw
  // a raw TypeError instead of this guard's message.
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run __tests__/scripts/bootstrap-project.test.mjs`

Expected: **20 passed**.

- [ ] **Step 5: Lint and typecheck**

```bash
npm run lint
```
Expected: no output (0 errors, 0 warnings).

```bash
npm run typecheck
```
Expected: `Types generated successfully`, no `error TS` lines.

- [ ] **Step 6: Commit**

```bash
git add scripts/bootstrap-project.mjs __tests__/scripts/bootstrap-project.test.mjs
git commit -m "feat(bootstrap): fail-closed guards for installing a baseline"
```

---

### Task 2: Apply and verify

**Files:**
- Modify: `scripts/bootstrap-project.mjs` (append below the guards)
- Modify: `package.json`

- [ ] **Step 1: Add the imports**

At the very top of `scripts/bootstrap-project.mjs`, above the doc comment:

```js
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
```

- [ ] **Step 2: Add the session helper and main()**

Append to `scripts/bootstrap-project.mjs`:

```js
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
```

- [ ] **Step 2b: Add the npm script**

In `package.json`, in `"scripts"`, directly after the `"schema:equivalence"` line, add:

```json
    "bootstrap:project": "node --env-file=.env.local scripts/bootstrap-project.mjs",
```

- [ ] **Step 3: Confirm the guards refuse a missing target**

Run: `npm run bootstrap:project`

Expected: exits 1 with `Bootstrap failed: Refusing to run: BOOTSTRAP_PROJECT_ID, BOOTSTRAP_BRANCH_ID, BOOTSTRAP_DATABASE_URL not set (or empty).`

This is the guard doing its job — do not "fix" it by adding a default.

- [ ] **Step 4: Lint, typecheck, unit tests**

```bash
npm run lint
```
Expected: no output.

```bash
npm run typecheck
```
Expected: `Types generated successfully`.

```bash
npx vitest run __tests__/scripts/bootstrap-project.test.mjs
```
Expected: **20 passed** (unchanged — the guards were not modified).

- [ ] **Step 5: Commit**

```bash
git add scripts/bootstrap-project.mjs package.json
git commit -m "feat(bootstrap): apply and verify the baseline against a named target"
```

---

### Task 3: Rehearse on a disposable branch of AISO

The rehearsal exists so the real run has already happened once. It must use the **same code path**, or it proves nothing.

**Files:** none changed. This task produces evidence.

- [ ] **Step 1: Create a disposable branch of AISO**

```bash
node "$APPDATA/npm/node_modules/neonctl/bin/cli.js" branches create --project-id weathered-wave-50814522 --name bootstrap-rehearsal-1
```

Record the branch id (`br-...`) from the output. On non-Windows, `neonctl` may be invoked directly; the `node <cli.js>` form is required on Windows because Node refuses to spawn a `.cmd` shim without `shell: true`.

- [ ] **Step 2: Export the target**

**Do not echo the connection string.** Export it directly:

```bash
export BOOTSTRAP_PROJECT_ID=weathered-wave-50814522
export BOOTSTRAP_BRANCH_ID=<BRANCH_ID>
export BOOTSTRAP_DATABASE_URL="$(node "$APPDATA/npm/node_modules/neonctl/bin/cli.js" connection-string <BRANCH_ID> --project-id weathered-wave-50814522 --role-name neondb_owner)"
```

- [ ] **Step 3: Run the bootstrap**

```bash
node scripts/bootstrap-project.mjs
```

Expected, with real numbers in place of the counts:

```
Target: branch br-... in project weathered-wave-50814522
Connection reports: project weathered-wave-50814522 branch br-... role neondb_owner public_tables 0
Applying baseline (sha256 ...)

Verification:
  tables                 34
  functions              12
  ledger_rows            37
  aeo_app                1
  aeo_app_bypassrls      true
  aeo_app_table_grants   <non-zero>

Bootstrap proof: ok -- runner finds nothing pending
```

Exit code 0. Record the actual counts — Task 6 compares the production-branch run against them.

- [ ] **Step 4: Prove the empty-schema guard is load-bearing**

Run the exact same command again against the now-populated branch:

```bash
node scripts/bootstrap-project.mjs
```

Expected: exits 1 with `Refusing to act: schema public already has 34 table(s)`.

A guard nobody has watched fire is not yet known to work.

- [ ] **Step 5: Delete the rehearsal branch**

```bash
node "$APPDATA/npm/node_modules/neonctl/bin/cli.js" branches delete <BRANCH_ID> --project-id weathered-wave-50814522
```

Confirm it is gone:

```bash
node "$APPDATA/npm/node_modules/neonctl/bin/cli.js" branches list --project-id weathered-wave-50814522
```

Expected: the rehearsal branch is absent. **Report any branch that failed to delete** rather than leaving it.

- [ ] **Step 6: Report the evidence**

There is no code change in this task. Report the verification table and both outcomes (success, then the refused re-run) verbatim.

---

### Task 4: Synthetic seeds

**Files:**
- Create: `supabase/seeds/001_synthetic.sql`
- Test: `__tests__/db/synthetic-seed.test.ts`

The `supabase/seeds/` directory does not exist yet; create it.

- [ ] **Step 1: Write the failing test**

Create `__tests__/db/synthetic-seed.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SEED = readFileSync(join(process.cwd(), 'supabase', 'seeds', '001_synthetic.sql'), 'utf8')

/** Brand limits, mirroring check_brand_limit() in the baseline. */
const BRAND_LIMIT: Record<string, number> = { free: 1, basic: 1, pro: 3, enterprise: 10 }

function seededAccountPlan(sql: string): string | null {
  return /insert into accounts[\s\S]*?values\s*\([^)]*?'(basic|pro|enterprise)'/i.exec(sql)?.[1] ?? null
}

function seededClientCount(sql: string): number {
  const stmt = /insert into clients[\s\S]*?;/i.exec(sql)?.[0] ?? ''
  return [...stmt.matchAll(/\(\s*'[0-9a-f-]{36}'/gi)].length
}

describe('synthetic seed', () => {
  it('seeds no identity: no neon_auth or profiles writes', () => {
    expect(SEED).not.toMatch(/insert\s+into\s+(public\.)?profiles/i)
    expect(SEED).not.toMatch(/insert\s+into\s+neon_auth/i)
  })

  it('is written to be re-runnable', () => {
    const inserts = SEED.match(/insert into/gi) ?? []
    const arbiters = SEED.match(/on conflict/gi) ?? []
    expect(inserts.length).toBeGreaterThan(0)
    expect(arbiters).toHaveLength(inserts.length)
  })

  // effective_plan only reaches the stored plan when status is 'active' AND a
  // subscription id is present (check_brand_limit, baseline :2077 and :2082).
  // Without both, a 'pro' account still resolves to 'free' and a limit of 1.
  it('seeds an account that actually resolves to its stored plan', () => {
    expect(SEED).toMatch(/'active'/)
    expect(SEED).toMatch(/stripe_subscription_id/i)
    expect(SEED).not.toMatch(/trial_ends_at/i)
  })

  // THE INVARIANT. Postgres fires BEFORE INSERT row triggers before the
  // ON CONFLICT arbiter, so on a re-run enforce_brand_limit counts the rows
  // already present and raises BRAND_LIMIT_REACHED before `do nothing` can skip
  // them. Re-runs are safe only while the seeded count stays STRICTLY BELOW the
  // limit. Adding one more client under this account breaks that silently.
  it('seeds strictly fewer clients than the account brand limit', () => {
    const plan = seededAccountPlan(SEED)
    expect(plan).not.toBeNull()
    const limit = BRAND_LIMIT[plan as string]
    expect(limit).toBeGreaterThan(0)
    expect(seededClientCount(SEED)).toBeLessThan(limit)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run __tests__/db/synthetic-seed.test.ts`

Expected: fails at module load — `ENOENT` on `supabase/seeds/001_synthetic.sql`.

- [ ] **Step 3: Write the seed**

Create `supabase/seeds/001_synthetic.sql`:

```sql
-- ============================================================================
-- Synthetic seed. NO PRODUCTION DATA -- every value here is invented.
--
-- Scope is deliberate: accounts -> clients -> scans, and nothing else. profiles
-- is not seeded because profiles.id carries a foreign key into neon_auth."user",
-- a schema Neon owns and provisions. Sign up through Neon Auth and the existing
-- webhooks/neon handler creates the profile; hand-written identity rows would
-- diverge from what the real flow produces.
--
-- WHY THE ACCOUNT LOOKS LIKE THIS. public.clients has a BEFORE INSERT trigger,
-- enforce_brand_limit, calling check_brand_limit(). An account left at its
-- defaults (plan 'basic', status 'active', no subscription) resolves through
-- that function to the effective plan 'free', whose limit is 1 -- and 'basic'
-- is also capped at 1. effective_plan only reaches the STORED plan when
-- status = 'active' AND stripe_subscription_id is not null. Hence pro + active
-- + a synthetic subscription id, which is limit 3.
--
-- Do NOT reach for trial_ends_at instead: check_brand_limit() compares it to
-- pg_catalog.now(), so a hardcoded timestamp is a time bomb that starts failing
-- after that date.
--
-- WHY EXACTLY TWO CLIENTS. Postgres fires BEFORE INSERT row triggers BEFORE the
-- ON CONFLICT arbiter is evaluated, so `on conflict do nothing` does not by
-- itself make a client insert idempotent: on a second run the trigger counts the
-- rows already there and raises BRAND_LIMIT_REACHED before the arbiter can skip
-- anything. Re-runs are safe only while the seeded count stays STRICTLY BELOW
-- the limit -- 2 < 3 passes, and `do nothing` then skips both rows. Adding a
-- third client under this account would break re-runnability silently.
-- __tests__/db/synthetic-seed.test.ts pins that invariant.
-- ============================================================================

insert into accounts (id, plan, status, stripe_subscription_id)
values ('00000000-0000-4000-8000-000000000001', 'pro', 'active', 'sub_seed_synthetic_pro')
on conflict (id) do nothing;

insert into clients (id, account_id, brand_name, domain, industry, region)
values
  ('00000000-0000-4000-8000-000000000101',
   '00000000-0000-4000-8000-000000000001',
   'Northwind Coffee', 'northwind.example', 'retail', 'HK'),
  ('00000000-0000-4000-8000-000000000102',
   '00000000-0000-4000-8000-000000000001',
   'Harbour Books', 'harbourbooks.example', 'retail', 'HK')
on conflict (id) do nothing;

insert into scans (id, account_id, client_id, url, domain, score, grade, results)
values
  ('00000000-0000-4000-8000-000000000201',
   '00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000101',
   'https://northwind.example/', 'northwind.example', 72.00, 'B',
   '{"seed": true}'::jsonb)
on conflict (id) do nothing;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run __tests__/db/synthetic-seed.test.ts`

Expected: **4 passed**.

- [ ] **Step 5: Lint and typecheck**

```bash
npm run lint
```
Expected: no output.

```bash
npm run typecheck
```
Expected: `Types generated successfully`.

- [ ] **Step 6: Commit**

```bash
git add supabase/seeds/001_synthetic.sql __tests__/db/synthetic-seed.test.ts
git commit -m "feat(seed): synthetic tenant data, re-runnable under the brand-limit trigger"
```

---

### Task 5: Prove the seed is re-runnable, on a real branch

A static test cannot prove the trigger/arbiter interaction. Only running it twice can.

**Files:**
- Modify: `scripts/bootstrap-project.mjs`

- [ ] **Step 1: Apply the seed from the script**

In `scripts/bootstrap-project.mjs`, add the constant beside `BASELINE_FILE`:

```js
const SEED_FILE = join(process.cwd(), 'supabase', 'seeds', '001_synthetic.sql')
```

Then, in `main()`, immediately after the `aeo_app_bypassrls` check and still inside the `withTargetClient` callback, add:

```js
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
```

- [ ] **Step 2: Rehearse again on a fresh disposable branch**

Create a second rehearsal branch exactly as in Task 3 Step 1, naming it `bootstrap-rehearsal-2`, export the same three variables, and run:

```bash
node scripts/bootstrap-project.mjs
```

Expected: the Task 3 output, plus

```
Applying synthetic seed
Seed applied twice: {"accounts":"1","clients":"2","scans":"1"}

Bootstrap proof: ok -- runner finds nothing pending
```

Exit code 0. The counts are the point: **2 clients, not 4** — the second application was skipped by `do nothing` rather than either duplicating rows or raising `BRAND_LIMIT_REACHED`.

- [ ] **Step 3: Prove the invariant is real**

Temporarily add a third client to `supabase/seeds/001_synthetic.sql` — copy the `Harbour Books` row, change its id's last digit to `3` and its name to `Third Brand`. Create a third disposable branch and run the bootstrap against it.

Expected: the run fails during the **second** seed application with `BRAND_LIMIT_REACHED`, because 3 clients is no longer strictly below the limit of 3.

Then restore the seed file:

```bash
git restore supabase/seeds/001_synthetic.sql
```

```bash
git diff --stat supabase/seeds/001_synthetic.sql
```
Expected: no output.

Delete all rehearsal branches and confirm none remain.

- [ ] **Step 4: Full local gate**

```bash
npm run lint
```
Expected: no output.

```bash
npm run typecheck
```
Expected: `Types generated successfully`.

```bash
npm test
```
Expected: green. A banner saying the integration project did not run is **not** a pass — report it.

- [ ] **Step 5: Commit**

```bash
git add scripts/bootstrap-project.mjs
git commit -m "feat(bootstrap): apply the synthetic seed twice to prove re-runnability"
```

---

### Task 6: Apply to the AISO production branch

**This is the irreversible step. Do not start it until Tasks 3 and 5 have both passed and every rehearsal branch is deleted.**

**Files:** none changed. This task changes a real database.

- [ ] **Step 1: Confirm the target**

```bash
node "$APPDATA/npm/node_modules/neonctl/bin/cli.js" branches list --project-id weathered-wave-50814522
```

Record the default/production branch id of the AISO project. Confirm no rehearsal branches remain.

- [ ] **Step 2: Export the target explicitly**

```bash
export BOOTSTRAP_PROJECT_ID=weathered-wave-50814522
export BOOTSTRAP_BRANCH_ID=<AISO_DEFAULT_BRANCH_ID>
export BOOTSTRAP_DATABASE_URL="$(node "$APPDATA/npm/node_modules/neonctl/bin/cli.js" connection-string <AISO_DEFAULT_BRANCH_ID> --project-id weathered-wave-50814522 --role-name neondb_owner)"
```

Never echo that value.

- [ ] **Step 3: Run it**

```bash
node scripts/bootstrap-project.mjs
```

Expected: the same verification table and counts recorded in Task 3 Step 3, plus `Seed applied twice: {"accounts":"1","clients":"2","scans":"1"}` and `Bootstrap proof: ok`. Exit code 0.

If the counts differ from the rehearsal, **stop and report** — the rehearsal and the real run used the same code path, so a difference means something about the target is not what we believed.

- [ ] **Step 4: Confirm the guard now protects the real database**

Re-run the bootstrap once more against the same target.

Expected: exits 1 with `Refusing to act: schema public already has 34 table(s)`.

- [ ] **Step 5: Report**

No code change. Report the verification table verbatim.

---

### Task 7: The credential handoff runbook

**Files:**
- Create: `docs/runbooks/bootstrap-greenfield-project.md`

- [ ] **Step 1: Verify the runbook's claims before writing them**

```bash
grep -n "MIGRATE_DATABASE_URL is not set" scripts/migrate.ts
```

```bash
ls scripts/verify-db-connection.mjs
```

Expected: both resolve. If `scripts/verify-db-connection.mjs` does not exist or does not report a role, correct the runbook in Step 2 to match reality rather than writing an instruction that fails.

- [ ] **Step 2: Write the runbook**

Create `docs/runbooks/bootstrap-greenfield-project.md`:

```markdown
# Runbook: finishing the greenfield project bootstrap

The schema, roles, grants and synthetic seed are installed by
`npm run bootstrap:project` (see `scripts/bootstrap-project.mjs`). Three steps
remain, and all three involve credentials, so they are done by a human and never
by tooling in this repo.

Target project: `weathered-wave-50814522` ("AISO").

## 1. Give `aeo_app` a password

The baseline creates the role `NOLOGIN` on purpose, so that no secret ever lands
in a tracked file. Connect as the owner and run:

    alter role aeo_app login password '<generated>';

Generate it with a password manager. Do not reuse the owner password, and do not
paste it into a shell command -- the Neon driver echoes full connection URLs,
password included, in its error messages.

## 2. Bind the application to it

Set `DATABASE_URL` to the **`aeo_app`** connection string (not the owner's) in:

- Vercel: Production, Preview and Development environments
- `.env.local` for local development

`MIGRATE_DATABASE_URL` is the separate **owner** connection string, used only by
`npm run migrate`. `aeo_app` cannot perform DDL, deliberately, and
`scripts/migrate.ts` has no fallback -- unset, it fails immediately and names the
variable.

Vercel also needs `NEON_AUTH_COOKIE_SECRET` (at least 32 characters) in every
environment including Preview. It is required at **build** time.

## 3. Verify the binding

    node scripts/verify-db-connection.mjs

Confirm it reports `role: aeo_app`. If it reports `neondb_owner`, the
application is running with DDL rights it should not have.

## What is deliberately not automated

Everything above. A script that sets passwords or writes deployment secrets
would have to handle them, and nothing in this repo should.
```

- [ ] **Step 3: Commit**

```bash
git add docs/runbooks/bootstrap-greenfield-project.md
git commit -m "docs(runbook): credential handoff for the greenfield bootstrap"
```

---

## Final verification

- [ ] `npm run lint` gives 0 errors, 0 warnings
- [ ] `npm run typecheck` is clean
- [ ] `REQUIRE_INTEGRATION_TESTS=1 npm test` is green and the integration project actually ran
- [ ] `git diff --stat main -- scripts/migrate.ts scripts/schema-equivalence.mjs` gives **no output**. This plan does not modify either; if it does, the two safety postures have been merged and the change needs re-review.
- [ ] `neonctl branches list --project-id weathered-wave-50814522` shows no `bootstrap-rehearsal-*` branches
- [ ] The AISO project reports the same verification counts as the rehearsal did

## What this does NOT establish

- **Production migration `038` is still unapplied**, and this plan does not touch it. It is blocked on credentials that are not on this machine, not on work.
- The application has not been run against the new project. That needs step 2 of the runbook first.
- Items 1.6 (connection-binding guards) and 1.8 (role allow/deny tests) remain open. 1.8's tests connect *as* `aeo_app` and cannot run until its password is set.
