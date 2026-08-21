# Verify the Pulse weekly rollup

Proves `computeWeeklySummary` (`lib/pulse/summary.ts`) actually writes both kinds of
row — one per platform, plus the `platform IS NULL` aggregate that everything
downstream reads — against a real PostgreSQL, on a throwaway Neon branch.

Run this when you change the rollup SQL, the `pulse_weekly_summary` schema, or any
migration it depends on. It is also the compensating control for the fact that the
integration project **does not run in CI** (see
`__tests__/ci/pr-gate-workflow.test.ts` for why: the repository has no `NEON_API_KEY`
secret).

## Do not provision a branch by hand

The harness does it for you. `__tests__/integration/setup.ts` is a Vitest
`globalSetup` that, in one process:

1. creates a branch named `test-<pid>-<timestamp>-<random>` off the project default,
   with a 2-hour TTL so a SIGKILL cannot leak it;
2. runs `drop schema public cascade; create schema public;` on it;
3. applies every migration with `scripts/migrate.ts`;
4. exports the branch DSN as `TEST_DATABASE_URL`; and
5. **deletes the branch in `teardown()`**, reporting any it could not delete.

Earlier drafts of this procedure had the operator create a branch, derive its DSN by
hostname substitution, and delete it afterwards. **Do not do that.** It is strictly
more dangerous than the harness path — it puts a hand-built DSN next to a
`drop schema public cascade`, and it bypasses the three independent guards below.

## Why the drop is safe

`resetPublicSchema()` refuses to run unless all three hold:

- Its argument is a `TestBranch`, not a connection string, so no refactor can hand it
  `process.env.DATABASE_URL` in passing.
- `assertDisposableTestBranch()` requires the branch id *and* its exact URI to be in a
  module-private registry that only this process's own successful `createTestBranch()`
  writes to. It rejects the production branch id by identity, and rejects any host
  matching the production `DATABASE_URL` — read from `.env.local` as well as the
  environment, because `npm run test:integration` does not load that file.
- The decisive one: the connection that will execute the drop is asked *who it is*.
  Neon exposes `neon.branch_id` / `neon.project_id` as GUCs, so the target identifies
  itself in-band on the very session that runs the statement. Absent GUCs read as
  `null` and fail the comparison — it fails closed.

Do not weaken any of these to make a run succeed.

## Prerequisites

- `neonctl` on `PATH` and authenticated (`neonctl auth`, or `NEON_API_KEY` set).
  Without it the integration project **skips**, and a skip is not a pass.
- Node 24.x.

## Procedure

```bash
REQUIRE_INTEGRATION_TESTS=1 npm run test:integration
```

`REQUIRE_INTEGRATION_TESTS=1` turns a skip into a failure. Never verify the rollup
without it — the whole point is to prove the tests executed.

Note the branch id printed as `Provisioned test branch br-…`. If the run crashes hard
enough to skip teardown, that is the id to clean up:

```bash
scripts/neon branches delete <branch-id> --project-id red-firefly-93523049
```

Afterwards, confirm the project is back to its three long-lived branches
(`production`, `preview-alert-evaluation`, `preview-pro-client-reports`):

```bash
scripts/neon branches list --project-id red-firefly-93523049
```

## Two `neonctl` hazards this procedure routes around

- **`neonctl branches create` prints the full connection URI, password included, to
  stdout.** Branch roles are inherited from the parent, so that *is* the production
  `neondb_owner` password. Always go through `scripts/neon`, which pipes output
  through the redactor; treat any bare-`neonctl` disclosure as a credential exposure
  and follow `docs/runbooks/rotate-neon-credential.md`.
- **`neonctl connection-string --branch-id <id>` returns the *parent's* endpoint, not
  the branch's.** Observed directly: asked for a freshly created branch's DSN, it
  returned the production host. Anything seeded with that DSN lands in production.
  This is the concrete reason the manual-DSN approach was abandoned. The branch
  identifier on this command is a POSITIONAL argument (`neonctl connection-string
  <id> ...`), not `--branch-id` — that flag is not declared on the command, so
  yargs silently drops it and the command falls back to the project's default
  branch (production). `__tests__/helpers/neon-branch.ts`'s `createTestBranch()`
  uses the positional form for exactly this reason, and its endpoint↔uri identity
  check would still catch a `--branch-id` regression even if someone reintroduced
  it.
- **`branches create` omits `connection_uris` from its response whenever the
  project has more than one Postgres role and it cannot pick one unambiguously.**
  Migration `037` added a second role, `aeo_app` (the least-privilege application
  role — see `docs/superpowers/plans/2026-08-16-least-privilege-db-role.md`),
  alongside the original `neondb_owner`, and every branch created off `main`
  since inherits both — so this project's `branches create` response is now
  reliably `{branch, endpoints}` with no `connection_uris` key at all, and
  `neonctl connection-string` without `--role-name` errors outright with
  "Multiple roles found for the branch". `createTestBranch()` fetches the uri
  with a second, explicit `connection-string` call naming `neondb_owner` (the
  `OWNER_ROLE` constant) — the role migrations need DDL rights to run as, and
  the only role this harness has ever used the branch's connection string for.
  This was fixed independently in two places at once (this branch and PR #48)
  after `037` landed; PR #48's version shipped, since it carries its own test
  coverage in `__tests__/helpers/neon-branch.test.ts`.

## What a green run proves

`__tests__/integration/pulse-summary.test.ts` covers the properties a mocked `sql`
cannot reach, because they are properties of PostgreSQL rather than of the TypeScript
around it:

| Property | Why a unit test cannot see it |
|---|---|
| `GROUPING SETS` emits the `platform IS NULL` aggregate | The aggregate is produced by the planner, not by application code |
| Re-running refreshes rather than duplicating | Depends on `031`'s unique index being `NULLS NOT DISTINCT`, resolved by Postgres at execution time |
| A mid-week date buckets into its Monday | `date_trunc('week', …)` is server behaviour |
| Competitor tallies do not inflate `total_queries` | Requires a real `unnest` over real arrays |

The idempotence assertion is the load-bearing one, at
`__tests__/integration/pulse-summary.test.ts:76`:

```ts
it('refreshes rather than duplicating on a re-run', async () => {
  await computeWeeklySummary(sql, { clientId: CLIENT, scanWeek: MONDAY })
  await computeWeeklySummary(sql, { clientId: CLIENT, scanWeek: MONDAY })

  const rows = await summaryRows()
  expect(rows).toHaveLength(3)
  expect(rows.filter(r => r.platform === null)).toHaveLength(1)
})
```

Without `NULLS NOT DISTINCT` a second `platform IS NULL` row would coexist, and
`cron/evaluate-alerts` — which reads "the latest two aggregate weeks" — would then
compare a week against itself and compute a 0% delta forever.

## What it does **not** prove

**That the rollup works in production.** It cannot: production has no data to roll up.
`prompt_bank` is empty, `selectPendingClients` only returns a client with an active
prompt, so the producer has never reached the rollup at all. Until a workspace has
prompts, `/api/cron/pulse` will keep answering `200 {done: true, processed: 0,
configuredClients: 0}` every Monday — and `configuredClients: 0` is precisely the
signal that this is what happened.

Seeding prompts for a real brand is a product decision, not an engineering one. Do not
automate it.

## Observed results

**2026-08-15, first execution of this procedure.** It was worth running: the suite had
rotted, and the first run was **red**, not green.

| Run | Result |
|---|---|
| Before any fix | 7 files / 36 tests — **2 files failed, 4 tests failed** |
| After the two fixes below | **7 files passed / 36 tests passed**, 0 failures, ~29s |

33 migrations applied cleanly to the fresh branch on every run, `031` included.

### Defect 1 — a real product bug (`d243eb5`)

`pulse-summary.test.ts > 'writes one row per platform plus the aggregate row nothing
else produces'` failed on:

```
- "scanWeek": "2026-01-05",
+ "scanWeek": "Mon Jan 05 2026 00:00:00 GMT+0800 (Hong Kong Standard Time)",
```

Not a test bug. `computeWeeklySummary` typed its `returning scan_week` as `string` and
called `String()` on it, but the WebSocket/`Client` driver parses a Postgres `date`
into a `Date` — and this value is returned verbatim by `POST /api/pulse/run`. The API
response therefore carried a field whose *content* varied with the server's timezone
and locale. Fixed by normalising to `YYYY-MM-DD` from **local** components (a zoneless
`date` is built at local midnight, so `toISOString()` reports the previous day at any
positive UTC offset). The unit suite could not have caught it: its fake `sql` only ever
returned the string shape the *HTTP* driver produces. It now returns a `Date` too.

### Defect 2 — test isolation (`78b7220`)

All three `webhook-provisioning-race.test.ts` tests failed in `beforeEach`:

```
NeonDbError: update or delete on table "accounts" violates foreign key constraint
"scans_account_id_fkey" on table "scans"
```

Integration files share **one** branch, and this file assumed it owned the whole
`accounts` table in three places: a global `delete from accounts where id not in
(select account_id from profiles …)` sweep, a global orphan count, and
`select count(*) from accounts` expecting exactly 1. The sweep tried to delete accounts
belonging to `brand-workspace` and `client-reports`, which hold `scans` rows. All three
are now keyed to the file's own fixtures and assert on **deltas** rather than absolutes.

Scoping the sweep then exposed a second, previously unreachable failure —
`neon_auth.user` has `name` and `"emailVerified"` as NOT NULL with no default, so the
fixture insert had never succeeded. **That file had never run to completion.**

> Take the general lesson: a fixture query that is not keyed to its own rows is a
> cross-file hazard here, not a style preference.

### Flakiness to expect

One run returned 19 failures, mostly `NeonDbError: Error connecting to database:
TypeError: fetch failed` spread across files, and took 105s against a typical 29s.
Three subsequent runs were clean — transient Neon/network trouble, not a code fault.
**Re-run before investigating a broad, connection-shaped failure.**

That run also orphaned a branch whose automatic cleanup failed. It carried its TTL and
would have been reaped, but it was removed by hand with the `branches delete` command
above, and `branches list` confirmed the project back to its three long-lived branches.
