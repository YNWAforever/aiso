# Fimmick AEO — Project Instructions

> **CRITICAL**: This project uses **Next.js 16** (App Router). APIs, file conventions, and caching behaviour may differ from your training data. Before writing any Next.js code, read the relevant guide in `node_modules/next/dist/docs/`. Heed deprecation notices.

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Language | TypeScript | 5.9 |
| Framework | Next.js (App Router) | 16.x |
| i18n | next-intl | 4.x |
| Database | Supabase (PostgreSQL) | @supabase/ssr 0.10 |
| Auth | Supabase Auth | via `lib/auth.ts` |
| Payments | Stripe | v22 |
| Email | Resend | v6 |
| AI / LLM | OpenRouter | `lib/openrouter.ts` |
| Styling | Tailwind CSS | v4 |
| UI primitives | Radix UI + shadcn/ui | `components/ui/` |
| Charts | Recharts | v3 |
| Testing | Vitest | v4 |
| Node | 22.x | required |

## Build & Run

```bash
npm run dev        # start dev server (localhost:3000)
npm run build      # production build
npm run start      # serve production build
npm run lint       # ESLint
npm run test       # Vitest (single run)
npm run test:watch # Vitest watch mode
```

## Project Structure

```
app/
  [lang]/          # i18n-prefixed public pages (en / zh-HK)
    auth/          # login, OAuth callback
    dashboard/[clientId]/  # authenticated client dashboard
    pricing/       # Stripe-gated pricing page
    pulse/[clientId]/      # AI visibility pulse report
    result/[id]/   # public scan result page
  api/             # Next.js route handlers (REST)
    scan/          # POST /api/scan — main AEO scan engine
    fix/           # AI fix-pack generation
    stripe/        # checkout, portal, webhook
    pulse/         # Pulse weekly AI monitoring
    clients/       # Client CRUD + agent sub-routes
    dashboard/     # Dashboard data API
    authority/     # Domain authority scoring
    cron/          # Cron job triggers
  admin/           # Internal admin pages (no lang prefix)
components/        # React UI components
  ui/              # shadcn/ui base components
  dashboard/       # Dashboard-specific components
  pulse/           # Pulse report components
  auth/            # Auth forms
lib/
  checks/          # 20 individual AEO check modules (c1–c20)
  authority/       # 5-layer domain authority engine
  auth.ts          # getProfile() — reads Supabase session server-side
  supabase.ts      # Browser Supabase client
  supabase-server.ts  # Server-side Supabase client (SSR cookies)
  tier.ts          # getPlanFeatures() — plan feature flags
  types.ts         # All shared TypeScript types
  openrouter.ts    # LLM calls via OpenRouter
i18n/              # next-intl routing + request config
messages/          # en.json / zh-HK.json translation strings
supabase/
  migrations/      # Numbered SQL migrations (001–014)
__tests__/         # Vitest tests mirroring lib/app structure
scripts/           # Utility scripts (seed, pulse runner)
n8n/               # n8n automation workflow exports
```

## Code Style

- Files: kebab-case for routes, PascalCase for React components
- Imports: use `@/` alias for project root (configured in `tsconfig.json` and `vitest.config.ts`)
- Server vs Client: use `supabase-server.ts` in Server Components / route handlers; `supabase.ts` in Client Components
- Auth pattern: call `getProfile()` from `lib/auth.ts` — returns `null` for unauthenticated requests (don't throw)
- Tier/feature gates: use `getPlanFeatures(plan)` from `lib/tier.ts` before exposing paid features
- Error handling: use `try/catch` with graceful fallbacks — checks must never throw; degrade to `{ status: 'fail', message: 'check_error' }`

## Checks Architecture (core domain logic)

The AEO scan engine runs 20 checks split into three buckets:

| Bucket | Checks | Max pts |
|--------|--------|---------|
| Core | c1–c5 | 45 |
| Extended | c6–c16 | 30 |
| GEO | c17–c20 | 25 |

Each check in `lib/checks/` exports a function that returns `CheckResult` (`{ status, message, details? }`). All checks run in parallel via `Promise.allSettled`. Scoring logic lives in `app/api/scan/route.ts`.

## Database (Supabase)

- Migrations in `supabase/migrations/` — numbered `001_` onward
- Schema evolves across phases; some columns may be absent in older DBs — always write resilient inserts
- Key tables: `scans`, `clients`, `accounts`, `profiles`, `pulse_weekly_summaries`, `pulse_metrics`, `notifications`, `prompts`
- RLS is enabled — use the server client for admin operations

## Testing

- Framework: **Vitest** with `globals: true`, `environment: node`
- Test files: `__tests__/**/*.test.ts` mirroring the source path
- Run: `npm test`
- Tests mock Supabase and fetch — do not hit the real DB in tests
- Coverage: `@vitest/coverage-v8` available

## i18n

- Locales: `en` (default), `zh-HK`
- All user-facing pages live under `app/[lang]/`
- Translation strings in `messages/en.json` and `messages/zh-HK.json`
- Use `next-intl` hooks (`useTranslations`, `getTranslations`) — never hardcode UI strings

## Environment Variables

Required (see `.env.example` if present):
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `RESEND_API_KEY`
- `OPENROUTER_API_KEY`

## Git Conventions

- Branch naming: `feat/`, `fix/`, `phase*`, `claude/` prefixes (observed in repo)
- Commits: lowercase imperative (`feat(scope): description`, `fix(scope): ...`)
- Main branch: `main`
