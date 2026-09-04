# Phase 1 completion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish Phase 1 — items 1.2, 1.6, 1.8 and 1.10 — so AISO has a recorded topology, a runtime
binding guard, proven role grants, and preview-branch lifecycle management.

**Architecture:** Four sequenced slices. The riskiest — a `Proxy` around `lib/db.ts`, which 43
modules import — lands alone so a revert stays clean.

**Tech Stack:** TypeScript 5.9, Next.js 16, `@neondatabase/serverless`, Vitest 4, `neonctl`.

**Spec:** `docs/superpowers/specs/2026-09-05-phase1-completion-design.md`

**Branch:** `claude/phase1-completion` (exists; holds the spec at `fe513b5`).

---

## Background the implementer needs

### The motivating incident

On 2026-09-05, `.env.local`'s `DATABASE_URL` was found pointing at AISO as **`neondb_owner`** — the
owner role, carrying DDL rights the application is designed not to have — with a password rotated
out from under it, and it had been that way since 2026-09-02. **Nothing caught it**: not a test, not
the app, not CI. It surfaced only because someone ran `scripts/verify-db-connection.mjs` by hand.

Task 2 exists to make that impossible.

### Two discoveries made while planning — read before designing anything

**1. The Neon GUCs exist, and this repo already relies on them.**
`__tests__/integration/setup.ts` reads `current_setting('neon.branch_id', true)` and the project-id
equivalent; its `resetPublicSchema` refuses to drop schema `public` unless both match the branch the
harness created. **That is the precedent to mirror in Task 2.** Do not invent a second identity
check, and do not build a fallback tuple — the condition it would guard against does not occur.

**2. The integration harness defaults to the production Neon project.**
`__tests__/helpers/neon-branch.ts:20` defaults `PROJECT_ID` to `red-firefly-93523049`, and line 27
defaults `PRODUCTION_BRANCH_ID` to `br-rough-butterfly-aojtgi92`. A Neon branch is a copy-on-write
snapshot of its parent, so absent an override the harness cuts disposable test branches from the
branch holding real customer data — then runs `drop schema public cascade` on the copy. §16.1:
*"Never create a preview or test branch from a branch that has held customer data."* Task 1 fixes it.

### Key identifiers

| | |
|---|---|
| AISO project | `weathered-wave-50814522` |
| AISO production branch | `br-square-mountain-az6f82vi` |
| AISO endpoint | `ep-mute-firefly-azxacr80` (`-pooler` for the app, direct for migrations) |
| Legacy project — blocklist it | `red-firefly-93523049` |
| Legacy branch — blocklist it | `br-rough-butterfly-aojtgi92` |
| `neonctl` org | `org-soft-sunset-25251479` |

### Hard constraints

- **`git add -A` is forbidden.** Name every file explicitly.
- **Never read, print, copy, rotate or test a live credential.** No secret in source, a diff, a log,
  a fixture, a screenshot, or your own output. The Neon driver echoes full connection URLs including
  the password in its error messages — filter through `redactSecrets` from
  `lib/security/redact-secrets.ts`.
- **Never copy production data.** No users, tenants, scans, billing state, reports or prompts.
- **Never create a branch from a branch that has held customer data.**
- **Never enable RLS or add a policy.**
- **Do not repoint Vercel production at AISO.** ADR-11; approval gates 11 and 12.

---

## File structure

| File | Responsibility | Action |
|---|---|---|
| `docs/topology-aiso.md` | Topology decision, expiry trigger, Vercel checklist | Create |
| `.env.example` | Document the guard's variables | Modify |
| `__tests__/helpers/neon-branch.ts` | Default test branching to AISO, not production | Modify |
| `__tests__/helpers/neon-branch-defaults.test.ts` | Pin those defaults | Create |
| `lib/security/db-binding.ts` | Pure comparison logic | Create |
| `lib/db.ts` | Proxy awaiting the guard before the first query | Modify |
| `__tests__/security/db-binding.test.ts` | Every mismatch case, no database | Create |
| `__tests__/integration/db-binding.test.ts` | Accepts AISO, rejects a forged expectation | Create |
| `__tests__/integration/aiso-least-privilege.test.ts` | Grants and denials against AISO | Create |
| `scripts/neon/prune-preview-branches.mjs` | TTL sweep with an allow-list | Create |
| `__tests__/scripts/prune-preview-branches.test.ts` | TTL arithmetic, never-delete-production | Create |

---

### Task 1 — Slice A: topology, and stop branching from production

**Files:**
- Create: `docs/topology-aiso.md`
- Modify: `.env.example`
- Modify: `__tests__/helpers/neon-branch.ts`
- Create: `__tests__/helpers/neon-branch-defaults.test.ts`

- [ ] **Step 1: Read before editing**

Read `__tests__/helpers/neon-branch.ts` in full, and `__tests__/integration/setup.ts`. Report in your
own words how `PROJECT_ID`, `PRODUCTION_BRANCH_ID`, `BRANCH_TTL_MS` and `assertDisposableTestBranch`
interact, and what `expiresAt` does on creation.

You are about to change defaults that decide which database a `drop schema public cascade` runs
against. Do not edit before you can explain it.

- [ ] **Step 2: Write the failing test**

Create `__tests__/helpers/neon-branch-defaults.test.ts`:

```ts
import { PROJECT_ID, PRODUCTION_BRANCH_ID } from '@/__tests__/helpers/neon-branch'

it('defaults test branching to the AISO project', () => {
  expect(PROJECT_ID).toBe('weathered-wave-50814522')
  expect(PRODUCTION_BRANCH_ID).toBe('br-square-mountain-az6f82vi')
})

it('never defaults to a project or branch that has held customer data', () => {
  expect(PROJECT_ID).not.toBe('red-firefly-93523049')
  expect(PRODUCTION_BRANCH_ID).not.toBe('br-rough-butterfly-aojtgi92')
})
```

The second test is the one that matters: it states the rule rather than the value, so it keeps
meaning if the ids ever change.

Run it. Expected: **FAIL** on both, reporting the legacy ids.

- [ ] **Step 3: Change the defaults**

In `__tests__/helpers/neon-branch.ts`, change the fallback on line 20 to `weathered-wave-50814522`
and line 27 to `br-square-mountain-az6f82vi`. Leave the `NEON_TEST_PROJECT_ID` /
`NEON_TEST_PRODUCTION_BRANCH_ID` overrides exactly as they are — CI may set them explicitly, and
removing an override is a separate, unrelated change.

Add a comment saying why the default must never be a project holding customer data, citing §16.1.

Run the test. Expected: **PASS**.

- [ ] **Step 4: Check CI does not still point at the legacy project**

```bash
grep -rn "NEON_TEST_PROJECT_ID\|NEON_TEST_PRODUCTION_BRANCH_ID\|red-firefly" .github/ scripts/ 2>/dev/null
```

Report every hit. **If CI sets these to the legacy project, changing the default achieves nothing** —
say so plainly rather than reporting the task done.

- [ ] **Step 5: Write `docs/topology-aiso.md`**

A reader must be able to act on it without this plan. It records:

- **The decision** — AISO stays a single project; preview branches are cut from
  `br-square-mountain-az6f82vi`.
- **The justification** — that branch has held only the synthetic seed (1 account, 2 clients, 1
  scan), so §16.1's customer-data hazard does not currently exist.
- **The expiry trigger, as a rule** — the first real customer write on AISO means previews must stop
  being cut from the production branch, moving to §16.1's two-project shape with a sterile
  schema-only parent. This is not a caveat; it is the condition under which the decision stops being
  correct.
- **Vercel** — Preview and Development bind to AISO; **Production stays on `red-firefly-93523049`**
  per ADR-11's dark launch, gated on approvals 11 and 12, and must not move as a side effect of this
  phase.
- **A checklist for the human** performing the Vercel binding, noting `NEON_AUTH_COOKIE_SECRET`
  (≥32 chars) is required at **build** time in every environment including Preview — without it a
  preview deploy fails with `Failed to collect page data for /api/auth/[...path]`.

- [ ] **Step 6: Document the guard's variables in `.env.example`**

Match the file's existing style — each variable with what breaks without it.

```
EXPECTED_NEON_PROJECT_ID=       # REQUIRED. The binding guard throws if unset, so the app
                                # will not start. Deliberate: an app that cannot prove
                                # which database it is talking to should not serve.
EXPECTED_NEON_BRANCH_ID=        # Optional; checked only when set. Leave unset for
                                # integration runs, whose branch id differs every run.
EXPECTED_DB_ROLE=               # Optional; checked when set. Should be aeo_app.
EXPECTED_DB_NAME=               # Optional; checked when set. Should be neondb.
FORBIDDEN_NEON_PROJECT_IDS=     # Comma-separated. Always enforced when non-empty.
FORBIDDEN_NEON_BRANCH_IDS=      # Comma-separated. Always enforced when non-empty.
FORBIDDEN_DB_HOSTS=             # Comma-separated. Always enforced when non-empty.
```

- [ ] **Step 7: Static checks**

```bash
npm run lint
```
```bash
npm run typecheck
```
```bash
npm run test:unit
```

All exit 0.

- [ ] **Step 8: Commit**

```bash
git add docs/topology-aiso.md .env.example __tests__/helpers/neon-branch.ts __tests__/helpers/neon-branch-defaults.test.ts && git commit -F- <<'EOF'
fix(test): stop defaulting integration branches to the production project

neon-branch.ts defaulted PROJECT_ID to red-firefly-93523049 and
PRODUCTION_BRANCH_ID to that project's default branch. A Neon branch is a
copy-on-write snapshot of its parent, so with no override the harness cut
disposable test branches from the branch holding real customer data -- and then
ran `drop schema public cascade` against the copy.

Section 16.1 is explicit: never create a preview or test branch from a branch
that has held customer data. The defaults now point at AISO, whose production
branch has held only the synthetic seed.

The test states the rule as well as the values, so it keeps meaning if the ids
change.

Also records the topology decision with its expiry trigger: the first real
customer write on AISO moves previews off its production branch. A topology
choice without its expiry condition is how a temporary simplification becomes a
permanent hazard.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 2 — Slice B: the runtime binding guard

**Files:**
- Create: `lib/security/db-binding.ts`
- Create: `__tests__/security/db-binding.test.ts`
- Modify: `lib/db.ts`
- Create: `__tests__/integration/db-binding.test.ts`

- [ ] **Step 1: Read the precedent**

Read `__tests__/integration/setup.ts` lines 40–95. It already performs this identity check. Mirror
its shape. Report what it does before writing code.

- [ ] **Step 2: Write the failing unit tests**

Create `__tests__/security/db-binding.test.ts`. The module is **pure** — observed tuple plus
expectation in, verdict out — so none of these need a database.

```ts
import { checkBinding } from '@/lib/security/db-binding'

const observed = {
  projectId: 'weathered-wave-50814522',
  branchId: 'br-square-mountain-az6f82vi',
  role: 'aeo_app',
  database: 'neondb',
  host: 'ep-mute-firefly-azxacr80-pooler.c-3.ap-southeast-1.aws.neon.tech',
}

it('accepts a matching binding', () => {
  expect(checkBinding(observed, { projectId: observed.projectId }).ok).toBe(true)
})

it('rejects a wrong project id, naming both values', () => {
  const v = checkBinding(observed, { projectId: 'some-other-project' })
  expect(v.ok).toBe(false)
  expect(v.reason).toMatch(/project/i)
  expect(v.reason).toContain('some-other-project')
  expect(v.reason).toContain('weathered-wave-50814522')
})

it('throws when the mandatory project expectation is absent', () => {
  expect(() => checkBinding(observed, {})).toThrow(/EXPECTED_NEON_PROJECT_ID/)
})

it('ignores branch, role and database when their expectations are unset', () => {
  expect(checkBinding(observed, { projectId: observed.projectId }).ok).toBe(true)
})

it('rejects a wrong branch id when that expectation is set', () => {
  expect(checkBinding(observed, { projectId: observed.projectId, branchId: 'br-wrong' }).ok).toBe(false)
})

it('rejects a wrong role when that expectation is set', () => {
  expect(checkBinding(observed, { projectId: observed.projectId, role: 'neondb_owner' }).ok).toBe(false)
})

it('rejects a wrong database when that expectation is set', () => {
  expect(checkBinding(observed, { projectId: observed.projectId, database: 'other' }).ok).toBe(false)
})

it('rejects a blocklisted project even when the allow-list matches', () => {
  const v = checkBinding(observed, {
    projectId: observed.projectId,
    forbiddenProjectIds: [observed.projectId],
  })
  expect(v.ok).toBe(false)
  expect(v.reason).toMatch(/forbidden/i)
})

it('rejects a blocklisted branch id', () => {
  const v = checkBinding(observed, {
    projectId: observed.projectId,
    forbiddenBranchIds: [observed.branchId],
  })
  expect(v.ok).toBe(false)
})

it('rejects a blocklisted host', () => {
  const v = checkBinding(observed, {
    projectId: observed.projectId,
    forbiddenHosts: [observed.host],
  })
  expect(v.ok).toBe(false)
})

it('never includes a password or DSN in the reason', () => {
  const v = checkBinding(
    { ...observed, host: 'postgresql://aeo_app:hunter2@host/db' },
    { projectId: 'other' },
  )
  expect(v.reason).not.toContain('hunter2')
  expect(v.reason).not.toContain('postgresql://')
})
```

Run: **FAIL**, module not found.

- [ ] **Step 3: Implement `lib/security/db-binding.ts`**

Export `checkBinding(observed, expected)` returning `{ ok: true }` or `{ ok: false, reason: string }`.

Rules, all load-bearing:

- **`expected.projectId` absent → throw**, naming `EXPECTED_NEON_PROJECT_ID`. Not a soft failure: an
  app that cannot prove which database it is on should not serve.
- Branch, role and database compared **only when their expectation is set**.
- **Blocklists always win.** A connection matching both the allow-list and a blocklist is a
  configuration error, and the safe reading is the forbidding one.
- The reason names the field with expected and actual values. Project ids, branch ids, role and
  database names are **not** secrets and belong in it — a reason of "binding mismatch" wastes the
  reader's time.
- **Every reason passes through `redactSecrets`** from `lib/security/redact-secrets.ts` before being
  returned. That is what the last test pins.

Also export `readExpectationFromEnv()`, parsing the seven variables and splitting the `FORBIDDEN_*`
lists on commas with trimming.

Run: **PASS**.

- [ ] **Step 4: Wire the Proxy into `lib/db.ts`**

The file today is 12 lines; `db()` is **synchronous** with 43 importers, and that must not change:

```ts
let _sql: NeonQueryFunction<false, false> | null = null

export function db(): NeonQueryFunction<false, false> {
  if (!_sql) {
    _sql = neon(process.env.DATABASE_URL!)
  }
  return _sql
}
```

Add a memoized guard promise that runs once and observes the tuple:

```sql
select current_setting('neon.project_id', true) as project_id,
       current_setting('neon.branch_id', true)  as branch_id,
       current_user                             as role,
       current_database()                       as database
```

Wrap the returned function in a `Proxy` so the **first query awaits the guard** before delegating.

Three things the wrapper must get right:

- **Preserve the tagged-template call signature.** Callers write `` sql`select ...` ``, so the
  `apply` trap must forward template strings and values unchanged.
- **Preserve `.transaction()`** and every other property on `NeonQueryFunction`. Use a `get` trap
  that forwards to the underlying function — do not hand-copy a property list.
- **Memoize the guard promise itself**, not its result, so concurrent first queries await one check
  rather than issuing several.

On failure the guard **throws**; do not catch and continue. If the guard's own query rejects, that
also fails closed — a database that cannot answer this cannot serve the request either.

- [ ] **Step 5: Prove the wrapper did not break the driver**

```bash
npm run test:unit
```

Expected: the same counts as before this task — **169 files, 1795 tests** on a clean checkout. If
`.playwright-ci-server/` is present the numbers roughly double and ~17 unrelated tests fail; that
directory is a generated copy of the repo and its failures are not yours. Say so explicitly rather
than reporting a false regression.

```bash
npm run typecheck
```
```bash
npm run build
```

Both exit 0. `typecheck` is what catches a `Proxy` typed wrongly against
`NeonQueryFunction<false, false>`.

- [ ] **Step 6: Set the expectation everywhere it must be set — do this before Step 7**

The guard throws when `EXPECTED_NEON_PROJECT_ID` is unset. That is correct, and it means **turning
it on breaks every environment that does not yet define it.** Enabling a mandatory check without
setting its input is how a good guard gets reverted the next morning.

Three places, and they are not all yours to change:

1. **The integration harness** — set `EXPECTED_NEON_PROJECT_ID` to the AISO project id where the
   harness builds its environment (see how `__tests__/integration/setup.ts` and
   `__tests__/helpers/neon-branch.ts` already pass `TEST_DATABASE_URL`). **Deliberately leave
   `EXPECTED_NEON_BRANCH_ID` unset** — ephemeral branch ids differ per run, and this is exactly the
   case the optional-when-unset rule exists for. Setting it would force an opt-out later.
2. **CI** — check whether `.github/workflows/pr-gate.yml` needs it for any job that reaches a
   database. Report what you find; do not add it speculatively to jobs that never connect.
3. **`.env.local`** — **not yours to edit.** It is the developer's file and sits beside live
   credentials. Note in your report that it needs
   `EXPECTED_NEON_PROJECT_ID=weathered-wave-50814522` before `npm run dev` will start, and that this
   value is a non-secret identifier, so it can be pasted freely.

Run `npm run test:unit` again after this step. Unit tests mock the database and should be
unaffected — if any now fail, the guard is running somewhere it should not be, and that is a finding
worth reporting rather than working around.

- [ ] **Step 7: Integration test**

Create `__tests__/integration/db-binding.test.ts` following the existing integration tests' setup
conventions: against the harness's AISO branch, a correct expectation connects, and a forged
`EXPECTED_NEON_PROJECT_ID` throws with a reason naming the project field.

```bash
REQUIRE_INTEGRATION_TESTS=1 npm run test:integration
```

A skip is not a pass — report which you got.

- [ ] **Step 8: Commit**

```bash
git add lib/security/db-binding.ts lib/db.ts __tests__/security/db-binding.test.ts __tests__/integration/db-binding.test.ts && git commit -F- <<'EOF'
feat(security): fail closed when the database binding is not what we expect

.env.local pointed at AISO as neondb_owner -- the owner role, with DDL rights
the app is designed not to have -- with a rotated password, from 2026-09-02
until 2026-09-05. Nothing caught it: not a test, not the app, not CI. It
surfaced because someone ran the verify script by hand.

A CI test would not have caught it either, because CI verifies CI's own
binding, which was never the wrong one. So the check runs in the query path.
db() stays synchronous and no caller changes; the returned function is proxied
and its first query awaits a memoized guard.

Positive allow-list and negative blocklist both, per section 16.1: a blocklist
alone would accept an unrelated third project, an allow-list alone would miss a
stale binding that happens to match. Blocklists win ties.

EXPECTED_NEON_PROJECT_ID is mandatory and there is no opt-out flag -- an
opt-out is what eventually gets set in production by accident. Branch, role and
database are checked only when their expectation is set, which is what lets
integration runs, whose branch id differs each time, keep the guard armed
rather than switch it off.

Identity comes from the neon.project_id / neon.branch_id GUCs, mirroring
__tests__/integration/setup.ts, which has used them since it was written.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 3 — Slice C: role and grant tests against AISO

**Files:**
- Create: `__tests__/integration/aiso-least-privilege.test.ts`

- [ ] **Step 1: Read the existing test**

Read `__tests__/integration/least-privilege-role.test.ts` in full. Every denial is asserted by its
**specific error message** — `/permission denied for schema public/i`, `/must be owner of table/i`,
`/permission denied to create role/i`, `/permission denied for table/i`. Its header explains why: a
bare "it threw" would also pass if the password were wrong. This month proved that is not
hypothetical.

- [ ] **Step 2: Write the test**

Mirror it against AISO, covering §16.2:

**Allowed** — DML on `public`; sequence usage; `select` on `neon_auth."user"` (required by the Neon
webhook, which ships no payload signing and authenticates against that table, and by alert recipient
lookup); default privileges for future tables.

**Forbidden**, each asserted by its own message — DDL (`create table`, `drop table`, `alter table`);
role creation; writes to `neon_auth`.

Re-assert `BYPASSRLS` with `037`'s fail-closed check:

```ts
it('aeo_app keeps BYPASSRLS', async () => {
  const [row] = await owner`select rolbypassrls from pg_roles where rolname = 'aeo_app'`
  expect(row.rolbypassrls).toBe(true)
})
```

Seven tables have RLS enabled with **zero policies**. A non-bypass role reads zero rows from them
**silently** rather than erroring — the failure mode `036` spent a migration eliminating elsewhere.

- [ ] **Step 3: Run it**

```bash
REQUIRE_INTEGRATION_TESTS=1 npm run test:integration
```

`REQUIRE_INTEGRATION_TESTS=1` makes a missing `neonctl` **fail** rather than skip. A skip is not a
pass — report which one you got.

- [ ] **Step 4: Commit**

```bash
git add __tests__/integration/aiso-least-privilege.test.ts && git commit -F- <<'EOF'
test(db): prove aeo_app's grants and denials on AISO

Mirrors the production least-privilege test. Every denial is asserted by its
specific error message, because a bare "it threw" also passes on a wrong
password -- and a wrong credential on AISO is exactly what went unnoticed for
three days this month.

Re-asserts BYPASSRLS: seven tables have RLS enabled with zero policies, and a
non-bypass role reads zero rows from them silently rather than raising.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 4 — Slice D: preview branch lifecycle

**Files:**
- Create: `scripts/neon/prune-preview-branches.mjs`
- Create: `__tests__/scripts/prune-preview-branches.test.ts`

- [ ] **Step 1: Read what already exists**

`__tests__/helpers/neon-branch.ts` already has `BRANCH_TTL_MS` (2 hours), sets `expiresAt` at
creation, and surfaces orphaned branch ids on delete failure together with the exact `neonctl`
command to remove them.

**This task extends that; it does not replace it.** Report what is already covered before writing
anything, and do not duplicate it.

- [ ] **Step 2: Write the failing tests first**

The two things worth testing need no Neon API call.

```ts
import { selectPrunableBranches } from '@/scripts/neon/prune-preview-branches.mjs'

const NOW = new Date('2026-09-05T12:00:00Z').getTime()
const PRODUCTION = 'br-square-mountain-az6f82vi'
const opts = { now: NOW, productionBranchId: PRODUCTION }

it('never returns the production branch, however old', () => {
  const branches = [{ id: PRODUCTION, name: 'production', created_at: '2020-01-01T00:00:00Z' }]
  expect(selectPrunableBranches(branches, opts)).toEqual([])
})

it('never returns a branch whose name is not a preview', () => {
  const branches = [{ id: 'br-x', name: 'staging', created_at: '2020-01-01T00:00:00Z' }]
  expect(selectPrunableBranches(branches, opts)).toEqual([])
})

it('returns a preview branch past its TTL', () => {
  const branches = [{ id: 'br-old', name: 'preview-123', created_at: '2026-09-05T09:00:00Z' }]
  expect(selectPrunableBranches(branches, opts).map(b => b.id)).toEqual(['br-old'])
})

it('leaves a preview branch inside its TTL', () => {
  const branches = [{ id: 'br-new', name: 'preview-124', created_at: '2026-09-05T11:30:00Z' }]
  expect(selectPrunableBranches(branches, opts)).toEqual([])
})
```

`now` is injected rather than read from the clock, so the test is deterministic.

Run: **FAIL**, module not found.

- [ ] **Step 3: Implement**

`selectPrunableBranches(branches, { now, productionBranchId, ttlMs })` must be **pure** and exported
separately from anything that calls Neon, so these tests never touch the network.

**Selection is an allow-list, not a blocklist.** A branch is prunable only if its name matches the
preview prefix **and** it is past TTL **and** its id is not the production branch. Written the other
way round — "delete anything that is not production" — a naming change silently makes everything
eligible.

A cleanup job that can delete the production branch is worse than no cleanup job. That is why the
production check is a distinct condition with its own test rather than being implied by the prefix.

`main()` must print each branch id **before** deleting it, so an interrupted run still leaves a
usable record.

- [ ] **Step 4: Dry run**

Give the script a `--dry-run` flag and run it that way first. Report exactly what it would delete.
**Do not run a destructive pass until the dry run's output has been read.**

- [ ] **Step 5: Static checks and commit**

```bash
npm run lint
```
```bash
npm run typecheck
```
```bash
npm run test:unit
```

All exit 0.

```bash
git add scripts/neon/prune-preview-branches.mjs __tests__/scripts/prune-preview-branches.test.ts && git commit -F- <<'EOF'
feat(neon): prune preview branches past their TTL

Extends what neon-branch.ts already does -- a 2h TTL, Neon-native expiresAt,
and orphan ids surfaced on delete failure -- with a sweep for the branches
those mechanisms miss.

Selection is an allow-list: the name matches the preview prefix, it is past
TTL, and its id is not the production branch. Written as a blocklist instead, a
naming change would silently make everything eligible. The production check is
a separate condition with its own test rather than implied by the prefix,
because it is the one bug in this script that cannot be undone.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Finishing

- [ ] `npm run lint` · `npm run typecheck` · `npm run build` · `REQUIRE_INTEGRATION_TESTS=1 npm test`
- [ ] Push and open a PR covering all four slices, leading with the two planning discoveries — the
      harness branching from production, and the GUC precedent already in the repo.
- [ ] **Verify CI against the pushed HEAD**: compare `gh run list --json headSha` with
      `git rev-parse HEAD`. A green run on a different SHA is not evidence.
