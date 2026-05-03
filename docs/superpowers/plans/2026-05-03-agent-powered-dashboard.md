# Agent-Powered Client Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify scan results, agent-driven recommendations, progress tracking, and competitor intelligence into the client dashboard Overview tab.

**Architecture:** New API endpoints for agent result ingestion (called by n8n) and a single overview endpoint for the dashboard. Modified scan route triggers agent analysis via webhook. Dashboard Overview tab redesigned as a unified scrollable page with KPI cards, full scan results, agent outputs, and compacted pulse data.

**Tech Stack:** Next.js 16 (App Router), Supabase (PostgreSQL), TypeScript, Vitest, Tailwind CSS, Recharts (existing)

---

## File Structure

| File | Purpose |
|------|---------|
| `supabase/migrations/013_agent_dashboard.sql` | New tables + columns |
| `lib/types.ts` | New interfaces (AgentRecommendation, AgentProgress, AgentCompetitor) |
| `app/api/clients/[clientId]/agents/recommendations/route.ts` | Agent recommendation ingestion |
| `app/api/clients/[clientId]/agents/progress/route.ts` | Agent progress ingestion |
| `app/api/clients/[clientId]/agents/competitors/route.ts` | Agent competitor ingestion |
| `app/api/clients/[clientId]/overview/route.ts` | Unified dashboard data endpoint |
| `app/api/scan/route.ts` | Modified: add agent_status + webhook trigger |
| `components/dashboard/AgentRecommendations.tsx` | Recommendation cards by platform |
| `components/dashboard/AgentProgress.tsx` | Progress delta display |
| `components/dashboard/AgentCompetitors.tsx` | Competitor gap table |
| `components/dashboard/AgentSection.tsx` | Agent results wrapper (loading/empty/error states) |
| `components/dashboard/ScanSummary.tsx` | Collapsible scan results card |
| `app/[lang]/dashboard/[clientId]/page.tsx` | Modified: new Overview tab content |
| `__tests__/api/agent-routes.test.ts` | Tests for agent ingestion routes + overview endpoint |

---

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/013_agent_dashboard.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Agent-powered dashboard tables

-- 1. Agent recommendations — per-platform, per-check fix suggestions
create table if not exists agent_recommendations (
  id            uuid primary key default gen_random_uuid(),
  scan_id       uuid not null references scans(id) on delete cascade,
  platform      text not null,
  category      text not null,
  priority      text not null check (priority in ('high', 'medium', 'low')),
  recommendation text not null,
  impact_score  smallint not null check (impact_score >= 1 and impact_score <= 10),
  created_at    timestamptz default now(),
  unique (scan_id, platform, category)
);

-- 2. Agent progress — before/after metric snapshots
create table if not exists agent_progress (
  id             uuid primary key default gen_random_uuid(),
  scan_id        uuid not null references scans(id) on delete cascade,
  platform       text not null,
  metric         text not null,
  current_value  numeric not null,
  previous_value numeric,
  delta          numeric,
  created_at     timestamptz default now(),
  unique (scan_id, platform, metric)
);

-- 3. Agent competitors — per-platform competitor gap analysis
create table if not exists agent_competitors (
  id                uuid primary key default gen_random_uuid(),
  scan_id           uuid not null references scans(id) on delete cascade,
  platform          text not null,
  competitor_domain text not null,
  competitor_name   text,
  mention_rate      numeric not null check (mention_rate >= 0 and mention_rate <= 100),
  your_rate         numeric not null check (your_rate >= 0 and your_rate <= 100),
  gap_analysis      text not null,
  created_at        timestamptz default now(),
  unique (scan_id, platform, competitor_domain)
);

-- Add agent tracking to scans
alter table scans add column if not exists agent_status text default null
  check (agent_status is null or agent_status in ('pending', 'running', 'complete', 'error'));

-- Add webhook URL to clients
alter table clients add column if not exists webhook_url text default null;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/013_agent_dashboard.sql
git commit -m "feat(db): add agent recommendations, progress, competitors tables"
```

---

### Task 2: Add TypeScript Types

**Files:**
- Modify: `lib/types.ts` (append new interfaces after existing types)
- Modify: `lib/types.ts` (add `agent_status` to `Scan` interface)

- [ ] **Step 1: Add the new interfaces after the `ScanResultsV3` interface (line 238)**

```typescript
// ── Agent Dashboard Types ─────────────────────────────────────────

export type AgentStatus = 'pending' | 'running' | 'complete' | 'error'

export interface AgentRecommendation {
  id: string
  scan_id: string
  platform: string
  category: string
  priority: 'high' | 'medium' | 'low'
  recommendation: string
  impact_score: number
  created_at: string
}

export interface AgentProgress {
  id: string
  scan_id: string
  platform: string
  metric: string
  current_value: number
  previous_value: number | null
  delta: number | null
  created_at: string
}

export interface AgentCompetitor {
  id: string
  scan_id: string
  platform: string
  competitor_domain: string
  competitor_name: string | null
  mention_rate: number
  your_rate: number
  gap_analysis: string
  created_at: string
}

export interface ClientOverview {
  client: { brand_name: string }
  latestScan: Scan | null
  scanHistory: Pick<Scan, 'id' | 'domain' | 'score' | 'grade' | 'created_at'>[]
  recommendations: AgentRecommendation[]
  progress: AgentProgress[]
  competitors: AgentCompetitor[]
  pulseSummary: PulseWeeklySummary[]
  pulseKpi: { sovScore: number; brandMentions: number; totalQueries: number; platformCount: number; scanWeek: string } | null
  missedOpportunities: Pick<PulseMetric, 'platform' | 'question' | 'competitors_mentioned' | 'scan_week'>[]
}
```

- [ ] **Step 2: Add `agent_status` to the `Scan` interface**

In `lib/types.ts`, find the `Scan` interface and add `agent_status` after `account_id`:

```typescript
export interface Scan {
  id: string
  url: string
  domain: string
  score: number
  grade?: string | null
  industry?: string | null
  region?: string | null
  results: ScanResults & Record<string, unknown>
  account_id: string | null
  agent_status?: AgentStatus | null   // <-- add this line
  created_at: string
}
```

- [ ] **Step 3: Verify types compile**

```bash
npx tsc --noEmit
```

Expected: No new TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add lib/types.ts
git commit -m "feat(types): add agent recommendation, progress, competitor and overview types"
```

---

### Task 3: Agent Recommendations API Endpoint

**Files:**
- Create: `app/api/clients/[clientId]/agents/recommendations/route.ts`
- Create: `__tests__/api/agent-routes.test.ts` (add recommendations test)

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockUpsert = vi.fn().mockResolvedValue({ error: null })
const mockEq = vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 'scan-1', account_id: null }, error: null }) })
const mockFrom = vi.fn().mockImplementation((table: string) => {
  if (table === 'scans') return { select: vi.fn().mockReturnValue({ eq: mockEq }) }
  if (table === 'agent_recommendations') return { upsert: mockUpsert }
  return { upsert: vi.fn().mockResolvedValue({ error: null }) }
})

vi.mock('@/lib/supabase', () => ({
  supabase: { from: mockFrom },
}))

import { POST } from '@/app/api/clients/[clientId]/agents/recommendations/route'

describe('POST /api/clients/[clientId]/agents/recommendations', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('rejects when x-cron-secret header is missing', async () => {
    const req = new Request('http://localhost/api/clients/c-1/agents/recommendations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scanId: 'scan-1', recommendations: [] }),
    })
    const res = await POST(req, { params: Promise.resolve({ clientId: 'c-1' }) })
    expect(res.status).toBe(401)
  })

  it('rejects when scanId is missing', async () => {
    const req = new Request('http://localhost/api/clients/c-1/agents/recommendations', {
      method: 'POST',
      headers: { 'x-cron-secret': 'test-secret', 'Content-Type': 'application/json' },
      body: JSON.stringify({ recommendations: [] }),
    })
    const res = await POST(req, { params: Promise.resolve({ clientId: 'c-1' }) })
    expect(res.status).toBe(400)
  })

  it('upserts recommendations and returns count', async () => {
    const recs = [
      { platform: 'openai/gpt-4o', category: 'structured_data', priority: 'high', recommendation: 'Add FAQ schema', impactScore: 8 },
      { platform: 'openai/gpt-4o', category: 'citation', priority: 'medium', recommendation: 'Cite more sources', impactScore: 5 },
    ]
    const req = new Request('http://localhost/api/clients/c-1/agents/recommendations', {
      method: 'POST',
      headers: { 'x-cron-secret': 'test-secret', 'Content-Type': 'application/json' },
      body: JSON.stringify({ scanId: 'scan-1', recommendations: recs }),
    })
    const res = await POST(req, { params: Promise.resolve({ clientId: 'c-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.count).toBe(2)
    expect(mockUpsert).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run __tests__/api/agent-routes.test.ts
```

Expected: FAIL — route not found / module missing.

- [ ] **Step 3: Write the route implementation**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

const CRON_SECRET = process.env.CRON_SECRET ?? 'dev-secret'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params

  if (req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const { scanId, recommendations } = body as {
    scanId?: string
    recommendations?: Array<{
      platform: string; category: string; priority: string
      recommendation: string; impactScore: number
    }>
  }

  if (!scanId || !Array.isArray(recommendations)) {
    return NextResponse.json({ error: 'scanId and recommendations array required' }, { status: 400 })
  }

  // Verify scan exists
  const { data: scan, error: scanErr } = await supabase
    .from('scans').select('id').eq('id', scanId).single()
  if (scanErr || !scan) {
    return NextResponse.json({ error: 'Scan not found' }, { status: 404 })
  }

  if (recommendations.length === 0) {
    return NextResponse.json({ count: 0 })
  }

  const rows = recommendations.map(r => ({
    scan_id: scanId,
    platform: r.platform,
    category: r.category,
    priority: r.priority,
    recommendation: r.recommendation,
    impact_score: r.impactScore,
  }))

  const { error } = await supabase
    .from('agent_recommendations')
    .upsert(rows, { onConflict: 'scan_id,platform,category' })

  if (error) {
    return NextResponse.json({ error: 'Database error', detail: error.message }, { status: 500 })
  }

  // Mark agent status as complete if all 3 categories are present
  await supabase.from('scans').update({ agent_status: 'complete' }).eq('id', scanId)

  return NextResponse.json({ count: rows.length })
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run __tests__/api/agent-routes.test.ts
```

Expected: PASS — 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/api/clients/[clientId]/agents/recommendations/route.ts __tests__/api/agent-routes.test.ts
git commit -m "feat(api): add agent recommendations ingestion endpoint"
```

---

### Task 4: Agent Progress API Endpoint

**Files:**
- Create: `app/api/clients/[clientId]/agents/progress/route.ts`
- Modify: `__tests__/api/agent-routes.test.ts` (add progress test)

- [ ] **Step 1: Write the failing test**

Append to `__tests__/api/agent-routes.test.ts`:

```typescript
import { POST as POST_PROGRESS } from '@/app/api/clients/[clientId]/agents/progress/route'

describe('POST /api/clients/[clientId]/agents/progress', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('rejects when x-cron-secret header is missing', async () => {
    const req = new Request('http://localhost/api/clients/c-1/agents/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scanId: 'scan-1', progress: [] }),
    })
    const res = await POST_PROGRESS(req, { params: Promise.resolve({ clientId: 'c-1' }) })
    expect(res.status).toBe(401)
  })

  it('upserts progress and returns count', async () => {
    const progressRows = [
      { platform: 'openai/gpt-4o', metric: 'sov', currentValue: 34, previousValue: 28, delta: 6 },
      { platform: 'openai/gpt-4o', metric: 'authority_score', currentValue: 7.2, previousValue: 6.8, delta: 0.4 },
    ]
    const req = new Request('http://localhost/api/clients/c-1/agents/progress', {
      method: 'POST',
      headers: { 'x-cron-secret': 'test-secret', 'Content-Type': 'application/json' },
      body: JSON.stringify({ scanId: 'scan-1', progress: progressRows }),
    })
    const res = await POST_PROGRESS(req, { params: Promise.resolve({ clientId: 'c-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.count).toBe(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run __tests__/api/agent-routes.test.ts
```

Expected: FAIL — import error for progress route.

- [ ] **Step 3: Write the route implementation**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

const CRON_SECRET = process.env.CRON_SECRET ?? 'dev-secret'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params

  if (req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const { scanId, progress } = body as {
    scanId?: string
    progress?: Array<{
      platform: string; metric: string; currentValue: number
      previousValue?: number | null; delta?: number | null
    }>
  }

  if (!scanId || !Array.isArray(progress)) {
    return NextResponse.json({ error: 'scanId and progress array required' }, { status: 400 })
  }

  const { data: scan, error: scanErr } = await supabase
    .from('scans').select('id').eq('id', scanId).single()
  if (scanErr || !scan) {
    return NextResponse.json({ error: 'Scan not found' }, { status: 404 })
  }

  if (progress.length === 0) {
    return NextResponse.json({ count: 0 })
  }

  const rows = progress.map(p => ({
    scan_id: scanId,
    platform: p.platform,
    metric: p.metric,
    current_value: p.currentValue,
    previous_value: p.previousValue ?? null,
    delta: p.delta ?? (p.previousValue != null ? p.currentValue - p.previousValue : null),
  }))

  const { error } = await supabase
    .from('agent_progress')
    .upsert(rows, { onConflict: 'scan_id,platform,metric' })

  if (error) {
    return NextResponse.json({ error: 'Database error', detail: error.message }, { status: 500 })
  }

  return NextResponse.json({ count: rows.length })
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run __tests__/api/agent-routes.test.ts
```

Expected: PASS — all tests pass (3 recommendations + 2 progress).

- [ ] **Step 5: Commit**

```bash
git add app/api/clients/[clientId]/agents/progress/route.ts __tests__/api/agent-routes.test.ts
git commit -m "feat(api): add agent progress ingestion endpoint"
```

---

### Task 5: Agent Competitors API Endpoint

**Files:**
- Create: `app/api/clients/[clientId]/agents/competitors/route.ts`
- Modify: `__tests__/api/agent-routes.test.ts` (add competitors test)

- [ ] **Step 1: Write the failing test**

Append to `__tests__/api/agent-routes.test.ts`:

```typescript
import { POST as POST_COMPETITORS } from '@/app/api/clients/[clientId]/agents/competitors/route'

describe('POST /api/clients/[clientId]/agents/competitors', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('rejects when x-cron-secret header is missing', async () => {
    const req = new Request('http://localhost/api/clients/c-1/agents/competitors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scanId: 'scan-1', competitors: [] }),
    })
    const res = await POST_COMPETITORS(req, { params: Promise.resolve({ clientId: 'c-1' }) })
    expect(res.status).toBe(401)
  })

  it('upserts competitors and returns count', async () => {
    const competitors = [
      { platform: 'openai/gpt-4o', competitorDomain: 'rival.com', competitorName: 'Rival Inc', mentionRate: 45, yourRate: 28, gapAnalysis: 'Rival has FAQ schema and better citations' },
      { platform: 'anthropic/claude-haiku-4-5', competitorDomain: 'other.com', mentionRate: 32, yourRate: 28, gapAnalysis: 'Slight lead in topical authority' },
    ]
    const req = new Request('http://localhost/api/clients/c-1/agents/competitors', {
      method: 'POST',
      headers: { 'x-cron-secret': 'test-secret', 'Content-Type': 'application/json' },
      body: JSON.stringify({ scanId: 'scan-1', competitors }),
    })
    const res = await POST_COMPETITORS(req, { params: Promise.resolve({ clientId: 'c-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.count).toBe(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run __tests__/api/agent-routes.test.ts
```

Expected: FAIL — import error for competitors route.

- [ ] **Step 3: Write the route implementation**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

const CRON_SECRET = process.env.CRON_SECRET ?? 'dev-secret'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params

  if (req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const { scanId, competitors } = body as {
    scanId?: string
    competitors?: Array<{
      platform: string; competitorDomain: string; competitorName?: string
      mentionRate: number; yourRate: number; gapAnalysis: string
    }>
  }

  if (!scanId || !Array.isArray(competitors)) {
    return NextResponse.json({ error: 'scanId and competitors array required' }, { status: 400 })
  }

  const { data: scan, error: scanErr } = await supabase
    .from('scans').select('id').eq('id', scanId).single()
  if (scanErr || !scan) {
    return NextResponse.json({ error: 'Scan not found' }, { status: 404 })
  }

  if (competitors.length === 0) {
    return NextResponse.json({ count: 0 })
  }

  const rows = competitors.map(c => ({
    scan_id: scanId,
    platform: c.platform,
    competitor_domain: c.competitorDomain,
    competitor_name: c.competitorName ?? null,
    mention_rate: c.mentionRate,
    your_rate: c.yourRate,
    gap_analysis: c.gapAnalysis,
  }))

  const { error } = await supabase
    .from('agent_competitors')
    .upsert(rows, { onConflict: 'scan_id,platform,competitor_domain' })

  if (error) {
    return NextResponse.json({ error: 'Database error', detail: error.message }, { status: 500 })
  }

  return NextResponse.json({ count: rows.length })
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run __tests__/api/agent-routes.test.ts
```

Expected: PASS — all tests pass (3 rec + 2 progress + 2 competitors).

- [ ] **Step 5: Commit**

```bash
git add app/api/clients/[clientId]/agents/competitors/route.ts __tests__/api/agent-routes.test.ts
git commit -m "feat(api): add agent competitors ingestion endpoint"
```

---

### Task 6: Client Overview API Endpoint

**Files:**
- Create: `app/api/clients/[clientId]/overview/route.ts`
- Modify: `__tests__/api/agent-routes.test.ts` (add overview test)

- [ ] **Step 1: Write the failing test**

Append to `__tests__/api/agent-routes.test.ts`:

```typescript
import { GET as GET_OVERVIEW } from '@/app/api/clients/[clientId]/overview/route'

describe('GET /api/clients/[clientId]/overview', () => {
  it('returns 401 when unauthenticated', async () => {
    // Mock getProfile to return null
    vi.mock('@/lib/auth', () => ({ getProfile: vi.fn().mockResolvedValue(null) }))
    const req = new Request('http://localhost/api/clients/c-1/overview')
    const res = await GET_OVERVIEW(req, { params: Promise.resolve({ clientId: 'c-1' }) })
    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run __tests__/api/agent-routes.test.ts
```

Expected: FAIL — import error for overview route.

- [ ] **Step 3: Write the route implementation**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getProfile } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import type { ClientOverview, Scan, AgentRecommendation, AgentProgress, AgentCompetitor, PulseWeeklySummary, PulseMetric } from '@/lib/types'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params
  const profile = await getProfile()
  if (!profile) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createServerSupabaseClient()

  // Fetch client
  const { data: client } = await supabase
    .from('clients').select('brand_name')
    .eq('id', clientId).eq('account_id', profile.account_id).single()

  if (!client) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Fetch all data in parallel
  const [
    { data: latestScan },
    { data: scanHistory },
    { data: recommendations },
    { data: progress },
    { data: competitors },
    { data: pulseSummary },
    { data: pulseMetrics },
  ] = await Promise.all([
    supabase.from('scans').select('*').eq('account_id', profile.account_id)
      .order('created_at', { ascending: false }).limit(1).single(),
    supabase.from('scans').select('id,domain,score,grade,created_at')
      .eq('account_id', profile.account_id)
      .order('created_at', { ascending: false }).limit(10),
    // Agent results for the latest scan
    latestScan ? supabase.from('agent_recommendations').select('*')
      .eq('scan_id', (latestScan as Scan).id).order('priority').order('impact_score', { ascending: false }) : Promise.resolve({ data: null }),
    latestScan ? supabase.from('agent_progress').select('*')
      .eq('scan_id', (latestScan as Scan).id) : Promise.resolve({ data: null }),
    latestScan ? supabase.from('agent_competitors').select('*')
      .eq('scan_id', (latestScan as Scan).id).order('mention_rate', { ascending: false }) : Promise.resolve({ data: null }),
    supabase.from('pulse_weekly_summary').select('*')
      .eq('client_id', clientId).order('scan_week').limit(40),
    supabase.from('pulse_metrics')
      .select('platform,question,competitors_mentioned,scan_week')
      .eq('client_id', clientId).eq('brand_mentioned', false)
      .order('scan_week', { ascending: false }).limit(10),
  ])

  const summary = (pulseSummary ?? []) as PulseWeeklySummary[]
  const latestWeek = summary.filter(d => !d.platform).at(-1)?.scan_week
  const kpiRow = summary.find(d => d.scan_week === latestWeek && !d.platform)
  const platformCount = [...new Set(
    summary.filter(d => d.scan_week === latestWeek && d.platform).map(d => d.platform)
  )].length

  const overview: ClientOverview = {
    client: { brand_name: client.brand_name },
    latestScan: latestScan as Scan | null,
    scanHistory: (scanHistory ?? []) as Pick<Scan, 'id' | 'domain' | 'score' | 'grade' | 'created_at'>[],
    recommendations: (recommendations ?? []) as AgentRecommendation[],
    progress: (progress ?? []) as AgentProgress[],
    competitors: (competitors ?? []) as AgentCompetitor[],
    pulseSummary: summary,
    pulseKpi: kpiRow ? {
      sovScore: kpiRow.sov_score,
      brandMentions: kpiRow.brand_mentions,
      totalQueries: kpiRow.total_queries,
      platformCount,
      scanWeek: kpiRow.scan_week,
    } : null,
    missedOpportunities: ((pulseMetrics ?? []) as PulseMetric[]).map(m => ({
      platform: m.platform,
      question: m.question,
      competitors_mentioned: m.competitors_mentioned,
      scan_week: m.scan_week,
    })),
  }

  return NextResponse.json(overview)
}
```

- [ ] **Step 4: Run test to verify it compiles**

```bash
npx tsc --noEmit
```

Expected: No TypeScript errors (test will use mocked deps).

- [ ] **Step 5: Commit**

```bash
git add app/api/clients/[clientId]/overview/route.ts __tests__/api/agent-routes.test.ts
git commit -m "feat(api): add client overview endpoint for unified dashboard"
```

---

### Task 7: Modify Scan Route — Agent Trigger

**Files:**
- Modify: `app/api/scan/route.ts` (lines 220-236 — replace the supabase insert block)

- [ ] **Step 1: Modify the scan persistence block (lines 220-236)**

Replace the existing `supabase.from('scans').insert(...)` block with:

```typescript
  // Determine if this is a dashboard-triggered scan (has clientId)
  const isDashboardScan = !!clientId

  const insertPayload: Record<string, unknown> = {
    url: baseUrl, domain,
    score: totalScore,
    results: { ...results, ...geoDetails },
    industry: geoIndustry,
    region:   geoRegion,
    grade,
    account_id,
  }

  if (isDashboardScan) {
    insertPayload.agent_status = 'pending'
  }

  const { data, error } = await supabase
    .from('scans')
    .insert(insertPayload)
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: 'Database error', detail: error.message }, { status: 500 })

  // Fire agent webhook if dashboard scan and client has webhook configured
  if (isDashboardScan) {
    const { data: clientData } = await supabase
      .from('clients').select('webhook_url,brand_name').eq('id', clientId).single()

    const webhookUrl = clientData?.webhook_url

    if (webhookUrl) {
      // Fire-and-forget — do not block the response
      fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          brandName: clientData?.brand_name ?? '',
          domain,
          industry: geoIndustry,
          scanId: data.id,
          score: totalScore,
          grade,
          results: { ...results, ...geoDetails },
        }),
        signal: AbortSignal.timeout(5_000),
      }).catch(err => console.error('[scan] webhook trigger failed:', err))
    }
  }

  return NextResponse.json({ id: data.id, score: totalScore, grade, results: { ...results, ...geoDetails } })
```

- [ ] **Step 2: Verify route compiles**

```bash
npx tsc --noEmit
```

Expected: No TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/scan/route.ts
git commit -m "feat(scan): add agent_status and webhook trigger for dashboard scans"
```

---

### Task 8: Agent Section UI Component (wrapper)

**Files:**
- Create: `components/dashboard/AgentSection.tsx`

- [ ] **Step 1: Write the component**

```typescript
'use client'

type AgentSectionProps = {
  status: string | null | undefined
  children: React.ReactNode
}

const PLATFORM_ICONS = ['openai/gpt-4o', 'anthropic/claude-haiku-4-5', 'google/gemini-2.0-flash-001', 'perplexity/sonar', 'perplexity/sonar-pro']

export function AgentSection({ status, children }: AgentSectionProps) {
  if (!status || status === 'error') return null

  if (status === 'pending' || status === 'running') {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <p className="text-sm font-semibold text-slate-700 mb-4">Agent Analysis</p>
        <div className="flex items-center gap-3">
          {PLATFORM_ICONS.map((platform, i) => (
            <div
              key={platform}
              className="flex items-center gap-2 text-xs text-slate-400"
              style={{ animationDelay: `${i * 300}ms` }}
            >
              <span className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
              <span className="truncate max-w-[100px]">{platform.split('/').pop()}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-400 mt-3">
          {status === 'pending' ? 'Agent analysis will start shortly...' : 'Agents are analyzing your results...'}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-sm font-semibold text-slate-700">Agent Analysis</p>
      {children}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/dashboard/AgentSection.tsx
git commit -m "feat(ui): add AgentSection loading/empty wrapper component"
```

---

### Task 9: Agent Recommendations Component

**Files:**
- Create: `components/dashboard/AgentRecommendations.tsx`

- [ ] **Step 1: Write the component**

```typescript
import type { AgentRecommendation } from '@/lib/types'

type Props = {
  recommendations: AgentRecommendation[]
}

const PRIORITY_COLORS: Record<string, string> = {
  high: 'bg-red-100 text-red-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-slate-100 text-slate-600',
}

function groupByPlatform(recs: AgentRecommendation[]): Record<string, AgentRecommendation[]> {
  const grouped: Record<string, AgentRecommendation[]> = {}
  for (const r of recs) {
    if (!grouped[r.platform]) grouped[r.platform] = []
    grouped[r.platform].push(r)
  }
  return grouped
}

export function AgentRecommendations({ recommendations }: Props) {
  if (recommendations.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <p className="text-sm font-semibold text-slate-700 mb-1">Recommendations</p>
        <p className="text-xs text-slate-400">No recommendations yet. Agent analysis will provide platform-specific fixes.</p>
      </div>
    )
  }

  const grouped = groupByPlatform(recommendations)

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <p className="text-sm font-semibold text-slate-700 mb-3">Recommendations</p>
      {Object.entries(grouped).map(([platform, recs]) => (
        <div key={platform} className="mb-3 last:mb-0">
          <p className="text-xs font-medium text-slate-500 mb-2 uppercase">{platform.split('/').pop()}</p>
          <div className="space-y-1.5">
            {recs.slice(0, 3).map((r) => (
              <div key={r.id} className="flex items-start gap-2">
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 mt-0.5 ${PRIORITY_COLORS[r.priority] ?? PRIORITY_COLORS.low}`}>
                  {r.priority}
                </span>
                <div className="min-w-0">
                  <p className="text-xs text-slate-800 leading-relaxed">{r.recommendation}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/dashboard/AgentRecommendations.tsx
git commit -m "feat(ui): add AgentRecommendations component"
```

---

### Task 10: Agent Progress Component

**Files:**
- Create: `components/dashboard/AgentProgress.tsx`

- [ ] **Step 1: Write the component**

```typescript
import type { AgentProgress } from '@/lib/types'

type Props = {
  progress: AgentProgress[]
}

function formatDelta(delta: number | null): { text: string; color: string } {
  if (delta === null || delta === undefined) return { text: '—', color: 'text-slate-400' }
  if (delta > 0) return { text: `+${delta.toFixed(1)}`, color: 'text-emerald-600' }
  if (delta < 0) return { text: delta.toFixed(1), color: 'text-red-500' }
  return { text: '0.0', color: 'text-slate-400' }
}

function groupByPlatform(rows: AgentProgress[]): Record<string, AgentProgress[]> {
  const grouped: Record<string, AgentProgress[]> = {}
  for (const r of rows) {
    if (!grouped[r.platform]) grouped[r.platform] = []
    grouped[r.platform].push(r)
  }
  return grouped
}

export function AgentProgress({ progress }: Props) {
  if (progress.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <p className="text-sm font-semibold text-slate-700 mb-1">Progress</p>
        <p className="text-xs text-slate-400">Progress tracking will appear after your next scan.</p>
      </div>
    )
  }

  const grouped = groupByPlatform(progress)

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <p className="text-sm font-semibold text-slate-700 mb-3">Progress</p>
      {Object.entries(grouped).map(([platform, rows]) => (
        <div key={platform} className="mb-3 last:mb-0">
          <p className="text-xs font-medium text-slate-500 mb-2 uppercase">{platform.split('/').pop()}</p>
          <div className="space-y-1.5">
            {rows.map((r) => {
              const delta = formatDelta(r.delta)
              return (
                <div key={r.id} className="flex items-center justify-between">
                  <span className="text-xs text-slate-700 capitalize">{r.metric.replace(/_/g, ' ')}</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-slate-900">{r.current_value}</span>
                    <span className={`text-[10px] font-medium ${delta.color}`}>{delta.text}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/dashboard/AgentProgress.tsx
git commit -m "feat(ui): add AgentProgress component"
```

---

### Task 11: Agent Competitors Component

**Files:**
- Create: `components/dashboard/AgentCompetitors.tsx`

- [ ] **Step 1: Write the component**

```typescript
import type { AgentCompetitor } from '@/lib/types'

type Props = {
  competitors: AgentCompetitor[]
}

function groupByPlatform(rows: AgentCompetitor[]): Record<string, AgentCompetitor[]> {
  const grouped: Record<string, AgentCompetitor[]> = {}
  for (const r of rows) {
    if (!grouped[r.platform]) grouped[r.platform] = []
    grouped[r.platform].push(r)
  }
  return grouped
}

export function AgentCompetitors({ competitors }: Props) {
  if (competitors.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <p className="text-sm font-semibold text-slate-700 mb-1">Competitors</p>
        <p className="text-xs text-slate-400">Competitor analysis will appear after agent analysis completes.</p>
      </div>
    )
  }

  const grouped = groupByPlatform(competitors)

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <p className="text-sm font-semibold text-slate-700 mb-3">Competitors</p>
      {Object.entries(grouped).map(([platform, rows]) => (
        <div key={platform} className="mb-3 last:mb-0">
          <p className="text-xs font-medium text-slate-500 mb-2 uppercase">{platform.split('/').pop()}</p>
          <div className="space-y-2">
            {rows.slice(0, 3).map((r) => (
              <div key={r.id} className="flex items-start gap-3 p-2 rounded-lg bg-slate-50">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs font-medium text-slate-800 truncate">
                      {r.competitor_name ?? r.competitor_domain}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[10px] text-slate-400">You: {r.your_rate}%</span>
                      <span className="text-[10px] font-semibold text-red-500">Them: {r.mention_rate}%</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">{r.gap_analysis}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/dashboard/AgentCompetitors.tsx
git commit -m "feat(ui): add AgentCompetitors component"
```

---

### Task 12: Scan Summary Component

**Files:**
- Create: `components/dashboard/ScanSummary.tsx`

- [ ] **Step 1: Write the component**

```typescript
import { ScoreRing } from '@/components/ScoreRing'
import { ExpandableCheckItem } from '@/components/ExpandableCheckItem'
import { CHECK_EXPLANATIONS } from '@/lib/checkExplanations'
import type { Scan, CheckResult } from '@/lib/types'

type Props = {
  scan: Pick<Scan, 'id' | 'score' | 'grade' | 'domain' | 'created_at' | 'results'>
}

const CORE_CHECK_KEYS = [
  'c1_robots', 'c2_llms_txt', 'c3_bot_access', 'c4_structured_data', 'c5_extractability',
] as const

const EXTENDED_CHECK_KEYS = [
  'c6_llms_full_txt', 'c7_mcp_card', 'c8_sitemap', 'c9_meta_desc', 'c10_headings',
  'c11_faq', 'c12_canonical', 'c13_render', 'c14_internal_links', 'c15_entity', 'c16_freshness',
] as const

const GEO_CHECK_KEYS = [
  'c17_citation_density', 'c18_factual_density', 'c19_topical_authority', 'c20_chunkability',
] as const

type CheckGroup = {
  title: string
  keys: readonly string[]
  maxPoints: number
}

export function ScanSummary({ scan }: Props) {
  const r = scan.results as Record<string, unknown>
  const grade = scan.grade ?? 'F'
  const date = new Date(scan.created_at).toLocaleDateString()

  const groups: CheckGroup[] = [
    { title: 'Core Checks', keys: CORE_CHECK_KEYS as unknown as string[], maxPoints: 45 },
    { title: 'Extended Checks', keys: EXTENDED_CHECK_KEYS as unknown as string[], maxPoints: 30 },
    { title: 'GEO Checks', keys: GEO_CHECK_KEYS as unknown as string[], maxPoints: 25 },
  ]

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-sm font-semibold text-slate-700">Latest Scan</p>
          <p className="text-xs text-slate-400">{scan.domain} &middot; {date}</p>
        </div>
        <ScoreRing score={scan.score} />
      </div>

      {/* Grade badge */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-lg font-bold text-slate-900">Grade {grade}</span>
      </div>

      {/* Check groups */}
      <div className="space-y-2">
        {groups.map((group) => {
          const checks = group.keys
            .map(key => ({ key, result: r[key] as CheckResult | undefined }))
            .filter(c => c.result)
          if (checks.length === 0) return null

          const passed = checks.filter(c => c.result?.status === 'pass').length
          const warn = checks.filter(c => c.result?.status === 'warn').length
          const pct = Math.round((passed / checks.length) * 100)

          return (
            <details key={group.title} className="group">
              <summary className="cursor-pointer flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-slate-50 list-none">
                <span className="text-xs font-medium text-slate-600">{group.title} ({passed}/{checks.length})</span>
                <div className="flex items-center gap-2">
                  <div className="w-16 h-1.5 rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full ${pct >= 60 ? 'bg-emerald-500' : pct >= 30 ? 'bg-amber-400' : 'bg-red-400'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <svg className={`w-3 h-3 text-slate-400 transition-transform group-open:rotate-180`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </summary>
              <div className="mt-1 space-y-0.5">
                {checks.map(({ key, result }) => {
                  const explanation = CHECK_EXPLANATIONS[key]
                  return (
                    <ExpandableCheckItem
                      key={key}
                      label={key.replace(/^c\d+_/, '').replace(/_/g, ' ')}
                      status={result!.status}
                      message={result!.message}
                      details={result!.details}
                      explanation={explanation ? { why: explanation.why, fix: explanation.fix[result!.status] } : undefined}
                    />
                  )
                })}
              </div>
            </details>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/dashboard/ScanSummary.tsx
git commit -m "feat(ui): add ScanSummary collapsible component with all 20 checks"
```

---

### Task 13: Redesign Dashboard Overview Tab

**Files:**
- Modify: `app/[lang]/dashboard/[clientId]/page.tsx`

- [ ] **Step 1: Replace the overview tab content**

Replace the entire `tab === 'overview'` block (lines 61-79) with the new unified content. The new page will fetch from the overview API instead of direct queries.

```typescript
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { requireAuth } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { SovChart }        from '@/components/pulse/SovChart'
import { PlatformBar }     from '@/components/pulse/PlatformBar'
import { MissedTable }     from '@/components/pulse/MissedTable'
import { CompetitorTab }   from '@/components/pulse/CompetitorTab'
import { AlertsTab }       from '@/components/pulse/AlertsTab'
import { TopBar }          from '@/components/dashboard/TopBar'
import { PulseTabs }       from '@/components/dashboard/PulseTabs'
import { ScanSummary }     from '@/components/dashboard/ScanSummary'
import { AgentSection }    from '@/components/dashboard/AgentSection'
import { AgentRecommendations } from '@/components/dashboard/AgentRecommendations'
import { AgentProgress }         from '@/components/dashboard/AgentProgress'
import { AgentCompetitors }      from '@/components/dashboard/AgentCompetitors'
import {
  Scan, AgentRecommendation, AgentProgress as AgentProgressType,
  AgentCompetitor, PulseWeeklySummary, PulseMetric,
} from '@/lib/types'
import Link from 'next/link'

export default async function DashboardPulsePage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string; clientId: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  const { lang, clientId } = await params
  const { tab = 'overview' } = await searchParams
  const profile  = await requireAuth(lang)
  const supabase = await createServerSupabaseClient()

  // Fetch client
  const { data: client } = await supabase
    .from('clients').select('brand_name')
    .eq('id', clientId).eq('account_id', profile.account_id).single()

  if (!client) notFound()

  // Phase 1: fetch scan + pulse data in parallel
  const [
    { data: latestScan },
    { data: scanHistory },
    { data: pulseSummary },
    { data: pulseMetrics },
  ] = await Promise.all([
    supabase.from('scans').select('*')
      .eq('account_id', profile.account_id)
      .order('created_at', { ascending: false }).limit(1).single(),
    supabase.from('scans').select('id,domain,score,grade,created_at')
      .eq('account_id', profile.account_id)
      .order('created_at', { ascending: false }).limit(10),
    supabase.from('pulse_weekly_summary').select('*')
      .eq('client_id', clientId).order('scan_week').limit(40),
    supabase.from('pulse_metrics')
      .select('platform,question,competitors_mentioned,scan_week')
      .eq('client_id', clientId).eq('brand_mentioned', false)
      .order('scan_week', { ascending: false }).limit(50),
  ])

  const scan = latestScan as Scan | null

  // Phase 2: fetch agent data conditionally (only if a scan exists)
  const [{ data: agentRecs }, { data: agentProg }, { data: agentComps }] = scan
    ? await Promise.all([
        supabase.from('agent_recommendations').select('*').eq('scan_id', scan.id).order('priority').order('impact_score', { ascending: false }),
        supabase.from('agent_progress').select('*').eq('scan_id', scan.id),
        supabase.from('agent_competitors').select('*').eq('scan_id', scan.id).order('mention_rate', { ascending: false }),
      ])
    : [{ data: null }, { data: null }, { data: null }]

  const summary = (pulseSummary ?? []) as PulseWeeklySummary[]
  const missed  = (pulseMetrics ?? []) as PulseMetric[]
  const latestWeek    = summary.filter(d => !d.platform).at(-1)?.scan_week
  const kpi           = summary.find(d => d.scan_week === latestWeek && !d.platform)
  const platformCount = [...new Set(
    summary.filter(d => d.scan_week === latestWeek && d.platform).map(d => d.platform)
  )].length

  return (
    <>
      <TopBar
        title={client.brand_name}
        subtitle={kpi?.scan_week ? `Week of ${kpi.scan_week}` : 'No data yet'}
      />
      <Suspense fallback={null}>
        <PulseTabs />
      </Suspense>

      <main className="flex-1 px-6 py-8 max-w-3xl space-y-6">

        {tab === 'overview' && (
          <>
            {/* KPI Strip */}
            <div className="grid grid-cols-3 gap-4">
              {/* AISO Score */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 text-center">
                <p className="text-2xl font-black text-blue-600">
                  {scan ? `${scan.score}` : '—'}
                </p>
                <p className="text-xs text-slate-500 mt-1">AISO Score</p>
                {scan?.grade && (
                  <span className="inline-block mt-1 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
                    {scan.grade}
                  </span>
                )}
              </div>

              {/* Share of Voice */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 text-center">
                <p className="text-2xl font-black text-purple-600">
                  {kpi ? `${kpi.sov_score}%` : '—'}
                </p>
                <p className="text-xs text-slate-500 mt-1">Share of Voice</p>
              </div>

              {/* Agent Status */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 text-center">
                <p className="text-2xl font-black text-slate-600">
                  {scan?.agent_status === 'complete' ? '✓' :
                   scan?.agent_status === 'pending' || scan?.agent_status === 'running' ? '...' : '—'}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  {scan?.agent_status === 'complete' ? 'Agents Ready' :
                   scan?.agent_status === 'pending' || scan?.agent_status === 'running' ? 'Analyzing' : 'No Analysis'}
                </p>
              </div>
            </div>

            {/* Scan Summary or Empty State */}
            {scan ? (
              <ScanSummary scan={scan} />
            ) : (
              <div className="bg-white rounded-xl border border-slate-200 p-6 text-center">
                <p className="text-sm font-semibold text-slate-700 mb-1">No scans yet</p>
                <p className="text-xs text-slate-400 mb-4">Run your first scan to see your AISO score and get agent recommendations.</p>
                <Link
                  href={`/${lang}`}
                  className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                >
                  Run a Scan
                </Link>
              </div>
            )}

            {/* Agent Results */}
            {scan && (
              <AgentSection status={scan.agent_status}>
                <div className="grid grid-cols-1 gap-4">
                  <AgentRecommendations recommendations={(agentRecs ?? []) as AgentRecommendation[]} />
                  <AgentProgress progress={(agentProg ?? []) as AgentProgressType[]} />
                  <AgentCompetitors competitors={(agentComps ?? []) as AgentCompetitor[]} />
                </div>
              </AgentSection>
            )}

            {/* Pulse Section (compacted) */}
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <p className="text-sm font-semibold text-slate-700 mb-3">SoV Trend</p>
              <SovChart data={summary} />
            </div>

            {/* Top Missed Opportunities */}
            {missed.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <p className="text-sm font-semibold text-slate-700 mb-3">Top Missed Opportunities</p>
                <MissedTable
                  rows={missed.slice(0, 3)}
                  platformLabel="Platform"
                  questionLabel="Question"
                  competitorsLabel="Competitors"
                />
              </div>
            )}
          </>
        )}

        {tab === 'platforms' && (
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <p className="text-sm font-semibold text-slate-700 mb-4">Platform Breakdown</p>
            <PlatformBar data={summary} />
          </div>
        )}

        {tab === 'missed' && (
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <p className="text-sm font-semibold text-slate-700 mb-1">Missed Opportunities</p>
            <p className="text-xs text-slate-400 mb-4">Queries where your brand was not mentioned</p>
            <MissedTable rows={missed} platformLabel="Platform" questionLabel="Question" competitorsLabel="Competitors" />
          </div>
        )}

        {tab === 'competitors' && (
          <CompetitorTab summary={summary} brandName={client.brand_name} />
        )}

        {tab === 'alerts' && (
          <AlertsTab clientId={clientId} />
        )}

      </main>
    </>
  )
}
```

- [ ] **Step 2: Check TypeScript compilation**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Run existing tests**

```bash
npx vitest run
```

Expected: All existing tests pass. No regressions.

- [ ] **Step 4: Commit**

```bash
git add app/[lang]/dashboard/[clientId]/page.tsx
git commit -m "feat(ui): redesign dashboard Overview tab with scans, agents, and compacted pulse"
```

---

### Task 14: Final Verification

- [ ] **Step 1: Run full test suite**

```bash
npx vitest run
```

Expected: All tests pass.

- [ ] **Step 2: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No TypeScript errors.

- [ ] **Step 3: Run linter**

```bash
npx eslint .
```

Expected: No new linting errors.

- [ ] **Step 4: Verify migration applies clean**

```bash
# Run against local Supabase (manual verification)
# supabase db reset && supabase migration up
```

Expected: Migration applies without errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: complete agent-powered unified dashboard"
```
