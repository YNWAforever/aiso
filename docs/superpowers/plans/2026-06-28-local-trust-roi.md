# Local Trust ROI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Pro/Enterprise Local Trust ROI dashboard step that translates AISO, Pulse, and owner assumptions into local trust scoring, prioritized actions, ROI proof, and Enterprise reporting.

**Architecture:** Keep the feature inside the existing client dashboard at `/:lang/dashboard/:clientId?step=roi`. Use deterministic library modules in `lib/localTrust/` for scoring and ROI math, Supabase tables for profile/snapshot/action persistence, route handlers for owner mutations and export, and focused dashboard components for the owner-facing UI.

**Tech Stack:** Next.js 16 App Router, React Server Components with small Client Components for forms/actions, Supabase, next-intl, Vitest, Tailwind CSS, lucide-react.

---

## Preflight Notes

- Work in a dedicated worktree or branch. The main checkout currently has unrelated MCP changes in `scripts/mcp-postgres.sh` and `__tests__/scripts/`; do not stage or edit them unless the user explicitly asks.
- Read `AGENTS.md` before implementation. This repo uses Next.js 16.2.4 with changed App Router conventions. Before touching App Router files, read the local docs in `node_modules/next/dist/docs/01-app/01-getting-started/03-layouts-and-pages.md`, `05-server-and-client-components.md`, `07-mutating-data.md`, and `15-route-handlers.md`.
- Keep the feature deterministic. Do not call LLMs for scoring, checklist ordering, or ROI math.
- Use `rg` for search and `apply_patch` for manual edits.

---

## File Structure

### Create

- `supabase/migrations/021_local_trust_roi.sql`  
  Adds Local Trust profile, snapshot, and action tables; adds plan feature columns; seeds plan-feature access.

- `lib/localTrust/types.ts`  
  Shared Local Trust domain types.

- `lib/localTrust/scoring.ts`  
  Deterministic Local Trust Score and Trust Gap Checklist logic.

- `lib/localTrust/roi.ts`  
  Deterministic ROI estimate helper.

- `lib/localTrust/store.ts`  
  Server-only Supabase read/write helpers for profile, snapshots, and actions.

- `lib/localTrust/index.ts`  
  Public exports for the Local Trust module.

- `app/api/dashboard/clients/[clientId]/local-trust/profile/route.ts`  
  Authenticated owner profile upsert route.

- `app/api/dashboard/clients/[clientId]/local-trust/actions/[actionId]/route.ts`  
  Authenticated action-status update route.

- `app/api/dashboard/clients/[clientId]/local-trust/export/route.ts`  
  Enterprise-only report export route.

- `components/dashboard/local-trust/LocalTrustStep.tsx`  
  Main server-rendered ROI step wrapper.

- `components/dashboard/local-trust/LocalTrustLockedPreview.tsx`  
  Basic/locked preview.

- `components/dashboard/local-trust/OwnerSummary.tsx`  
  Plain-English owner summary.

- `components/dashboard/local-trust/LocalTrustScorePanel.tsx`  
  Overall score and four bucket cards.

- `components/dashboard/local-trust/TrustGapChecklist.tsx`  
  Interactive action list.

- `components/dashboard/local-trust/LocalTrustSetupForm.tsx`  
  Owner inputs for services, service area, lead value, close rate, and competitors.

- `components/dashboard/local-trust/RoiTimeline.tsx`  
  Monthly proof timeline.

- `components/dashboard/local-trust/CompetitorSnapshot.tsx`  
  Enterprise competitor comparison.

- `components/dashboard/local-trust/ReportActions.tsx`  
  Enterprise export/share controls.

- `__tests__/lib/local-trust.test.ts`  
  Scoring, checklist, and ROI unit tests.

- `__tests__/api/local-trust-routes.test.ts`  
  Route auth, gating, validation, and export tests.

- `__tests__/components/local-trust.test.tsx`  
  Component rendering tests using `renderToStaticMarkup`.

### Modify

- `lib/types.ts`  
  Add Local Trust and plan-feature types.

- `lib/tier.ts`  
  Add Local Trust feature flags for Basic, Pro, Enterprise.

- `app/[lang]/dashboard/[clientId]/page.tsx`  
  Fetch Local Trust data and render `LocalTrustStep` when `step=roi`.

- `components/dashboard/DashboardSidebar.tsx`  
  Add ROI navigation step and lock behavior.

- `components/dashboard/WizardProgress.tsx`  
  Add ROI step if this component remains in use during implementation.

- `messages/en.json` and `messages/zh-HK.json`  
  Add dashboard/local-trust copy.

- `__tests__/lib/tier.test.ts`  
  Add plan-gating coverage.

---

## Task 1: Schema, Types, And Plan Gates

**Files:**
- Create: `supabase/migrations/021_local_trust_roi.sql`
- Modify: `lib/types.ts`
- Modify: `lib/tier.ts`
- Test: `__tests__/lib/tier.test.ts`

- [ ] **Step 1: Add failing tier tests**

Append these tests to `__tests__/lib/tier.test.ts`:

```ts
it('basic cannot access Local Trust ROI', () => {
  expect(planAllows('basic', 'local_trust_roi')).toBe(false)
})

it('pro can access Local Trust ROI but not competitor snapshot or export', () => {
  expect(planAllows('pro', 'local_trust_roi')).toBe(true)
  expect(planAllows('pro', 'local_trust_competitors')).toBe(false)
  expect(planAllows('pro', 'local_trust_export')).toBe(false)
})

it('enterprise can access all Local Trust ROI features', () => {
  expect(planAllows('enterprise', 'local_trust_roi')).toBe(true)
  expect(planAllows('enterprise', 'local_trust_competitors')).toBe(true)
  expect(planAllows('enterprise', 'local_trust_export')).toBe(true)
})
```

- [ ] **Step 2: Run tier tests and verify they fail**

Run:

```bash
npm test -- __tests__/lib/tier.test.ts
```

Expected: fails because `local_trust_roi`, `local_trust_competitors`, and `local_trust_export` are not keys of `PlanFeatures`.

- [ ] **Step 3: Add Local Trust plan-feature types**

In `lib/types.ts`, extend the existing `PlanFeatures` interface near the lower app-domain types. Keep the existing `plan: 'basic' | 'pro' | 'enterprise'` union and add only the three Local Trust booleans:

```ts
export interface PlanFeatures {
  plan: 'basic' | 'pro' | 'enterprise'
  platform_access: string[]
  agent_recs: boolean
  agent_progress: boolean
  agent_competitors: boolean
  alerts: boolean
  csv_export: boolean
  max_brands: number
  history_weeks: number
  edit_prompts: boolean
  local_trust_roi: boolean
  local_trust_competitors: boolean
  local_trust_export: boolean
}
```

Also add these Local Trust row types near the other app-domain types:

```ts
export type LocalTrustBucketKey = 'local_visibility' | 'proof_depth' | 'ai_answer_readiness' | 'market_authority'
export type LocalTrustActionStatus = 'open' | 'planned' | 'done' | 'skipped'
export type LocalTrustImpact = 'low' | 'medium' | 'high'
export type LocalTrustEffort = 'low' | 'medium' | 'high'

export interface LocalTrustProfile {
  id: string
  client_id: string
  account_id: string
  primary_services: string[]
  service_area: string | null
  average_lead_value: number | null
  close_rate: number | null
  competitors: string[]
  created_at: string
  updated_at: string
}

export interface LocalTrustBucketScore {
  key: LocalTrustBucketKey
  label: string
  score: number
  maxScore: number
  explanation: string
  strongestSignal: string
  weakestSignal: string
  topAction: string
}

export interface LocalTrustGap {
  stableKey: string
  title: string
  bucket: LocalTrustBucketKey
  impact: LocalTrustImpact
  effort: LocalTrustEffort
  rationale: string
  suggestedTarget: string
}

export interface LocalTrustRoiEstimate {
  low: number
  high: number
  currency: 'HKD'
  assumptions: {
    averageLeadValue: number
    closeRate: number
    estimatedExtraEnquiriesLow: number
    estimatedExtraEnquiriesHigh: number
  }
  confidence: 'directional'
}

export interface LocalTrustSnapshot {
  id: string
  client_id: string
  account_id: string
  snapshot_month: string
  local_trust_score: number
  bucket_scores: LocalTrustBucketScore[]
  trust_gaps: LocalTrustGap[]
  roi_estimate: LocalTrustRoiEstimate | null
  source_scan_id: string | null
  source_pulse_week: string | null
  created_at: string
}

export interface LocalTrustAction {
  id: string
  client_id: string
  snapshot_id: string
  stable_key: string
  title: string
  bucket: LocalTrustBucketKey
  impact: LocalTrustImpact
  effort: LocalTrustEffort
  status: LocalTrustActionStatus
  created_at: string
  updated_at: string
}
```

- [ ] **Step 4: Add plan gates in `lib/tier.ts`**

Update each plan entry:

```ts
basic: {
  plan: 'basic',
  platform_access: ['gemini'],
  agent_recs: true, agent_progress: false, agent_competitors: false,
  alerts: false, csv_export: false,
  max_brands: 1, history_weeks: 4, edit_prompts: false,
  local_trust_roi: false, local_trust_competitors: false, local_trust_export: false,
},
pro: {
  plan: 'pro',
  platform_access: ['gemini', 'gpt4o', 'claude', 'perplexity-s', 'perplexity-p'],
  agent_recs: true, agent_progress: true, agent_competitors: false,
  alerts: true, csv_export: false,
  max_brands: 3, history_weeks: 26, edit_prompts: true,
  local_trust_roi: true, local_trust_competitors: false, local_trust_export: false,
},
enterprise: {
  plan: 'enterprise',
  platform_access: ['gemini', 'gpt4o', 'claude', 'perplexity-s', 'perplexity-p'],
  agent_recs: true, agent_progress: true, agent_competitors: true,
  alerts: true, csv_export: true,
  max_brands: 10, history_weeks: 999, edit_prompts: true,
  local_trust_roi: true, local_trust_competitors: true, local_trust_export: true,
},
```

- [ ] **Step 5: Add migration**

Create `supabase/migrations/021_local_trust_roi.sql`:

```sql
-- Local Trust ROI

alter table plan_features add column if not exists local_trust_roi boolean not null default false;
alter table plan_features add column if not exists local_trust_competitors boolean not null default false;
alter table plan_features add column if not exists local_trust_export boolean not null default false;

update plan_features set
  local_trust_roi = false,
  local_trust_competitors = false,
  local_trust_export = false
where plan = 'basic';

update plan_features set
  local_trust_roi = true,
  local_trust_competitors = false,
  local_trust_export = false
where plan = 'pro';

update plan_features set
  local_trust_roi = true,
  local_trust_competitors = true,
  local_trust_export = true
where plan = 'enterprise';

create table if not exists local_trust_profiles (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  primary_services text[] not null default '{}',
  service_area text,
  average_lead_value numeric,
  close_rate numeric check (close_rate is null or (close_rate >= 0 and close_rate <= 1)),
  competitors text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id)
);

create table if not exists local_trust_snapshots (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  snapshot_month date not null,
  local_trust_score numeric not null check (local_trust_score >= 0 and local_trust_score <= 100),
  bucket_scores jsonb not null default '[]'::jsonb,
  trust_gaps jsonb not null default '[]'::jsonb,
  roi_estimate jsonb,
  source_scan_id uuid references scans(id) on delete set null,
  source_pulse_week date,
  created_at timestamptz not null default now(),
  unique (client_id, snapshot_month)
);

create table if not exists local_trust_actions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  snapshot_id uuid not null references local_trust_snapshots(id) on delete cascade,
  stable_key text not null,
  title text not null,
  bucket text not null check (bucket in ('local_visibility', 'proof_depth', 'ai_answer_readiness', 'market_authority')),
  impact text not null check (impact in ('low', 'medium', 'high')),
  effort text not null check (effort in ('low', 'medium', 'high')),
  status text not null default 'open' check (status in ('open', 'planned', 'done', 'skipped')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (snapshot_id, stable_key)
);

create index if not exists local_trust_profiles_account_idx on local_trust_profiles(account_id);
create index if not exists local_trust_snapshots_client_month_idx on local_trust_snapshots(client_id, snapshot_month desc);
create index if not exists local_trust_actions_snapshot_idx on local_trust_actions(snapshot_id);

alter table local_trust_profiles enable row level security;
alter table local_trust_snapshots enable row level security;
alter table local_trust_actions enable row level security;

drop policy if exists "local_trust_profiles_select_own" on local_trust_profiles;
create policy "local_trust_profiles_select_own" on local_trust_profiles
  for select using (account_id in (select account_id from profiles where id = auth.uid()));

drop policy if exists "local_trust_profiles_insert_own" on local_trust_profiles;
create policy "local_trust_profiles_insert_own" on local_trust_profiles
  for insert with check (account_id in (select account_id from profiles where id = auth.uid()));

drop policy if exists "local_trust_profiles_update_own" on local_trust_profiles;
create policy "local_trust_profiles_update_own" on local_trust_profiles
  for update using (account_id in (select account_id from profiles where id = auth.uid()));

drop policy if exists "local_trust_snapshots_select_own" on local_trust_snapshots;
create policy "local_trust_snapshots_select_own" on local_trust_snapshots
  for select using (account_id in (select account_id from profiles where id = auth.uid()));

drop policy if exists "local_trust_snapshots_insert_own" on local_trust_snapshots;
create policy "local_trust_snapshots_insert_own" on local_trust_snapshots
  for insert with check (account_id in (select account_id from profiles where id = auth.uid()));

drop policy if exists "local_trust_snapshots_update_own" on local_trust_snapshots;
create policy "local_trust_snapshots_update_own" on local_trust_snapshots
  for update using (account_id in (select account_id from profiles where id = auth.uid()));

drop policy if exists "local_trust_actions_select_own" on local_trust_actions;
create policy "local_trust_actions_select_own" on local_trust_actions
  for select using (
    exists (
      select 1 from local_trust_snapshots s
      join profiles p on p.account_id = s.account_id
      where s.id = local_trust_actions.snapshot_id and p.id = auth.uid()
    )
  );

drop policy if exists "local_trust_actions_insert_own" on local_trust_actions;
create policy "local_trust_actions_insert_own" on local_trust_actions
  for insert with check (
    exists (
      select 1 from local_trust_snapshots s
      join profiles p on p.account_id = s.account_id
      where s.id = local_trust_actions.snapshot_id and p.id = auth.uid()
    )
  );

drop policy if exists "local_trust_actions_update_own" on local_trust_actions;
create policy "local_trust_actions_update_own" on local_trust_actions
  for update using (
    exists (
      select 1 from local_trust_snapshots s
      join profiles p on p.account_id = s.account_id
      where s.id = local_trust_actions.snapshot_id and p.id = auth.uid()
    )
  );
```

- [ ] **Step 6: Run tier tests and commit**

Run:

```bash
npm test -- __tests__/lib/tier.test.ts
```

Expected: all tier tests pass.

Commit:

```bash
git add supabase/migrations/021_local_trust_roi.sql lib/types.ts lib/tier.ts __tests__/lib/tier.test.ts
git commit -m "feat(local-trust): add schema and plan gates"
```

---

## Task 2: Deterministic Local Trust Score And ROI Math

**Files:**
- Create: `lib/localTrust/types.ts`
- Create: `lib/localTrust/scoring.ts`
- Create: `lib/localTrust/roi.ts`
- Create: `lib/localTrust/index.ts`
- Test: `__tests__/lib/local-trust.test.ts`

- [ ] **Step 1: Write failing Local Trust unit tests**

Create `__tests__/lib/local-trust.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { calculateLocalTrust, estimateRoi } from '@/lib/localTrust'
import type { Client, Scan, PulseWeeklySummary, PulseMetric, AgentCompetitor, LocalTrustProfile } from '@/lib/types'

const pass = (message = 'pass') => ({ status: 'pass' as const, message })
const warn = (message = 'warn') => ({ status: 'warn' as const, message })
const fail = (message = 'fail') => ({ status: 'fail' as const, message })

const client: Client = {
  id: 'client-1',
  brand_name: 'Harbour Advisory',
  domain: 'harbour.example',
  industry: 'legal',
  competitors: ['rival.example'],
  status: 'active',
  created_at: '2026-06-01T00:00:00.000Z',
}

const profile: LocalTrustProfile = {
  id: 'profile-1',
  client_id: 'client-1',
  account_id: 'account-1',
  primary_services: ['tax advisory', 'company secretary'],
  service_area: 'Hong Kong',
  average_lead_value: 20000,
  close_rate: 0.25,
  competitors: ['rival.example'],
  created_at: '2026-06-01T00:00:00.000Z',
  updated_at: '2026-06-01T00:00:00.000Z',
}

const scan: Scan = {
  id: 'scan-1',
  url: 'https://harbour.example',
  domain: 'harbour.example',
  score: 78,
  grade: 'B',
  industry: 'legal',
  region: 'HK',
  account_id: 'account-1',
  created_at: '2026-06-20T00:00:00.000Z',
  results: {
    c4_structured_data: pass(),
    c5_extractability: pass(),
    c8_sitemap: pass(),
    c9_meta_desc: pass(),
    c10_headings: warn(),
    c11_faq: fail(),
    c12_canonical: pass(),
    c13_render: pass(),
    c14_internal_links: warn(),
    c15_entity: warn(),
    c16_freshness: warn(),
    c17_citation_density: warn(),
    c18_factual_density: warn(),
    c19_topical_authority: warn(),
    c20_chunkability: pass(),
  },
}

const pulse: PulseWeeklySummary[] = [{
  id: 'summary-1',
  client_id: 'client-1',
  scan_week: '2026-06-22',
  platform: null,
  total_queries: 20,
  brand_mentions: 8,
  sov_score: 40,
  avg_sentiment_score: 0.2,
  top_competitors: { 'rival.example': 12 },
  created_at: '2026-06-22T00:00:00.000Z',
}]

const missed: PulseMetric[] = [{
  id: 'metric-1',
  client_id: 'client-1',
  prompt_id: 'prompt-1',
  platform: 'chatgpt',
  question: 'best tax advisor hong kong',
  raw_answer: null,
  brand_mentioned: false,
  sentiment: 'not_mentioned',
  mention_position: null,
  competitors_mentioned: ['rival.example'],
  scan_week: '2026-06-22',
  created_at: '2026-06-22T00:00:00.000Z',
}]

const competitors: AgentCompetitor[] = [{
  id: 'comp-1',
  scan_id: 'scan-1',
  platform: 'chatgpt',
  competitor_domain: 'rival.example',
  competitor_name: 'Rival Advisory',
  mention_rate: 60,
  your_rate: 40,
  gap_analysis: 'Rival has stronger case studies and FAQ coverage.',
  created_at: '2026-06-22T00:00:00.000Z',
}]

describe('calculateLocalTrust', () => {
  it('returns four buckets and a capped 100-point score', () => {
    const result = calculateLocalTrust({ client, profile, scan, pulseSummary: pulse, missed, competitors })
    expect(result.local_trust_score).toBeGreaterThan(0)
    expect(result.local_trust_score).toBeLessThanOrEqual(100)
    expect(result.bucket_scores).toHaveLength(4)
    expect(result.bucket_scores.map(b => b.key)).toEqual([
      'local_visibility',
      'proof_depth',
      'ai_answer_readiness',
      'market_authority',
    ])
  })

  it('prioritizes high-impact low-effort trust gaps', () => {
    const result = calculateLocalTrust({ client, profile, scan, pulseSummary: pulse, missed, competitors })
    expect(result.trust_gaps[0]).toMatchObject({
      impact: 'high',
      effort: 'low',
    })
  })

  it('degrades when scan and Pulse data are missing', () => {
    const result = calculateLocalTrust({ client, profile: null, scan: null, pulseSummary: [], missed: [], competitors: [] })
    expect(result.local_trust_score).toBeGreaterThanOrEqual(0)
    expect(result.trust_gaps.some(g => g.stableKey === 'run-first-scan')).toBe(true)
    expect(result.roi_estimate).toBeNull()
  })
})

describe('estimateRoi', () => {
  it('returns null without lead value and close rate assumptions', () => {
    const current = calculateLocalTrust({ client, profile: { ...profile, average_lead_value: null, close_rate: null }, scan, pulseSummary: pulse, missed, competitors })
    expect(estimateRoi({ currentSnapshot: current })).toBeNull()
  })

  it('returns a directional low/high range with assumptions', () => {
    const current = calculateLocalTrust({ client, profile, scan, pulseSummary: pulse, missed, competitors })
    const estimate = estimateRoi({
      previousScore: current.local_trust_score - 10,
      currentSnapshot: current,
      averageLeadValue: 20000,
      closeRate: 0.25,
    })
    expect(estimate).toMatchObject({
      currency: 'HKD',
      confidence: 'directional',
    })
    expect(estimate!.low).toBeGreaterThan(0)
    expect(estimate!.high).toBeGreaterThan(estimate!.low)
  })
})
```

- [ ] **Step 2: Run Local Trust tests and verify they fail**

Run:

```bash
npm test -- __tests__/lib/local-trust.test.ts
```

Expected: fails because `@/lib/localTrust` does not exist.

- [ ] **Step 3: Add Local Trust module types**

Create `lib/localTrust/types.ts`:

```ts
import type {
  AgentCompetitor,
  Client,
  LocalTrustBucketScore,
  LocalTrustGap,
  LocalTrustProfile,
  LocalTrustRoiEstimate,
  PulseMetric,
  PulseWeeklySummary,
  Scan,
} from '@/lib/types'

export type LocalTrustSnapshotDraft = {
  client_id: string
  account_id: string | null
  snapshot_month: string
  local_trust_score: number
  bucket_scores: LocalTrustBucketScore[]
  trust_gaps: LocalTrustGap[]
  roi_estimate: LocalTrustRoiEstimate | null
  source_scan_id: string | null
  source_pulse_week: string | null
}

export type LocalTrustInput = {
  client: Client
  profile: LocalTrustProfile | null
  scan: Scan | null
  pulseSummary: PulseWeeklySummary[]
  missed: PulseMetric[]
  competitors: AgentCompetitor[]
}

export type EstimateRoiInput = {
  previousScore?: number
  currentSnapshot: LocalTrustSnapshotDraft
  averageLeadValue?: number | null
  closeRate?: number | null
}
```

- [ ] **Step 4: Add deterministic ROI helper**

Create `lib/localTrust/roi.ts`:

```ts
import type { LocalTrustRoiEstimate } from '@/lib/types'
import type { EstimateRoiInput } from './types'

export function estimateRoi({
  previousScore,
  currentSnapshot,
  averageLeadValue,
  closeRate,
}: EstimateRoiInput): LocalTrustRoiEstimate | null {
  if (!averageLeadValue || !closeRate || averageLeadValue <= 0 || closeRate <= 0) return null

  const baseline = previousScore ?? Math.max(0, currentSnapshot.local_trust_score - 5)
  const scoreDelta = Math.max(0, currentSnapshot.local_trust_score - baseline)
  if (scoreDelta <= 0) return null

  const estimatedExtraEnquiriesLow = Math.max(1, Math.round(scoreDelta / 10))
  const estimatedExtraEnquiriesHigh = Math.max(estimatedExtraEnquiriesLow + 1, Math.round(scoreDelta / 4))

  return {
    low: Math.round(estimatedExtraEnquiriesLow * averageLeadValue * closeRate),
    high: Math.round(estimatedExtraEnquiriesHigh * averageLeadValue * closeRate),
    currency: 'HKD',
    confidence: 'directional',
    assumptions: {
      averageLeadValue,
      closeRate,
      estimatedExtraEnquiriesLow,
      estimatedExtraEnquiriesHigh,
    },
  }
}
```

- [ ] **Step 5: Add deterministic scoring helper**

Create `lib/localTrust/scoring.ts`:

```ts
import type {
  CheckResult,
  LocalTrustBucketKey,
  LocalTrustBucketScore,
  LocalTrustGap,
} from '@/lib/types'
import { estimateRoi } from './roi'
import type { LocalTrustInput, LocalTrustSnapshotDraft } from './types'

const BUCKET_LABELS: Record<LocalTrustBucketKey, string> = {
  local_visibility: 'Local visibility',
  proof_depth: 'Proof depth',
  ai_answer_readiness: 'AI answer readiness',
  market_authority: 'Market authority',
}

function clamp(value: number, max = 100) {
  return Math.max(0, Math.min(max, Math.round(value)))
}

function statusPoints(result: unknown, passPoints: number, warnPoints = Math.round(passPoints * 0.6)) {
  const status = (result as CheckResult | undefined)?.status
  if (status === 'pass') return passPoints
  if (status === 'warn') return warnPoints
  if (status === 'fail') return 0
  return 0
}

function latestAggregateSov(input: LocalTrustInput) {
  return input.pulseSummary
    .filter(row => !row.platform)
    .sort((a, b) => a.scan_week.localeCompare(b.scan_week))
    .at(-1)
}

function bucket(key: LocalTrustBucketKey, score: number, explanation: string, strongestSignal: string, weakestSignal: string, topAction: string): LocalTrustBucketScore {
  return {
    key,
    label: BUCKET_LABELS[key],
    score: clamp(score, 25),
    maxScore: 25,
    explanation,
    strongestSignal,
    weakestSignal,
    topAction,
  }
}

function buildGaps(input: LocalTrustInput, buckets: LocalTrustBucketScore[]): LocalTrustGap[] {
  const gaps: LocalTrustGap[] = []
  const results = input.scan?.results ?? {}

  if (!input.scan) {
    gaps.push({
      stableKey: 'run-first-scan',
      title: 'Run the first AISO scan',
      bucket: 'ai_answer_readiness',
      impact: 'high',
      effort: 'low',
      rationale: 'The ROI view needs a baseline scan before it can show trustworthy progress.',
      suggestedTarget: 'Dashboard scan step',
    })
  }

  if (!input.profile?.service_area) {
    gaps.push({
      stableKey: 'add-service-area',
      title: 'Confirm your local service area',
      bucket: 'local_visibility',
      impact: 'high',
      effort: 'low',
      rationale: 'Local AI discovery depends on clear market and service-area signals.',
      suggestedTarget: 'Local Trust setup',
    })
  }

  if (!input.profile?.primary_services?.length) {
    gaps.push({
      stableKey: 'add-primary-services',
      title: 'Add your primary services',
      bucket: 'local_visibility',
      impact: 'high',
      effort: 'low',
      rationale: 'Service labels help the dashboard map visibility gaps to owner-friendly actions.',
      suggestedTarget: 'Local Trust setup',
    })
  }

  if ((results.c11_faq as CheckResult | undefined)?.status !== 'pass') {
    gaps.push({
      stableKey: 'add-local-faq',
      title: 'Add comparison and local buyer FAQs',
      bucket: 'ai_answer_readiness',
      impact: 'high',
      effort: 'medium',
      rationale: 'FAQs make high-consideration services easier for AI systems to quote and summarize.',
      suggestedTarget: 'Priority service pages',
    })
  }

  if ((results.c15_entity as CheckResult | undefined)?.status !== 'pass') {
    gaps.push({
      stableKey: 'strengthen-entity-proof',
      title: 'Strengthen credentials and entity proof',
      bucket: 'proof_depth',
      impact: 'high',
      effort: 'medium',
      rationale: 'Professional and B2B buyers look for credentials, team authority, and proof before enquiring.',
      suggestedTarget: 'About, team, and service pages',
    })
  }

  if (input.missed.length > 0) {
    gaps.push({
      stableKey: 'close-missed-local-query',
      title: 'Create content for missed local AI queries',
      bucket: 'market_authority',
      impact: 'medium',
      effort: 'medium',
      rationale: 'Missed Pulse queries reveal where competitors are being cited instead of your brand.',
      suggestedTarget: input.missed[0]?.question ?? 'Pulse missed opportunities',
    })
  }

  for (const weakBucket of buckets.filter(b => b.score < 12)) {
    gaps.push({
      stableKey: `improve-${weakBucket.key}`,
      title: weakBucket.topAction,
      bucket: weakBucket.key,
      impact: 'medium',
      effort: 'medium',
      rationale: weakBucket.explanation,
      suggestedTarget: weakBucket.weakestSignal,
    })
  }

  const rank = { high: 0, medium: 1, low: 2 }
  const effortRank = { low: 0, medium: 1, high: 2 }
  return gaps
    .filter((gap, index, arr) => arr.findIndex(other => other.stableKey === gap.stableKey) === index)
    .sort((a, b) => rank[a.impact] - rank[b.impact] || effortRank[a.effort] - effortRank[b.effort])
}

export function calculateLocalTrust(input: LocalTrustInput): LocalTrustSnapshotDraft {
  const results = input.scan?.results ?? {}
  const latestSov = latestAggregateSov(input)
  const serviceArea = input.profile?.service_area || input.scan?.region || input.client.industry
  const accountId = input.scan?.account_id ?? input.profile?.account_id ?? null

  const localVisibility = bucket(
    'local_visibility',
    (serviceArea ? 8 : 0) +
      (input.profile?.primary_services?.length ? 5 : 0) +
      statusPoints(results.c8_sitemap, 4) +
      statusPoints(results.c12_canonical, 4) +
      statusPoints(results.c15_entity, 4),
    serviceArea ? 'Your site has identifiable market or service-area signals.' : 'Your local service area is not clear enough yet.',
    serviceArea ? `Service area: ${serviceArea}` : 'No service area confirmed',
    input.profile?.primary_services?.length ? 'Local schema and entity signals need review' : 'Primary services are missing',
    'Clarify local services and service area on priority pages',
  )

  const proofDepth = bucket(
    'proof_depth',
    (input.profile?.primary_services?.length ? 5 : 0) +
      statusPoints(results.c15_entity, 7) +
      statusPoints(results.c11_faq, 5) +
      statusPoints(results.c17_citation_density, 4) +
      statusPoints(results.c18_factual_density, 4),
    'Proof depth estimates whether a cautious local buyer can verify your credibility.',
    input.profile?.primary_services?.length ? 'Primary services are identified' : 'Technical proof signals are available',
    (results.c15_entity as CheckResult | undefined)?.status === 'pass' ? 'Case-study depth still needs review' : 'Entity and credential signals are weak',
    'Add credentials, case studies, testimonials, and measurable proof near conversion points',
  )

  const aiAnswerReadiness = bucket(
    'ai_answer_readiness',
    statusPoints(results.c4_structured_data, 4) +
      statusPoints(results.c5_extractability, 5) +
      statusPoints(results.c10_headings, 4) +
      statusPoints(results.c11_faq, 4) +
      statusPoints(results.c13_render, 4) +
      statusPoints(results.c20_chunkability, 4),
    'AI answer readiness measures whether your service content can be parsed, summarized, and cited.',
    (results.c5_extractability as CheckResult | undefined)?.status === 'pass' ? 'Content is extractable' : 'Structured checks are present',
    (results.c11_faq as CheckResult | undefined)?.status === 'pass' ? 'Comparison content can improve' : 'FAQ coverage is weak',
    'Add buyer-question sections and concise service explanations',
  )

  const marketAuthority = bucket(
    'market_authority',
    Math.min(8, Math.round((input.scan?.score ?? 0) / 12.5)) +
      Math.min(8, Math.round((latestSov?.sov_score ?? 0) / 12.5)) +
      statusPoints(results.c17_citation_density, 5) +
      (input.competitors.length ? 2 : 0) +
      (input.missed.length ? 0 : 2),
    'Market authority combines AISO strength, citations, and whether competitors are winning AI answers.',
    latestSov ? `Pulse SoV: ${latestSov.sov_score}%` : 'AISO scan score is available',
    input.missed.length ? 'Competitors are still appearing in missed queries' : 'Pulse data is missing or incomplete',
    'Earn more trusted local and industry citations, then close missed Pulse queries',
  )

  const buckets = [localVisibility, proofDepth, aiAnswerReadiness, marketAuthority]
  const score = clamp(buckets.reduce((sum, item) => sum + item.score, 0))
  const draft: LocalTrustSnapshotDraft = {
    client_id: input.client.id,
    account_id: accountId,
    snapshot_month: new Date().toISOString().slice(0, 7) + '-01',
    local_trust_score: score,
    bucket_scores: buckets,
    trust_gaps: [],
    roi_estimate: null,
    source_scan_id: input.scan?.id ?? null,
    source_pulse_week: latestSov?.scan_week ?? null,
  }

  draft.trust_gaps = buildGaps(input, buckets)
  draft.roi_estimate = estimateRoi({
    currentSnapshot: draft,
    averageLeadValue: input.profile?.average_lead_value,
    closeRate: input.profile?.close_rate,
  })
  return draft
}
```

- [ ] **Step 6: Add module exports**

Create `lib/localTrust/index.ts`:

```ts
export type { EstimateRoiInput, LocalTrustInput, LocalTrustSnapshotDraft } from './types'
export { calculateLocalTrust } from './scoring'
export { estimateRoi } from './roi'
```

- [ ] **Step 7: Run Local Trust tests and commit**

Run:

```bash
npm test -- __tests__/lib/local-trust.test.ts
```

Expected: all Local Trust tests pass.

Commit:

```bash
git add lib/localTrust __tests__/lib/local-trust.test.ts
git commit -m "feat(local-trust): add deterministic scoring"
```

---

## Task 3: Local Trust Persistence And Mutation Routes

**Files:**
- Create: `lib/localTrust/store.ts`
- Create: `app/api/dashboard/clients/[clientId]/local-trust/profile/route.ts`
- Create: `app/api/dashboard/clients/[clientId]/local-trust/actions/[actionId]/route.ts`
- Test: `__tests__/api/local-trust-routes.test.ts`

- [ ] **Step 1: Write failing route tests**

Create `__tests__/api/local-trust-routes.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetProfile, mockFrom } = vi.hoisted(() => ({
  mockGetProfile: vi.fn(),
  mockFrom: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getProfile: mockGetProfile }))
vi.mock('@/lib/supabase-server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({ from: mockFrom })),
}))

function chain(data: unknown = null, error: unknown = null) {
  const single = vi.fn(async () => ({ data, error }))
  const eq = vi.fn(() => ({ eq, single, select: vi.fn(() => ({ single })) }))
  const select = vi.fn(() => ({ eq, single }))
  const upsert = vi.fn(() => ({ select: vi.fn(() => ({ single })) }))
  const update = vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ select: vi.fn(() => ({ single })) })) })) }))
  return { select, eq, single, upsert, update }
}

import { PUT as PUT_PROFILE } from '@/app/api/dashboard/clients/[clientId]/local-trust/profile/route'
import { PATCH as PATCH_ACTION } from '@/app/api/dashboard/clients/[clientId]/local-trust/actions/[actionId]/route'

describe('Local Trust profile route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetProfile.mockResolvedValue({
      account_id: 'account-1',
      accounts: { plan: 'pro' },
    })
  })

  it('rejects unauthenticated profile updates', async () => {
    mockGetProfile.mockResolvedValue(null)
    const req = new Request('http://localhost/api/dashboard/clients/client-1/local-trust/profile', { method: 'PUT', body: '{}' })
    const res = await PUT_PROFILE(req, { params: Promise.resolve({ clientId: 'client-1' }) })
    expect(res.status).toBe(401)
  })

  it('rejects Basic users', async () => {
    mockGetProfile.mockResolvedValue({ account_id: 'account-1', accounts: { plan: 'basic' } })
    const req = new Request('http://localhost/api/dashboard/clients/client-1/local-trust/profile', { method: 'PUT', body: '{}' })
    const res = await PUT_PROFILE(req, { params: Promise.resolve({ clientId: 'client-1' }) })
    expect(res.status).toBe(403)
  })

  it('upserts sanitized owner assumptions for owned clients', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'clients') return chain({ id: 'client-1' })
      if (table === 'local_trust_profiles') return chain({ id: 'profile-1', client_id: 'client-1' })
      return chain()
    })
    const req = new Request('http://localhost/api/dashboard/clients/client-1/local-trust/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        primary_services: [' Tax Advisory ', ''],
        service_area: ' Hong Kong ',
        average_lead_value: '20000',
        close_rate: '0.25',
        competitors: [' rival.example ', ''],
      }),
    })
    const res = await PUT_PROFILE(req, { params: Promise.resolve({ clientId: 'client-1' }) })
    expect(res.status).toBe(200)
  })
})

describe('Local Trust action route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetProfile.mockResolvedValue({
      account_id: 'account-1',
      accounts: { plan: 'pro' },
    })
  })

  it('rejects invalid action statuses', async () => {
    const req = new Request('http://localhost/api/dashboard/clients/client-1/local-trust/actions/action-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'archived' }),
    })
    const res = await PATCH_ACTION(req, { params: Promise.resolve({ clientId: 'client-1', actionId: 'action-1' }) })
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run route tests and verify they fail**

Run:

```bash
npm test -- __tests__/api/local-trust-routes.test.ts
```

Expected: fails because the routes do not exist.

- [ ] **Step 3: Add store helper**

Create `lib/localTrust/store.ts`:

```ts
import { createServerSupabaseClient } from '@/lib/supabase-server'
import type {
  AgentCompetitor,
  Client,
  LocalTrustAction,
  LocalTrustActionStatus,
  LocalTrustProfile,
  LocalTrustSnapshot,
  PulseMetric,
  PulseWeeklySummary,
  Scan,
} from '@/lib/types'
import { calculateLocalTrust } from './scoring'
import type { LocalTrustSnapshotDraft } from './types'

export async function verifyClientOwnership(clientId: string, accountId: string): Promise<Client | null> {
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase
    .from('clients')
    .select('*')
    .eq('id', clientId)
    .eq('account_id', accountId)
    .single()
  return (data ?? null) as Client | null
}

export async function getLocalTrustProfile(clientId: string): Promise<LocalTrustProfile | null> {
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase
    .from('local_trust_profiles')
    .select('*')
    .eq('client_id', clientId)
    .single()
  return (data ?? null) as LocalTrustProfile | null
}

export async function upsertLocalTrustProfile(input: {
  clientId: string
  accountId: string
  primaryServices: string[]
  serviceArea: string | null
  averageLeadValue: number | null
  closeRate: number | null
  competitors: string[]
}): Promise<LocalTrustProfile> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('local_trust_profiles')
    .upsert({
      client_id: input.clientId,
      account_id: input.accountId,
      primary_services: input.primaryServices,
      service_area: input.serviceArea,
      average_lead_value: input.averageLeadValue,
      close_rate: input.closeRate,
      competitors: input.competitors,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'client_id' })
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data as LocalTrustProfile
}

export async function updateLocalTrustActionStatus(input: {
  clientId: string
  actionId: string
  status: LocalTrustActionStatus
}): Promise<LocalTrustAction> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('local_trust_actions')
    .update({ status: input.status, updated_at: new Date().toISOString() })
    .eq('id', input.actionId)
    .eq('client_id', input.clientId)
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data as LocalTrustAction
}

export async function getOrCreateLocalTrustSnapshot(input: {
  client: Client
  accountId: string
  latestScan: Scan | null
  profile: LocalTrustProfile | null
  pulseSummary: PulseWeeklySummary[]
  missed: PulseMetric[]
  competitors: AgentCompetitor[]
}): Promise<{ snapshot: LocalTrustSnapshot; actions: LocalTrustAction[]; draft: LocalTrustSnapshotDraft }> {
  const supabase = await createServerSupabaseClient()
  const draft = calculateLocalTrust({
    client: input.client,
    profile: input.profile,
    scan: input.latestScan,
    pulseSummary: input.pulseSummary,
    missed: input.missed,
    competitors: input.competitors,
  })

  const { data: snapshot, error } = await supabase
    .from('local_trust_snapshots')
    .upsert({
      client_id: input.client.id,
      account_id: input.accountId,
      snapshot_month: draft.snapshot_month,
      local_trust_score: draft.local_trust_score,
      bucket_scores: draft.bucket_scores,
      trust_gaps: draft.trust_gaps,
      roi_estimate: draft.roi_estimate,
      source_scan_id: draft.source_scan_id,
      source_pulse_week: draft.source_pulse_week,
    }, { onConflict: 'client_id,snapshot_month' })
    .select()
    .single()

  if (error) throw new Error(error.message)

  const snapshotId = (snapshot as LocalTrustSnapshot).id
  const actionRows = draft.trust_gaps.map(gap => ({
    client_id: input.client.id,
    snapshot_id: snapshotId,
    stable_key: gap.stableKey,
    title: gap.title,
    bucket: gap.bucket,
    impact: gap.impact,
    effort: gap.effort,
    status: 'open' as LocalTrustActionStatus,
  }))

  if (actionRows.length > 0) {
    await supabase
      .from('local_trust_actions')
      .upsert(actionRows, { onConflict: 'snapshot_id,stable_key', ignoreDuplicates: true })
  }

  const { data: actions } = await supabase
    .from('local_trust_actions')
    .select('*')
    .eq('snapshot_id', snapshotId)
    .order('created_at')

  return {
    snapshot: snapshot as LocalTrustSnapshot,
    actions: (actions ?? []) as LocalTrustAction[],
    draft,
  }
}
```

- [ ] **Step 4: Add profile route**

Create `app/api/dashboard/clients/[clientId]/local-trust/profile/route.ts`:

```ts
import { getProfile } from '@/lib/auth'
import { planAllows } from '@/lib/tier'
import { upsertLocalTrustProfile, verifyClientOwnership } from '@/lib/localTrust/store'

function textArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(item => String(item).trim()).filter(Boolean).slice(0, 10)
}

function nullableText(value: unknown): string | null {
  const text = String(value ?? '').trim()
  return text ? text : null
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params
  const profile = await getProfile()
  if (!profile) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const plan = profile.accounts?.plan ?? 'basic'
  if (!planAllows(plan, 'local_trust_roi')) {
    return Response.json({ error: 'UPGRADE_REQUIRED', feature: 'local_trust_roi', plan }, { status: 403 })
  }

  const client = await verifyClientOwnership(clientId, profile.account_id)
  if (!client) return Response.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  const closeRate = nullableNumber(body.close_rate)
  if (closeRate !== null && closeRate > 1) {
    return Response.json({ error: 'close_rate must be between 0 and 1' }, { status: 400 })
  }

  const data = await upsertLocalTrustProfile({
    clientId,
    accountId: profile.account_id,
    primaryServices: textArray(body.primary_services),
    serviceArea: nullableText(body.service_area),
    averageLeadValue: nullableNumber(body.average_lead_value),
    closeRate,
    competitors: textArray(body.competitors),
  })

  return Response.json({ profile: data })
}
```

- [ ] **Step 5: Add action route**

Create `app/api/dashboard/clients/[clientId]/local-trust/actions/[actionId]/route.ts`:

```ts
import { getProfile } from '@/lib/auth'
import { updateLocalTrustActionStatus, verifyClientOwnership } from '@/lib/localTrust/store'
import { planAllows } from '@/lib/tier'
import type { LocalTrustActionStatus } from '@/lib/types'

const VALID_STATUSES = new Set<LocalTrustActionStatus>(['open', 'planned', 'done', 'skipped'])

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ clientId: string; actionId: string }> }
) {
  const { clientId, actionId } = await params
  const profile = await getProfile()
  if (!profile) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const plan = profile.accounts?.plan ?? 'basic'
  if (!planAllows(plan, 'local_trust_roi')) {
    return Response.json({ error: 'UPGRADE_REQUIRED', feature: 'local_trust_roi', plan }, { status: 403 })
  }

  const client = await verifyClientOwnership(clientId, profile.account_id)
  if (!client) return Response.json({ error: 'Not found' }, { status: 404 })

  const { status } = await req.json()
  if (!VALID_STATUSES.has(status)) {
    return Response.json({ error: 'Invalid status' }, { status: 400 })
  }

  const action = await updateLocalTrustActionStatus({ clientId, actionId, status })
  return Response.json({ action })
}
```

- [ ] **Step 6: Run route tests and commit**

Run:

```bash
npm test -- __tests__/api/local-trust-routes.test.ts
```

Expected: all Local Trust route tests pass. If the provided mock chain is too narrow for the final store calls, update only the mock helpers in the test file; do not weaken route assertions.

Commit:

```bash
git add lib/localTrust/store.ts app/api/dashboard/clients/[clientId]/local-trust __tests__/api/local-trust-routes.test.ts
git commit -m "feat(local-trust): add persistence routes"
```

---

## Task 4: Dashboard Step Plumbing

**Files:**
- Modify: `components/dashboard/local-trust/LocalTrustStep.tsx`
- Modify: `app/[lang]/dashboard/[clientId]/page.tsx`
- Modify: `components/dashboard/DashboardSidebar.tsx`
- Modify: `components/dashboard/WizardProgress.tsx`
- Modify: `messages/en.json`
- Modify: `messages/zh-HK.json`
- Test: `__tests__/components/local-trust.test.tsx`

- [ ] **Step 1: Add failing navigation/content tests**

Create the first part of `__tests__/components/local-trust.test.tsx`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = process.cwd()

describe('Local Trust dashboard wiring', () => {
  it('adds ROI as the fifth dashboard workflow step', () => {
    const sidebar = readFileSync(join(repoRoot, 'components/dashboard/DashboardSidebar.tsx'), 'utf8')
    const page = readFileSync(join(repoRoot, 'app/[lang]/dashboard/[clientId]/page.tsx'), 'utf8')

    expect(sidebar).toContain(\"key: 'roi'\")
    expect(sidebar).toContain('nav_roi')
    expect(page).toContain(\"step === 'roi'\")
    expect(page).toContain('LocalTrustStep')
  })

  it('contains English and Traditional Chinese Local Trust copy keys', () => {
    const en = readFileSync(join(repoRoot, 'messages/en.json'), 'utf8')
    const zh = readFileSync(join(repoRoot, 'messages/zh-HK.json'), 'utf8')

    expect(en).toContain('step_roi_title')
    expect(en).toContain('local_trust_score')
    expect(zh).toContain('step_roi_title')
    expect(zh).toContain('local_trust_score')
  })
})
```

- [ ] **Step 2: Run component wiring tests and verify they fail**

Run:

```bash
npm test -- __tests__/components/local-trust.test.tsx
```

Expected: fails because ROI step copy and components are not wired.

- [ ] **Step 3: Add dashboard copy**

In `messages/en.json`, inside `"dashboard"`, add:

```json
"step_roi_title": "Prove local trust and ROI",
"step_roi_body": "Show owners how local trust, AI visibility, completed fixes, and estimated enquiry value are moving over time.",
"step_roi_locked": "Upgrade to Pro to unlock Local Trust ROI: owner-friendly trust scoring, action priorities, and proof of progress.",
"nav_roi": "ROI",
"nav_roi_desc": "Local trust and owner proof",
"local_trust_score": "Local Trust Score",
"local_trust_locked_title": "Local Trust ROI",
"local_trust_locked_body": "Show how local trust, AI visibility, and completed fixes translate into owner-ready progress.",
"owner_summary": "Owner Summary",
"trust_gap_checklist": "Trust Gap Checklist",
"roi_timeline": "ROI Proof Timeline",
"competitor_snapshot": "Local Competitor Snapshot",
"setup_local_trust": "Set up Local Trust ROI",
"setup_local_trust_body": "Add your services, service area, and lead assumptions to unlock clearer ROI estimates.",
"primary_services": "Primary services",
"service_area": "Service area",
"average_lead_value": "Average lead value",
"close_rate": "Close rate",
"competitors": "Competitors",
"save_assumptions": "Save assumptions",
"estimated_value": "Estimated value range",
"directional_estimate": "Directional estimate based on your assumptions",
"no_roi_estimate": "Add average lead value and close rate to estimate enquiry value.",
"export_report": "Export report",
"print_report": "Print report",
"mark_done": "Done",
"mark_skipped": "Skip"
```

In `messages/zh-HK.json`, inside `"dashboard"`, add equivalent Traditional Chinese keys:

```json
"step_roi_title": "證明本地信任及 ROI",
"step_roi_body": "向老闆展示本地信任、AI 能見度、已完成修復及預估查詢價值如何隨時間改善。",
"step_roi_locked": "升級至專業版即可解鎖 Local Trust ROI：老闆易明的信任評分、行動優先次序及進度證明。",
"nav_roi": "ROI",
"nav_roi_desc": "本地信任及成效證明",
"local_trust_score": "本地信任評分",
"local_trust_locked_title": "Local Trust ROI",
"local_trust_locked_body": "展示本地信任、AI 能見度及已完成修復如何轉化為老闆易明的進度。",
"owner_summary": "老闆摘要",
"trust_gap_checklist": "信任缺口清單",
"roi_timeline": "ROI 成效時間線",
"competitor_snapshot": "本地競爭對手概覽",
"setup_local_trust": "設定 Local Trust ROI",
"setup_local_trust_body": "加入你的服務、服務地區及潛在客戶假設，以獲得更清晰的 ROI 估算。",
"primary_services": "主要服務",
"service_area": "服務地區",
"average_lead_value": "平均潛在客戶價值",
"close_rate": "成交率",
"competitors": "競爭對手",
"save_assumptions": "儲存假設",
"estimated_value": "預估價值範圍",
"directional_estimate": "根據你的假設作方向性估算",
"no_roi_estimate": "加入平均潛在客戶價值及成交率，即可估算查詢價值。",
"export_report": "匯出報告",
"print_report": "列印報告",
"mark_done": "完成",
"mark_skipped": "略過"
```

- [ ] **Step 4: Add ROI nav step**

In `components/dashboard/DashboardSidebar.tsx`, add `TrendingUp` to the lucide import and add ROI to `STEPS` after monitor:

```ts
{ key: 'roi', labelKey: 'nav_roi', icon: TrendingUp, descKey: 'nav_roi_desc' },
```

Update the locked condition:

```ts
const locked = (s.key === 'improve' && !features.agent_recs) ||
                (s.key === 'roi' && !features.local_trust_roi) ||
                (s.key === 'results' && !brandId)
```

- [ ] **Step 5: Add ROI to `WizardProgress` if retained**

In `components/dashboard/WizardProgress.tsx`, add:

```ts
{ key: 'roi', label: 'ROI' },
```

And add access:

```ts
roi: { accessible: hasScan && features.local_trust_roi, reason: !features.local_trust_roi ? 'Pro plan required for Local Trust ROI' : undefined },
```

- [ ] **Step 6: Wire dashboard page to Local Trust step**

In `app/[lang]/dashboard/[clientId]/page.tsx`, import:

```ts
import { LocalTrustStep } from '@/components/dashboard/local-trust/LocalTrustStep'
import { getLocalTrustProfile, getOrCreateLocalTrustSnapshot } from '@/lib/localTrust/store'
import type { Client } from '@/lib/types'
```

Update `StepHeader` info:

```ts
roi: {
  title: t('step_roi_title'),
  body: features.local_trust_roi ? t('step_roi_body') : t('step_roi_locked'),
},
```

Update the client query to fetch the full `Client` shape needed by Local Trust:

```ts
const { data: client } = await supabase
  .from('clients').select('id, brand_name, domain, industry, competitors, status, created_at')
  .eq('id', clientId).eq('account_id', profile.account_id).single()
```

Fetch Local Trust data only when `step === 'roi'`:

```ts
const localTrustProfile = step === 'roi' ? await getLocalTrustProfile(clientId) : null
const localTrustData = step === 'roi'
  ? await getOrCreateLocalTrustSnapshot({
      client: client as Client,
      accountId: profile.account_id,
      latestScan: scan,
      profile: localTrustProfile,
      pulseSummary: summary,
      missed,
      competitors: (agentComps ?? []) as AgentCompetitor[],
    })
  : null
```

Add render branch:

```tsx
{step === 'roi' && (
  <LocalTrustStep
    lang={lang}
    clientId={clientId}
    plan={plan}
    profile={localTrustProfile}
    snapshot={localTrustData?.snapshot ?? null}
    actions={localTrustData?.actions ?? []}
    competitors={(agentComps ?? []) as AgentCompetitor[]}
  />
)}
```

- [ ] **Step 7: Create a compiling LocalTrustStep shell**

Create `components/dashboard/local-trust/LocalTrustStep.tsx`:

```tsx
import type { AgentCompetitor, LocalTrustAction, LocalTrustProfile, LocalTrustSnapshot } from '@/lib/types'

type Props = {
  lang: string
  clientId: string
  plan: string
  profile: LocalTrustProfile | null
  snapshot: LocalTrustSnapshot | null
  actions: LocalTrustAction[]
  competitors: AgentCompetitor[]
}

export function LocalTrustStep({ snapshot }: Props) {
  return (
    <div className="rounded-xl border border-dash-border bg-dash-surface p-6">
      <p className="text-sm font-semibold text-dash-text">Local Trust ROI</p>
      <p className="mt-1 text-xs text-dash-muted">
        {snapshot ? `Local trust score: ${snapshot.local_trust_score}/100` : 'Run a scan and add assumptions to generate your first ROI view.'}
      </p>
    </div>
  )
}
```

- [ ] **Step 8: Run component wiring tests and commit**

Run:

```bash
npm test -- __tests__/components/local-trust.test.tsx
```

Expected: wiring tests pass with the LocalTrustStep shell.

Commit after Task 5 if Task 4 cannot compile without the new component:

```bash
git add app/[lang]/dashboard/[clientId]/page.tsx components/dashboard/DashboardSidebar.tsx components/dashboard/WizardProgress.tsx components/dashboard/local-trust/LocalTrustStep.tsx messages/en.json messages/zh-HK.json __tests__/components/local-trust.test.tsx
git commit -m "feat(local-trust): wire dashboard roi step"
```

---

## Task 5: Local Trust ROI Read-Only UI

**Files:**
- Create: `components/dashboard/local-trust/LocalTrustStep.tsx`
- Create: `components/dashboard/local-trust/LocalTrustLockedPreview.tsx`
- Create: `components/dashboard/local-trust/OwnerSummary.tsx`
- Create: `components/dashboard/local-trust/LocalTrustScorePanel.tsx`
- Create: `components/dashboard/local-trust/RoiTimeline.tsx`
- Create: `components/dashboard/local-trust/CompetitorSnapshot.tsx`
- Test: `__tests__/components/local-trust.test.tsx`

- [ ] **Step 1: Add failing read-only UI tests**

Append to `__tests__/components/local-trust.test.tsx`:

```ts
import { renderToStaticMarkup } from 'react-dom/server'

describe('Local Trust UI components', () => {
  it('renders a locked preview for Basic users', async () => {
    const { LocalTrustLockedPreview } = await import('@/components/dashboard/local-trust/LocalTrustLockedPreview')
    const html = renderToStaticMarkup(<LocalTrustLockedPreview />)
    expect(html).toContain('Local Trust ROI')
    expect(html).toContain('Upgrade')
  })

  it('renders score buckets and owner summary for Pro users', async () => {
    const { LocalTrustScorePanel } = await import('@/components/dashboard/local-trust/LocalTrustScorePanel')
    const html = renderToStaticMarkup(
      <LocalTrustScorePanel
        score={71}
        buckets={[
          { key: 'local_visibility', label: 'Local visibility', score: 18, maxScore: 25, explanation: 'Good local signals.', strongestSignal: 'HK service area', weakestSignal: 'Schema', topAction: 'Clarify services' },
          { key: 'proof_depth', label: 'Proof depth', score: 14, maxScore: 25, explanation: 'Proof needs work.', strongestSignal: 'Services', weakestSignal: 'Case studies', topAction: 'Add proof' },
          { key: 'ai_answer_readiness', label: 'AI answer readiness', score: 20, maxScore: 25, explanation: 'Readable content.', strongestSignal: 'Extractable text', weakestSignal: 'FAQs', topAction: 'Add FAQs' },
          { key: 'market_authority', label: 'Market authority', score: 19, maxScore: 25, explanation: 'Some authority.', strongestSignal: 'Pulse', weakestSignal: 'Citations', topAction: 'Earn citations' },
        ]}
      />
    )
    expect(html).toContain('71')
    expect(html).toContain('Local visibility')
    expect(html).toContain('Proof depth')
  })
})
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
npm test -- __tests__/components/local-trust.test.tsx
```

Expected: fails because components do not exist.

- [ ] **Step 3: Add locked preview**

Create `components/dashboard/local-trust/LocalTrustLockedPreview.tsx`:

```tsx
import Link from 'next/link'

export function LocalTrustLockedPreview({ lang = 'en' }: { lang?: string }) {
  return (
    <div className="rounded-xl border border-dash-border bg-dash-surface p-6">
      <div className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-dash-muted">Local Trust ROI</p>
        <h3 className="mt-2 text-lg font-bold text-dash-text">Prove local trust and owner ROI</h3>
        <p className="mt-1 text-xs leading-relaxed text-dash-muted">
          Unlock local trust scoring, prioritized proof gaps, and a monthly ROI timeline for SME owners.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3 opacity-70">
        {[
          ['Local Trust', '71/100'],
          ['Fixes shipped', '6'],
          ['Estimated value', 'HKD 12k-28k'],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-dash-border bg-dash-elevated p-4">
            <p className="text-[10px] uppercase tracking-widest text-dash-muted">{label}</p>
            <p className="mt-2 text-xl font-black text-dash-text">{value}</p>
          </div>
        ))}
      </div>
      <Link
        href={`/${lang}/pricing`}
        className="mt-5 inline-flex rounded-lg bg-dash-accent px-4 py-2 text-sm font-semibold text-primary-foreground"
      >
        Upgrade to Pro
      </Link>
    </div>
  )
}
```

- [ ] **Step 4: Add score panel**

Create `components/dashboard/local-trust/LocalTrustScorePanel.tsx`:

```tsx
import type { LocalTrustBucketScore } from '@/lib/types'

type Props = {
  score: number
  buckets: LocalTrustBucketScore[]
}

export function LocalTrustScorePanel({ score, buckets }: Props) {
  return (
    <section className="rounded-xl border border-dash-border bg-dash-surface p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-dash-muted">Local Trust Score</p>
          <p className="mt-2 text-4xl font-black text-dash-text">{score}</p>
        </div>
        <span className="rounded-full bg-dash-accent/10 px-3 py-1 text-xs font-semibold text-dash-accent">/100</span>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {buckets.map(bucket => (
          <article key={bucket.key} className="rounded-lg border border-dash-border bg-dash-elevated p-4">
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-sm font-semibold text-dash-text">{bucket.label}</h4>
              <span className="font-mono text-xs font-bold text-dash-accent">{bucket.score}/{bucket.maxScore}</span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-dash-muted">{bucket.explanation}</p>
            <dl className="mt-3 space-y-1 text-[11px] text-dash-muted">
              <div><dt className="inline font-semibold text-dash-text">Strongest: </dt><dd className="inline">{bucket.strongestSignal}</dd></div>
              <div><dt className="inline font-semibold text-dash-text">Weakest: </dt><dd className="inline">{bucket.weakestSignal}</dd></div>
            </dl>
          </article>
        ))}
      </div>
    </section>
  )
}
```

- [ ] **Step 5: Add owner summary**

Create `components/dashboard/local-trust/OwnerSummary.tsx`:

```tsx
import type { LocalTrustAction, LocalTrustSnapshot } from '@/lib/types'

export function OwnerSummary({ snapshot, actions }: { snapshot: LocalTrustSnapshot; actions: LocalTrustAction[] }) {
  const topAction = actions.find(action => action.status === 'open') ?? actions[0]
  const weakestBucket = [...snapshot.bucket_scores].sort((a, b) => a.score - b.score)[0]

  return (
    <section className="rounded-xl border border-dash-border bg-dash-surface p-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-dash-muted">Owner Summary</p>
      <p className="mt-3 text-sm leading-relaxed text-dash-text">
        Your local trust score is <strong>{snapshot.local_trust_score}/100</strong>.
        {weakestBucket ? ` The biggest gap is ${weakestBucket.label.toLowerCase()}: ${weakestBucket.topAction}.` : ''}
        {topAction ? ` Next best action: ${topAction.title}.` : ''}
      </p>
    </section>
  )
}
```

- [ ] **Step 6: Add ROI timeline**

Create `components/dashboard/local-trust/RoiTimeline.tsx`:

```tsx
import type { LocalTrustSnapshot } from '@/lib/types'

export function RoiTimeline({ snapshots }: { snapshots: LocalTrustSnapshot[] }) {
  return (
    <section className="rounded-xl border border-dash-border bg-dash-surface p-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-dash-muted">ROI Proof Timeline</p>
      <div className="mt-4 space-y-3">
        {snapshots.map(snapshot => (
          <article key={snapshot.id} className="rounded-lg border border-dash-border bg-dash-elevated p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-dash-text">{new Date(snapshot.snapshot_month).toLocaleDateString('en-HK', { month: 'short', year: 'numeric' })}</p>
              <p className="font-mono text-sm font-bold text-dash-accent">{snapshot.local_trust_score}/100</p>
            </div>
            {snapshot.roi_estimate ? (
              <p className="mt-2 text-xs text-dash-muted">
                Estimated value range: HKD {snapshot.roi_estimate.low.toLocaleString()}-{snapshot.roi_estimate.high.toLocaleString()}
              </p>
            ) : (
              <p className="mt-2 text-xs text-dash-muted">Add average lead value and close rate to estimate enquiry value.</p>
            )}
          </article>
        ))}
      </div>
    </section>
  )
}
```

- [ ] **Step 7: Add competitor snapshot**

Create `components/dashboard/local-trust/CompetitorSnapshot.tsx`:

```tsx
import type { AgentCompetitor } from '@/lib/types'

export function CompetitorSnapshot({ competitors }: { competitors: AgentCompetitor[] }) {
  if (!competitors.length) {
    return (
      <section className="rounded-xl border border-dash-border bg-dash-surface p-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-dash-muted">Local Competitor Snapshot</p>
        <p className="mt-2 text-xs text-dash-muted">Add competitors or run agent analysis to compare local trust gaps.</p>
      </section>
    )
  }

  return (
    <section className="rounded-xl border border-dash-border bg-dash-surface p-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-dash-muted">Local Competitor Snapshot</p>
      <div className="mt-4 divide-y divide-dash-border rounded-lg border border-dash-border">
        {competitors.slice(0, 5).map(row => (
          <article key={`${row.platform}-${row.competitor_domain}`} className="p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-dash-text">{row.competitor_name ?? row.competitor_domain}</p>
              <p className="font-mono text-xs text-dash-muted">{row.mention_rate}% vs {row.your_rate}%</p>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-dash-muted">{row.gap_analysis}</p>
          </article>
        ))}
      </div>
    </section>
  )
}
```

- [ ] **Step 8: Expand LocalTrustStep wrapper**

Replace the shell in `components/dashboard/local-trust/LocalTrustStep.tsx` with:

```tsx
import { getPlanFeatures } from '@/lib/tier'
import type { AgentCompetitor, LocalTrustAction, LocalTrustProfile, LocalTrustSnapshot } from '@/lib/types'
import { CompetitorSnapshot } from './CompetitorSnapshot'
import { LocalTrustLockedPreview } from './LocalTrustLockedPreview'
import { LocalTrustScorePanel } from './LocalTrustScorePanel'
import { OwnerSummary } from './OwnerSummary'
import { RoiTimeline } from './RoiTimeline'

type Props = {
  lang: string
  clientId: string
  plan: string
  profile: LocalTrustProfile | null
  snapshot: LocalTrustSnapshot | null
  actions: LocalTrustAction[]
  competitors: AgentCompetitor[]
}

export function LocalTrustStep({ lang, plan, snapshot, actions, competitors }: Props) {
  const features = getPlanFeatures(plan)

  if (!features.local_trust_roi) {
    return <LocalTrustLockedPreview lang={lang} />
  }

  if (!snapshot) {
    return (
      <div className="rounded-xl border border-dash-border bg-dash-surface p-8 text-center">
        <p className="text-sm font-semibold text-dash-text">Set up Local Trust ROI</p>
        <p className="mt-1 text-xs text-dash-muted">Run a scan and add owner assumptions to generate your first snapshot.</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <OwnerSummary snapshot={snapshot} actions={actions} />
      <LocalTrustScorePanel score={snapshot.local_trust_score} buckets={snapshot.bucket_scores} />
      <RoiTimeline snapshots={[snapshot]} />
      {features.local_trust_competitors ? (
        <CompetitorSnapshot competitors={competitors} />
      ) : (
        <div className="rounded-xl border border-dash-border bg-dash-surface p-5 text-center">
          <p className="text-sm font-semibold text-dash-text">Local Competitor Snapshot</p>
          <p className="mt-1 text-xs text-dash-muted">Available on Enterprise.</p>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 9: Run component tests and commit**

Run:

```bash
npm test -- __tests__/components/local-trust.test.tsx
```

Expected: all component tests pass.

Commit:

```bash
git add components/dashboard/local-trust __tests__/components/local-trust.test.tsx app/[lang]/dashboard/[clientId]/page.tsx components/dashboard/DashboardSidebar.tsx components/dashboard/WizardProgress.tsx messages/en.json messages/zh-HK.json
git commit -m "feat(local-trust): add roi dashboard view"
```

---

## Task 6: Owner Setup Form And Trust Gap Checklist Interactions

**Files:**
- Create: `components/dashboard/local-trust/LocalTrustSetupForm.tsx`
- Create: `components/dashboard/local-trust/TrustGapChecklist.tsx`
- Modify: `components/dashboard/local-trust/LocalTrustStep.tsx`
- Test: `__tests__/components/local-trust.test.tsx`

- [ ] **Step 1: Add failing interactive component tests**

Append:

```ts
describe('Local Trust interactive controls', () => {
  it('renders setup form fields', async () => {
    const { LocalTrustSetupForm } = await import('@/components/dashboard/local-trust/LocalTrustSetupForm')
    const html = renderToStaticMarkup(<LocalTrustSetupForm clientId="client-1" profile={null} />)
    expect(html).toContain('name="service_area"')
    expect(html).toContain('name="average_lead_value"')
    expect(html).toContain('name="close_rate"')
  })

  it('renders action status controls', async () => {
    const { TrustGapChecklist } = await import('@/components/dashboard/local-trust/TrustGapChecklist')
    const html = renderToStaticMarkup(
      <TrustGapChecklist
        clientId="client-1"
        actions={[{
          id: 'action-1',
          client_id: 'client-1',
          snapshot_id: 'snapshot-1',
          stable_key: 'add-local-proof',
          title: 'Add local proof',
          bucket: 'proof_depth',
          impact: 'high',
          effort: 'low',
          status: 'open',
          created_at: '',
          updated_at: '',
        }]}
      />
    )
    expect(html).toContain('Add local proof')
    expect(html).toContain('Done')
    expect(html).toContain('Skip')
  })
})
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
npm test -- __tests__/components/local-trust.test.tsx
```

Expected: fails because form and checklist components do not exist.

- [ ] **Step 3: Add setup form**

Create `components/dashboard/local-trust/LocalTrustSetupForm.tsx`:

```tsx
'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { LocalTrustProfile } from '@/lib/types'

export function LocalTrustSetupForm({ clientId, profile }: { clientId: string; profile: LocalTrustProfile | null }) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
    const form = new FormData(event.currentTarget)
    const body = {
      primary_services: String(form.get('primary_services') ?? '').split(',').map(value => value.trim()).filter(Boolean),
      service_area: form.get('service_area'),
      average_lead_value: form.get('average_lead_value'),
      close_rate: form.get('close_rate'),
      competitors: String(form.get('competitors') ?? '').split(',').map(value => value.trim()).filter(Boolean),
    }

    const res = await fetch(`/api/dashboard/clients/${clientId}/local-trust/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? 'Could not save assumptions')
      setSaving(false)
      return
    }
    router.refresh()
    setSaving(false)
  }

  return (
    <form onSubmit={onSubmit} className="rounded-xl border border-dash-border bg-dash-surface p-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-dash-muted">Set up Local Trust ROI</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-dash-muted">
          Primary services
          <input name="primary_services" defaultValue={profile?.primary_services.join(', ') ?? ''} className="mt-1 w-full rounded-lg border border-dash-border bg-dash-elevated px-3 py-2 text-sm text-dash-text" />
        </label>
        <label className="text-xs font-medium text-dash-muted">
          Service area
          <input name="service_area" defaultValue={profile?.service_area ?? ''} className="mt-1 w-full rounded-lg border border-dash-border bg-dash-elevated px-3 py-2 text-sm text-dash-text" />
        </label>
        <label className="text-xs font-medium text-dash-muted">
          Average lead value
          <input name="average_lead_value" type="number" min="0" defaultValue={profile?.average_lead_value ?? ''} className="mt-1 w-full rounded-lg border border-dash-border bg-dash-elevated px-3 py-2 text-sm text-dash-text" />
        </label>
        <label className="text-xs font-medium text-dash-muted">
          Close rate
          <input name="close_rate" type="number" min="0" max="1" step="0.01" defaultValue={profile?.close_rate ?? ''} className="mt-1 w-full rounded-lg border border-dash-border bg-dash-elevated px-3 py-2 text-sm text-dash-text" />
        </label>
        <label className="sm:col-span-2 text-xs font-medium text-dash-muted">
          Competitors
          <input name="competitors" defaultValue={profile?.competitors.join(', ') ?? ''} className="mt-1 w-full rounded-lg border border-dash-border bg-dash-elevated px-3 py-2 text-sm text-dash-text" />
        </label>
      </div>
      {error && <p className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
      <button disabled={saving} className="mt-4 rounded-lg bg-dash-accent px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
        {saving ? 'Saving...' : 'Save assumptions'}
      </button>
    </form>
  )
}
```

- [ ] **Step 4: Add checklist**

Create `components/dashboard/local-trust/TrustGapChecklist.tsx`:

```tsx
'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { LocalTrustAction, LocalTrustActionStatus } from '@/lib/types'

export function TrustGapChecklist({ clientId, actions }: { clientId: string; actions: LocalTrustAction[] }) {
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)

  async function updateStatus(actionId: string, status: LocalTrustActionStatus) {
    setBusyId(actionId)
    await fetch(`/api/dashboard/clients/${clientId}/local-trust/actions/${actionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    router.refresh()
    setBusyId(null)
  }

  return (
    <section className="rounded-xl border border-dash-border bg-dash-surface p-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-dash-muted">Trust Gap Checklist</p>
      <div className="mt-4 space-y-3">
        {actions.map(action => (
          <article key={action.id} className="rounded-lg border border-dash-border bg-dash-elevated p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-dash-text">{action.title}</p>
                <p className="mt-1 text-[11px] uppercase tracking-widest text-dash-muted">{action.impact} impact · {action.effort} effort · {action.status}</p>
              </div>
              <div className="flex gap-2">
                <button disabled={busyId === action.id} onClick={() => updateStatus(action.id, 'done')} className="rounded-md bg-dash-accent px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50">Done</button>
                <button disabled={busyId === action.id} onClick={() => updateStatus(action.id, 'skipped')} className="rounded-md border border-dash-border px-3 py-1.5 text-xs font-semibold text-dash-muted disabled:opacity-50">Skip</button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
```

- [ ] **Step 5: Render form and checklist in `LocalTrustStep`**

Update imports:

```ts
import { LocalTrustSetupForm } from './LocalTrustSetupForm'
import { TrustGapChecklist } from './TrustGapChecklist'
```

In the Pro/Enterprise render, include:

```tsx
<LocalTrustSetupForm clientId={clientId} profile={profile} />
<OwnerSummary snapshot={snapshot} actions={actions} />
<LocalTrustScorePanel score={snapshot.local_trust_score} buckets={snapshot.bucket_scores} />
<TrustGapChecklist clientId={clientId} actions={actions} />
<RoiTimeline snapshots={[snapshot]} />
```

- [ ] **Step 6: Run tests and commit**

Run:

```bash
npm test -- __tests__/components/local-trust.test.tsx __tests__/api/local-trust-routes.test.ts
```

Expected: component and route tests pass.

Commit:

```bash
git add components/dashboard/local-trust __tests__/components/local-trust.test.tsx
git commit -m "feat(local-trust): add owner setup and actions"
```

---

## Task 7: Enterprise Export And Share Route

**Files:**
- Create: `app/api/dashboard/clients/[clientId]/local-trust/export/route.ts`
- Create: `components/dashboard/local-trust/ReportActions.tsx`
- Modify: `components/dashboard/local-trust/LocalTrustStep.tsx`
- Test: `__tests__/api/local-trust-routes.test.ts`
- Test: `__tests__/components/local-trust.test.tsx`

- [ ] **Step 1: Add failing export tests**

Append to `__tests__/api/local-trust-routes.test.ts`:

```ts
import { GET as GET_EXPORT } from '@/app/api/dashboard/clients/[clientId]/local-trust/export/route'

describe('Local Trust export route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects Pro users because export is Enterprise-only', async () => {
    mockGetProfile.mockResolvedValue({ account_id: 'account-1', accounts: { plan: 'pro' } })
    const req = new Request('http://localhost/api/dashboard/clients/client-1/local-trust/export')
    const res = await GET_EXPORT(req, { params: Promise.resolve({ clientId: 'client-1' }) })
    expect(res.status).toBe(403)
  })
})
```

Append to `__tests__/components/local-trust.test.tsx`:

```ts
it('renders Enterprise report actions', async () => {
  const { ReportActions } = await import('@/components/dashboard/local-trust/ReportActions')
  const html = renderToStaticMarkup(<ReportActions clientId="client-1" />)
  expect(html).toContain('Export report')
  expect(html).toContain('/api/dashboard/clients/client-1/local-trust/export')
})
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
npm test -- __tests__/api/local-trust-routes.test.ts __tests__/components/local-trust.test.tsx
```

Expected: fails because export route and report actions do not exist.

- [ ] **Step 3: Add Enterprise export route**

Create `app/api/dashboard/clients/[clientId]/local-trust/export/route.ts`:

```ts
import { getProfile } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { getLocalTrustProfile, getOrCreateLocalTrustSnapshot, verifyClientOwnership } from '@/lib/localTrust/store'
import { planAllows } from '@/lib/tier'
import type { AgentCompetitor, PulseMetric, PulseWeeklySummary, Scan } from '@/lib/types'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params
  const profile = await getProfile()
  if (!profile) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const plan = profile.accounts?.plan ?? 'basic'
  if (!planAllows(plan, 'local_trust_export')) {
    return Response.json({ error: 'UPGRADE_REQUIRED', feature: 'local_trust_export', plan }, { status: 403 })
  }

  const client = await verifyClientOwnership(clientId, profile.account_id)
  if (!client) return Response.json({ error: 'Not found' }, { status: 404 })

  const supabase = await createServerSupabaseClient()
  const { data: latestScan } = await supabase.from('scans').select('*')
    .eq('account_id', profile.account_id)
    .order('created_at', { ascending: false }).limit(1).single()

  const [{ data: pulseSummary }, { data: missed }, { data: competitors }] = await Promise.all([
    supabase.from('pulse_weekly_summary').select('*')
      .eq('client_id', clientId).order('scan_week').limit(40),
    supabase.from('pulse_metrics').select('platform,question,competitors_mentioned,scan_week')
      .eq('client_id', clientId).eq('brand_mentioned', false)
      .order('scan_week', { ascending: false }).limit(50),
    supabase.from('agent_competitors').select('*')
      .eq('scan_id', latestScan?.id ?? '__none__').order('mention_rate', { ascending: false }),
  ])

  const localProfile = await getLocalTrustProfile(clientId)
  const data = await getOrCreateLocalTrustSnapshot({
    client,
    accountId: profile.account_id,
    latestScan: latestScan as Scan | null,
    profile: localProfile,
    pulseSummary: (pulseSummary ?? []) as PulseWeeklySummary[],
    missed: (missed ?? []) as PulseMetric[],
    competitors: (competitors ?? []) as AgentCompetitor[],
  })

  const rows = [
    ['Metric', 'Value'],
    ['Local Trust Score', String(data.snapshot.local_trust_score)],
    ['Snapshot Month', data.snapshot.snapshot_month],
    ['Top Action', data.actions[0]?.title ?? 'No open actions'],
    ['Estimated Value Low', data.snapshot.roi_estimate?.low ? String(data.snapshot.roi_estimate.low) : ''],
    ['Estimated Value High', data.snapshot.roi_estimate?.high ? String(data.snapshot.roi_estimate.high) : ''],
  ]
  const csv = rows.map(row => row.map(cell => `"${cell.replaceAll('"', '""')}"`).join(',')).join('\n')

  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="local-trust-${clientId}.csv"`,
    },
  })
}
```

- [ ] **Step 4: Add report actions**

Create `components/dashboard/local-trust/ReportActions.tsx`:

```tsx
'use client'

export function ReportActions({ clientId }: { clientId: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      <a
        href={`/api/dashboard/clients/${clientId}/local-trust/export`}
        className="rounded-lg bg-dash-accent px-4 py-2 text-sm font-semibold text-primary-foreground"
      >
        Export report
      </a>
      <button
        type="button"
        onClick={() => window.print()}
        className="rounded-lg border border-dash-border px-4 py-2 text-sm font-semibold text-dash-text"
      >
        Print report
      </button>
    </div>
  )
}
```

- [ ] **Step 5: Render report actions for Enterprise**

In `LocalTrustStep.tsx`, import `ReportActions` and render it when export is allowed:

```tsx
{features.local_trust_export && <ReportActions clientId={clientId} />}
```

- [ ] **Step 6: Run tests and commit**

Run:

```bash
npm test -- __tests__/api/local-trust-routes.test.ts __tests__/components/local-trust.test.tsx
```

Expected: export and component tests pass.

Commit:

```bash
git add app/api/dashboard/clients/[clientId]/local-trust/export/route.ts components/dashboard/local-trust/ReportActions.tsx components/dashboard/local-trust/LocalTrustStep.tsx __tests__/api/local-trust-routes.test.ts __tests__/components/local-trust.test.tsx
git commit -m "feat(local-trust): add enterprise export"
```

---

## Task 8: Verification And Polish

**Files:**
- Modify only files required by test, build, or visual findings.

- [ ] **Step 1: Run focused Local Trust tests**

Run:

```bash
npm test -- __tests__/lib/local-trust.test.ts __tests__/api/local-trust-routes.test.ts __tests__/components/local-trust.test.tsx __tests__/lib/tier.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 2: Run full test suite**

Run:

```bash
npm test
```

Expected: all Vitest tests pass. If unrelated pre-existing tests fail, capture the failing file and exact error before changing anything.

- [ ] **Step 3: Run production build**

Run:

```bash
npm run build
```

Expected: Next build and TypeScript pass. The known multiple-lockfile Turbopack workspace-root warning can be reported if it appears.

- [ ] **Step 4: Run lint**

Run:

```bash
npm run lint
```

Expected: either lint passes or it fails on the known `.opencode/plugins/superpowers.js` ENOENT tooling issue. Report the exact output if it fails.

- [ ] **Step 5: Browser smoke**

Start dev server:

```bash
npm run dev
```

If this worktree does not have `.env.local`, source the main workspace env for this command only:

```bash
set -a; source ../../.env.local; set +a; npm run dev
```

Use Playwright or the in-app browser to verify:

- `/en/dashboard/[clientId]?step=roi` redirects unauthenticated users to login.
- Basic user state shows locked preview.
- Pro user state shows setup form, score, checklist, and timeline.
- Enterprise user state shows competitor snapshot and export controls.
- Mobile viewport has no horizontal overflow or clipped buttons.

- [ ] **Step 6: Final review**

Request a code review for the full Local Trust diff. Fix actionable correctness, auth, security, accessibility, responsive, or test issues. Re-run focused tests and build after fixes.

- [ ] **Step 7: Commit verification fixes**

If verification required code changes:

```bash
git add <changed-files>
git commit -m "fix(local-trust): address verification findings"
```

If no verification changes were required, do not create an empty commit.
