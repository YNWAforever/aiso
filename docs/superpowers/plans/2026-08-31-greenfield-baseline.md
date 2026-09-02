# Provable Greenfield Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce `supabase/baseline/000_baseline_2026-08-31.sql` — a single reviewed
schema-only file — together with a differ that *proves* it lands the same application-owned
schema as replaying migrations `001`–`037`.

**Architecture:** A pure, unit-tested comparison function (`lib/schema/diff.ts`) plus a thin
catalog introspector (`lib/schema/introspect.ts`), driven by a single-process script
(`scripts/schema-equivalence.mjs`) that provisions one disposable Neon branch, builds both
schema paths on it, and diffs them. The baseline is then authored in six dependency-ordered
slices, running the differ after each so a transcription error is attributed to the slice
that introduced it.

**Tech Stack:** TypeScript, Vitest, `@neondatabase/serverless` (`Pool`/`Client`), the existing
`__tests__/helpers/neon-branch.ts` provisioning helpers.

**Design:** `docs/superpowers/specs/2026-08-31-greenfield-baseline-design.md`

---

## File structure

| File | Responsibility |
|---|---|
| `lib/schema/types.ts` | `SchemaSnapshot` / `SchemaDiff` shapes — shared vocabulary, no logic |
| `lib/schema/diff.ts` | Pure `diffSchemas(a, b)`. No I/O. Fully unit-tested. |
| `lib/schema/introspect.ts` | Eight catalog queries → `SchemaSnapshot`. Thin. |
| `scripts/schema-equivalence.mjs` | Orchestrates: branch → path A → path B → diff → exit code |
| `supabase/baseline/000_baseline_2026-08-31.sql` | The consolidated schema |
| `__tests__/lib/schema-diff.test.ts` | Unit tests for the differ |

Every snapshot class is a flat `Record<string, string>` — key identifies the object, value is
its normalized definition. That single decision makes the differ one generic loop instead of
eight bespoke comparators, and makes test fixtures readable.

---

### Task 1: Snapshot and diff types

**Files:**
- Create: `lib/schema/types.ts`

- [ ] **Step 1: Write the types**

```ts
/**
 * A normalized view of one database's application-owned schema.
 *
 * Every class is a flat map: the key identifies an object, the value is its
 * definition rendered as a single comparable string. Keeping all eight classes
 * the same shape lets diffSchemas() be one generic loop rather than eight
 * bespoke comparators.
 */
export interface SchemaSnapshot {
  /** "table.column" -> "type|nullable|default" */
  columns: Record<string, string>
  /** "table.constraint" -> pg_get_constraintdef output (body, not just presence) */
  constraints: Record<string, string>
  /** "table.index" -> full indexdef */
  indexes: Record<string, string>
  /** "table.trigger" -> "function|tgtype" */
  triggers: Record<string, string>
  /** "name(argtypes)" -> "returns|volatility|security_definer" */
  functions: Record<string, string>
  /** "table" -> comma-joined sorted privilege list for aeo_app */
  grants: Record<string, string>
  /** "table" -> "rowsecurity=<bool>|policies=<count>" */
  rls: Record<string, string>
  /** "extension" -> schema it is installed into */
  extensions: Record<string, string>
}

export type SchemaClass = keyof SchemaSnapshot

export interface ClassDiff {
  /** Keys present in the legacy path but missing from the baseline path. */
  onlyInLegacy: string[]
  /** Keys present in the baseline path but missing from the legacy path. */
  onlyInBaseline: string[]
  /** Keys in both whose definitions differ. */
  changed: Array<{ key: string; legacy: string; baseline: string }>
}

export interface SchemaDiff {
  equivalent: boolean
  classes: Record<SchemaClass, ClassDiff>
}

export const SCHEMA_CLASSES: SchemaClass[] = [
  'columns', 'constraints', 'indexes', 'triggers',
  'functions', 'grants', 'rls', 'extensions',
]
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add lib/schema/types.ts
git commit -m "feat(schema): snapshot and diff types for baseline equivalence"
```

---

### Task 2: The differ (TDD)

**Files:**
- Create: `lib/schema/diff.ts`
- Test: `__tests__/lib/schema-diff.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest'
import { diffSchemas } from '@/lib/schema/diff'
import type { SchemaSnapshot } from '@/lib/schema/types'

function snapshot(overrides: Partial<SchemaSnapshot> = {}): SchemaSnapshot {
  return {
    columns: {}, constraints: {}, indexes: {}, triggers: {},
    functions: {}, grants: {}, rls: {}, extensions: {},
    ...overrides,
  }
}

describe('diffSchemas', () => {
  it('reports equivalence for identical snapshots', () => {
    const legacy = snapshot({ columns: { 'clients.id': 'uuid|NO|gen_random_uuid()' } })
    const baseline = snapshot({ columns: { 'clients.id': 'uuid|NO|gen_random_uuid()' } })
    const result = diffSchemas(legacy, baseline)

    expect(result.equivalent).toBe(true)
    expect(result.classes.columns.onlyInLegacy).toEqual([])
    expect(result.classes.columns.onlyInBaseline).toEqual([])
    expect(result.classes.columns.changed).toEqual([])
  })

  it('reports a table the baseline forgot to create', () => {
    const legacy = snapshot({ columns: { 'scans.id': 'uuid|NO|', 'fix_packs.id': 'uuid|NO|' } })
    const baseline = snapshot({ columns: { 'scans.id': 'uuid|NO|' } })
    const result = diffSchemas(legacy, baseline)

    expect(result.equivalent).toBe(false)
    expect(result.classes.columns.onlyInLegacy).toEqual(['fix_packs.id'])
    expect(result.classes.columns.onlyInBaseline).toEqual([])
  })

  it('reports an object the baseline invented', () => {
    const result = diffSchemas(
      snapshot(),
      snapshot({ indexes: { 'scans.idx_extra': 'CREATE INDEX idx_extra ON scans (url)' } }),
    )

    expect(result.equivalent).toBe(false)
    expect(result.classes.indexes.onlyInBaseline).toEqual(['scans.idx_extra'])
  })

  it('reports a column whose type drifted', () => {
    const result = diffSchemas(
      snapshot({ columns: { 'scans.score': 'integer|YES|' } }),
      snapshot({ columns: { 'scans.score': 'numeric|YES|' } }),
    )

    expect(result.equivalent).toBe(false)
    expect(result.classes.columns.changed).toEqual([
      { key: 'scans.score', legacy: 'integer|YES|', baseline: 'numeric|YES|' },
    ])
  })

  it('catches a check constraint whose body differs though its name matches', () => {
    const result = diffSchemas(
      snapshot({ constraints: { 'accounts.reason_len': 'CHECK ((char_length(reason) <= 500))' } }),
      snapshot({ constraints: { 'accounts.reason_len': 'CHECK ((char_length(reason) <= 200))' } }),
    )

    expect(result.equivalent).toBe(false)
    expect(result.classes.constraints.changed).toHaveLength(1)
  })

  it('catches a trigger the baseline dropped even when its function survives', () => {
    const legacy = snapshot({
      triggers: { 'clients.enforce_brand_limit': 'check_brand_limit|7' },
      functions: { 'check_brand_limit()': 'trigger|v|true' },
    })
    const baseline = snapshot({ functions: { 'check_brand_limit()': 'trigger|v|true' } })
    const result = diffSchemas(legacy, baseline)

    expect(result.equivalent).toBe(false)
    expect(result.classes.triggers.onlyInLegacy).toEqual(['clients.enforce_brand_limit'])
    expect(result.classes.functions.changed).toEqual([])
  })

  it('catches an aeo_app grant difference', () => {
    const result = diffSchemas(
      snapshot({ grants: { scans: 'DELETE,INSERT,SELECT,UPDATE' } }),
      snapshot({ grants: { scans: 'SELECT' } }),
    )

    expect(result.equivalent).toBe(false)
    expect(result.classes.grants.changed).toHaveLength(1)
  })

  it('catches a policy appearing where the posture requires none', () => {
    const result = diffSchemas(
      snapshot({ rls: { client_reports: 'rowsecurity=true|policies=0' } }),
      snapshot({ rls: { client_reports: 'rowsecurity=true|policies=1' } }),
    )

    expect(result.equivalent).toBe(false)
    expect(result.classes.rls.changed).toHaveLength(1)
  })

  it('sorts reported keys so output is stable across runs', () => {
    const legacy = snapshot({ columns: { 'z.c': 'text|YES|', 'a.c': 'text|YES|' } })
    const result = diffSchemas(legacy, snapshot())

    expect(result.classes.columns.onlyInLegacy).toEqual(['a.c', 'z.c'])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run __tests__/lib/schema-diff.test.ts`
Expected: FAIL — `Cannot find module '@/lib/schema/diff'`.

- [ ] **Step 3: Implement the differ**

```ts
import type { ClassDiff, SchemaClass, SchemaDiff, SchemaSnapshot } from './types'
import { SCHEMA_CLASSES } from './types'

/**
 * Compares one class of objects. Keys are sorted so a report is byte-stable
 * across runs — a diff that reorders itself is unreadable when you are running
 * it after every authoring slice.
 */
function diffClass(
  legacy: Record<string, string>,
  baseline: Record<string, string>,
): ClassDiff {
  const onlyInLegacy: string[] = []
  const onlyInBaseline: string[] = []
  const changed: ClassDiff['changed'] = []

  for (const key of Object.keys(legacy).sort()) {
    if (!(key in baseline)) onlyInLegacy.push(key)
    else if (legacy[key] !== baseline[key]) {
      changed.push({ key, legacy: legacy[key]!, baseline: baseline[key]! })
    }
  }
  for (const key of Object.keys(baseline).sort()) {
    if (!(key in legacy)) onlyInBaseline.push(key)
  }

  return { onlyInLegacy, onlyInBaseline, changed }
}

/**
 * Proves (or disproves) that replaying migrations 001-037 and applying the
 * greenfield baseline converge on the same application-owned schema.
 *
 * Pure: give it two snapshots, get a verdict. All database access lives in
 * lib/schema/introspect.ts.
 */
export function diffSchemas(legacy: SchemaSnapshot, baseline: SchemaSnapshot): SchemaDiff {
  const classes = {} as Record<SchemaClass, ClassDiff>
  let equivalent = true

  for (const name of SCHEMA_CLASSES) {
    const result = diffClass(legacy[name], baseline[name])
    classes[name] = result
    if (result.onlyInLegacy.length || result.onlyInBaseline.length || result.changed.length) {
      equivalent = false
    }
  }

  return { equivalent, classes }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run __tests__/lib/schema-diff.test.ts`
Expected: PASS, 9/9.

- [ ] **Step 5: Full check and commit**

Run: `npm run lint && npm run typecheck && npx vitest run __tests__/lib/schema-diff.test.ts`
Expected: all clean.

```bash
git add lib/schema/diff.ts __tests__/lib/schema-diff.test.ts
git commit -m "feat(schema): pure schema differ with unit tests"
```

---

### Task 3: The introspector

**Files:**
- Create: `lib/schema/introspect.ts`

Scope note: every query filters to `table_schema = 'public'` / `nspname = 'public'`. `auth` is
excluded because it is asymmetric by design (the legacy chain needs it, the baseline
deliberately never creates it); `neon_auth` because it is Neon-managed and inherited
identically by both paths.

- [ ] **Step 1: Write the introspector**

```ts
import type { Client } from '@neondatabase/serverless'
import type { SchemaSnapshot } from './types'

/** The role whose grants are load-bearing (migration 037). */
const APP_ROLE = 'aeo_app'

async function rows(client: Client, sql: string, params: unknown[] = []) {
  const result = await client.query(sql, params)
  return result.rows as Record<string, string>[]
}

function index<T extends Record<string, string>>(
  list: T[],
  key: (row: T) => string,
  value: (row: T) => string,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const row of list) out[key(row)] = value(row)
  return out
}

/**
 * Reads one database's application-owned schema into a comparable snapshot.
 *
 * Deliberately thin: no branching logic, no normalization beyond joining fields
 * into a single string. Anything clever belongs in lib/schema/diff.ts, which is
 * unit-tested; this file's correctness is demonstrated by the equivalence
 * runner's diff converging to empty.
 */
export async function introspectSchema(client: Client): Promise<SchemaSnapshot> {
  const columns = index(
    await rows(client, `
      select table_name, column_name, data_type, is_nullable,
             coalesce(column_default, '') as column_default
      from information_schema.columns
      where table_schema = 'public'
    `),
    (r) => `${r.table_name}.${r.column_name}`,
    (r) => `${r.data_type}|${r.is_nullable}|${r.column_default}`,
  )

  const constraints = index(
    await rows(client, `
      select rel.relname as table_name, con.conname as constraint_name,
             pg_get_constraintdef(con.oid) as definition
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
      where nsp.nspname = 'public'
    `),
    (r) => `${r.table_name}.${r.constraint_name}`,
    (r) => r.definition,
  )

  const indexes = index(
    await rows(client, `
      select tablename, indexname, indexdef from pg_indexes where schemaname = 'public'
    `),
    (r) => `${r.tablename}.${r.indexname}`,
    (r) => r.indexdef,
  )

  // Presence AND the function each trigger calls: a pg_proc-only check would
  // report success while a trigger silently stopped being attached.
  const triggers = index(
    await rows(client, `
      select rel.relname as table_name, tg.tgname as trigger_name,
             proc.proname as function_name, tg.tgtype::text as tgtype
      from pg_trigger tg
      join pg_class rel on rel.oid = tg.tgrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
      join pg_proc proc on proc.oid = tg.tgfoid
      where nsp.nspname = 'public' and not tg.tgisinternal
    `),
    (r) => `${r.table_name}.${r.trigger_name}`,
    (r) => `${r.function_name}|${r.tgtype}`,
  )

  const functions = index(
    await rows(client, `
      select proc.proname,
             pg_get_function_identity_arguments(proc.oid) as args,
             pg_get_function_result(proc.oid) as returns,
             proc.provolatile::text as volatility,
             proc.prosecdef::text as security_definer
      from pg_proc proc
      join pg_namespace nsp on nsp.oid = proc.pronamespace
      where nsp.nspname = 'public'
    `),
    (r) => `${r.proname}(${r.args})`,
    (r) => `${r.returns}|${r.volatility}|${r.security_definer}`,
  )

  const grantRows = await rows(client, `
    select table_name, privilege_type
    from information_schema.role_table_grants
    where table_schema = 'public' and grantee = $1
    order by table_name, privilege_type
  `, [APP_ROLE])
  const grants: Record<string, string> = {}
  for (const row of grantRows) {
    grants[row.table_name] = grants[row.table_name]
      ? `${grants[row.table_name]},${row.privilege_type}`
      : row.privilege_type
  }

  const rls = index(
    await rows(client, `
      select t.tablename,
             t.rowsecurity::text as rowsecurity,
             (select count(*) from pg_policies p
               where p.schemaname = 'public' and p.tablename = t.tablename)::text as policies
      from pg_tables t
      where t.schemaname = 'public'
    `),
    (r) => r.tablename,
    (r) => `rowsecurity=${r.rowsecurity}|policies=${r.policies}`,
  )

  const extensions = index(
    await rows(client, `
      select ext.extname, nsp.nspname
      from pg_extension ext
      join pg_namespace nsp on nsp.oid = ext.extnamespace
    `),
    (r) => r.extname,
    (r) => r.nspname,
  )

  return { columns, constraints, indexes, triggers, functions, grants, rls, extensions }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run lint && npm run typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add lib/schema/introspect.ts
git commit -m "feat(schema): catalog introspector for public schema"
```

---

### Task 4: The equivalence runner

**Files:**
- Create: `scripts/schema-equivalence.mjs`
- Modify: `package.json` (add script entry)

This is the tool the baseline is authored against; it must work before Task 5 begins.

Two hard constraints it exists to satisfy, both from `__tests__/integration/setup.ts`:
- Everything runs in **one process**, because `assertDisposableTestBranch()` validates against
  a module-private registry that only the creating process populates.
- It reproduces the same three-proof guard before any `drop schema public cascade`: the
  argument is a `TestBranch` (never a raw connection string), the registry check, and the
  in-band `neon.project_id` / `neon.branch_id` GUC identity check, which reads null and
  therefore fails closed when the GUCs are absent.

- [ ] **Step 1: Write the runner**

```js
/**
 * Proves the greenfield baseline is equivalent to replaying migrations 001-037.
 *
 *   npm run schema:equivalence
 *
 * Provisions ONE disposable Neon branch on the EXISTING project (the same thing
 * `npm run test:integration` does — no new project, nothing persistent, 2h TTL),
 * builds both schema paths on it, and diffs the application-owned result.
 *
 * Exit 0 = equivalent. Exit 1 = divergent, with a per-class report. While
 * authoring slices 1-5 a non-empty diff is the expected, useful signal.
 */
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Client, neonConfig } from '@neondatabase/serverless'

import {
  assertDisposableTestBranch,
  createTestBranch,
  createdBranchIds,
  deleteTestBranch,
  PROJECT_ID,
} from '../__tests__/helpers/neon-branch.ts'
import { introspectSchema } from '../lib/schema/introspect.ts'
import { diffSchemas } from '../lib/schema/diff.ts'
import { redactSecrets } from '../lib/security/redact-secrets.ts'

const BASELINE_FILE = join(process.cwd(), 'supabase', 'baseline', '000_baseline_2026-08-31.sql')

/**
 * Opens a session on a branch this process created, after the same three
 * independent proofs the integration harness requires.
 */
async function withBranchClient(branch, fn) {
  assertDisposableTestBranch(branch)
  neonConfig.webSocketConstructor = globalThis.WebSocket
  const client = new Client({ connectionString: branch.connectionUri })
  // Branch deletion terminates sessions with FATAL 57P01; without a listener the
  // driver rethrows and dumps the client — password included — to the log.
  client.on('error', () => {})
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

async function resetPublicSchema(branch) {
  await withBranchClient(branch, async (client) => {
    const { rows } = await client.query(
      "select current_setting('neon.project_id', true) as project_id, " +
      "current_setting('neon.branch_id', true) as branch_id",
    )
    const onProject = rows[0]?.project_id ?? 'unknown'
    const onBranch = rows[0]?.branch_id ?? 'unknown'
    if (onProject !== PROJECT_ID || onBranch !== branch.id) {
      throw new Error(
        `Refusing to drop schema public: connection reports branch ${onBranch} in project ` +
        `${onProject}, but this process created ${branch.id} in ${PROJECT_ID}.`,
      )
    }
    await client.query('drop schema public cascade; create schema public;')
  })
}

function reportClass(name, classDiff) {
  const { onlyInLegacy, onlyInBaseline, changed } = classDiff
  if (!onlyInLegacy.length && !onlyInBaseline.length && !changed.length) {
    console.log(`  ${name.padEnd(12)} ok`)
    return
  }
  console.log(`  ${name.padEnd(12)} ${onlyInLegacy.length} missing, ` +
    `${onlyInBaseline.length} extra, ${changed.length} changed`)
  for (const key of onlyInLegacy) console.log(`    - missing from baseline: ${key}`)
  for (const key of onlyInBaseline) console.log(`    + only in baseline:     ${key}`)
  for (const { key, legacy, baseline } of changed) {
    console.log(`    ~ ${key}\n        legacy:   ${legacy}\n        baseline: ${baseline}`)
  }
}

async function main() {
  const name = `equiv-${process.pid}-${Date.now()}-${randomUUID().slice(0, 8)}`
  try {
    const branch = createTestBranch(name)
    console.log(`Provisioned ${branch.id} (${name}) in project ${PROJECT_ID}`)

    // Path A — legacy-to-head, exactly what the integration harness builds.
    await resetPublicSchema(branch)
    execFileSync('node', ['scripts/migrate.ts'], {
      env: { ...process.env, MIGRATE_DATABASE_URL: branch.connectionUri },
      stdio: 'inherit',
    })
    const legacy = await withBranchClient(branch, introspectSchema)

    // Path B — baseline-to-head.
    await resetPublicSchema(branch)
    const rawBaseline = readFileSync(BASELINE_FILE, 'utf8')
    const checksum = createHash('sha256').update(rawBaseline).digest('hex')
    const baselineSql = rawBaseline.replaceAll(":'baseline_checksum'", `'${checksum}'`)
    await withBranchClient(branch, (client) => client.query(baselineSql))
    const baseline = await withBranchClient(branch, introspectSchema)

    const diff = diffSchemas(legacy, baseline)
    console.log('\nSchema equivalence (legacy 001-037 vs baseline):')
    for (const [className, classDiff] of Object.entries(diff.classes)) {
      reportClass(className, classDiff)
    }

    console.log(diff.equivalent ? '\nEQUIVALENT' : '\nDIVERGENT')
    process.exitCode = diff.equivalent ? 0 : 1
  } finally {
    for (const id of createdBranchIds()) {
      try {
        deleteTestBranch(id)
        console.log(`Deleted ${id}`)
      } catch {
        console.error(
          `Failed to delete ${id} — orphaned.\n` +
          `Clean up: neonctl branches delete ${id} --project-id ${PROJECT_ID}`,
        )
      }
    }
  }
}

main().catch((error) => {
  // The Neon driver echoes full connection urls, password included, in its error
  // messages — never print one raw.
  console.error(redactSecrets(error instanceof Error ? error.message : String(error)))
  process.exitCode = 1
})
```

- [ ] **Step 2: Add the npm script**

In `package.json`'s `scripts`, directly after the `"migrate"` entry:

```diff
     "migrate": "node --env-file=.env.local scripts/migrate.ts",
+    "schema:equivalence": "node --env-file=.env.local scripts/schema-equivalence.mjs",
```

- [ ] **Step 3: Verify the machinery works before any baseline exists**

Run: `npm run schema:equivalence`
Expected: it provisions a branch, applies `001`–`037`, then fails reading
`supabase/baseline/000_baseline_2026-08-31.sql` (`ENOENT`) — and **still deletes the branch**
in `finally`. That single run proves the guard path, the migrate path, and cleanup all work
before a baseline exists. Confirm the deletion line appears in the output.

Requires `neonctl` authenticated (`npm i -g neonctl && neonctl auth`, or `NEON_API_KEY` set).
If unavailable, report **not run** — do not claim a pass.

- [ ] **Step 4: Commit**

```bash
git add scripts/schema-equivalence.mjs package.json
git commit -m "feat(schema): equivalence runner comparing legacy chain to baseline"
```

---

### Tasks 5–10: Author the baseline, one slice per task

**Files (all six tasks):**
- Create/Modify: `supabase/baseline/000_baseline_2026-08-31.sql`

**Why the SQL is not pre-written here.** It is derived by reading 2,778 lines across 35
migrations and consolidating each table's *final* state after every later `ALTER`. Inlining
that would make this plan a worse copy of the migrations themselves. What is fixed precisely
instead: the procedure, the exact table list per slice, and the verification — **the differ is
the specification of correctness**, and it is exact.

**Procedure — identical for every slice N:**

1. **Read every migration touching this slice's tables.** For each table:
   `grep -ln "<table_name>" supabase/migrations/*.sql`, then read those files in filename
   order. A table's final shape is its `CREATE TABLE` plus every later
   `ALTER TABLE ... ADD COLUMN` / `ALTER COLUMN` / `ADD CONSTRAINT`.
2. **Append consolidated DDL** to the baseline in the slice's own dependency order (parents
   before children). Carry over the explanatory comments from the source migrations rather
   than emitting bare DDL — the baseline must be *reviewable*, per ADR-007.
3. **Exclude**, per ADR-007 and plan §15.2: anything in the `auth` schema, the 30 policies
   migration `036` already dropped, and anything in `neon_auth` (Neon provisions it).
4. **Run the differ:** `npm run schema:equivalence`
5. **Read the report.** Expect `columns`/`constraints`/`indexes` still to list objects
   `missing from baseline` for *later* slices' tables — that is correct progress. Expect
   **zero** `only in baseline` entries; anything there means this slice invented something the
   migration chain never created. Fix before moving on.
6. **Commit the slice.**

- [ ] **Task 5 — Slice 1: core tenancy.** Tables: `accounts`, `profiles`, `clients`.
  First because nearly everything FKs into them. `profiles.id` FKs `neon_auth.user`
  (migration `022`) — the baseline *references* that schema but must never create it.
  Commit: `feat(baseline): slice 1 — accounts, profiles, clients`

- [ ] **Task 6 — Slice 2: scan engine.** Tables: `scans`, `fix_packs`, `chunk_analysis`.
  Commit: `feat(baseline): slice 2 — scans, fix packs, chunk analysis`

- [ ] **Task 7 — Slice 3: monitoring.** Tables: `prompt_bank`, `pulse_metrics`,
  `pulse_weekly_summary` (singular), `alert_configs`, `notifications`,
  `alert_email_deliveries`. Migration `031` adds the `(client_id, scan_week, platform)`
  arbiter the weekly rollup's `on conflict` depends on; `033` adds the
  `(client_id, type, scan_week)` unique index that dedupes notifications.
  Commit: `feat(baseline): slice 3 — pulse, prompts, alerts, notifications`

- [ ] **Task 8 — Slice 4: features.** Tables: `client_reports`, `client_report_versions`,
  `account_report_branding`, `local_trust_profiles`, `local_trust_snapshots`,
  `local_trust_actions`, `authority_scores`, `authority_overrides`, `domain_signals`,
  `agent_recommendations`, `agent_progress`, `agent_competitors`.
  Commit: `feat(baseline): slice 4 — reports, local trust, authority, agents`

- [ ] **Task 9 — Slice 5: infra and packs.** Tables: `public_scan_rate_limits`,
  `authenticated_scan_monthly_usage`, `stripe_webhook_events`,
  `stripe_subscription_processing_leases`, `industry_packs`, `regional_packs`,
  `topical_clusters`, `content_briefs`, `ai_citation_log`.
  Do **not** create `plan_features` — migration `028` drops it on purpose, which is why
  `--verify` reports it MISSING for `014` by design.
  Commit: `feat(baseline): slice 5 — rate limits, quotas, stripe ledgers, packs`

- [ ] **Task 10 — Slice 6: the `037` layer.** Functions (16), triggers (4), the `pgcrypto`
  extension in `public` (from `027`), then roles and grants last: `aeo_app`'s exact grant set,
  its `BYPASSRLS` flag with `037`'s own fail-closed re-assertion, and the seven
  RLS-enabled/zero-policy tables' posture — each per its *creating* migration:
  `public_scan_rate_limits` (`023`); `stripe_subscription_processing_leases` and
  `stripe_webhook_events` (`024`); `authenticated_scan_monthly_usage` (`025`);
  `account_report_branding`, `client_reports`, `client_report_versions` (`027`).
  Include `clients`'s `enforce_brand_limit` trigger — it lives in `pg_trigger`, a different
  catalog from `check_brand_limit()`, and is exactly the object a function-only check misses.
  **After this slice the differ must report `EQUIVALENT`, exit 0.** If it does not, the
  baseline is not done — do not proceed to Task 11.
  Commit: `feat(baseline): slice 6 — functions, triggers, roles, grants, RLS posture`

---

### Task 11: Ledger and checksum (item 1.5)

**Files:**
- Modify: `supabase/baseline/000_baseline_2026-08-31.sql`
- Create: `__tests__/db/baseline-ledger.test.ts`

**The finding that makes this a real task:** `scripts/migrate.ts:229` creates
`schema_migrations (filename text primary key, applied_at timestamptz not null default now())`
— there is **no checksum column**. Item 1.5's "immutable baseline checksum" therefore requires
adding one, not merely inserting a row.

- [ ] **Step 1: Write the failing test**

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const BASELINE = readFileSync(
  join(process.cwd(), 'supabase', 'baseline', '000_baseline_2026-08-31.sql'),
  'utf8',
)

describe('baseline ledger', () => {
  it('creates the schema_migrations ledger with a checksum column', () => {
    expect(BASELINE).toMatch(/create table if not exists schema_migrations/i)
    expect(BASELINE).toMatch(/checksum\s+text/i)
  })

  it('seeds exactly one ledger row naming itself', () => {
    const inserts = BASELINE.match(/insert into schema_migrations/gi) ?? []
    expect(inserts).toHaveLength(1)
    expect(BASELINE).toContain('000_baseline_2026-08-31.sql')
  })

  it('keeps the column shape migrate.ts already relies on', () => {
    expect(BASELINE).toMatch(/filename\s+text\s+primary key/i)
    expect(BASELINE).toMatch(/applied_at\s+timestamptz/i)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run __tests__/db/baseline-ledger.test.ts`
Expected: FAIL — the baseline has no ledger section yet.

- [ ] **Step 3: Append the ledger section to the end of the baseline**

```sql
-- ─── Migration ledger ────────────────────────────────────────────────────────
-- A greenfield database's lineage starts here: one row naming this file, so
-- scripts/migrate.ts's assertBaselined() guard sees a populated ledger and
-- future migrations continue from 038 rather than replaying 001-037.
--
-- `checksum` does not exist in migrate.ts's own `create table if not exists`
-- (scripts/migrate.ts:229 defines filename + applied_at only). It is added here
-- so the baseline is tamper-evident: the digest recorded is of this file's
-- contents at the moment it was applied. The runner substitutes the value.
create table if not exists schema_migrations (
  filename   text primary key,
  applied_at timestamptz not null default now(),
  checksum   text
);

insert into schema_migrations (filename, checksum)
values ('000_baseline_2026-08-31.sql', :'baseline_checksum')
on conflict (filename) do nothing;
```

The `:'baseline_checksum'` placeholder is substituted by the runner, which Task 4 already
wired: it hashes the file's pre-substitution contents with SHA-256 and replaces the token.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run __tests__/db/baseline-ledger.test.ts`
Expected: PASS, 3/3.

- [ ] **Step 5: Re-prove equivalence with the ledger present**

Run: `npm run schema:equivalence`
Expected: still `EQUIVALENT`, exit 0. `schema_migrations` exists in **both** paths — the
legacy path's copy is created by `migrate.ts` itself — so it must not introduce a diff. If it
does, the two definitions have drifted, and the baseline's must match `migrate.ts:229` exactly
plus the added `checksum` column.

- [ ] **Step 6: Full check and commit**

Run: `npm run lint && npm run typecheck && npm test`
Expected: lint clean, typecheck clean, unit suite green (integration skips without `neonctl`).

```bash
git add supabase/baseline/000_baseline_2026-08-31.sql scripts/schema-equivalence.mjs __tests__/db/baseline-ledger.test.ts
git commit -m "feat(baseline): migration ledger with immutable checksum (item 1.5)"
```

---

## Final verification

- [ ] **Step 1: Equivalence proven**

Run: `npm run schema:equivalence`
Expected: `EQUIVALENT`, exit 0, all eight classes `ok`, disposable branch deleted.
Label the result honestly — if `neonctl` was unavailable this is **not run**, not a pass.

- [ ] **Step 2: Local gate**

Run: `npm run lint && npm run typecheck && npm test`
Expected: all green.

- [ ] **Step 3: Diff scope**

Run: `git diff main...HEAD --stat`
Expected: only `lib/schema/*`, `scripts/schema-equivalence.mjs`, `supabase/baseline/*`,
`__tests__/lib/schema-diff.test.ts`, `__tests__/db/baseline-ledger.test.ts`, `package.json`,
and this plan's docs. **No change to `supabase/migrations/001`–`037`** — that chain stays
intact as the old project's lineage per ADR-007.
