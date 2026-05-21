# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev          # start dev server (Next.js, port 3000)
npm run build        # production build
npm run lint         # ESLint
npm run test         # run all tests once (Vitest)
npm run test:watch   # Vitest in watch mode

# Run a single test file
npx vitest run __tests__/checks/robots.test.ts

# Run tests matching a pattern
npx vitest run --reporter=verbose checks
```

Required env vars (see `.env.local`):
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`
- `OPENROUTER_API_KEY`
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`
- `RESEND_API_KEY`
- `CRON_SECRET` (authorises `/api/pulse/run` and `/api/cron/evaluate-alerts`)

## Architecture

### What this is
Fimmick AISO is an AI Search Optimization (AEO) SaaS. It audits websites for readability by LLM-based search engines, tracking a 100-point score across 20 checks. Paying users get a multi-brand dashboard, weekly AI share-of-voice tracking ("Pulse"), AI-generated fix packs, and agent-powered recommendations.

### Routing — all pages are under `[lang]`
Every user-facing page lives at `app/[lang]/...` where `lang` is `en` or `zh-HK`. `next.config.ts` adds permanent redirects from legacy bare paths (`/pricing` → `/en/pricing`). The `app/layout.tsx` root is minimal; `app/[lang]/layout.tsx` wraps everything in `NextIntlClientProvider`. Translations live in `messages/en.json` and `messages/zh-HK.json`; the routing config is in `i18n/routing.ts`.

### Scoring engine — `app/api/scan/route.ts`
The POST handler is the core of the product. It:
1. Fetches the target page HTML once, then fans out 16 checks in parallel via `Promise.allSettled`.
2. Scores Core (c1–c5, 45 pts) + Extended (c6–c16, 30 pts) synchronously.
3. Runs 4 GEO checks (c17–c20, 25 pts) in a second `Promise.allSettled`, fetching sitemap URLs for c19 if not provided.
4. Persists to `scans` table, fires an n8n webhook (SSRF-validated) when triggered from the dashboard.

Check weights: pass = full pts, warn = 50%, fail = 0. Grades: A+ ≥90, A ≥80, B ≥70, C ≥60, D ≥50, F <50.

All 20 individual check modules are in `lib/checks/`. Each exports a single async function returning `CheckResult` (`{ status, message, details? }`). Tests for checks mirror this structure in `__tests__/checks/`.

### Authority Engine — `lib/authority/`
A 5-layer scoring system (`layer1-tld` → `layer5-dynamic`) aggregated in `aggregator.ts`. Used by c17 (Citation Density) to score external links. Results are in-process cached via `lib/authority/cache.ts`.

- L1 TLD heuristics, L2 async domain signals (Wikipedia, Tranco), L3/L4 sync industry/regional pack lookups, L5 optional dynamic boost from real citation frequency.
- When L5 is absent the weights shift (L1/L2/L3/L4 split 0.20/0.35/0.30/0.15).

### Supabase — two client patterns
| File | Used by | Auth method |
|------|---------|-------------|
| `lib/supabase.ts` | API route handlers | Service role key (lazy singleton, bypasses RLS) |
| `lib/supabase-server.ts` | Server Components | SSR cookie client (respects RLS) |

`lib/auth.ts` exports `getProfile()` / `requireAuth()` / `requireAdmin()` — all use the SSR client. Always use `requireAuth` at the top of authenticated Server Components.

### Plan tiers — `lib/tier.ts`
`getPlanFeatures(plan)` returns a `PlanFeatures` object (platform access, feature flags, limits). Plans: `basic`, `pro`, `enterprise`. The source of truth is the hardcoded `FEATURES` map in this file and the `plan_features` Supabase table (migration 014).

### Dashboard flow — `app/[lang]/dashboard/[clientId]/page.tsx`
A single Server Component renders one of four "steps" based on `?step=` query param:
- `scan` → `ScanStep`
- `results` → `ResultsStep`
- `improve` → `ImproveStep` (agent recommendations/progress/competitors)
- `monitor` → `MonitorStep` (Pulse share-of-voice)

All Supabase fetches for the page run in parallel at the top of the component.

### Pulse — `app/api/pulse/`
Weekly share-of-voice tracking. `POST /api/pulse/run` (cron-protected) iterates a client's active prompts, calls all AI platforms via `callMultiPlatform` in `lib/openrouter.ts`, records results to `pulse_metrics`, and logs citations to `ai_citation_log`. `POST /api/pulse/onboard` seeds the prompt bank for a new client.

### Fix Packs — `app/api/fix/`
`POST /api/fix` calls Claude Haiku (via OpenRouter) to generate `llms_txt`, `robots_patch`, and `faq_schema` for a scan. Results are cached in the `fix_packs` table. Sub-routes `/cluster-map`, `/content-brief`, `/rewrite-chunks` handle individual GEO fix outputs.

### AI platform calls — `lib/openrouter.ts`
`callOpenRouter` is the single-platform primitive. `callMultiPlatform` fans out to all 5 platforms (Perplexity Sonar, Perplexity Sonar Pro, GPT-4o, Claude Haiku, Gemini Flash) in parallel, silently dropping failures.

### Database migrations
Sequential SQL files in `supabase/migrations/`. The latest (014) adds `plan_features` table and `agent_platforms` column to `scans`. Run via Supabase CLI (`supabase db push`) or the Supabase MCP tools.

### Types
All shared TypeScript types are in `lib/types.ts`. The file is the authoritative reference for `ScanResults` (c1–c16), `ScanResultsV3` (c17–c20 GEO), `Client`, `Account`, `Profile`, `PulseMetric`, `PulseWeeklySummary`, `AgentRecommendation`, and `PlanFeatures`.
