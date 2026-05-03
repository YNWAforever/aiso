# Agent Subscription Tiers & Wizard Portal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat client portal with a 4-step guided wizard (Scan → Results → Improve → Monitor) gated by 3 subscription tiers (Basic $29/mo Gemini-only, Pro $79/mo all 5 platforms, Enterprise $199/mo full suite).

**Architecture:** A new `plan_features` table drives all feature gating via a `planAllows()` utility. Stripe checkout/webhook updated for 3 plans. Scan route gates agent platform selection by plan. Dashboard page becomes a wizard with step components and locked feature panels.

**Tech Stack:** Next.js 16, Supabase, TypeScript, Tailwind CSS v4, Stripe SDK

---

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/014_subscription_tiers.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Agent subscription tiers

-- 1. Plan features configuration table
create table if not exists plan_features (
  plan                text primary key check (plan in ('basic', 'pro', 'enterprise')),
  platform_access     text[] not null default '{}',
  agent_recs          boolean not null default true,
  agent_progress      boolean not null default false,
  agent_competitors   boolean not null default false,
  alerts              boolean not null default false,
  csv_export          boolean not null default false,
  max_brands          smallint not null default 1,
  history_weeks       smallint not null default 4,
  edit_prompts        boolean not null default false
);

-- Seed data
insert into plan_features (plan, platform_access, agent_recs, agent_progress, agent_competitors, alerts, csv_export, max_brands, history_weeks, edit_prompts) values
  ('basic',      '{gemini}',                                        true,  false, false, false, false, 1,  4,   false),
  ('pro',        '{gemini,gpt4o,claude,perplexity-s,perplexity-p}', true,  true,  false, true,  false, 3,  26,  true),
  ('enterprise', '{gemini,gpt4o,claude,perplexity-s,perplexity-p}', true,  true,  true,  true,  true,  10, 999, true)
on conflict (plan) do update set
  platform_access   = excluded.platform_access,
  agent_recs        = excluded.agent_recs,
  agent_progress    = excluded.agent_progress,
  agent_competitors = excluded.agent_competitors,
  alerts            = excluded.alerts,
  csv_export        = excluded.csv_export,
  max_brands        = excluded.max_brands,
  history_weeks     = excluded.history_weeks,
  edit_prompts      = excluded.edit_prompts;

-- 2. Rename starter → basic on accounts
update accounts set plan = 'basic' where plan = 'starter';

-- 3. Update plan constraint
alter table accounts drop constraint if exists accounts_plan_check;
alter table accounts add constraint accounts_plan_check check (plan in ('basic', 'pro', 'enterprise'));

-- 4. Add agent_platforms to scans
alter table scans add column if not exists agent_platforms text[] default null;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/014_subscription_tiers.sql
git commit -m "feat(db): add plan_features table and subscription tier migration"
```

---

### Task 2: Update Types and Tier Utility

**Files:**
- Modify: `lib/types.ts` (update Account plan type)
- Modify: `lib/tier.ts` (rewrite with plan_features-based gating)

- [ ] **Step 1: Update Account plan type in `lib/types.ts`**

Find the `Account` interface and change the `plan` type:

```typescript
export interface Account {
  id: string
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  plan: 'basic' | 'pro' | 'enterprise'
  status: 'active' | 'past_due' | 'cancelled' | 'trialing'
  created_at: string
}
```

Also add a `PlanFeatures` type at the end of the file:

```typescript
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
}
```

- [ ] **Step 2: Rewrite `lib/tier.ts`**

Replace entire file:

```typescript
import type { PlanFeatures } from '@/lib/types'

// In-memory cache — populated once on first call, matches DB plan_features table
const FEATURES: Record<string, PlanFeatures> = {
  basic: {
    plan: 'basic',
    platform_access: ['gemini'],
    agent_recs: true, agent_progress: false, agent_competitors: false,
    alerts: false, csv_export: false,
    max_brands: 1, history_weeks: 4, edit_prompts: false,
  },
  pro: {
    plan: 'pro',
    platform_access: ['gemini', 'gpt4o', 'claude', 'perplexity-s', 'perplexity-p'],
    agent_recs: true, agent_progress: true, agent_competitors: false,
    alerts: true, csv_export: false,
    max_brands: 3, history_weeks: 26, edit_prompts: true,
  },
  enterprise: {
    plan: 'enterprise',
    platform_access: ['gemini', 'gpt4o', 'claude', 'perplexity-s', 'perplexity-p'],
    agent_recs: true, agent_progress: true, agent_competitors: true,
    alerts: true, csv_export: true,
    max_brands: 10, history_weeks: 999, edit_prompts: true,
  },
}

export function getPlanFeatures(plan: string): PlanFeatures {
  return FEATURES[plan] ?? FEATURES.basic!
}

export function planAllows(plan: string, feature: keyof PlanFeatures): boolean {
  const f = getPlanFeatures(plan)
  return Boolean((f as Record<string, unknown>)[feature])
}

export function maxBrandsForPlan(plan: string): number {
  return getPlanFeatures(plan).max_brands
}
```

- [ ] **Step 3: Verify TypeScript and tests compile**

```bash
npx tsc --noEmit 2>&1 | head -5
npx vitest run 2>&1 | grep -E '(Tests|FAIL|PASS)' | head -5
```

- [ ] **Step 4: Commit**

```bash
git add lib/types.ts lib/tier.ts
git commit -m "feat(tier): rewrite plan features with subscription tier support"
```

---

### Task 3: Update Stripe Library

**Files:**
- Modify: `lib/stripe.ts`

- [ ] **Step 1: Add 3 price IDs**

Replace the `STRIPE_PRICES` object:

```typescript
export const STRIPE_PRICES: Record<string, string> = {
  basic:      process.env.STRIPE_PRICE_BASIC!,
  pro:        process.env.STRIPE_PRICE_PRO!,
  enterprise: process.env.STRIPE_PRICE_ENTERPRISE!,
} as const
```

- [ ] **Step 2: Commit**

```bash
git add lib/stripe.ts
git commit -m "feat(stripe): add basic and enterprise price ID configs"
```

---

### Task 4: Update Stripe Checkout

**Files:**
- Modify: `app/api/stripe/checkout/route.ts`

- [ ] **Step 1: Accept all 3 plans**

Replace the file:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { stripe, STRIPE_PRICES, APP_URL } from '@/lib/stripe'
import { getProfile } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const VALID_PLANS = ['basic', 'pro', 'enterprise'] as const

export async function POST(req: NextRequest) {
  const { plan } = await req.json()
  const profile = await getProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!VALID_PLANS.includes(plan)) {
    return NextResponse.json({ error: 'Invalid plan. Use basic, pro, or enterprise.' }, { status: 400 })
  }

  const priceId = STRIPE_PRICES[plan]
  if (!priceId) {
    return NextResponse.json({ error: `Price not configured for plan: ${plan}` }, { status: 500 })
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: profile.email ?? undefined,
      metadata: { account_id: profile.account_id },
      success_url: `${APP_URL}/auth/callback?next=/en/dashboard`,
      cancel_url:  `${APP_URL}/en/pricing`,
    })
    return NextResponse.json({ url: session.url })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Stripe error'
    console.error('[stripe/checkout]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/stripe/checkout/route.ts
git commit -m "feat(stripe): accept basic/pro/enterprise plans in checkout"
```

---

### Task 5: Update Stripe Webhook

**Files:**
- Modify: `app/api/stripe/webhook/route.ts`

- [ ] **Step 1: Map 3 price IDs to plans**

Find the `getPlan()` function and replace it:

```typescript
function getPlan(priceId: string): 'basic' | 'pro' | 'enterprise' {
  if (priceId === process.env.STRIPE_PRICE_ENTERPRISE) return 'enterprise'
  if (priceId === process.env.STRIPE_PRICE_PRO)        return 'pro'
  if (priceId === process.env.STRIPE_PRICE_BASIC)      return 'basic'
  return 'basic'
}
```

Find the subscription deleted handler and change `'starter'` → `'basic'`:

```typescript
  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as { id: string }
    await supabase
      .from('accounts')
      .update({ plan: 'basic', status: 'cancelled' })
      .eq('stripe_subscription_id', sub.id)
  }
```

- [ ] **Step 2: Commit**

```bash
git add app/api/stripe/webhook/route.ts
git commit -m "feat(stripe): update webhook for 3-tier plan mapping"
```

---

### Task 6: Gate Agent Platforms in Scan Route

**Files:**
- Modify: `app/api/scan/route.ts`

- [ ] **Step 1: Read plan and gate platform list**

In the scan route, after the `isDashboardScan` check and before the webhook fire, add plan-based platform gating. Insert after line 234 (`insertPayload.agent_status = 'pending'`).

Read the existing code first, then add this logic to the webhook payload section (replace the webhook fire block):

```typescript
  // Fire agent webhook if dashboard scan and client has webhook configured
  if (isDashboardScan) {
    const { data: clientData } = await supabase
      .from('clients').select('webhook_url,brand_name').eq('id', clientId).single()

    const webhookUrl = clientData?.webhook_url

    if (webhookUrl) {
      // Determine which platforms to include based on plan
      const plan = account_id
        ? (await supabase.from('accounts').select('plan').eq('id', account_id).single()).data?.plan ?? 'basic'
        : 'basic'
      const features = getPlanFeatures(plan)
      const platforms = features.platform_access

      // Record which platforms were triggered
      await supabase.from('scans')
        .update({ agent_platforms: platforms })
        .eq('id', data.id)

      // Validate webhook URL
      let safe = false
      try {
        const parsed = new URL(webhookUrl)
        safe = parsed.protocol === 'https:' &&
               parsed.hostname !== 'localhost' &&
               !parsed.hostname.startsWith('127.') &&
               !parsed.hostname.startsWith('169.254.') &&
               !parsed.hostname.startsWith('10.') &&
               !parsed.hostname.match(/^172\.(1[6-9]|2\d|3[01])\./) &&
               !parsed.hostname.startsWith('192.168.')
      } catch { /* invalid URL */ }

      if (safe) {
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
            platforms,  // only the platforms the user paid for
            results: { ...results, ...geoDetails },
          }),
          signal: AbortSignal.timeout(5_000),
        }).catch(err => console.error('[scan] webhook trigger failed:', err))
      } else {
        console.error('[scan] invalid webhook URL:', webhookUrl)
      }
    }
  }
```

Add the import at top of file:

```typescript
import { getPlanFeatures } from '@/lib/tier'
```

- [ ] **Step 2: Verify compilation**

```bash
npx tsc --noEmit 2>&1 | head -5
```

- [ ] **Step 3: Commit**

```bash
git add app/api/scan/route.ts
git commit -m "feat(scan): gate agent platforms by subscription plan"
```

---

### Task 7: LockedFeature Component

**Files:**
- Create: `components/dashboard/LockedFeature.tsx`

- [ ] **Step 1: Write the component**

```typescript
'use client'

type Props = {
  feature: string
  requiredPlan: string
  price: string
  children?: React.ReactNode
}

export function LockedFeature({ feature, requiredPlan, price, children }: Props) {
  return (
    <div className="relative rounded-xl border border-[#1e1e30] bg-[#0d0d18] overflow-hidden group">
      {/* Blurred preview */}
      {children && (
        <div className="opacity-20 blur-[2px] pointer-events-none select-none">
          {children}
        </div>
      )}

      {/* Lock overlay */}
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#050510]/80 p-6">
        <svg className="w-8 h-8 text-[#5c5c6e] mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
        <p className="text-sm font-semibold text-[#e0e0ec] mb-1">{feature}</p>
        <p className="text-xs text-[#5c5c6e] mb-4 font-mono">
          Available on {requiredPlan} — {price}
        </p>
        <button
          onClick={async () => {
            const res = await fetch('/api/stripe/checkout', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ plan: requiredPlan.toLowerCase() }),
            })
            const data = await res.json()
            if (data.url) window.location.href = data.url
          }}
          className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg text-[#050510] bg-[#a78bfa] hover:bg-[#b99aff] transition-colors"
        >
          Upgrade to {requiredPlan} →
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/dashboard/LockedFeature.tsx
git commit -m "feat(ui): add LockedFeature component with upgrade CTA"
```

---

### Task 8: WizardProgress Component

**Files:**
- Create: `components/dashboard/WizardProgress.tsx`

- [ ] **Step 1: Write the component**

```typescript
import { getPlanFeatures } from '@/lib/tier'

type Step = { key: string; label: string }

const STEPS: Step[] = [
  { key: 'scan',    label: 'Scan' },
  { key: 'results', label: 'Results' },
  { key: 'improve', label: 'Improve' },
  { key: 'monitor', label: 'Monitor' },
]

type Props = {
  current: string
  plan: string
  hasScan: boolean
}

export function WizardProgress({ current, plan, hasScan }: Props) {
  const features = getPlanFeatures(plan)
  const currentIdx = STEPS.findIndex(s => s.key === current)

  // Which steps are accessible for this plan
  const stepAccess: Record<string, { accessible: boolean; reason?: string }> = {
    scan:    { accessible: true },
    results: { accessible: hasScan },
    improve:  { accessible: hasScan && features.agent_recs, reason: !features.agent_recs ? 'Pro plan required for agent analysis' : undefined },
    monitor:  { accessible: hasScan },
  }

  return (
    <div className="flex items-center justify-center gap-0 py-3 px-6 border-b border-[#1e1e30] bg-[#0d0d18]">
      {STEPS.map((step, i) => {
        const access = stepAccess[step.key]!
        const isCurrent = step.key === current
        const isCompleted = i < currentIdx
        const isLocked = !access.accessible && i > currentIdx

        return (
          <div key={step.key} className="flex items-center">
            {/* Step circle */}
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors ${
              isCurrent ? 'bg-[#00d4ff12]' : isCompleted ? 'bg-transparent' : 'bg-transparent'
            }`}>
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold font-mono transition-colors ${
                isCompleted
                  ? 'bg-[#22c55e] text-white'
                  : isCurrent
                    ? 'bg-[#00d4ff] text-[#050510]'
                    : isLocked
                      ? 'bg-[#1e1e30] text-[#5c5c6e]'
                      : 'bg-[#1e1e30] text-[#5c5c6e]'
              }`}>
                {isCompleted ? '✓' : isLocked ? '🔒' : i + 1}
              </div>
              <span className={`text-[11px] font-medium transition-colors ${
                isCurrent ? 'text-[#e0e0ec]' : isCompleted ? 'text-[#22c55e]' : 'text-[#5c5c6e]'
              }`}>
                {step.label}
              </span>
            </div>

            {/* Connector line */}
            {i < STEPS.length - 1 && (
              <div className={`w-8 h-px mx-1 ${i < currentIdx ? 'bg-[#22c55e]' : 'bg-[#1e1e30]'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/dashboard/WizardProgress.tsx
git commit -m "feat(ui): add WizardProgress 4-step navigation bar"
```

---

### Task 9: Step Components (Scan, Results, Improve, Monitor)

**Files:**
- Create: `components/dashboard/ScanStep.tsx`
- Create: `components/dashboard/ResultsStep.tsx`
- Create: `components/dashboard/ImproveStep.tsx`
- Create: `components/dashboard/MonitorStep.tsx`

- [ ] **Step 1: ScanStep**

```typescript
import Link from 'next/link'
import type { Scan } from '@/lib/types'

type Props = {
  lang: string
  scan: Scan | null
  scanHistory: Pick<Scan, 'id' | 'domain' | 'score' | 'grade' | 'created_at'>[]
}

export function ScanStep({ lang, scan, scanHistory }: Props) {
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-[#1e1e30] bg-[#0d0d18] p-6 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[#00d4ff12] mb-4">
          <svg className="w-5 h-5 text-[#00d4ff]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <p className="text-sm font-semibold text-[#e0e0ec] mb-1">Run a New Scan</p>
        <p className="text-xs text-[#5c5c6e] mb-5 font-mono">Analyze any URL across 20 AI readiness checks</p>
        <Link href={`/${lang}`}
          className="inline-flex items-center px-5 py-2.5 text-sm font-medium rounded-lg text-[#050510] bg-[#00d4ff] hover:bg-[#00e5ff] transition-colors">
          Start Scan →
        </Link>
      </div>

      {/* Scan history */}
      {scanHistory.length > 0 && (
        <div className="rounded-xl border border-[#1e1e30] bg-[#0d0d18] p-4">
          <p className="text-xs font-semibold text-[#5c5c6e] tracking-widest uppercase mb-3">Recent Scans</p>
          <div className="space-y-1.5">
            {scanHistory.map((s) => (
              <div key={s.id} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-[#141422] transition-colors">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[11px] text-[#8c8c9e] font-mono truncate">{s.domain}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-[11px] text-[#5c5c6e] font-mono">{new Date(s.created_at).toLocaleDateString()}</span>
                  <span className={`text-[11px] font-semibold font-mono ${s.score >= 80 ? 'text-[#22c55e]' : s.score >= 50 ? 'text-[#f59e0b]' : 'text-[#ef4444]'}`}>{s.score}</span>
                  {s.grade && <span className="text-[10px] font-bold text-[#5c5c6e]">{s.grade}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: ResultsStep**

```typescript
import { ScanSummary } from '@/components/dashboard/ScanSummary'
import type { Scan } from '@/lib/types'

type Props = { scan: Scan }

export function ResultsStep({ scan }: Props) {
  return <ScanSummary scan={scan} />
}
```

- [ ] **Step 3: ImproveStep**

```typescript
import { AgentSection } from '@/components/dashboard/AgentSection'
import { AgentRecommendations } from '@/components/dashboard/AgentRecommendations'
import { AgentProgress } from '@/components/dashboard/AgentProgress'
import { AgentCompetitors } from '@/components/dashboard/AgentCompetitors'
import { LockedFeature } from '@/components/dashboard/LockedFeature'
import { getPlanFeatures } from '@/lib/tier'
import type { Scan, AgentRecommendation, AgentProgress as AgentProgressType, AgentCompetitor } from '@/lib/types'

type Props = {
  scan: Scan
  plan: string
  recommendations: AgentRecommendation[]
  progress: AgentProgressType[]
  competitors: AgentCompetitor[]
}

export function ImproveStep({ scan, plan, recommendations, progress, competitors }: Props) {
  const features = getPlanFeatures(plan)

  // Filter recommendations to only show allowed platforms
  const allowedRecs = recommendations.filter(r => features.platform_access.includes(r.platform))

  return (
    <AgentSection status={scan.agent_status}>
      <div className="space-y-3">
        {/* Recommendations — gated by platform_access */}
        {features.agent_recs ? (
          <AgentRecommendations recommendations={allowedRecs} />
        ) : (
          <LockedFeature feature="Agent Recommendations" requiredPlan="Pro" price="$79/month" />
        )}

        {/* Progress tracking — pro gate */}
        {features.agent_progress ? (
          <AgentProgress progress={progress} />
        ) : (
          <LockedFeature feature="Progress Tracking" requiredPlan="Pro" price="$79/month">
            <AgentProgress progress={progress} />
          </LockedFeature>
        )}

        {/* Competitor intelligence — enterprise gate */}
        {features.agent_competitors ? (
          <AgentCompetitors competitors={competitors} />
        ) : (
          <LockedFeature feature="Competitor Intelligence" requiredPlan="Enterprise" price="$199/month">
            <AgentCompetitors competitors={competitors.slice(0, 1)} />
          </LockedFeature>
        )}
      </div>
    </AgentSection>
  )
}
```

- [ ] **Step 4: MonitorStep**

```typescript
import { SovChart } from '@/components/pulse/SovChart'
import { MissedTable } from '@/components/pulse/MissedTable'
import { LockedFeature } from '@/components/dashboard/LockedFeature'
import { AlertsTab } from '@/components/pulse/AlertsTab'
import { getPlanFeatures } from '@/lib/tier'
import type { PulseWeeklySummary, PulseMetric } from '@/lib/types'

type Props = {
  plan: string
  clientId: string
  summary: PulseWeeklySummary[]
  missed: PulseMetric[]
}

export function MonitorStep({ plan, clientId, summary, missed }: Props) {
  const features = getPlanFeatures(plan)

  return (
    <div className="space-y-5">
      {/* SoV Trend — always visible */}
      <div className="rounded-xl border border-[#1e1e30] bg-[#0d0d18] p-5">
        <p className="text-xs font-semibold text-[#5c5c6e] tracking-widest uppercase mb-4">SoV Trend</p>
        <SovChart data={summary} />
      </div>

      {/* Missed Opportunities — always visible */}
      {missed.length > 0 && (
        <div className="rounded-xl border border-[#1e1e30] bg-[#0d0d18] p-5">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-1.5 h-1.5 rounded-full bg-[#ef4444]" />
            <p className="text-xs font-semibold text-[#5c5c6e] tracking-widest uppercase">Missed Opportunities</p>
          </div>
          <MissedTable rows={missed.slice(0, 3)} platformLabel="Platform" questionLabel="Query" competitorsLabel="Competitors" />
        </div>
      )}

      {/* Alerts — pro gate */}
      {features.alerts ? (
        <div className="rounded-xl border border-[#1e1e30] bg-[#0d0d18] p-5">
          <AlertsTab clientId={clientId} />
        </div>
      ) : (
        <LockedFeature feature="Weekly Alerts" requiredPlan="Pro" price="$79/month" />
      )}
    </div>
  )
}
```

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/ScanStep.tsx components/dashboard/ResultsStep.tsx components/dashboard/ImproveStep.tsx components/dashboard/MonitorStep.tsx
git commit -m "feat(ui): add wizard step components with plan-gated features"
```

---

### Task 10: Redesign Dashboard Page with Wizard

**Files:**
- Modify: `app/[lang]/dashboard/[clientId]/page.tsx`

- [ ] **Step 1: Replace the dashboard page**

Replace the entire file with the wizard-based version:

```typescript
import { notFound } from 'next/navigation'
import { requireAuth } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { getPlanFeatures } from '@/lib/tier'
import { TopBar } from '@/components/dashboard/TopBar'
import { WizardProgress } from '@/components/dashboard/WizardProgress'
import { ScanStep } from '@/components/dashboard/ScanStep'
import { ResultsStep } from '@/components/dashboard/ResultsStep'
import { ImproveStep } from '@/components/dashboard/ImproveStep'
import { MonitorStep } from '@/components/dashboard/MonitorStep'
import {
  Scan, AgentRecommendation, AgentProgress as AgentProgressType,
  AgentCompetitor, PulseWeeklySummary, PulseMetric,
} from '@/lib/types'

export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string; clientId: string }>
  searchParams: Promise<{ step?: string }>
}) {
  const { lang, clientId } = await params
  const { step = 'scan' } = await searchParams
  const profile  = await requireAuth(lang)
  const supabase = await createServerSupabaseClient()
  const plan = profile.accounts?.plan ?? 'basic'

  const { data: client } = await supabase
    .from('clients').select('brand_name')
    .eq('id', clientId).eq('account_id', profile.account_id).single()

  if (!client) notFound()

  // Phase 1: scan + pulse
  const [{ data: latestScan }, { data: scanHistory }, { data: pulseSummary }, { data: pulseMetrics }] =
    await Promise.all([
      supabase.from('scans').select('*').eq('account_id', profile.account_id)
        .order('created_at', { ascending: false }).limit(1).single(),
      supabase.from('scans').select('id,domain,score,grade,created_at')
        .eq('account_id', profile.account_id).order('created_at', { ascending: false }).limit(10),
      supabase.from('pulse_weekly_summary').select('*')
        .eq('client_id', clientId).order('scan_week').limit(40),
      supabase.from('pulse_metrics')
        .select('platform,question,competitors_mentioned,scan_week')
        .eq('client_id', clientId).eq('brand_mentioned', false)
        .order('scan_week', { ascending: false }).limit(50),
    ])

  const scan = latestScan as Scan | null

  // Phase 2: agent data
  const [{ data: agentRecs }, { data: agentProg }, { data: agentComps }] = scan
    ? await Promise.all([
        supabase.from('agent_recommendations').select('*').eq('scan_id', scan.id).order('priority').order('impact_score', { ascending: false }),
        supabase.from('agent_progress').select('*').eq('scan_id', scan.id),
        supabase.from('agent_competitors').select('*').eq('scan_id', scan.id).order('mention_rate', { ascending: false }),
      ])
    : [{ data: null }, { data: null }, { data: null }]

  const summary = (pulseSummary ?? []) as PulseWeeklySummary[]
  const missed  = (pulseMetrics ?? []) as PulseMetric[]

  const kpi = summary.filter(d => !d.platform).at(-1)

  return (
    <div className="dashboard-dark min-h-full">
      <TopBar
        title={client.brand_name}
        subtitle={kpi?.scan_week ? `Week of ${kpi.scan_week}` : 'No data yet'}
      />

      <WizardProgress
        current={step}
        plan={plan}
        hasScan={!!scan}
      />

      <main className="flex-1 px-6 py-6 max-w-3xl mx-auto">
        {step === 'scan' && <ScanStep lang={lang} scan={scan} scanHistory={(scanHistory ?? []) as Pick<Scan, 'id' | 'domain' | 'score' | 'grade' | 'created_at'>[]} />}

        {step === 'results' && scan && <ResultsStep scan={scan} />}
        {step === 'results' && !scan && (
          <div className="rounded-xl border border-[#1e1e30] bg-[#0d0d18] p-8 text-center">
            <p className="text-sm text-[#5c5c6e]">Run a scan first to see results.</p>
          </div>
        )}

        {step === 'improve' && scan && (
          <ImproveStep
            scan={scan}
            plan={plan}
            recommendations={(agentRecs ?? []) as AgentRecommendation[]}
            progress={(agentProg ?? []) as AgentProgressType[]}
            competitors={(agentComps ?? []) as AgentCompetitor[]}
          />
        )}
        {step === 'improve' && !scan && (
          <div className="rounded-xl border border-[#1e1e30] bg-[#0d0d18] p-8 text-center">
            <p className="text-sm text-[#5c5c6e]">Run a scan first to see agent analysis.</p>
          </div>
        )}

        {step === 'monitor' && (
          <MonitorStep plan={plan} clientId={clientId} summary={summary} missed={missed} />
        )}
      </main>
    </div>
  )
}
```

- [ ] **Step 2: Update Sidebar to remove AI Pulse link and add new navigation**

The sidebar `app/[lang]/dashboard/layout.tsx` no longer wraps this page with tabs. Modify the layout to be simpler — just auth guard + sidebar with minimal links:

The layout stays but the `PulseTabs` are replaced by `WizardProgress`. The Sidebar component should remove the "AI Pulse" link since the wizard handles all navigation.

Find and update `components/dashboard/Sidebar.tsx` — remove the "AI Pulse" nav item.

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit 2>&1 | head -5
```

- [ ] **Step 4: Commit**

```bash
git add app/\[lang\]/dashboard/\[clientId\]/page.tsx components/dashboard/Sidebar.tsx
git commit -m "feat(portal): replace tabs with 4-step wizard flow"
```

---

### Task 11: Update Pricing Page

**Files:**
- Modify: `app/[lang]/pricing/page.tsx`

- [ ] **Step 1: Update plan names and prices**

The pricing page is a client component using i18n. Update the plan card data:

- Rename "Starter" → "Basic", price to "$29/mo"
- Pro stays "$79/mo" (or "$79/month")
- Enterprise stays "$199/mo" (add price)
- Update CTA buttons: Basic → Stripe checkout for 'basic', Pro → 'pro', Enterprise → 'enterprise' (or mailto)
- Update feature lists per the tier table in the spec

This is a visual update — read the current file and adjust labels, prices, and features.

- [ ] **Step 2: Commit**

```bash
git add app/\[lang\]/pricing/page.tsx
git commit -m "feat(pricing): update to 3-tier agent subscription model"
```

---

### Task 12: Update Settings Page

**Files:**
- Modify: `app/[lang]/dashboard/settings/page.tsx`

- [ ] **Step 1: Update plan labels and CTA**

Replace `PLAN_LABELS` and update the upgrade link:

```typescript
const PLAN_LABELS: Record<string, string> = {
  basic:      'Basic — $29/month',
  pro:        'Pro — $79/month',
  enterprise: 'Enterprise — $199/month',
}
```

Change the upgrade link from `plan === 'starter'` check to show upgrade to next tier:

```typescript
{plan === 'basic' && (
  <div className="border-t border-slate-100 pt-4">
    <p className="text-xs text-slate-500 mb-2">Unlock all 5 AI platforms, progress tracking, and alerts.</p>
    <a href={`/${lang}/pricing`}
      className="inline-block bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 transition">
      Upgrade to Pro →
    </a>
  </div>
)}
{plan === 'pro' && (
  <div className="border-t border-slate-100 pt-4">
    <p className="text-xs text-slate-500 mb-2">Unlock competitor intelligence, CSV export, and 10 brands.</p>
    <a href={`/${lang}/pricing`}
      className="inline-block bg-purple-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-purple-700 transition">
      Upgrade to Enterprise →
    </a>
  </div>
)}
```

- [ ] **Step 2: Commit**

```bash
git add app/\[lang\]/dashboard/settings/page.tsx
git commit -m "feat(settings): update plan labels and tier upgrade CTAs"
```

---

### Task 13: Final Verification

- [ ] **Step 1: Run tests**

```bash
npx vitest run 2>&1 | grep -E '(Tests|Test Files)'
```

- [ ] **Step 2: Check types**

```bash
npx tsc --noEmit 2>&1 | head -10
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: complete agent subscription tiers and wizard portal"
```

- [ ] **Step 4: Push**

```bash
git push origin main
```
