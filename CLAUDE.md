# Fimmick AEO — Project Instructions

> **CRITICAL**: This project uses **Next.js 16** (App Router). APIs, file conventions, and caching behaviour may differ from your training data. Before writing any Next.js code, read the relevant guide in `node_modules/next/dist/docs/`. Heed deprecation notices.
>
> Next.js 16 renames `middleware.ts` → **`proxy.ts`** (exporting `proxy`, not `middleware`). This repo uses `proxy.ts` at the root. Do not create a `middleware.ts`.

## ✅ Migration complete: Supabase → Neon

The Supabase → Neon migration is done. `db()` from `@/lib/db` (a lazy
`@neondatabase/serverless` singleton) is the only database client in the codebase — the
`lib/supabase.ts` / `lib/supabase-server.ts` shims are deleted and `@supabase/supabase-js` /
`@supabase/ssr` are uninstalled.

- Neon's driver is **tagged-template only**: `` sql`select … where id = ${id}` ``.
  Calling `sql(someString)` throws. Interpolations are parameterised, not string-concatenated.
- An ESLint `no-restricted-imports` rule in `eslint.config.mjs` blocks any new import of
  `@supabase/*`, `@/lib/supabase`, or `@/lib/supabase-server` — reintroducing one is a lint
  error, not just a convention.
- Local Trust is **restored and live** (`lib/localTrust/`): profile, actions and export all
  run on `db()` and gate through `lib/localTrust/guard.ts`. Its store was the only feature
  store ever ported to Neon — the other fenced features have no `db()` data layer at all, so
  restoring one means writing its queries, not just deleting the fence.

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Language | TypeScript | 5.9 |
| Framework | Next.js (App Router) | 16.2 |
| i18n | next-intl | 4.x |
| Database | **Neon** (PostgreSQL) | `@neondatabase/serverless` 1.x |
| Auth | **Neon Auth** | `@neondatabase/auth` 0.4.2-beta (pinned exact) |
| Payments | Stripe | v22 |
| Email | Resend | v6 |
| AI / LLM | OpenRouter | `lib/openrouter.ts` |
| Styling | Tailwind CSS | v4 |
| UI primitives | Radix UI + shadcn/ui | `components/ui/` |
| Charts | Recharts | v3 |
| Unit tests | Vitest | v4 |
| E2E tests | Playwright | v1.60 |
| Node | **24.x** (`engines`) | required |
| Deploy | Vercel | `vercel.json` |

No `@supabase/*` packages remain — see the migration note above.

## Build & Run

```bash
npm run dev        # start dev server (localhost:3000)
npm run build      # production build
npm run start      # serve production build
npm run lint       # ESLint — clean: 0 errors, 0 warnings. Keep it there.
npm run test       # unit + integration (integration skips loudly without neonctl)
npm run test:unit  # unit only
npm run test:integration  # integration only — always requires neonctl
npm run test:watch # Vitest watch mode
npm run e2e        # Playwright E2E (needs a dev server, or START_DEV_SERVER=1)
```

There is **no CI** — no `.github/workflows/`. Run `build`, `lint`, and `test` locally
before opening a PR.

## Project Structure

```
app/
  [lang]/          # i18n-prefixed public pages (en / zh-HK)
    auth/          # login + /auth/complete (client-side session exchange)
    dashboard/[clientId]/  # authenticated client dashboard
    pricing/       # Stripe-gated pricing page
    pulse/[clientId]/      # AI visibility pulse report
    result/[id]/   # public scan result page (+ opengraph-image)
  api/             # Next.js route handlers (REST)
    scan/          # POST /api/scan — main AEO scan engine
    auth/[...path]/  # Neon Auth catch-all handler
    webhooks/neon/ # Neon Auth user.created → provision profile + account
    fix/           # AI fix-pack generation
    stripe/        # checkout, portal, webhook
    pulse/         # Pulse weekly AI monitoring
    clients/       # Client CRUD + agent sub-routes
    dashboard/     # Dashboard data API (incl. local-trust)
    authority/     # Domain authority scoring
    cron/          # Cron job triggers
  admin/           # Internal admin pages (app/admin/layout.tsx -> requireAdmin).
                   # Reachable: proxy.ts's matcher now excludes /admin, so it no
                   # longer 307s to a non-existent /en/admin. A separate localised
                   # app/[lang]/admin/authority/ page DOES go through intl routing.
components/        # React UI components
  ui/              # shadcn/ui base components
  dashboard/       # Dashboard-specific components (+ local-trust/)
  pulse/           # Pulse report components
  result/          # Public result page components
  auth/            # Auth forms
lib/
  checks/          # 20 AEO check modules, named by domain (robots.ts, llmsTxt.ts, ...)
                   # NOT c1.ts-c20.ts - see Checks Architecture below
  authority/       # Domain authority engine: 4 layer modules. computeAuthority()'s
                   # 5th "dynamicBoost" slot is an optional arg no caller passes.
  localTrust/      # Local trust scoring + ROI engine
  prompts/         # Question-bank vocabulary + gate. categories.ts is the single
                   # source of truth for the four category keys — the column has
                   # no CHECK and its writers are LLMs, so validate on the way in
                   # and stay permissive on the way out.
  pulse/           # Pulse producer: summary rollup, answer analysis, platform
                   # vocabularies, and limits.ts. MAX_PROMPTS is shared — pulse/run
                   # scans `limit MAX_PROMPTS`, so the writer must cap at the same
                   # number or the excess is silently never scanned.
  db.ts            # db() — Neon serverless SQL singleton  ← use this
  auth.ts          # getProfile() — reads Neon Auth session server-side
  neon-auth.ts     # auth() — server-side Neon Auth singleton
  auth-client.ts   # authClient + buildAuthCompleteUrl() (browser)
  scoring.ts       # CORE_PTS / EXT_PTS / GEO_PTS, calculateScore, assignGrade
  tier.ts          # resolveCommercialEntitlement() — the real gate; getPlanFeatures() ignores status
  types.ts         # Hub for shared types. NOT exhaustive - ImpactReport lives in
                   # lib/impact.ts, CheckExplanation in lib/checkExplanations.ts
  openrouter.ts    # LLM calls via OpenRouter
proxy.ts           # Next 16 proxy (was middleware) — intl routing + auth verifier
i18n/              # next-intl routing + request config
messages/          # en.json / zh-HK.json translation strings
supabase/
  migrations/      # 30 SQL migrations, 001_-032_ (no 005/006) - dir name is legacy
__tests__/         # Vitest tests mirroring lib/app structure
tests/e2e/         # Playwright specs + page objects
scripts/           # migrate.ts (npm run migrate), run-tests.mjs (npm test), seed-packs.ts
n8n/               # n8n workflow exports (JSON) + deploy/credential shell scripts
```

## Code Style

- Route segments: lowercase kebab-case (`local-trust`), but dynamic segments are camelCase
  inside brackets (`[clientId]`). React components PascalCase - EXCEPT `components/ui/`
  primitives, which are lowercase (`button.tsx`); match that dir or you break `shadcn add`.
  `lib/` has no single rule (camelCase `checkExplanations.ts` next to kebab `auth-client.ts`)
  - match neighbouring files rather than introducing a third style.
- Imports: use `@/` alias for project root (configured in `tsconfig.json` and `vitest.config.ts`)
- DB access: `const sql = db()` from `@/lib/db`, then tagged-template queries
- Auth pattern: call `getProfile()` from `lib/auth.ts` — returns `null` for unauthenticated
  requests (don't throw). Use `requireAuth(lang)` / `requireAdmin(lang)` in layouts to redirect.
- Tier/feature gates: use **`resolveCommercialEntitlement(profile.accounts)`** from
  `lib/tier.ts`, never `getPlanFeatures(plan)`. The latter takes a plan string and so ignores
  subscription status, trial expiry and admin overrides — it will happily report Pro features
  for a `cancelled` account. `resolveCommercialEntitlement` resolves override → past_due →
  cancelled → trial → paid and fails closed to `free`.
- Error handling: `try/catch` with graceful fallbacks — checks degrade rather than throw, each
  with its own domain-specific message (see Checks Architecture; don't emit `check_error`).
- **Never return a success over a failed write.** This bit hard: `supabase-js` resolved to
  `{ data: null, error }` instead of throwing, and routes that discarded that `error`
  returned HTTP 200 over a dead database. The Stripe webhook returned `{ok:true}` while
  dropping every write, so Stripe marked each event delivered and never retried — paid
  upgrades were lost silently for months. `db()` throws, which is why every handler wraps
  its queries in `try/catch` and returns 5xx. Keep it that way: a 2xx must mean the write
  happened.
- Deployment config lives outside the code and is easy to miss: `vercel.json` sets
  `maxDuration` (60s scan, 30s fix) and nothing else — no cron. Its `functions` keys are **literal paths,
  not prefixes**, so `fix/`'s subroutes inherit nothing despite also calling OpenRouter.
  `next.config.ts` declares two permanent redirects that fire *before* `proxy.ts`.
- `npm run lint` ≠ `npx eslint .` — the ignores are CLI flags in `package.json`, not in
  `eslint.config.mjs`. Several of those flags (`.worktrees/`, `.codex/`, `.opencode/`) are
  vestigial: no such directories exist any more, and `git worktree list` shows a single
  worktree. The same dead paths linger in `tsconfig.json` and `vitest.config.ts` excludes.
- Lazy singletons: `db()` and `auth()` defer client construction. This genuinely protects the
  build for `db()` — `next build` succeeds with `DATABASE_URL` unset. It does **not** protect
  `auth()`: `app/api/auth/[...path]/route.ts` calls `auth().handler()` at module scope, so
  Next evaluates it eagerly during "Collecting page data".
- **Build-time env requirement:** `NEON_AUTH_COOKIE_SECRET` must be set and ≥32 chars at
  **build** time, not just runtime. Without it `next build` fails with
  `Failed to collect page data for /api/auth/[...path]`, and Vercel deploys fail.
  (`NEON_AUTH_BASE_URL` is runtime-only.)
- Never call `db()` or `auth()` at module scope in a route file. `export const dynamic =
  'force-dynamic'` does **not** exempt a route from build-time module evaluation.

## Auth Architecture

**A new page or API route is unprotected unless it gates itself.** There is no global gate.

`proxy.ts` runs intl routing only, and its matcher `['/((?!api|admin|_next|.*\\..*).*)']`
**skips `/api` entirely** (and `/admin`, so that unlocalised subtree is reachable rather than
307ing to a non-existent `/en/admin`). Sole exception: a sign-in return carrying *both* the
verifier param and the challenge cookie is delegated to the SDK middleware. Layouts never run
for `app/api/**`.

Enforcement lives in three places, all via `lib/auth.ts`:
1. **Route-group layouts** — `app/[lang]/dashboard/layout.tsx` → `requireAuth(lang)`;
   `app/admin/layout.tsx` → `requireAdmin()`. A layout covers only its own subtree.
2. **Per-page** outside those subtrees — e.g. `app/[lang]/admin/authority/page.tsx`, which is
   localised and so does go through intl routing. Dashboard pages also re-call `requireAuth`
   on top of the layout; keep doing that.
3. **Per-route-handler** — every handler must gate itself with `requireAuth()`,
   `requireAdmin()`, `requireApiAdmin()` (`lib/admin-guard.ts`, the API-shaped variant that
   returns a response instead of redirecting), `getProfile()` + null-check, or
   webhook-payload verification — **and filter by `profile.account_id`, never a
   caller-supplied id.**

> **Three routes are intentionally public**, and no others: `auth/[...path]` (the Neon Auth
> catch-all), `funnel-events` (redacted telemetry only, 2 KiB body cap, rate-limited), and
> `scans/[id]/claim-intent` (rate-limited, issues a signed cookie). `webhooks/neon` is public
> in the sense that anyone can POST it, but it authenticates every payload against
> `neon_auth.user` — `@neondatabase/auth` ships no webhook signing, so that lookup is the
> only authentication it has. Do not remove it.
>
> **Grep is not a reliable gate check here.** `app/api/client-reports/**` and
> `report-branding` look ungated in their own files: they delegate to `lib/reports/service.ts`,
> which calls `getProfile()` and filters by `account_id`. Read the callee before concluding a
> route is open.
>
> Routes whose feature is fenced return `503 FEATURE_UNAVAILABLE` via `lib/unavailable.ts`:
> `pulse/*` **except `pulse/run`**, `fix/cluster-map`, `fix/content-brief`, `notifications/*`,
> `agents/*`, `cron/*` (both trial-emails and evaluate-alerts). **Local Trust, the alerts
> *config* route, the Pulse producer (`pulse/run`) and the whole prompt bank are restored**;
> `cron/evaluate-alerts` deliberately is not — it needs a scheduler, and none exists.
> `__tests__/api/fenced-routes.test.ts` is the canonical list and asserts each still 503s, so
> restoring a route means deleting its entry there too.
>
> Three of the remaining fences should be **deleted rather than restored**, and it is worth
> not re-litigating that: `pulse/[clientId]/summary` and `/missed` are redundant —
> `clients/[clientId]/overview` is unfenced and already serves both datasets with larger
> limits — `pulse/onboard` is superseded by `onboarding/complete`, and `notifications/*` has
> never had a producer in any commit, so restoring it surfaces a permanently empty list whose
> only consumer (`NotificationBell`) has no importer either.
>
> A fence is not a gate — **restoring one means adding a real gate, not just deleting the
> `featureUnavailable` call.** The shape to copy is `lib/localTrust/guard.ts`: auth →
> entitlement → ownership, in that order, in one place so a route cannot do two of the three.
> Ownership failure is `404` (the id came from the caller); a failed ownership *lookup* is
> `503`, so a database incident cannot read as "not yours". `pulse/run` inverts that order
> deliberately and is the one documented exception: it is cron-authenticated with no session,
> so the account is resolved *through* the client. The entitlement check survives the
> inversion and doubles as cost control — a plan granting no platforms is refused `403`
> before any LLM spend.

Sign-in completes **client-side**: `LoginForm` / `TrialCta` set `callbackURL` to
`/{lang}/auth/complete`, and `components/auth/AuthComplete.tsx` exchanges the session
verifier via `getSession()`. `proxy.ts` delegates to the SDK middleware *only* when both the
verifier query param and the challenge cookie are present — the magic-link flow sets no
challenge cookie, and delegating without it bounces users back to login. Read the comment
block at the top of `proxy.ts` before changing any of this.

## Checks Architecture (core domain logic)

The AEO scan engine runs 20 checks split into three buckets:

| Bucket | Checks | Max pts |
|--------|--------|---------|
| Core | c1–c5 | 45 |
| Extended | c6–c16 | 30 |
| GEO | c17–c20 | 25 |

`c1`–`c20` are **result keys**, not filenames — modules are named by domain (`robots.ts`,
`llmsTxt.ts`, …). The keys are declared in `lib/types.ts`; weights in `lib/scoring.ts`;
`app/api/scan/route.ts` maps each module's output onto its key.

Checks run in **two sequential** `Promise.allSettled` batches, not one: batch 1 (c1–c16)
after a blocking page fetch supplies the shared `html`; batch 2 (c17–c20) after a
`/sitemap.xml` fetch feeding c19 (skipped if the caller passes `sitemapUrls`). Within a batch
checks are concurrent. A new GEO check inherits two blocking fetches on its critical path.

Each check returns `CheckResult`. The four GEO checks return `CheckResult & { geoDetails? }`;
the route stores that as `<key>_data` in the `scans.results` JSONB — omit it and the payload
is silently lost. **Argument shapes are not uniform** — read the signature before calling:
c1–c6 and c8 are `(baseUrl, fetcher)`; c7 is `(baseUrl, html, fetcher)`; c9–c16 are sync
`(html, baseUrl)` with no fetcher; c17 is `(html, baseUrl, ctx)`; c18/c20 are `(html, ctx)`;
c19 is `(sitemapUrls, clientId, industry)`.

**Every network check takes a required `PublicUrlFetch` last — there is no default.** The scan
route injects `fetchPublicUrl` (`lib/security/public-url.ts`), which pins DNS and revalidates
every redirect hop. A bare `fetch()` inside a check is blind SSRF: `checkMcpCard` did exactly
that, and a public host answering `302 → 169.254.169.254` reached link-local space. Two guards
now exist — an ESLint `no-restricted-globals` rule over `lib/checks/**`, and a wiring assertion
in `__tests__/api/scan-security.test.ts` that every check received the injected fetcher, which
is the level the bug actually lived at.

`checkMcpCard`'s reversed order still typechecks fine and still fails silently — `baseUrl` and
`html` are both bare `string`, and swapping them makes all four probes throw inside their own
`catch`, so the check returns a plausible `mcp_card_missing` with no error anywhere. The
fetcher parameter does not mitigate this; it is third.

c19 defends itself: it normalises its first argument through `lib/security/sitemap-urls.ts`
rather than trusting the caller, because that value originates in the request body.

Checks degrade rather than throw, using **domain-specific** messages
(`headings_missing`, …). `{ status: 'fail', message: 'check_error' }` is the route's own
fallback for a rejected promise — don't emit that literal from a check or you collide with it.

Weights and `scorePts` / `assignGrade` / `calculateScore` / `calculateGeoScore` live in
`lib/scoring.ts` (re-exported by the scan route for older tests). **Composition is not fully
centralized:** the scan route computes `Math.min(100, score + geoScore)` inline, and
`lib/impact.ts` duplicates the same cap — change one, check the other.

## Database (Neon Postgres)

- **`pulse_metrics` has no unique key**, and `total_queries` in the weekly rollup is a count
  over its rows — so writing a prompt twice inflates `sov_score`, the number the whole feature
  reports. `pulse/run` therefore deletes a prompt's rows for the week before writing them,
  in application code rather than via a constraint, so it stays correct whether or not the
  pending migrations ever land. Any new writer of that table needs the same discipline.
- **Never `returning *` on a statement that joins another table.** The Neon HTTP driver builds
  each row with `Object.fromEntries(...)`, so duplicate column names **silently overwrite —
  last wins** — and the joined relation's columns come *after* the target's. `update prompt_bank
  p … from clients c … returning *` returns 11 columns that collapse to 9 keys, with `row.id`
  holding the **client's** id, because both tables have `id` and `created_at`. It typechecks,
  it reads correctly in review, and the caller then addresses an id that never existed. Name
  the columns explicitly (`returning p.id, p.question, …`). Verified against PostgreSQL 16.
- Putting tenancy *inside* a write (`update … from clients c where … and c.account_id = ${id}`)
  rather than checking first is the preferred shape — one statement, no TOCTOU window, and zero
  rows means 404 without distinguishing "absent" from "not yours". See
  `app/api/dashboard/clients/[clientId]/prompts/[promptId]/route.ts`.
- Migrations in `supabase/migrations/` — 30 files, `001_`–`032_` (no 005/006; directory name is legacy;
  the target is now Neon)
- **A migration runner now exists:** `scripts/migrate.ts`, run via `npm run migrate`. It
  applies every file absent from the `schema_migrations` ledger, in filename order, each in
  its own transaction. `--dry-run` previews; `--baseline --except <file>` records existing
  migrations as applied without running them.
  **It refuses to run against a populated database with an empty ledger** — that guard is
  what stops it re-applying the migrations that were applied by hand before it existed.
- **Run `npm run migrate -- --verify` first, and trust it over this file.** It reports, per
  migration, whether the tables that migration creates actually exist. `--baseline` now refuses
  to record any migration whose tables are missing, because recording one is unrecoverable: it
  removes the only path by which its objects would ever be created. Baseline excepting **every**
  migration that has not run — anything you forget is recorded as applied without ever running.
- ⚠️ **`021` is disputed and must be settled before baselining.** `021_local_trust_roi.sql:3`
  says of itself *"This migration has never been applied (no local_trust_* table exists in
  Neon)"*, while the line below claimed `001`–`026` were applied and `027:10` asserts
  "Production has 021 applied". They cannot all be true. 021 is the sole creator of
  `local_trust_profiles` / `_snapshots` / `_actions`, which `lib/localTrust/store.ts` queries
  directly — so if it never ran, **Local Trust is broken in production**, and baselining
  without excepting it strands those tables permanently. `--verify` answers this in one command.
- Believed applied: `001`–`026` (**except possibly `021`**) and `028`. **Pending: `027`, `029`,
  `030`, `031`, `032`.** Verify before baselining; this line is only as fresh as the last person to
  edit it, and it has been wrong. Slice 6 (client reports) applies `027`. It was edited to
  apply cleanly — it previously duplicated `021`'s `clients_id_account_id_unique`
  constraint, used `gen_random_bytes()` without enabling `pgcrypto`, and granted to the
  Supabase roles `anon` / `authenticated` / `service_role`, which do not exist under Neon.
- The four tables that once had no migration file (`stripe_webhook_events`,
  `public_scan_rate_limits`, `authenticated_scan_monthly_usage`,
  `stripe_subscription_processing_leases`) were backfilled into `023`–`025`.
- Key tables: `scans`, `clients`, `accounts`, `profiles`, `pulse_weekly_summary` (**singular**),
  `pulse_metrics`, `notifications`, `prompt_bank`
- Neon Auth owns the `neon_auth` schema (`neon_auth.user`, `.session`, …). `profiles.id` FKs
  to `neon_auth.user` (migration `022`).
- **RLS is enabled but inert — never rely on it.** *(Counts below are unverified — they need
  a live connection to check `pg_class.relrowsecurity`, `pg_policies` and `pg_roles`. The
  conclusion holds regardless: nothing here is a backstop.)* 22 of 27 public tables still have
  `relrowsecurity = true` carrying 21 leftover Supabase-era policies that call `auth.uid()`.
  They never fire: the app connects as `neondb_owner`, which has `rolbypassrls = true`, and
  no table sets FORCE ROW LEVEL SECURITY — so `row_security_active()` is false everywhere.
  **Every query must filter by `account_id` explicitly.** There is no effective backstop.
- **Latent hazard:** point the app at a non-owner Neon role (or `ALTER ROLE … NOBYPASSRLS`)
  and those 21 policies activate. `auth.uid()` is a Supabase function that does not exist
  under Neon Auth, so nearly every query silently returns zero rows. Drop the dead policies
  before introducing a least-privilege role.

## Testing

- Framework: **Vitest** with `globals: true`, `environment: node`
- Test files: `__tests__/**/*.test.ts`, plus 7 `.tsx` and 5 `.mjs`. Mirroring is inconsistent:
  `__tests__/checks/` -> `lib/checks/`, `__tests__/api/` -> `app/api/`, while
  `__tests__/config/`, `__tests__/migrations/` and `__tests__/scripts/` assert on config,
  SQL files and the test runner rather than mirroring a source module.
- **Nothing typechecks the tests.** `tsconfig.json` excludes them and there is no
  `typecheck` script - a type error in a test compiles, runs, and passes green.
- Run: `npm test` (unit: 106 files / 1141 tests currently pass)
- **`npm test` runs two projects**, unit then integration, via `scripts/run-tests.mjs`. The
  integration project provisions a real Neon branch and needs `neonctl` on PATH and
  authenticated. Without it that project is **skipped**, with a banner printed after the run
  so it cannot scroll out of view — a skip is not a pass. Naming an integration test
  explicitly, or setting `REQUIRE_INTEGRATION_TESTS=1`, fails instead of skipping.
  **`REQUIRE_INTEGRATION_TESTS=1 npm test` is the command that proves the full suite ran.**
- Unit tests mock the DB client and `fetch` — do not hit the real DB in the unit project
- **Caveat:** a suite that mocks the thing it is testing proves little. Two live examples of
  the failure mode: the funnel-events route test passed via the rate limiter's fail-open path
  until the limiter was mocked explicitly, and the scan-security suite reused module-level
  check mocks across tests, so per-test argument assertions read an earlier test's call.
- `vitest.config.ts` stubs `next/headers` and inlines `@neondatabase/auth` so its compiled
  server module loads under Node — see `__tests__/stubs/next-headers.ts`
- E2E: Playwright in `tests/e2e/` with page objects; `npm run e2e`
- Coverage: `@vitest/coverage-v8` available

## i18n

- Locales: `en` (default), `zh-HK`
- All user-facing pages live under `app/[lang]/`
- Translation strings in `messages/en.json` and `messages/zh-HK.json`
- Use `next-intl` hooks (`useTranslations`, `getTranslations`) — never hardcode UI strings

## Environment Variables

- `DATABASE_URL` — Neon connection string
- `NEON_AUTH_BASE_URL` / `NEON_AUTH_COOKIE_SECRET` (the latter is **build-time** — see above)
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_BASIC` / `STRIPE_PRICE_PRO` / `STRIPE_PRICE_ENTERPRISE` — read by
  `lib/stripe.ts` and `app/api/stripe/webhook/route.ts`. **Not in `.env.local`** — locally,
  checkout sends an undefined price id and webhook tier resolution falls through to `basic`.
- `RESEND_API_KEY` · `OPENROUTER_API_KEY` · `NEXT_PUBLIC_APP_URL` · `N8N_SCAN_WEBHOOK_URL`
- `PUBLIC_SCAN_RATE_LIMIT_SECRET` / `REPORT_SHARE_SECRET` — both ≥32 chars. The first has no
  production fallback, so unset it takes **every anonymous scan to 503**; the second signs
  report share links *and* the scan-claim cookie.
- **`.env.example` is the authoritative list** — it documents every variable and what breaks
  without it.
- Optional, with fallbacks: `RESEND_FROM_EMAIL`, `WIKIPEDIA_USER_AGENT`
- E2E only: `BASE_URL`, `START_DEV_SERVER`, `CI`, `PLAYWRIGHT_TEST_EMAIL`,
  `PLAYWRIGHT_TEST_PASSWORD`
- **Dead:** `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` — read by zero source files; checkout is
  server-side only. `@stripe/stripe-js` is installed but never imported.
- `CRON_SECRET` — ≥16 chars, read by **two** routes in the same request chain, in two
  different header shapes, which looks like a bug and is not. Vercel Cron sends
  `Authorization: Bearer $CRON_SECRET` to `GET /api/cron/pulse`; that driver then sends
  `x-cron-secret` to `POST /api/pulse/run`. Neither shape is ours to choose — the first is
  Vercel's, the second is the producer's. Both return 500 rather than running if the secret
  is unset or short. `vercel.json` now schedules the driver weekly; `cron/trial-emails` and
  `cron/evaluate-alerts` remain 503 stubs that read no secret.
- **Dead:** `RESEND_API_KEY` (`sendAlertEmail` has no callers). Legacy Supabase
  (`NEXT_PUBLIC_SUPABASE_URL`, `..._ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) is also fully
  dead: no application code reads them. The ESLint rule that bans `@supabase/*` now covers
  `.mjs`/`.js`/`.cjs` as well as TS — it previously did not, which is how an orphaned
  `scripts/run-pulse.mjs` kept a live import past it.

## Secrets Hygiene

- **`.mcp.json` is git-tracked. It no longer contains a literal token** — it interpolates
  `${N8N_MCP_TOKEN}` and `${DATABASE_URL}` — but the old n8n bearer JWT is still reachable in
  history at `bcbe9dc`, and it carries no `exp` claim, so it never self-expires. **Rotating it
  in n8n is still owed**; removing it from HEAD achieved nothing on its own.
- `n8n/configure-credentials.sh` and `n8n/deploy-workflows.sh` both now read from env and exit
  if unset. `configure-credentials.sh` goes further and is the pattern to copy: it builds the
  Postgres credential payload through a `python3` heredoc so the password never lands in a
  shell argument, posts it with `--data-binary @tempfile`, and cleans up with `trap … EXIT`.
- Never paste a connection string into a shell command — the `@neondatabase/serverless`
  driver echoes the **full URL including the password** in its error messages. Pipe through
  `2>&1 | grep -v "postgresql://"` when scripting against it.

## Git Conventions

- Branch naming: `feat/`, `fix/`, `refactor/`, `codex/`, `claude/` are the live prefixes —
  `claude/` branches do get merged (PRs #35–#37).
- Commits: lowercase imperative with scope (`feat(auth): …`, `fix(scan): …`, `refactor(scoring): …`)
- Recent work lands as PR merge commits (no squash). But older history was committed
  straight to `main`, so `git log --first-parent` is NOT a list of PRs.
- Main branch: `main` — remote `github.com/YNWAforever/fimmick-aeo`
