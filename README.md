# Fimmick AISO

Multi-tenant SaaS that scores websites on **AEO / GEO** — how well AI answer engines
(ChatGPT, Perplexity, Google AI Overviews, …) can crawl, parse, and cite them.
Live at [aiso-kappa.vercel.app](https://aiso-kappa.vercel.app).

- **Scan** — 20 checks across three buckets (Core 45 pts, Extended 30 pts, GEO 25 pts)
  produce a 0–100 score and a letter grade (`A+` → `F`). Entry point: `POST /api/scan`.
- **Fix packs** — AI-generated, prioritised remediation for the failing checks, via
  OpenRouter (`app/api/fix/`).
- **Local Trust** — trust/ROI scoring per brand, with a CSV export
  (`app/api/dashboard/clients/[clientId]/local-trust/`, `lib/localTrust/`).
- **Pulse** — weekly monitoring of how often a brand is surfaced by LLM platforms
  (`app/api/pulse/`, `lib/pulse/`). The producer route `/api/cron/pulse` drives
  `POST /api/pulse/run` across configured platforms, and the dashboard's Monitor step
  renders the results. Scheduling is via `cloudflare/cron-worker/`, not Vercel Cron (see
  `docs/runbooks/deploy-cron-worker.md`).
- Bilingual **en / zh-HK** (`next-intl`), billed through **Stripe**, deployed on **Vercel**.

Stack: Next.js 16 (App Router) · TypeScript 5.9 · Neon Postgres + Neon Auth · Tailwind v4 ·
shadcn/ui · Vitest · Playwright.

Read [`CLAUDE.md`](./CLAUDE.md) before writing code. It is the real architecture document.
Current project state (migrations, fences, scheduler) is in
[`docs/project-status.md`](./docs/project-status.md).

## Prerequisites

- **Node 24.x** (enforced by `engines` in `package.json`)
- npm
- Access to the Neon project (`DATABASE_URL`)

## Setup

```bash
npm install
cp .env.example .env.local   # then fill it in
npm run dev                  # http://localhost:3000
```

**`.env.example` is the authoritative list.** Each entry there says what breaks when it is
missing. The highlights:

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Neon connection string |
| `NEON_AUTH_BASE_URL` | Neon Auth issuer (runtime) |
| `NEON_AUTH_COOKIE_SECRET` | ≥32 chars. Required when Neon Auth is used at runtime; auth is initialized lazily, so a successful build does not prove it is configured |
| `PUBLIC_SCAN_RATE_LIMIT_SECRET` | ≥32 chars. **Unset in production, every anonymous scan returns 503** — no local fallback is used there |
| `REPORT_SHARE_SECRET` | ≥32 chars. Signs report share links **and** the scan-claim cookie |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | without the webhook secret every Stripe event 400s and no subscription provisions |
| `STRIPE_PRICE_BASIC` / `STRIPE_PRICE_PRO` / `STRIPE_PRICE_ENTERPRISE` | checkout guards these and 500s per plan; the **webhook** does not, so tiers resolve wrongly |
| `OPENROUTER_API_KEY` | LLM calls (`lib/openrouter.ts`) |
| `NEXT_PUBLIC_APP_URL` | public origin; falls back to `https://aiso-kappa.vercel.app` (`lib/app-origin.ts`) |
| `N8N_SCAN_WEBHOOK_URL` | n8n scan automation; unset = feature off |

Optional (have fallbacks): `RESEND_FROM_EMAIL`, `WIKIPEDIA_USER_AGENT`. More detail, including
cron secrets, E2E variables and dead variables:
[`docs/configuration.md`](./docs/configuration.md).

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

`npm run e2e:ui` and `npm run e2e:report` are also available. CI is
`.github/workflows/pr-gate.yml` — a deterministic merge gate on every PR, running four jobs
(`static`, `unit-contract`, `e2e-accessibility`, `build`) that a final `pr-gate` job aggregates,
plus a separate `cloudflare-worker` job. Still run `build`, `lint`, and `test` locally first;
the gate is the backstop, not the first signal.

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
- [`docs/project-status.md`](./docs/project-status.md) — migration state, feature fences, scheduler
- [`docs/configuration.md`](./docs/configuration.md) — environment variable details
- [`docs/runbooks/public-scan-prerequisites.md`](./docs/runbooks/public-scan-prerequisites.md) —
  migrations and secrets to apply before releasing public or authenticated scans
- [`docs/runbooks/runtime-readiness.md`](./docs/runbooks/runtime-readiness.md) — the manual
  runtime readiness probe
- [`docs/runbooks/schema-equivalence.md`](./docs/runbooks/schema-equivalence.md) — the
  schema-equivalence rehearsal
- [`docs/runbooks/`](./docs/runbooks) — deploy, rotate, roll out and verify procedures
- [`docs/ux/`](./docs/ux) — the UX rebuild, phase by phase, with evidence
- [`docs/`](./docs) — everything else: ADRs, plans, contracts, audits
