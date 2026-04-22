# Fimmick AEO Lite + AI Pulse — Design Spec

**Date:** 2026-04-22  
**Status:** Approved  
**Project:** `/Users/willylai/Documents/Claude/Projects/AEO`

---

## Context

Fimmick wants a public-facing AEO (Answer Engine Optimization) tool that checks websites for AI search visibility and generates fix code automatically. Phase 2 adds a recurring Brand Mention Tracker ("AI Pulse") that monitors how often client brands appear in AI platform responses, with a shareable dashboard.

The tool serves two purposes: (1) lead generation / brand awareness for Fimmick, and (2) a billable SaaS product for clients at US$99–199/month.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router) |
| Hosting | Vercel (new project) |
| Database | Supabase (`ggudkqnxglvydplqmcbh`) |
| LLM Gateway | OpenRouter API |
| Automation | n8n (self-hosted, already running) |
| Charts | Recharts (Phase 2) |
| Styling | Tailwind CSS |
| i18n | next-intl (EN + ZH-HK) |

**No Vercel KV** — Supabase is used for all persistence (scans, fix packs, pulse data).

---

## Visual Design

- **Style:** Clean Professional — white/light background, `#2563eb` blue primary
- **Language toggle:** EN / 中文 in nav, persisted via cookie
- **Font:** System sans-serif (Inter via Tailwind)
- **No auth system** — Phase 2 dashboards accessed via UUID URL

---

## Project Structure

```
fimmick-aeo/
├── app/
│   ├── [lang]/
│   │   ├── page.tsx                        # Home — URL input
│   │   ├── result/[id]/page.tsx            # Scan results + Fix Pack
│   │   └── pulse/[clientId]/page.tsx       # Phase 2 dashboard
│   └── api/
│       ├── scan/route.ts                   # 5 checks → Supabase
│       ├── fix/route.ts                    # OpenRouter → Fix Pack
│       ├── pulse/onboard/route.ts          # Generate 50 prompts
│       └── pulse/[clientId]/summary/route.ts
├── lib/
│   ├── checks/
│   │   ├── robots.ts
│   │   ├── llmsTxt.ts
│   │   ├── botAccess.ts
│   │   ├── structuredData.ts
│   │   └── extractability.ts
│   ├── openrouter.ts                       # Unified LLM gateway
│   ├── supabase.ts                         # Single DB client
│   └── types.ts
├── components/
│   ├── ScoreRing.tsx
│   ├── CheckItem.tsx
│   ├── FixPackBlock.tsx
│   └── pulse/
│       ├── SovChart.tsx
│       ├── PlatformBar.tsx
│       └── MissedTable.tsx
├── messages/
│   ├── en.json
│   └── zh-HK.json
└── middleware.ts                           # next-intl locale routing
```

---

## Phase 1 — AEO Lite Check Tool

### Home Page `/[lang]`

- Large headline with EN/ZH copy
- Single URL input with "Scan →" button
- Trust bar: GPTBot · ClaudeBot · PerplexityBot
- On submit: POST `/api/scan` → redirect to `/[lang]/result/[id]`

### Scan API `POST /api/scan`

Runs 5 checks in parallel via `Promise.allSettled`:

| Check | What it tests |
|---|---|
| C1 `robots.ts` | AI bot rules in robots.txt |
| C2 `llmsTxt.ts` | llms.txt exists at root |
| C3 `botAccess.ts` | GPTBot / ClaudeBot / PerplexityBot can fetch homepage |
| C4 `structuredData.ts` | Any JSON-LD schema in HTML |
| C5 `extractability.ts` | Raw HTML has meaningful text content |

**Score:** `pass=100, warn=50, fail=0` — weighted average (C3=30%, others=17.5%)

Saves to `scans` table, returns `{ id, score, results }`.

### Result Page `/[lang]/result/[id]`

- Score ring (numeric, colour-coded: ≥80 green, 50–79 amber, <50 red)
- 5 check rows: ✅ Pass / ⚠️ Warn / ❌ Fail + one-line explanation (bilingual)
- "Generate Fix Pack" button → POST `/api/fix`
- Fix Pack section (revealed after generation):
  - `llms.txt` — copy button
  - `robots.txt patch` — copy button
  - `FAQ JSON-LD` — copy button

### Fix API `POST /api/fix`

- Receives `scanId`
- Checks `fix_packs` for existing row with this `scan_id` — if found, return cached result (idempotent)
- Otherwise: fetches scan from Supabase, calls OpenRouter (`anthropic/claude-haiku-4-5`, max 2000 tokens)
- Prompt: domain + meta description + issue list → JSON with `llms_txt`, `robots_patch`, `faq_schema`
- Saves to `fix_packs` table, returns the three strings

### Out of scope for Phase 1

- Email capture / PDF report (post-launch)
- Authentication

---

## Phase 2 — AI Pulse Brand Mention Tracker

### Onboarding `POST /api/pulse/onboard`

- Input: `{ brandName, industry, competitors[] }`
- Calls OpenRouter (Claude Haiku) to generate 50 prompts across 4 categories
- Saves new `client` + `prompt_bank` rows to Supabase
- Returns `clientId` (UUID) — Fimmick shares `/pulse/[clientId]` URL with client

### n8n Weekly Workflow (self-hosted)

Schedule: **Monday 08:00 HKT**

1. Supabase node → fetch active clients + their prompts
2. Split in batches per client
3. HTTP Request × 5 in parallel (all via OpenRouter, only model param changes):
   - `perplexity/sonar`
   - `perplexity/sonar-pro`
   - `openai/gpt-4o`
   - `anthropic/claude-haiku-4-5`
   - `google/gemini-flash-2.0`
4. HTTP Request → Claude Haiku analysis per answer (brand mentioned? sentiment? position?)
5. Supabase node → write `pulse_metrics` rows
6. Supabase node → compute + write `pulse_weekly_summary`
7. Gmail/Slack node → send weekly report

### Dashboard `/[lang]/pulse/[clientId]`

- **No auth** — UUID in URL is the access token
- KPI cards: Share of Voice %, Brand Mentions count, Avg Sentiment
- SoV trend line (Recharts `LineChart`, 8 weeks)
- Platform breakdown bar chart (Recharts `BarChart`)
- Missed Opportunities table: queries where brand not mentioned, sorted by frequency

### APIs

- `GET /api/pulse/[clientId]/summary` — weekly summary rows for charts
- `GET /api/pulse/[clientId]/missed` — unmentioned prompt patterns

---

## Supabase Schema

### Phase 1

```sql
create table scans (
  id uuid primary key default gen_random_uuid(),
  url text not null,
  domain text not null,
  score numeric(5,2),
  results jsonb not null,
  created_at timestamptz default now()
);

create table fix_packs (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid references scans(id) on delete cascade,
  llms_txt text,
  robots_patch text,
  faq_schema text,
  created_at timestamptz default now()
);
```

### Phase 2

```sql
create table clients (
  id uuid primary key default gen_random_uuid(),
  brand_name text not null,
  industry text,
  competitors text[],
  status text default 'active',
  created_at timestamptz default now()
);

create table prompt_bank (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  category text, -- brand_query / category_query / intent_query / pain_point
  question text not null,
  language text default 'zh-HK',
  is_active boolean default true,
  created_at timestamptz default now()
);

create table pulse_metrics (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id),
  prompt_id uuid references prompt_bank(id),
  platform text not null,
  question text not null,
  raw_answer text,
  brand_mentioned boolean,
  sentiment text, -- positive / neutral / negative / not_mentioned
  mention_position int,
  competitors_mentioned text[],
  scan_week date not null,
  created_at timestamptz default now()
);

create table pulse_weekly_summary (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id),
  scan_week date not null,
  platform text,
  total_queries int,
  brand_mentions int,
  sov_score numeric(5,2),
  avg_sentiment_score numeric(3,2),
  top_competitors jsonb,
  created_at timestamptz default now()
);
```

---

## Environment Variables

```bash
# Required
OPENROUTER_API_KEY=sk-or-...
NEXT_PUBLIC_SUPABASE_URL=https://ggudkqnxglvydplqmcbh.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

# Optional (post-launch)
RESEND_API_KEY=...
```

---

## OpenRouter Model Usage

| Use | Model ID | Est. cost/call |
|---|---|---|
| Fix Pack generation | `anthropic/claude-haiku-4-5` | ~US$0.003 |
| Prompt bank generation | `anthropic/claude-haiku-4-5` | ~US$0.005 |
| Pulse analysis | `anthropic/claude-haiku-4-5` | ~US$0.001 |
| Pulse queries | `perplexity/sonar`, `openai/gpt-4o`, etc. | ~US$6–8/client/month |

All calls use:
```
POST https://openrouter.ai/api/v1/chat/completions
Authorization: Bearer $OPENROUTER_API_KEY
HTTP-Referer: https://aeo.fimmick.com
X-Title: Fimmick AEO
```

---

## Verification Plan

1. **Phase 1 local test:** Run `next dev`, submit a real URL (e.g. fimmick.com), confirm 5 check results appear, click Fix Pack, confirm 3 code blocks generated
2. **Bilingual:** Toggle EN↔中文, confirm all UI copy switches
3. **Supabase:** Check `scans` and `fix_packs` tables populated after a scan
4. **Phase 2 onboard:** POST `/api/pulse/onboard` with Fimmick as test client, confirm 50 prompts in `prompt_bank`
5. **n8n pilot:** Trigger workflow manually, confirm `pulse_metrics` rows written and dashboard shows data
6. **Deploy:** Push to Vercel, confirm production URL works end-to-end
