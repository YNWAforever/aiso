# Close the greenfield bootstrap gap — design

**Status:** Approved 2026-09-01
**Phase:** 1 (Sub-project A follow-up). Unblocks item 1.11, the Phase 1 gate.
**Scope:** Build and deploy tooling only. No runtime code path changes, no new Neon resources.

## The defect

`supabase/baseline/000_baseline_2026-08-31.sql` is provably equivalent to replaying
`001`–`038` — `npm run schema:equivalence` reports EQUIVALENT, exit 0, all 8 classes ok.
It is nevertheless unusable for the one job it exists to do.

`planMigrations` (`scripts/migrate.ts:46`) filters `listMigrationFiles()`, which reads
`supabase/migrations/`, against the `schema_migrations` ledger. The baseline lives in
`supabase/baseline/` and records exactly one ledger row naming itself, so:

- its own row is never in the file list, and
- all 36 chain files are in the file list and absent from the ledger.

On a fresh project bootstrapped from the baseline, `assertBaselined` passes (the ledger is
non-empty), `planMigrations` returns all 36, and `001` aborts on an already-existing table.

**A greenfield database therefore cannot be brought to head.** That is the blocker for item
1.11 (fresh-project bootstrap rehearsal), which the base plan marks as the Phase 1 gate.

### What is NOT established

Nothing here touches a live database. The greenfield project does not exist; items
1.1/1.2/1.10/1.11 still require real Neon resources and remain unauthorised. This change
removes the *code* blocker that would have made 1.11 fail — it does not perform 1.11.

## Approach

**The baseline records the migrations it subsumes, exactly as the legacy path records them.**

No new concept and no change to `migrate.ts`. The runner already has "record as applied
without running" semantics — that is what `--baseline` does, and it is how production itself
was baselined. The greenfield path does the same thing in SQL instead of via a flag.

The claim is earned rather than asserted: `npm run schema:equivalence` proves the baseline
produces what `001`–`038` produce. That proof is what makes recording them honest.

### Rejected alternatives

| Alternative | Why not |
|---|---|
| Teach `planMigrations` that a `000_baseline_*.sql` row supersedes earlier filenames | Needs the boundary declared somewhere — realistically a new `schema_migrations` column. The differ compares that table column-for-column, so the change lands in both paths, and a pure three-line function becomes stateful about filename conventions. More surface for no extra guarantee. |
| Retire `001`–`038` from `supabase/migrations/` | Correct end state, not viable now. The legacy production database still needs the chain as its lineage, `--verify` reads those files to report object state, and several tests read migration SQL by filename. A Phase 7 idea. |

## Components

### 1. Baseline ledger section

`supabase/baseline/000_baseline_2026-08-31.sql`, adjacent to the existing single-row insert
(currently at line 3207), gains a second statement:

```sql
insert into schema_migrations (filename)
values
  ('001_phase1.sql'),
  -- ... every file through ...
  ('038_app_role_function_execute.sql')
on conflict (filename) do nothing;
```

All 36 files are listed: `001`–`004` and `007`–`038`. (`005` and `006` have never existed.)

Three properties, each deliberate:

- **A separate statement, not folded into the existing insert.** The `checksum` column means
  "these bytes produced this lineage". Only the baseline file has bytes that were hashed;
  giving a chain row the baseline's digest would be false.
- **No checksum on the chain rows.** This also makes them byte-identical in shape to what
  `scripts/migrate.ts:329` writes on the legacy path, which names only `filename`.
- **`on conflict (filename) do nothing`**, for the same reason the existing row has it:
  re-running the file against a database that already has the lineage must not disturb it.

### 2. Drift test

Extends `__tests__/db/baseline-ledger.test.ts`. Its current assertion "seeds exactly one
ledger row naming itself" is the guard this design deliberately changes, so it is replaced
rather than supplemented.

The new assertion parses the listed filenames from the baseline and requires them to be a
**contiguous prefix of the sorted contents of `supabase/migrations/`** — that is,
`sorted.slice(0, listed.length)` deep-equals `listed`.

**"Contiguous prefix" means of the sorted filename list, not of the numbering.** `005` and
`006` do not exist, so a numeric-contiguity check would fail against a pre-existing and
entirely legitimate gap.

This catches a gap in the middle, a reordering, and a listed file that does not exist on
disk. Today the prefix happens to be the entire list; the distinction only starts to matter
when `039` lands.

**Why a prefix and not "every file".** Migration `039` must apply to *both* lineages. If the
test demanded the baseline list every file, adding `039` would force listing it — recording
it as applied on greenfield without ever creating its objects. That is exactly the
stranded-objects hazard `unappliedBaselineClaims` (`scripts/migrate.ts:112`) exists to
prevent, and its own comment states the reason: recording a migration as applied
"permanently removes the only path by which its objects would ever be created".

### 3. Bootstrap proof

`scripts/schema-equivalence.mjs` gains a step after Path B (baseline applied, snapshot
taken): run the real runner against the baselined branch and require it to find nothing
pending.

```js
const out = execFileSync('node', ['scripts/migrate.ts', '--dry-run'], {
  env: { ...process.env, MIGRATE_DATABASE_URL: branch.connectionUri },
  encoding: 'utf8',
})
```

`--dry-run` for two reasons: it cannot mutate the branch, and when it fails it names exactly
which migrations it would have replayed. The runner prints `Nothing to apply — the database
is up to date.` before the dry-run branch is consulted (`scripts/migrate.ts:306`), so the
empty case is reported under `--dry-run` too.

The step runs **after** introspection, so the snapshot compared by the differ is unaffected
regardless of outcome.

Today this step fails with `Would apply 36 migration(s)`. That is the failing test the work
starts from.

## Why three guards

Each catches a failure mode the others cannot:

| Guard | Runs | Catches |
|---|---|---|
| Drift test | unit, no database | list **shape** — gaps, reordering, a listed file absent from disk |
| Bootstrap proof | `schema:equivalence` | list **completeness** — a subsumed migration omitted, so the runner replays it |
| Existing schema diff | `schema:equivalence` | list **truthfulness** — a migration listed but whose DDL is missing from the baseline body, stranding its objects |

The third is why the drift test does not attempt database-level object checking: the
equivalence diff already answers that question, against a real branch, better than a regex
over SQL text could.

## Error handling

- The baseline insert is idempotent (`on conflict do nothing`).
- No runtime code path changes; this is build and deploy tooling only.
- The equivalence script keeps its existing `finally` branch deletion and `redactSecrets`
  error piping. The new `execFileSync` captures stdout rather than inheriting it, so its
  output passes through the same redaction on the failure path — the Neon driver echoes the
  full connection URL including the password in some error fields.
- Rollback is `git revert`. Nothing is applied to any live database by this change.

## Verification

1. `npm run schema:equivalence` → EQUIVALENT, exit 0, **and** the new bootstrap proof passes.
2. `npm test` → the extended `baseline-ledger` suite passes.
3. `npm run lint` → 0 errors, 0 warnings. `npm run typecheck` → clean.
4. Confirm the bootstrap proof is load-bearing by removing the baseline's chain insert and
   watching it fail with `Would apply 36 migration(s)` — a guard nobody has seen fail is not
   yet known to work.

## Out of scope

- Creating the greenfield Neon project (items 1.1/1.2/1.10/1.11 — still unauthorised).
- Retiring `001`–`038` from `supabase/migrations/`.
- The equivalence differ's ACL blindness on the `functions` class, carried over as an open
  follow-up from the `038` design.
