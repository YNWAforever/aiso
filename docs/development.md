# Run, test and deploy AISO

Run commands from the repository root unless a block says otherwise. Use Node
**24.x** and the committed npm lockfile. See [architecture](../ARCHITECTURE.md),
[configuration](configuration.md) and [`.env.example`](../.env.example).

## Start a development instance

```bash
npm ci
cp .env.example .env.local
# Fill .env.local with the intended development target, then:
npm run dev
```

Next.js reads `.env.local`; Vitest does not automatically load it. Minimum DB
configuration is `DATABASE_URL` plus `EXPECTED_NEON_PROJECT_ID`; pin branch, role
(`aeo_app`) and database expectations for the target as well. Use
`MIGRATE_DATABASE_URL` only for migrations, never as the application credential.
Auth needs `NEON_AUTH_BASE_URL` and a >=32-character `NEON_AUTH_COOKIE_SECRET`.
Public scan/claim needs the rate-limit and report-share secrets. Production
anonymous rate limiting depends on Vercel runtime primitives; setting `VERCEL=1`
alone does not provision them for self-hosting.

Open `http://localhost:3000/en` (or `/zh-HK`). Schema provisioning is separate
from starting the server: follow [bootstrap](runbooks/bootstrap-greenfield-project.md)
for a new target. Existing databases require their migration ledger to be checked
before changes. Do not point integration tests at a development or production
application database.

## Fast local verification (no live providers)

```bash
npm run typecheck
npm run lint
CI=1 npm run test:unit -- --maxWorkers=4
npm run build
```

`CI=1` installs the unit suite's guard against unmocked fetches. The build and
unit checks do not prove that runtime Auth, DB, billing or providers are healthy.
Both `auth()` and `db()` are lazy, including the Auth catch-all route; neither
requires constructing a live client during module import.

### Observed build validation gap

On this docs/tests branch (base `096fa041`), a webpack production build compiles
but fails Next.js route export validation. Reproduce with:

```bash
npm run build -- --webpack
```

The generated validators reject these existing exports: `parseFixPack` in
`app/api/fix/route.ts`, scoring re-exports in `app/api/scan/route.ts`,
`claimScanForAccount` in `app/api/scans/[id]/claim/route.ts`, and
`provisionAccountForUser` in `app/api/webhooks/neon/route.ts`. These route files
are unchanged in this docs/tests PR. Reusable helpers belong in library modules;
do not disable type checking to get past this. After the build generates those
validators, `npm run typecheck` also reports the same errors (an earlier run
without them passed).

The default Turbopack build hit an internal port-binding `EPERM` in this execution
environment, so its production validation outcome is unknown here. The webpack
result establishes a compatibility gap, not a successful substitute release build.
Neither integration nor browser/live-provider acceptance was performed locally
for this change; integration preflight rejected the missing `neonctl` executable.

Run the core-flow checks from this change with:

```bash
npm run test -- \
  __tests__/api/scan-claim-recovery.test.ts \
  __tests__/api/scan-claim.test.ts \
  __tests__/api/scan-claim-intent.test.ts \
  __tests__/api/stripe-webhook-full.test.ts \
  __tests__/api/stripe-entitlement-integrity.test.ts --maxWorkers=2
```

An explicitly named unit path through `npm test` runs only that layer. With no
paths, `npm test` also attempts integration; missing `neonctl` produces a loud
skip banner, not a full pass. `npm run test:unit` deliberately excludes integration
and local persistence suites. `npm run test:watch` uses the default Vitest config;
exclude integration when watching only unit tests.

## Real SQL integration

The harness in `__tests__/integration/setup.ts` creates an expiring disposable
Neon branch, proves its identity, resets its schema, runs migrations and cleans
up. It needs authenticated `neonctl` and a verified test project/default parent
that has never held customer data. The harness has a project default; inspect
`__tests__/helpers/neon-branch.ts` before relying on it. A branch copied from
production is not an empty fixture.

After the disposable target and any role-password operation are authorized:

```bash
npm run test:integration
# Or unit + the default integration suite, with no availability skip allowed:
REQUIRE_INTEGRATION_TESTS=1 npm test
# Additional exact-target suites excluded by the default integration config:
node scripts/ci/run-exact-target-suites.mjs
```

The exact-target wrapper derives its environment from a newly provisioned
branch; do not invent target approvals or substitute `DATABASE_URL` manually.
CI's integration job documents its credential and disposable-role authorization
inputs in [pr-gate.yml](../.github/workflows/pr-gate.yml). A default integration
pass alone does not include the exact-target suites. Redact stdout and file
reporters with `scripts/redact.mjs` before retaining or sharing DB failure logs.

## Browser and scheduler checks

For local browser tests, install Chromium and let Playwright own the dev server:

```bash
npx playwright install chromium
START_DEV_SERVER=1 npm run e2e -- --project=chromium tests/e2e/public-pages.spec.ts
```

This uses the local application. Broad E2E requires fixture preparation and
explicit fixture env; use the build/fixture procedure and env block in
[pr-gate.yml](../.github/workflows/pr-gate.yml) for the deterministic CI matrix.
Do not set `BASE_URL` to production for a write-capable suite. Real owner journeys
use captured, gitignored session state (`npm run e2e:auth:capture`, then
`npm run e2e:authenticated`); capture/replay requires an approved account and target.
Fixture rendering does not prove real sign-in or persistence.

Worker checks use a separate lockfile/toolchain:

```bash
npm --prefix cloudflare/cron-worker ci
npm --prefix cloudflare/cron-worker test
npm --prefix cloudflare/cron-worker run typecheck
```

## Deploy and verify

1. **Identify the target and candidate.** Record Vercel project/team/environment,
   source SHA, DB project/branch/role, feature flags and the compatible app/Worker
   versions for rollback. Configure runtime variables from `.env.example` in the
   selected Vercel environment. Keep owner credentials out of app runtime.
2. **Verify schema, then apply the reviewed pending list.** With the approved
   target in `.env.local`, `npm run migrate -- --verify` checks schema state and
   `npm run migrate -- --dry-run` previews pending work. `npm run migrate` mutates
   the target via `MIGRATE_DATABASE_URL`; use it only for the reviewed release.
   Re-verify afterward. Existing unledgered schemas need baseline reconciliation,
   not blindly replaying all files. See the [release packet](remediation/2026-10-11/release-runbook.md).
3. **Deploy the app candidate through the project's Vercel Git integration.**
   PR/branch builds are previews when enabled by project settings; merging to the
   configured production branch can deploy production. Verify those settings
   first. A PR is not approval to merge or promote. Require the `pr-gate` evidence
   on the candidate SHA: static, unit-contract, integration (including exact-target
   suites), E2E/accessibility, build/Lighthouse and Cloudflare Worker checks.
4. **Accept the preview before promotion.** Check deployed SHA/alias, runtime DB
   binding and the approved synthetic scan → sign-in → claim → workspace journey.
   Exercise billing with test-mode providers only. Follow
   [runtime readiness](runbooks/runtime-readiness.md) and
   [scan prerequisites](runbooks/public-scan-prerequisites.md).
   Config reports validate supplied values; they do not prove provider connectivity.
5. **Publish the scheduler separately when authorized.** The dedicated profile is
   `cloudflare/aiso-worker/wrangler.jsonc`; do not use the legacy profile or the
   Worker's bare `npm run deploy`. Prepare the artifact from the root with:

   ```bash
   node cloudflare/cron-worker/node_modules/wrangler/bin/wrangler.js deploy \
     --dry-run --config cloudflare/aiso-worker/wrangler.jsonc
   ```

   After target, schedules and secret mapping are approved, use the same command
   without `--dry-run`. Current source enables Pulse/repair at `17 4 * * *` and
   alerts at `47 7 * * 1` (UTC); the 09:00 email/Search Console trigger is disabled.
   Read back the deployed version/schedules, rule out overlapping Vercel/n8n
   producers and correlate an execution with persisted completion. Follow the
   [Worker runbook](runbooks/deploy-cron-worker.md); a trigger returning 2xx is
   insufficient evidence.
6. **Keep rollback concrete.** Roll app/Worker back to the recorded compatible
   versions, pausing affected producers first and reconciling in-flight work.
   Additive schema/evidence should be preserved; do not drop migrations as a
   generic rollback. Feature flags alone may leave legacy producers active.

These are release instructions, not a record of a deployment performed by this PR.

## Roadmap outcome and enterprise acceptance

Phases 2–4 release contracts and dark flags are documented in
[integrations/outcomes.md](integrations/outcomes.md),
[integrations/closed-loop-visibility.md](integrations/closed-loop-visibility.md)
and [integrations/enterprise-os.md](integrations/enterprise-os.md). Run the full
local gates plus the focused synthetic SQL/contracts before PR handoff:

```bash
npm run test:unit -- __tests__/integrations/outcome-store.test.ts __tests__/visibility __tests__/enterprise
```

These tests create fresh in-memory PostgreSQL fixtures, including the application
role and migrations 071–078 as appropriate; they do not connect to the managed
`DATABASE_URL`. Hosted disposable-Neon integration and browser checks remain
separate gates. The external adapter example imports without provider credentials
or DB writes. No new Worker schedule, production allowlist edit, paid provider
call or production migration is part of local acceptance.
