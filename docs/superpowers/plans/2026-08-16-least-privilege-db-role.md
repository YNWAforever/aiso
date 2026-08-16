# Least-Privilege Database Role Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The running application connects to Neon as `aeo_app`, a role that can read and write application data but cannot perform DDL, create roles, or write Neon Auth's tables — so a leaked application credential can no longer destroy or restructure the database.

**Architecture:** Migration `037` creates `aeo_app` `NOLOGIN BYPASSRLS` with blanket DML grants on `public`, `ALTER DEFAULT PRIVILEGES` so future migrations' tables are granted automatically, and read-only access to `neon_auth."user"`. A human sets the password out of band, so it never enters git. `scripts/migrate.ts` moves to a separate `MIGRATE_DATABASE_URL` so migrations keep running as the owner. An integration suite connects *as* `aeo_app` and asserts both what it can do and what it must not.

**Tech Stack:** PostgreSQL 16 on Neon, `@neondatabase/serverless`, `scripts/migrate.ts`, Vitest 4 (unit + integration projects), `neonctl` for disposable branches.

---

## Read this before you start

**The design is `docs/superpowers/specs/2026-08-16-least-privilege-db-role-design.md`.** Read it. Everything below was verified against a real Neon branch on 2026-08-16 — do not re-litigate it from first principles, but do re-verify if something contradicts you.

**`BYPASSRLS` is deliberate and load-bearing.** Seven tables in `public` have RLS enabled with zero policies — a default-deny posture chosen independently by `023`, `024`, `025` and `027`. A `NOBYPASSRLS` role granted `SELECT` on those returns **zero rows silently**, which is exactly what migration `036` existed to eliminate. **A freshly created role defaults to `rolbypassrls = false`**, so the keyword must be stated explicitly. This is a *grants* change, not an RLS change.

**The `neon_auth` grants are required.** `app/api/webhooks/neon/route.ts:122` authenticates every webhook payload against `neon_auth."user"`, and since `@neondatabase/auth` ships no webhook signing, **that lookup is the only authentication the endpoint has**. `lib/alerts/neon-store.ts:193` joins the same table for recipient emails. Verified: `neondb_owner` is a member of the `neon_auth` role that owns the schema, so it may issue these grants.

**Never paste a connection string into a shell command.** The driver echoes the full URL including the password in its error messages.

**Do not run anything against production.** Task 8 is the only production step and it is human-only.

**Baseline going in:** `npm run test:unit` passes at **144 files / 1586 tests**; `npm run lint` and `npm run typecheck` exit 0. `node_modules` is installed. Branch `claude/subagent-driven-fa2a11`.

---

## Task 1: Record the baseline

**Files:** none.

- [ ] **Step 1: Confirm the starting state is green**

Run: `npm run test:unit`

Expected: PASS. Note the exact file and test counts — 144 / 1586 at the time of writing. Trust what you see over that number.

Run: `npm run lint`

Expected: exits 0 with no output. This repo holds lint at 0 errors and 0 warnings.

Run: `npm run typecheck`

Expected: exits 0, no output.

If any of these fail before you have changed anything, stop and report it — you have inherited a broken baseline and must not attribute it to your own work later.

---

## Task 2: Migration 037

**Files:**
- Create: `supabase/migrations/037_least_privilege_app_role.sql`
- Test: `__tests__/supabase/037_least_privilege_app_role.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/supabase/037_least_privilege_app_role.test.ts`:

```ts
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  new URL('../../supabase/migrations/037_least_privilege_app_role.sql', import.meta.url),
  'utf8',
)

/** The migration with `--` line comments stripped, so prose cannot satisfy an assertion. */
const code = sql
  .split(/\r?\n/)
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n')

describe('037 least-privilege app role', () => {
  it('creates the role without login, so no password enters git', () => {
    expect(code).toMatch(/create\s+role\s+aeo_app[^;]*nologin/i)
    expect(code).not.toMatch(/password/i)
  })

  it('states BYPASSRLS explicitly', () => {
    // A fresh role defaults to rolbypassrls = false. Without this the seven
    // default-deny tables return zero rows silently -- the exact failure 036
    // existed to remove. Verified on a branch 2026-08-16.
    expect(code).toMatch(/create\s+role\s+aeo_app[^;]*bypassrls/i)
  })

  it('grants blanket DML on public but never DDL', () => {
    expect(code).toMatch(/grant\s+usage\s+on\s+schema\s+public\s+to\s+aeo_app/i)
    expect(code).toMatch(/grant\s+select,\s*insert,\s*update,\s*delete\s+on\s+all\s+tables\s+in\s+schema\s+public\s+to\s+aeo_app/i)
    expect(code).toMatch(/grant\s+usage,\s*select\s+on\s+all\s+sequences\s+in\s+schema\s+public\s+to\s+aeo_app/i)
    expect(code).not.toMatch(/grant\s+all\b/i)
    expect(code).not.toMatch(/grant[^;]*\bcreate\b[^;]*to\s+aeo_app/i)
    expect(code).not.toMatch(/\bsuperuser\b|\bcreaterole\b/i)
  })

  it('sets default privileges so a later migration cannot create an unreadable table', () => {
    expect(code).toMatch(/alter\s+default\s+privileges[^;]*on\s+tables\s+to\s+aeo_app/i)
    expect(code).toMatch(/alter\s+default\s+privileges[^;]*on\s+sequences\s+to\s+aeo_app/i)
  })

  it('grants read-only access to neon_auth."user" and nothing more', () => {
    expect(code).toMatch(/grant\s+usage\s+on\s+schema\s+neon_auth\s+to\s+aeo_app/i)
    expect(code).toMatch(/grant\s+select\s+on\s+neon_auth\.[^;]*to\s+aeo_app/i)
    // Read access must not carry write access, and session data is not the
    // app's business.
    expect(code).not.toMatch(/grant[^;]*(insert|update|delete)[^;]*neon_auth/i)
    expect(code).not.toMatch(/neon_auth\.\"?session\"?/i)
  })

  it('leaves the dead auth schema alone', () => {
    expect(code).not.toMatch(/\bauth\.\w/i)
  })

  it('fails closed if BYPASSRLS did not take effect', () => {
    expect(code).toMatch(/rolbypassrls/i)
    expect(code).toMatch(/raise\s+exception/i)
  })

  it('is re-runnable', () => {
    expect(code).toMatch(/to_regrole\(\s*'aeo_app'\s*\)/i)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/supabase/037_least_privilege_app_role.test.ts`

Expected: FAIL — the migration file does not exist, so `readFileSync` throws `ENOENT`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/037_least_privilege_app_role.sql`:

```sql
-- 037: introduce aeo_app, the least-privilege application role.
--
-- The app has connected as neondb_owner, which is rolbypassrls = true,
-- rolcreaterole = true, and owns every object in public. A leaked application
-- credential therefore IS the database: it can drop any table, alter any
-- schema, and create new roles. aeo_app can read and write application data --
-- which the app does anyway -- but nothing else.
--
-- BYPASSRLS is DELIBERATE and must stay. Seven tables in public have RLS
-- enabled with zero policies; 023, 024, 025 and 027 each chose that
-- default-deny posture for the tables it created. A NOBYPASSRLS role granted
-- SELECT on those returns ZERO ROWS SILENTLY -- precisely the failure migration
-- 036 existed to remove. Verified on a disposable branch 2026-08-16: a freshly
-- created role defaults to rolbypassrls = false, so omitting the keyword
-- reintroduces that failure quietly. This is a grants change, not an RLS
-- change.
--
-- The role is created NOLOGIN. A human sets the password out of band so it
-- never enters git:
--     alter role aeo_app login password '<generated>';
--
-- The neon_auth grants are required, not optional:
--   * app/api/webhooks/neon/route.ts authenticates every payload against
--     neon_auth."user", and @neondatabase/auth ships no webhook signing, so
--     that lookup is the ONLY authentication that endpoint has;
--   * lib/alerts/neon-store.ts joins it to resolve recipient emails.
-- neondb_owner may issue them: it is a member of the neon_auth role that owns
-- the schema. Verified 2026-08-16.

do $$
begin
  if to_regrole('aeo_app') is null then
    create role aeo_app nologin bypassrls;
  else
    alter role aeo_app nologin bypassrls;
  end if;
end $$;

grant usage on schema public to aeo_app;
grant select, insert, update, delete on all tables in schema public to aeo_app;
grant usage, select on all sequences in schema public to aeo_app;

-- Without this, migration 038 creates a table aeo_app cannot read, and the
-- failure surfaces at runtime in whichever route touches it first -- long after
-- the migration looked successful. Applies to objects created by the role
-- running migrations, which is neondb_owner.
alter default privileges in schema public
  grant select, insert, update, delete on tables to aeo_app;
alter default privileges in schema public
  grant usage, select on sequences to aeo_app;

grant usage on schema neon_auth to aeo_app;
grant select on neon_auth."user" to aeo_app;

-- Fail closed. If BYPASSRLS did not take, the seven default-deny tables would
-- return zero rows for every app query, silently. The runner wraps each
-- migration in a transaction, so raising here rolls the whole file back and
-- leaves the ledger unmarked.
do $$
declare
  bypasses boolean;
begin
  select rolbypassrls into bypasses from pg_roles where rolname = 'aeo_app';

  if bypasses is distinct from true then
    raise exception
      'aeo_app must have BYPASSRLS: without it the seven RLS-enabled, zero-policy '
      'tables silently return no rows to the application';
  end if;
end $$;
```

**Note on the `DO` blocks:** `scripts/migrate.ts` rejects a migration containing its own `begin`/`commit`/`rollback`, but its check strips dollar-quoted bodies first (`scripts/migrate.ts:128`), so the `begin`/`end` inside `$$ … $$` are invisible to it. Do not restructure to avoid them.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run __tests__/supabase/037_least_privilege_app_role.test.ts`

Expected: PASS, 8/8.

- [ ] **Step 5: Confirm the runner accepts the file**

Run: `npx vitest run __tests__/supabase/migration-contract.test.ts`

Expected: PASS. This suite reads every migration off disk, so `037` is covered automatically — in particular `'contains no transaction control statements'` and `'uses unique, numerically sorted migration prefixes'`. If the transaction-control test fails, **stop and report it — do not delete the fail-closed block to make it pass.**

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/037_least_privilege_app_role.sql __tests__/supabase/037_least_privilege_app_role.test.ts
git commit -m "feat(db): add the least-privilege aeo_app role"
```

---

## Task 3: Migrations run as the owner, via their own DSN

The app's `DATABASE_URL` becomes `aeo_app`'s. Migrations need the owner, so they move to `MIGRATE_DATABASE_URL`.

**This breaks two callers if you miss them.** `__tests__/integration/setup.ts:137` and `__tests__/integration/migrate.test.ts:57` both invoke `scripts/migrate.ts` with `DATABASE_URL` in its env. Both must change, or every integration run fails.

**Files:**
- Modify: `scripts/migrate.ts:177-181`
- Modify: `__tests__/integration/setup.ts:137`
- Modify: `__tests__/integration/migrate.test.ts:57`
- Modify: `.env.example`
- Test: `__tests__/scripts/migrate-connection-source.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/scripts/migrate-connection-source.test.ts`:

```ts
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../../scripts/migrate.ts', import.meta.url), 'utf8')

describe('migrate.ts connection source', () => {
  it('reads MIGRATE_DATABASE_URL', () => {
    expect(source).toContain('process.env.MIGRATE_DATABASE_URL')
  })

  it('does not fall back to DATABASE_URL', () => {
    // A fallback would run migrations as the least-privilege app role, fail
    // partway through the first DDL statement, and leave the operator guessing.
    // Failing at startup with a clear message is strictly better.
    expect(source).not.toMatch(/MIGRATE_DATABASE_URL\s*(\|\||\?\?)\s*process\.env\.DATABASE_URL/)
    expect(source).not.toContain('process.env.DATABASE_URL')
  })

  it('names the variable in the error so the fix is obvious', () => {
    expect(source).toMatch(/MIGRATE_DATABASE_URL is not set/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/scripts/migrate-connection-source.test.ts`

Expected: FAIL — `migrate.ts` still reads `process.env.DATABASE_URL`.

- [ ] **Step 3: Change the connection source**

In `scripts/migrate.ts`, replace this function:

```ts
function connectionString(): string {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  return url
}
```

with:

```ts
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
```

- [ ] **Step 4: Update both integration callers**

In `__tests__/integration/setup.ts`, at the `execFileSync` that runs the migration runner, change:

```ts
      env: { ...process.env, DATABASE_URL: branch.connectionUri },
```

to:

```ts
      env: { ...process.env, MIGRATE_DATABASE_URL: branch.connectionUri },
```

In `__tests__/integration/migrate.test.ts`, in the test `'is idempotent — running it again applies nothing'`, change:

```ts
      env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
```

to:

```ts
      env: { ...process.env, MIGRATE_DATABASE_URL: process.env.TEST_DATABASE_URL },
```

- [ ] **Step 5: Document both variables**

In `.env.example`, immediately after the `DATABASE_URL=` line, add:

```bash
# The OWNER connection string, used only by `npm run migrate`.
# DATABASE_URL above is the least-privilege application role (aeo_app, migration
# 037), which deliberately cannot run DDL. The runner does NOT fall back to
# DATABASE_URL — unset, `npm run migrate` fails immediately and says so.
MIGRATE_DATABASE_URL=
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run __tests__/scripts/migrate-connection-source.test.ts`

Expected: PASS, 3/3.

Run: `npm run test:unit`

Expected: PASS. `npm run migrate` is not exercised by the unit project, so nothing else should move.

- [ ] **Step 7: Commit**

```bash
git add scripts/migrate.ts __tests__/scripts/migrate-connection-source.test.ts __tests__/integration/setup.ts __tests__/integration/migrate.test.ts .env.example
git commit -m "refactor(migrate): run migrations through MIGRATE_DATABASE_URL"
```

---

## Task 4: Prove the role's privileges on a real branch

The point of this suite is the **negative** assertions. A test that only proves `aeo_app` works would pass just as happily against `neondb_owner` and prove nothing.

**Files:**
- Create: `__tests__/integration/least-privilege-role.test.ts`

- [ ] **Step 1: Write the suite**

Create `__tests__/integration/least-privilege-role.test.ts`:

```ts
import { neon } from '@neondatabase/serverless'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * Proves migration 037's role really is least-privilege, against a real branch.
 *
 * The negative assertions carry the weight: asserting only that aeo_app can
 * read would pass against the owner too. Each denial is matched on its specific
 * message, because a bare "it threw" would also pass if the password were
 * simply wrong.
 */
const owner = neon(process.env.TEST_DATABASE_URL!)

/** Generated per run, never logged, never committed. */
const PASSWORD = `t${Math.random().toString(36).slice(2)}${Date.now()}`

let app: ReturnType<typeof neon>

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error('TEST_DATABASE_URL is not set — globalSetup did not provision a branch')
  }

  // DDL cannot take bind parameters, and Neon's tagged template parameterises
  // every interpolation, so this must go through .query() with literal SQL.
  await owner.query(`alter role aeo_app login password '${PASSWORD}'`)

  const url = new URL(process.env.TEST_DATABASE_URL)
  url.username = 'aeo_app'
  url.password = PASSWORD
  app = neon(url.toString())

  // Seed a row so the RLS visibility assertion below cannot pass vacuously:
  // an empty table returns zero rows whether or not BYPASSRLS is set.
  await owner`
    insert into accounts (id, name, plan) values (gen_random_uuid(), 'rls probe', 'free')
    on conflict do nothing
  `
  await owner`
    insert into client_reports (id, account_id, client_id, status)
    select gen_random_uuid(), a.id, null, 'draft' from accounts a limit 1
    on conflict do nothing
  `
})

describe('aeo_app can do its job', () => {
  it('connects at all', async () => {
    const rows = await app`select 1 as ok`
    expect(rows[0].ok).toBe(1)
  })

  it('reads and writes an application table', async () => {
    const inserted = await app`
      insert into accounts (id, name, plan) values (gen_random_uuid(), 'app role probe', 'free')
      returning id
    `
    expect(inserted).toHaveLength(1)

    await app`update accounts set name = 'app role probe 2' where id = ${inserted[0].id}`
    const read = await app`select name from accounts where id = ${inserted[0].id}`
    expect(read[0].name).toBe('app role probe 2')

    await app`delete from accounts where id = ${inserted[0].id}`
  })

  it('sees rows in an RLS-enabled, zero-policy table', async () => {
    // THE assertion this whole design turns on. Without BYPASSRLS this returns
    // 0 while erroring nowhere. The seeded row above is what makes it mean
    // something.
    const rows = await app`select count(*)::int as n from client_reports`
    expect(rows[0].n).toBeGreaterThan(0)
  })

  it('reads neon_auth."user", the webhook\'s only authentication', async () => {
    await expect(app`select id, email from neon_auth."user" limit 1`).resolves.toBeDefined()
  })
})

describe('aeo_app cannot escalate — the assertions that matter', () => {
  it('cannot create a table', async () => {
    await expect(app`create table lp_probe_should_not_exist (id int)`)
      .rejects.toThrow(/permission denied for schema public/i)
  })

  it('cannot drop a table', async () => {
    await expect(app`drop table accounts`).rejects.toThrow(/must be owner of table/i)
  })

  it('cannot alter a table', async () => {
    await expect(app`alter table accounts add column lp_probe int`)
      .rejects.toThrow(/must be owner of table/i)
  })

  it('cannot create a role', async () => {
    await expect(app`create role lp_probe_evil`).rejects.toThrow(/permission denied to create role/i)
  })

  it('cannot write Neon Auth data despite reading it', async () => {
    await expect(
      app`insert into neon_auth."user" (id) values ('00000000-0000-0000-0000-000000000000')`,
    ).rejects.toThrow(/permission denied for table/i)
  })
})

describe('default privileges cover tables created later', () => {
  it('grants a table created after 037 without another grant statement', async () => {
    // The single most likely way this design silently rots: migration 038 adds
    // a table and the app cannot read it, surfacing at runtime in whichever
    // route touches it first.
    await owner.query('create table lp_future_table (id int primary key)')
    try {
      await expect(app`select count(*) from lp_future_table`).resolves.toBeDefined()
    } finally {
      await owner.query('drop table lp_future_table')
    }
  })
})
```

- [ ] **Step 2: Run the suite**

Run: `npm run test:integration`

Expected: PASS, including all of the above. `neonctl` must be on PATH and authenticated; it is on this machine (2.26.6).

**If a negative assertion fails because nothing threw, that is a real finding — the role has a privilege it should not.** Report it; do not relax the assertion.

**If `insert into client_reports` in `beforeAll` fails** because the column set differs from what this plan assumed, read `supabase/migrations/027_client_report_snapshots.sql` for the actual `NOT NULL` columns and adjust the seed. The requirement is only that **at least one row exists** before the visibility assertion runs — the exact column values do not matter.

- [ ] **Step 3: Commit**

```bash
git add __tests__/integration/least-privilege-role.test.ts
git commit -m "test(integration): prove aeo_app is least-privilege"
```

---

## Task 5: Document the role

**Files:**
- Modify: `CLAUDE.md` (Database section)

- [ ] **Step 1: Add the role to the Database section**

In `CLAUDE.md`, find the bullet beginning `- **There is no database-level tenancy backstop.`, and insert this **immediately before** it:

```markdown
- **The app connects as `aeo_app`, not `neondb_owner`** (migration `037`). It has blanket DML on
  `public`, `USAGE`/`SELECT` on sequences, and `SELECT` on `neon_auth."user"` — nothing else. It
  cannot run DDL, cannot create roles, and cannot write Neon Auth's tables.
  `__tests__/integration/least-privilege-role.test.ts` asserts each denial by its specific error
  message, because a bare "it threw" would also pass on a wrong password.
- **`aeo_app` keeps `BYPASSRLS`, deliberately.** The seven RLS-enabled, zero-policy tables would
  otherwise return **zero rows silently** to every app query. A freshly created role defaults to
  `rolbypassrls = false`, so `037` states the keyword and then fails closed if it did not take.
  Least privilege here is about *grants*, not RLS.
- **Migrations run through `MIGRATE_DATABASE_URL`, not `DATABASE_URL`** — `aeo_app` cannot perform
  DDL. `scripts/migrate.ts` does **not** fall back; unset, it fails immediately and names the
  variable. `__tests__/scripts/migrate-connection-source.test.ts` pins the absence of that fallback.
```

- [ ] **Step 2: Check nothing else contradicts it**

Run: `grep -rn "connects as \`neondb_owner\`" CLAUDE.md`

Expected: the remaining hits describe the *historical* reason the dead RLS policies never fired, which is still true of `neondb_owner` itself. Leave those; they are about the owner role, not about what the app now uses. If you find a line claiming the **application** connects as `neondb_owner`, correct it.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: record the least-privilege app role"
```

---

## Task 6: Full verification

**Files:** none, unless a check fails.

- [ ] **Step 1: Unit suite**

Run: `npm run test:unit`

Expected: PASS. Against the 144 files / 1586 baseline you have added two files and **+12 tests**: `037_least_privilege_app_role.test.ts` has 8, `migrate-connection-source.test.ts` has 3, and `__tests__/migrations/neon-role-portability.test.mjs` **auto-adds one** because it runs `it.each` over `readdirSync` of the migrations directory — adding any migration adds a test without anyone writing one. Expect **146 files / 1598 tests**. If the total moved by any other amount, work out why.

- [ ] **Step 2: The RLS tests must still pass**

Run: `npx vitest run __tests__/migrations/rls-policy-freeze.test.mjs __tests__/db/client-report-migration.test.ts`

Expected: PASS. `037` creates no policy, so the freeze guard is satisfied; it disables no RLS, so `027`'s default-deny pin holds.

- [ ] **Step 3: Lint and typecheck**

Run: `npm run lint`

Expected: exits 0, zero warnings.

Run: `npm run typecheck`

Expected: exits 0.

- [ ] **Step 4: Whole suite, both projects**

Run: `REQUIRE_INTEGRATION_TESTS=1 npm test`

Expected: PASS for both projects. This is the command that proves integration genuinely ran rather than skipping. If `neonctl` is unavailable this **fails rather than skips**, by design — in that case say plainly in your report that the integration project did not execute.

- [ ] **Step 5: Clean tree**

Run: `git status --porcelain`

Expected: no output.

---

## Task 7: Cutover (HUMAN ONLY — agents stop here)

**Files:** none. This task changes a live database and deployment configuration.

> **Agents: do not perform this task.** It requires reading and entering a password and changing production environment variables. Hand this plan to the human. Do not offer to run any part of it, and do not ask for the connection string — you do not need it and must not have it.

- [ ] **Step 1: Apply `037`**

With `MIGRATE_DATABASE_URL` set to the owner DSN, run `npm run migrate -- --dry-run`, then `npm run migrate`, then `npm run migrate -- --verify`.

Expected: `037` applies and is recorded. If it aborts with `aeo_app must have BYPASSRLS`, nothing was applied — the transaction rolled back and the ledger is unmarked. Investigate rather than forcing it through.

- [ ] **Step 2: Give the role a password**

Generate a strong password and run, as the owner:

```sql
alter role aeo_app login password '<generated>';
```

Never paste the resulting connection string into a shell command — the driver echoes the full URL including the password in its error messages.

- [ ] **Step 3: Set the environment variables**

- Locally: `MIGRATE_DATABASE_URL` = owner DSN in `.env.local`; leave `DATABASE_URL` alone until step 5.
- Vercel, every environment: set `DATABASE_URL` to the **`aeo_app`** DSN. Keep the owner DSN recorded somewhere safe — it is the rollback.

- [ ] **Step 4: Redeploy**

Redeploy each Vercel environment so the new `DATABASE_URL` takes effect.

- [ ] **Step 5: Verify the paths most likely to break**

- run a scan
- load the dashboard
- open a client report — this exercises an RLS-enabled table, so a zero-rows result means `BYPASSRLS` did not take
- replay a Stripe webhook
- **complete a real signup**, so the Neon Auth `user.created` webhook fires. It depends on the `neon_auth` grant and fails silently otherwise — this is the path least likely to be noticed and most likely to break.

- [ ] **Step 6: Rollback if needed**

Set `DATABASE_URL` back to the owner DSN and redeploy. Nothing in `037` needs reverting for the app to work again.

---

## What this plan deliberately does not do

- **It does not rotate the leaked `neondb_owner` password.** Still live, still exposed, still separately owed. This reduces what the *application* credential can do; it does not retire the owner credential.
- **It does not make RLS load-bearing.** No policies are created; the `create policy` ban added alongside `036` stands.
- **It does not tighten grants per table.** Blanket DML matches the real trust boundary — the app can already read and write everything it is asked to. Tightening later is not blocked by anything here.
- **It does not change `lib/db.ts` or any query.** Only `scripts/migrate.ts` and two test callers change.
