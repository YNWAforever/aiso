# Agent-Powered Client Dashboard — Design Spec

## Overview

Unify scan results, agent-driven recommendations, progress tracking, and competitor intelligence into the client dashboard's Overview tab. The scan engine stays unchanged; the dashboard gains richer context, automatic agent analysis triggers, and structured agent result display.

**Workflow:** Scan-first — client scans → sees full 20-check results inline → agent analysis fires automatically → dashboard shows recommendations, progress, and competitor gaps.

---

## Data Model

### New Tables

**`agent_recommendations`** — per-platform, per-check fix suggestions from AI agents:

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK, default gen_random_uuid() |
| `scan_id` | uuid | FK → scans.id, NOT NULL |
| `platform` | text | e.g. 'openai/gpt-4o' |
| `category` | text | e.g. 'structured_data', 'citation', 'freshness' |
| `priority` | text | 'high', 'medium', 'low' |
| `recommendation` | text | Actionable fix description |
| `impact_score` | smallint | 1-10 estimated ranking impact |
| `created_at` | timestamptz | default now() |

Unique on `(scan_id, platform, category)` — upsert replaces on conflict.

**`agent_progress`** — before/after metric snapshots per scan:

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `scan_id` | uuid | FK → scans.id |
| `platform` | text | |
| `metric` | text | e.g. 'sov', 'citation_count', 'authority_score' |
| `current_value` | numeric | |
| `previous_value` | numeric | Nullable — null on first scan |
| `delta` | numeric | Computed: current - previous |
| `created_at` | timestamptz | |

Unique on `(scan_id, platform, metric)`.

**`agent_competitors`** — per-platform competitor gap analysis:

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `scan_id` | uuid | FK → scans.id |
| `platform` | text | |
| `competitor_domain` | text | |
| `competitor_name` | text | Nullable |
| `mention_rate` | numeric | 0-100, competitor's rate |
| `your_rate` | numeric | 0-100, your brand's rate |
| `gap_analysis` | text | Agent-written explanation |
| `created_at` | timestamptz | |

Unique on `(scan_id, platform, competitor_domain)`.

### Modified Columns

- **`scans`**: Add `agent_status text DEFAULT NULL` — values: `'pending'` | `'running'` | `'complete'` | `'error'`
- **`clients`**: Add `webhook_url text DEFAULT NULL` — n8n webhook URL for agent trigger

---

## API Routes

### Agent Ingestion (called by n8n)

All secured by `x-cron-secret` header (same pattern as `/api/pulse/run`).

**`POST /api/clients/[clientId]/agents/recommendations`**
- Body: `{ scanId: string, recommendations: Array<{ platform, category, priority, recommendation, impactScore }> }`
- Upserts into `agent_recommendations` on conflict `(scan_id, platform, category)`
- Returns `{ count }`
- Updates `scans.agent_status = 'complete'` if all 3 categories received

**`POST /api/clients/[clientId]/agents/progress`**
- Body: `{ scanId: string, progress: Array<{ platform, metric, currentValue, previousValue?, delta? }> }`
- Upserts into `agent_progress` on conflict `(scan_id, platform, metric)`
- Updates `scans.agent_status = 'complete'` if all 3 categories received

**`POST /api/clients/[clientId]/agents/competitors`**
- Body: `{ scanId: string, competitors: Array<{ platform, competitorDomain, competitorName?, mentionRate, yourRate, gapAnalysis }> }`
- Upserts into `agent_competitors` on conflict `(scan_id, platform, competitor_domain)`
- Updates `scans.agent_status = 'complete'` if all 3 categories received

### Scan Trigger (modified)

**`POST /api/scan`** — after persisting scan:
- If `clientId` present: sets `scans.agent_status = 'pending'`, fires webhook to `clients.webhook_url` (non-blocking, 5s timeout, logs on failure)
- Webhook payload: `{ clientId, brandName, domain, industry, scanId, score, grade, results }`
- Returns scan response immediately — does not wait for agent

### Dashboard Read

**`GET /api/clients/[clientId]/overview`** — single server-side fetch returning:
- Latest scan (score, grade, agent_status, created_at)
- Scan history (last 10: id, domain, score, grade, created_at)
- Agent recommendations (latest scan, grouped by platform)
- Agent progress (latest scan, with deltas)
- Agent competitors (latest scan, sorted by mention_rate desc)
- Pulse summary (last 8 weeks SoV + latest KPI)
- Missed opportunities (last 10, brand_mentioned = false)

### Scan Claim (modified)

**`POST /api/scans/[id]/claim`** — after linking scan to account, also sets `agent_status = 'pending'` if the client has a webhook URL, then fires the agent trigger.

---

## Dashboard UI — Overview Tab

The Overview tab (`/[lang]/dashboard/[clientId]?tab=overview`) becomes a unified scrollable page.

### KPI Strip (3 cards, horizontal)

| Card | Content |
|------|---------|
| AISO Score | Latest scan score + grade badge (color-coded), "Last scan: X days ago" |
| Share of Voice | Current SoV % with week-over-week delta arrow |
| Agent Status | `pending` / `running` / `complete` with platform count |

### Latest Scan Summary (collapsible)

- Score ring + grade, scan domain + date
- Three expandable check groups mirroring the full result page:

| Group | Checks | Max Points |
|-------|--------|------------|
| Core | c1–c5 (robots, llms_txt, bot_access, structured_data, extractability) | 45 |
| Extended | c6–c16 (llms_full_txt, mcp_card, sitemap, meta_desc, headings, faq, canonical, render, internal_links, entity, freshness) | 30 |
| GEO | c17–c20 (citation_density, factual_density, topical_authority, chunkability) | 25 |

- Each group is an accordion (collapsed by default) showing all checks via `ExpandableCheckItem` — same pass/warn/fail icons, same "Why it matters" / "What we found" / "How to fix" detail panels
- Group headers show subtotal with color-coded progress bar
- "Run New Scan" button above the summary

### Agent Results (when `agent_status = 'complete'`)

Three side-by-side cards:

**Recommendations** — grouped by platform (tabbed or stacked):
- Sort by priority (high > medium > low), then impact_score
- Each shows: category icon, recommendation text, impact score badge

**Progress** — delta indicators per metric:
- Mini sparkline or delta badges: "+2.3 authority since last scan"
- Tracked metrics: authority_score, sov_score, citation_count

**Competitors** — top 3 competitors table:
- Domain, mention rate vs. your rate, gap analysis text
- Gap highlighted in red where competitor exceeds you

When `agent_status = 'pending'` or `'running'`: show processing state with platform icons pulsing.

### Pulse Section (compacted)

- Mini SoV trend sparkline (last 4 weeks)
- Top 3 missed opportunities with platform + question

### Empty State

No scans: "Run your first scan to see your AISO score and get agent recommendations" with CTA button.

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Agent never responds | `agent_status` stays `'pending'`. UI shows "In progress..." indefinitely. |
| Agent writes partial data | If <3 categories received, status stays `'running'`. UI renders available data with note. |
| Webhook unreachable | Scan succeeds. Logged. Agent analysis silently skipped. |
| Duplicate agent writes | UPSERT — latest write wins per unique key. |
| Public scan (no clientId) | No agent trigger. Public result page unchanged. |
| Client has no webhook_url | Agent trigger skipped silently. |
| Client changes webhook_url | Only affects future scans. |
| Rate limits | `x-cron-secret` header. Optional simple throttle in n8n. |

---

## Migration

One Supabase migration file adds:
- `agent_recommendations` table (with unique index on `scan_id, platform, category`)
- `agent_progress` table (with unique index on `scan_id, platform, metric`)
- `agent_competitors` table (with unique index on `scan_id, platform, competitor_domain`)
- `scans.agent_status` column (nullable text, default null)
- `clients.webhook_url` column (nullable text, default null)

No breaking changes to existing tables or data.

---

## Architecture

```
Dashboard (Overview tab)
    │
    ├── GET /api/clients/[clientId]/overview
    │       → scans + agent_recommendations + agent_progress
    │         + agent_competitors + pulse_weekly_summary + pulse_metrics
    │
    └── POST /api/scan (with clientId)
            → persists scan, sets agent_status = 'pending'
            → fires webhook to n8n
            │
            n8n workflow
            ├── agent 1 (GPT-4o)  ──┐
            ├── agent 2 (Claude)  ──┤
            ├── agent 3 (Gemini)  ──┤ each analyzes scan results
            └── agent 4 (Perplex) ──┘
                        │
                        ▼
            POST /api/clients/[clientId]/agents/*
                    (recommendations, progress, competitors)
                        │
                        ▼
            agent_status → 'complete'
```
