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
- Local Trust (`lib/localTrust/store.ts` and its routes under
  `app/api/dashboard/clients/[clientId]/local-trust/`) runs on `db()` but stays
  **intentionally fenced**: those routes return `503 FEATURE_UNAVAILABLE` regardless of the
  store working. Don't unfence them as part of unrelated work.

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
npm run lint       # ESLint (warnings only today; 0 errors)
npm run test       # Vitest (single run)
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
                   # WARNING - UNREACHABLE today: proxy.ts's matcher does not exclude
                   # /admin and next-intl defaults localePrefix to 'always', so
                   # GET /admin 307s to /en/admin, which has no page -> 404.
components/        # React UI components
  ui/              # shadcn/ui base components
  dashboard/       # Dashboard-specific components (+ local-trust/)
  pulse/           # Pulse report components
  result/          # Public result page components
  auth/            # Auth forms
lib/
  checks/          # 20 AEO check modules, named by domain (robots.ts, llmsTxt.ts, ...)
                   # NOT c1.ts-c20.ts - see Checks Architecture below
  authority/       # Domain authority engine: 5 layer modules, but computeAuthority()
                   # wires only layers 1-4. Layer 5 is an optional arg no caller passes.
  localTrust/      # Local trust scoring + ROI engine
  db.ts            # db() — Neon serverless SQL singleton  ← use this
  auth.ts          # getProfile() — reads Neon Auth session server-side
  neon-auth.ts     # auth() — server-side Neon Auth singleton
  auth-client.ts   # authClient + buildAuthCompleteUrl() (browser)
  scoring.ts       # CORE_PTS / EXT_PTS / GEO_PTS, calculateScore, assignGrade
  tier.ts          # getPlanFeatures() — plan feature flags
  types.ts         # Hub for shared types. NOT exhaustive - ImpactReport lives in
                   # lib/impact.ts, CheckExplanation in lib/checkExplanations.ts
  openrouter.ts    # LLM calls via OpenRouter
proxy.ts           # Next 16 proxy (was middleware) — intl routing + auth verifier
i18n/              # next-intl routing + request config
messages/          # en.json / zh-HK.json translation strings
supabase/
  migrations/      # 20 SQL migrations, 001_-022_ (no 005/006) - dir name is legacy
__tests__/         # Vitest tests mirroring lib/app structure
tests/e2e/         # Playwright specs + page objects
scripts/           # Utility scripts (seed, pulse runner)
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
- Tier/feature gates: use `getPlanFeatures(plan)` from `lib/tier.ts` before exposing paid features
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
  `maxDuration` (60s scan, 30s fix) and one cron; its `functions` keys are **literal paths,
  not prefixes**, so `fix/`'s subroutes inherit nothing despite also calling OpenRouter.
  `next.config.ts` declares two permanent redirects that fire *before* `proxy.ts`.
- `.worktrees/` holds four live git worktrees (gitignored, so `git status` hides them;
  `codex/ui-polish` is 18 commits ahead and unmerged — don't prune). Raw `grep`/`find` need
  `--exclude-dir=.worktrees` or they return ~5× duplicates. Also note `npm run lint` ≠
  `npx eslint .` — the ignores are CLI flags in `package.json`, not in `eslint.config.mjs`.
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

`proxy.ts` runs intl routing only, and its matcher `['/((?!api|_next|.*\\..*).*)']` **skips
`/api` entirely**. (Sole exception: a sign-in return carrying *both* the verifier param and
the challenge cookie is delegated to the SDK middleware.) Layouts never run for `app/api/**`.

Enforcement lives in three places, all via `lib/auth.ts`:
1. **Route-group layouts** — `app/[lang]/dashboard/layout.tsx` → `requireAuth(lang)`;
   `app/admin/layout.tsx` → `requireAdmin()`. A layout covers only its own subtree.
2. **Per-page** outside those subtrees — e.g. `app/[lang]/pulse/[clientId]/page.tsx`.
   Dashboard pages also re-call `requireAuth` on top of the layout; keep doing that.
3. **Per-route-handler** — every handler must gate itself with `requireAuth()`,
   `requireAdmin()`, `getProfile()` + null-check, a `CRON_SECRET` check, or webhook-signature
   verification — **and filter by `profile.account_id`, never a caller-supplied id.**

> ⚠️ **13 API routes are currently ungated** (excluding `auth/[...path]` and `scan/lead`,
> which are public by design): `authority/score`, `authority/score-bulk`,
> `authority/diagnostics/[domain]`, `fix`, `fix/cluster-map`, `fix/content-brief`,
> `fix/rewrite-chunks`, `onboarding/complete`, `pulse/onboard`, `pulse/suggest-questions`,
> `pulse/[clientId]/summary`, `pulse/[clientId]/missed`, `webhooks/neon`.
> `webhooks/neon` is **live on Neon and verifies no signature** — any POST can provision
> `accounts` + `profiles` rows. `fix/*` and `authority/score*` are live and call OpenRouter
> unmetered. The rest currently fail closed only by accident, because they hit the dead
> Supabase host — **migrating one to Neon without adding a gate turns it into a real hole**
> (e.g. `pulse/[clientId]/summary` reads by `clientId` with no ownership check).

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
c1–c5 and c6/c8 take `(baseUrl)`; c7 is `(baseUrl, html)`; c9–c16 are `(html, baseUrl)`;
c17 is `(html, baseUrl, ctx)`; c18/c20 are `(html, ctx)`; c19 is `(sitemapUrls, clientId,
industry)`. `checkMcpCard`'s reversed order typechecks fine and fails silently.

Checks degrade rather than throw, using **domain-specific** messages
(`headings_missing`, …). `{ status: 'fail', message: 'check_error' }` is the route's own
fallback for a rejected promise — don't emit that literal from a check or you collide with it.

Weights and `scorePts` / `assignGrade` / `calculateScore` / `calculateGeoScore` live in
`lib/scoring.ts` (re-exported by the scan route for older tests). **Composition is not fully
centralized:** the scan route computes `Math.min(100, score + geoScore)` inline, and
`lib/impact.ts` duplicates the same cap — change one, check the other.

## Database (Neon Postgres)

- Migrations in `supabase/migrations/` — numbered `001_`–`028_` (directory name is legacy;
  the target is now Neon)
- **A migration runner now exists:** `scripts/migrate.ts`, run via `npm run migrate`. It
  applies every file absent from the `schema_migrations` ledger, in filename order, each in
  its own transaction. `--dry-run` previews; `--baseline --except <file>` records existing
  migrations as applied without running them.
  **It refuses to run against a populated database with an empty ledger** — that guard is
  what stops it re-applying the migrations that were applied by hand before it existed.
  Baseline production once (`--baseline --except 027_client_report_snapshots.sql`) before
  the first real run.
- Applied as of 2026-07-26: `001`–`026` and `028`. **`027_client_report_snapshots.sql` is
  the sole pending migration**, and Slice 6 (client reports) applies it. It was edited to
  apply cleanly — it previously duplicated `021`'s `clients_id_account_id_unique`
  constraint, used `gen_random_bytes()` without enabling `pgcrypto`, and granted to the
  Supabase roles `anon` / `authenticated` / `service_role`, which do not exist under Neon.
- Neon also has tables with no migration file (`stripe_webhook_events`,
  `public_scan_rate_limits`, `authenticated_scan_monthly_usage`,
  `stripe_subscription_processing_leases`) — added out-of-band.
- Key tables: `scans`, `clients`, `accounts`, `profiles`, `pulse_weekly_summary` (**singular**),
  `pulse_metrics`, `notifications`, `prompt_bank`
- Neon Auth owns the `neon_auth` schema (`neon_auth.user`, `.session`, …). `profiles.id` FKs
  to `neon_auth.user` (migration `022`).
- **RLS is enabled but inert — never rely on it.** 22 of 27 public tables still have
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
- Test files: `__tests__/**/*.test.ts` plus one `.tsx`. Mirroring is inconsistent:
  `__tests__/checks/` -> `lib/checks/`, `__tests__/api/` -> `app/api/`, and
  `__tests__/config/` mirrors no source at all.
- **Nothing typechecks the tests.** `tsconfig.json` excludes them and there is no
  `typecheck` script - a type error in a test compiles, runs, and passes green.
- Run: `npm test` (313 tests / 40 files currently pass)
- Tests mock the DB client and `fetch` — do not hit the real DB in tests
- **Caveat:** many suites mock the *Supabase* client, so they pass for routes that are
  broken in production. A green suite is not evidence a Supabase-backed route works.
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
- `CRON_SECRET` — guards `/api/cron/*`. Note the two cron routes disagree on how:
  `trial-emails` is GET + `Authorization: Bearer`; `evaluate-alerts` is POST +
  `x-cron-secret` and is scheduled by nothing. Prefer `x-cron-secret` for new routes.
- Optional, with fallbacks: `RESEND_FROM_EMAIL`, `WIKIPEDIA_USER_AGENT`
- E2E only: `BASE_URL`, `START_DEV_SERVER`, `CI`, `PLAYWRIGHT_TEST_EMAIL`,
  `PLAYWRIGHT_TEST_PASSWORD`
- **Dead:** `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` — read by zero source files; checkout is
  server-side only. `@stripe/stripe-js` is installed but never imported.
- Legacy Supabase (`NEXT_PUBLIC_SUPABASE_URL`, `..._ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) —
  the project is gone, but these are still **read by live code**, so those paths are broken,
  not dormant. Note 4 files bypass the shims and import `@supabase/*` directly
  (`cron/trial-emails`, `cron/evaluate-alerts`, `components/dashboard/Sidebar.tsx`).

## Secrets Hygiene

- **`.mcp.json` is git-tracked and contains a hardcoded n8n bearer JWT with no `exp` claim.**
  It never self-expires. Rotate in n8n first (it is already in git history — gitignoring
  achieves nothing), then reference an env var instead.
- `n8n/configure-credentials.sh` hardcodes an n8n API JWT (expired 2026-06-06, repo private —
  no live exposure, but purge the pattern). `n8n/deploy-workflows.sh` does it correctly:
  read from env, exit if unset. Copy that.
- Never paste a connection string into a shell command — the `@neondatabase/serverless`
  driver echoes the **full URL including the password** in its error messages. Pipe through
  `2>&1 | grep -v "postgresql://"` when scripting against it.

## Git Conventions

- Branch naming: `feat/`, `fix/`, `refactor/`, `codex/` are the live prefixes. `claude/`
  branches exist on origin but none has ever been merged.
- Commits: lowercase imperative with scope (`feat(auth): …`, `fix(scan): …`, `refactor(scoring): …`)
- Recent work lands as PR merge commits (no squash). But older history was committed
  straight to `main`, so `git log --first-parent` is NOT a list of PRs.
- Main branch: `main` — remote `github.com/YNWAforever/fimmick-aeo`
