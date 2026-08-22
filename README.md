# Fimmick AEO

Multi-tenant SaaS that scores websites on **AEO / GEO** — how well AI answer engines
(ChatGPT, Perplexity, Google AI Overviews, …) can crawl, parse, and cite them.

- **Scan** — 20 checks across three buckets (Core 45 pts, Extended 30 pts, GEO 25 pts)
  produce a 0–100 score and a letter grade (`A+` → `F`). Entry point: `POST /api/scan`.
- **Fix packs** — AI-generated, prioritised remediation for the failing checks, via
  OpenRouter (`app/api/fix/`).
- **Local Trust** — trust/ROI scoring per brand, with a CSV export
  (`app/api/dashboard/clients/[clientId]/local-trust/`, `lib/localTrust/`).
- **Pulse** — weekly monitoring of how often a brand is surfaced by LLM platforms
  (`app/api/pulse/`, `lib/pulse/`). The producer is **live**: `/api/cron/pulse` drives
  `POST /api/pulse/run` across five platforms weekly, and the dashboard's Monitor step
  renders the results. Scheduling is via `cloudflare/cron-worker/`, not Vercel Cron (see
  `docs/runbooks/deploy-cron-worker.md`).
- Bilingual **en / zh-HK** (`next-intl`), billed through **Stripe**, deployed on **Vercel**.

Several features are **fenced**: their routes return `503 FEATURE_UNAVAILABLE` via
`lib/unavailable.ts`, and `__tests__/api/fenced-routes.test.ts` is the canonical list. Still
fenced: agents and content tools. Live: Local Trust, alert *configuration*, the Pulse
producer (`POST /api/pulse/run`), the question bank (including AI question suggestions),
`notifications` (restored), and `cron/trial-emails` (restored 2026-08-22). Alert *evaluation*
is also live: it runs weekly (scheduled via `cloudflare/cron-worker/`, not Vercel Cron) and
emails threshold, week-over-week and recovery alerts, deduped to one per client, type and
week, with in-app notifications written and readable. Migrations `033`–`035` gate its deploy (see
[`docs/alert-evaluation-release.md`](./docs/alert-evaluation-release.md)). A fence is not a
gate — restoring one means adding a real auth/entitlement/ownership gate, not just deleting
the `featureUnavailable` call. `lib/localTrust/guard.ts` is the shape to copy.

Stack: Next.js 16 (App Router) · TypeScript 5.9 · Neon Postgres + Neon Auth · Tailwind v4 ·
shadcn/ui · Vitest · Playwright.

## Project status — read before you touch anything

**The Supabase → Neon migration is complete.** `db()` from `@/lib/db` is the only database
client: zero files import `lib/supabase.ts` / `lib/supabase-server.ts` (both deleted), no
`@supabase/*` package remains, and an ESLint rule makes re-adding one an error rather than a
convention. The dashboard and admin routes run on Neon.

What is *not* done is a separate thing, and it is tracked above: several features are fenced
to `503` because their queries were never ported, not because anything is broken.

Two live caveats worth knowing before you touch the database:

- **All migrations `001`–`035` are applied** as of a `--verify` run against production on
  2026-08-15, which also settled the long-running `021` dispute: it *did* run, its three
  `local_trust_*` tables exist, and `021`'s own "never been applied" header comment is the
  thing that was wrong. Run `npm run migrate -- --verify` against the target database before
  believing any of this — it reports which migrations' objects actually exist, and this line
  is only as fresh as its date.
- **RLS is enabled but inert.** The app connects as `neondb_owner`, which bypasses it, and the
  leftover policies call a Supabase function that no longer exists. Every query must filter by
  `account_id` explicitly — there is no backstop.

Read [`CLAUDE.md`](./CLAUDE.md) before writing code. It is the real architecture document.

## Prerequisites

- **Node 24.x** (enforced by `engines` in `package.json`)
- npm
- Access to the Neon project (`DATABASE_URL`)

## Setup

```bash
npm install
touch .env.local   # then fill in the variables below
npm run dev        # http://localhost:3000
```

**`.env.example` is the authoritative list** — copy it to `.env.local` and fill it in. Each
entry there says what breaks when it is missing. The highlights:

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Neon connection string |
| `NEON_AUTH_BASE_URL` | Neon Auth issuer (runtime) |
| `NEON_AUTH_COOKIE_SECRET` | ≥32 chars, required at **build** time — `next build` fails without it |
| `PUBLIC_SCAN_RATE_LIMIT_SECRET` | ≥32 chars. **Unset in production, every anonymous scan returns 503** — no local fallback is used there |
| `REPORT_SHARE_SECRET` | ≥32 chars. Signs report share links **and** the scan-claim cookie |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | without the webhook secret every Stripe event 400s and no subscription provisions |
| `STRIPE_PRICE_BASIC` / `STRIPE_PRICE_PRO` / `STRIPE_PRICE_ENTERPRISE` | checkout guards these and 500s per plan; the **webhook** does not, so tiers resolve wrongly |
| `OPENROUTER_API_KEY` | LLM calls (`lib/openrouter.ts`) |
| `NEXT_PUBLIC_APP_URL` | public origin; falls back to `https://aeo.fimmick.com` (`lib/app-origin.ts`) |
| `N8N_SCAN_WEBHOOK_URL` | n8n scan automation; unset = feature off |

Optional (have fallbacks): `RESEND_FROM_EMAIL`, `WIKIPEDIA_USER_AGENT`.
E2E only: `BASE_URL`, `START_DEV_SERVER`, `PLAYWRIGHT_TEST_EMAIL`, `PLAYWRIGHT_TEST_PASSWORD`.

`CRON_SECRET` (≥16 chars) authenticates the weekly Pulse chain: the Cloudflare Worker
(`cloudflare/cron-worker/`, not Vercel Cron) calls `GET /api/cron/pulse` with
`Authorization: Bearer`, and that driver calls `POST /api/pulse/run` with `x-cron-secret`.
Both return 500 rather than running when it is unset. `/api/cron/trial-emails` is restored
(2026-08-22) and validates the same `Authorization: Bearer` shape; `/api/cron/evaluate-alerts`
is Neon-backed and scheduled weekly, accepting both header shapes on its own handlers.

Dead — read by nothing, listed so nobody re-adds them expecting an effect:
`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (checkout is server-side only). `RESEND_API_KEY`
is used by the Neon alert evaluator. The legacy `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — the Neon migration is complete
and no application code reads them.

## Commands

```bash
npm run dev         # dev server on localhost:3000
npm run build       # production build
npm run start       # serve the production build
npm run lint        # ESLint
npm run test        # unit + integration (see below)
npm run test:unit   # unit only
npm run test:integration  # integration only — always requires neonctl
npm run test:watch  # Vitest watch mode
npm run e2e         # Playwright E2E (needs a dev server, or START_DEV_SERVER=1)
```

`npm run e2e:ui` and `npm run e2e:report` are also available. There is **no CI** — run
`build`, `lint`, and `test` locally before opening a PR.

### Integration tests need `neonctl`

The integration suite provisions a real, disposable Neon branch per run, so it needs
`neonctl` on PATH and authenticated (`npm i -g neonctl && neonctl auth`, or `NEON_API_KEY`).

Without it, `npm run test` runs the unit suite and **skips** integration, printing a banner
that says so — twice, the second time after the run, so it cannot scroll out of view. A skip
is not a pass. Two cases never skip:

- naming an integration test explicitly (`npm run test __tests__/integration/x.test.ts`), and
- `REQUIRE_INTEGRATION_TESTS=1 npm run test` — **this is the command that proves the full
  suite ran**, and the one to use before merging anything with integration coverage.

`SKIP_INTEGRATION_TESTS=1` opts out deliberately, with the same loud banner.

Database migrations live in `supabase/migrations/` (the directory name is legacy — they are
applied against Neon). Apply them with `npm run migrate` (`scripts/migrate.ts`), which tracks
what has run in a `schema_migrations` ledger; `--dry-run` previews.

## Further reading

- [`CLAUDE.md`](./CLAUDE.md) — architecture, auth model, checks engine, DB notes, gotchas
- [`docs/`](./docs) — historical plans and specs

## Public scan deployment prerequisites

Production anonymous scans are supported only on Vercel, where the platform overwrites
`x-vercel-forwarded-for` and exposes the `VERCEL=1` system environment invariant.
The endpoint fails closed when either invariant is missing.

Before releasing public scans:

- Apply `supabase/migrations/023_public_scan_rate_limits.sql` to the production database.
- Apply `supabase/migrations/024_stripe_lifecycle_integrity.sql` before enabling Stripe webhooks.
- Apply `supabase/migrations/025_authenticated_scan_quotas.sql` before releasing authenticated scans.
  The server-only `DATABASE_URL` role must be able to insert, update, select, and delete rows in
  `authenticated_scan_monthly_usage`; authenticated scans fail closed if the counter is unavailable.
- Apply `supabase/migrations/026_effective_brand_limit.sql` before releasing self-service brand creation.
  It replaces the legacy raw-plan trigger with serialized, effective-entitlement enforcement.
- **Apply `supabase/migrations/028_account_plan_overrides.sql` BEFORE deploying the code that
  expects it — not before first using admin plan comps.** `getProfile()` in `lib/auth.ts`
  selects `override_plan` and `override_expires_at` on every authenticated request, and the
  Neon driver throws on a missing column. Deploying the code against a pre-028 schema returns
  500 for every signed-in request (dashboard, admin, pulse, reports, authenticated scans)
  while anonymous traffic keeps working — so the public funnel smoke-tests green while every
  logged-in customer is down. The migration is additive (`add column if not exists`) and its
  only destructive statement drops the orphaned `plan_features` table, so migration-first is
  always the safe order. Apply it before, or atomically with, the deploy.
  It adds the override columns and replaces `check_brand_limit()` so a comp is honoured by
  the database as well as the application.
- Configure the server-only `PUBLIC_SCAN_RATE_LIMIT_SECRET` with at least 32 random characters.
  Do not expose it through a `NEXT_PUBLIC_` variable or commit its value.

Local development and tests use a single explicitly isolated identity and development-only
HMAC key. They ignore forwarding headers and do not claim production proxy security.
