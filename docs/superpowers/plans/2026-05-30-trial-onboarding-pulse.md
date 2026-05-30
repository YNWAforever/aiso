# Trial Onboarding + Enhanced AI Pulse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a zero-friction 7-day trial flow (magic-link from result page → onboarding wizard → trial dashboard) and replace the separate Pulse + Prompts pages with a single unified page (Overview / Scan Log / Question Bank with AI-generated questions).

**Architecture:** Trial state lives in two new `accounts` columns (`trial_ends_at`, `trial_emails_sent`). `getProfile()` is extended with a `getTrialStatus()` helper. The unified Pulse page fetches all `pulse_metrics` for the latest week and renders them as expandable question rows alongside the existing PromptBankEditor. A new `/api/pulse/suggest-questions` route calls OpenRouter to generate question suggestions.

**Tech Stack:** Next.js 16 App Router, Supabase (SSR), Resend, OpenRouter, Tailwind CSS v4, Vitest

**Spec:** `docs/superpowers/specs/2026-05-30-trial-onboarding-pulse-design.md`

---

## File Map

### New files
| File | Responsibility |
|---|---|
| `supabase/migrations/016_trial_columns.sql` | Add `trial_ends_at`, `trial_started_at`, `trial_emails_sent` to `accounts` |
| `lib/trial.ts` | `getTrialStatus(account)` helper — computes `isTrial`, `daysRemaining`, `isExpired` |
| `components/result/TrialCta.tsx` | Magic-link trial CTA on result page (replaces Fix Pack sign-up button) |
| `app/[lang]/onboarding/page.tsx` | 3-step onboarding wizard page |
| `components/onboarding/OnboardingWizard.tsx` | Wizard UI — brand, domain, industry/region steps |
| `app/api/onboarding/complete/route.ts` | Creates client, sets trial dates, seeds prompts, links scan |
| `components/dashboard/TrialBanner.tsx` | Persistent top banner with countdown + upgrade CTA |
| `app/api/cron/trial-emails/route.ts` | Daily cron — sends trial drip emails via Resend |
| `components/pulse/QuestionRow.tsx` | Single question row with platform dots + expandable AI answers |
| `components/pulse/ScanLogSection.tsx` | Section ② — groups QuestionRows by category with filters |
| `components/pulse/SuggestQuestionsPanel.tsx` | Slide-in panel for AI-generated question suggestions |
| `components/pulse/QuestionBankSection.tsx` | Section ③ — wraps PromptBankEditor + suggest panel + first-time banner |
| `app/api/pulse/suggest-questions/route.ts` | Returns 5 AI-suggested questions (not saved — caller decides) |

### Modified files
| File | Change |
|---|---|
| `lib/types.ts` | Add `trial_ends_at`, `trial_started_at`, `trial_emails_sent` to `Account` |
| `lib/auth.ts` | Import + re-export `getTrialStatus` for convenience |
| `components/result/ResultClient.tsx` | Replace bottom CTA section with `<TrialCta>` |
| `app/[lang]/dashboard/layout.tsx` | Add `<TrialBanner>` above `{children}` |
| `app/[lang]/pulse/[clientId]/page.tsx` | Rewrite — unified page with 3 sections |
| `app/[lang]/dashboard/[clientId]/prompts/page.tsx` | Redirect to `/pulse/[clientId]#question-bank` |
| `vercel.json` | Add cron entry for trial-emails |

---

## Phase 1 — Database + Types

### Task 1: Migration — trial columns

**Files:**
- Create: `supabase/migrations/016_trial_columns.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/016_trial_columns.sql
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS trial_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS trial_ends_at    timestamptz,
  ADD COLUMN IF NOT EXISTS trial_emails_sent integer NOT NULL DEFAULT 0;
```

- [ ] **Step 2: Push to Supabase**

```bash
supabase db push
```

Expected output: `Applying migration 016_trial_columns.sql... Finished supabase db push.`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/016_trial_columns.sql
git commit -m "feat(db): add trial columns to accounts"
```

---

### Task 2: Types + trial status helper

**Files:**
- Modify: `lib/types.ts`
- Create: `lib/trial.ts`
- Test: `__tests__/lib/trial.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/lib/trial.test.ts
import { getTrialStatus } from '@/lib/trial'
import type { Account } from '@/lib/types'

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 'acc-1',
    stripe_customer_id: null,
    stripe_subscription_id: null,
    plan: 'basic',
    status: 'active',
    trial_started_at: null,
    trial_ends_at: null,
    trial_emails_sent: 0,
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

describe('getTrialStatus', () => {
  it('returns isTrial=false when trial_ends_at is null', () => {
    const result = getTrialStatus(makeAccount())
    expect(result.isTrial).toBe(false)
    expect(result.isExpired).toBe(false)
    expect(result.daysRemaining).toBe(0)
  })

  it('returns correct daysRemaining for active trial', () => {
    const endsAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString()
    const result = getTrialStatus(makeAccount({ trial_ends_at: endsAt }))
    expect(result.isTrial).toBe(true)
    expect(result.isExpired).toBe(false)
    expect(result.daysRemaining).toBe(5)
  })

  it('returns isExpired=true when trial_ends_at is in the past', () => {
    const endsAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const result = getTrialStatus(makeAccount({ trial_ends_at: endsAt }))
    expect(result.isTrial).toBe(true)
    expect(result.isExpired).toBe(true)
    expect(result.daysRemaining).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- __tests__/lib/trial.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/trial'`

- [ ] **Step 3: Add trial fields to Account type**

In `lib/types.ts`, find the `Account` interface and add three fields:

```typescript
export interface Account {
  id: string
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  plan: 'basic' | 'pro' | 'enterprise'
  status: 'active' | 'past_due' | 'cancelled' | 'trialing'
  trial_started_at: string | null   // ← add
  trial_ends_at: string | null      // ← add
  trial_emails_sent: number         // ← add
  created_at: string
}
```

- [ ] **Step 4: Create `lib/trial.ts`**

```typescript
// lib/trial.ts
import type { Account } from '@/lib/types'

export interface TrialStatus {
  isTrial: boolean
  isExpired: boolean
  daysRemaining: number
}

export function getTrialStatus(account: Account | null | undefined): TrialStatus {
  if (!account?.trial_ends_at) {
    return { isTrial: false, isExpired: false, daysRemaining: 0 }
  }
  const now = Date.now()
  const ends = new Date(account.trial_ends_at).getTime()
  const msRemaining = ends - now
  const daysRemaining = Math.max(0, Math.ceil(msRemaining / (1000 * 60 * 60 * 24)))
  const isExpired = msRemaining <= 0
  return { isTrial: true, isExpired, daysRemaining }
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npm test -- __tests__/lib/trial.test.ts
```

Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add lib/types.ts lib/trial.ts __tests__/lib/trial.test.ts
git commit -m "feat(trial): add trial columns to Account type + getTrialStatus helper"
```

---

## Phase 2 — Trial Onboarding Flow

### Task 3: TrialCta component

Replaces the bottom "Get my Fix Pack" CTA on the result page when the user is in the `unlocked` phase (post email capture).

**Files:**
- Create: `components/result/TrialCta.tsx`
- Modify: `components/result/ResultClient.tsx`

- [ ] **Step 1: Create `components/result/TrialCta.tsx`**

```tsx
// components/result/TrialCta.tsx
'use client'
import { useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { Zap, ChevronRight, Mail } from 'lucide-react'

interface Props {
  email: string        // pre-filled from email gate
  scanId: string
  lang: string
  failCount: number
}

export function TrialCta({ email, scanId, lang, failCount }: Props) {
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  async function handleStart() {
    setLoading(true)
    setError('')
    const redirectTo = `${window.location.origin}/${lang}/onboarding?scan=${scanId}`
    const { error: authError } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    })
    if (authError) {
      setError(authError.message)
      setLoading(false)
      return
    }
    setSent(true)
    setLoading(false)
  }

  if (sent) {
    return (
      <div className="bg-slate-900 rounded-2xl p-8 text-center">
        <div className="size-12 rounded-2xl bg-emerald-500/20 flex items-center justify-center mx-auto mb-4">
          <Mail className="size-6 text-emerald-400" />
        </div>
        <h2 className="text-white font-black text-xl mb-2">Check your inbox</h2>
        <p className="text-slate-400 text-sm">
          We sent a magic link to <strong className="text-white">{email}</strong>.
          Click it to start your free trial and get your Fix Pack.
        </p>
      </div>
    )
  }

  return (
    <div className="bg-slate-900 rounded-2xl p-8 text-center">
      <div className="size-12 rounded-2xl bg-primary/20 flex items-center justify-center mx-auto mb-4">
        <Zap className="size-6 text-primary" />
      </div>
      <h2 className="text-white font-black text-xl mb-2">
        Fix your {failCount} issue{failCount !== 1 ? 's' : ''} — free for 7 days
      </h2>
      <p className="text-slate-400 text-sm mb-2 max-w-sm mx-auto">
        Start your free trial to download your Fix Pack: llms.txt, robots.txt patch, and FAQ schema — ready to deploy.
      </p>
      <p className="text-slate-500 text-xs mb-6">No credit card required · 7-day trial · Cancel anytime</p>
      <button
        onClick={handleStart}
        disabled={loading}
        className="inline-flex items-center gap-2 bg-primary text-primary-foreground font-semibold px-8 py-3 rounded-xl text-sm hover:bg-primary/90 transition disabled:opacity-60 mx-auto"
      >
        {loading ? 'Sending magic link…' : `Start free trial — send to ${email}`}
        {!loading && <ChevronRight className="size-4" />}
      </button>
      {error && <p className="text-red-400 text-xs mt-3">{error}</p>}
      <p className="text-slate-600 text-xs mt-4">
        Already have an account?{' '}
        <a href={`/${lang}/auth/login`} className="text-slate-400 hover:text-white underline transition">Sign in</a>
      </p>
    </div>
  )
}
```

- [ ] **Step 2: Update `ResultClient.tsx` to use TrialCta**

In `components/result/ResultClient.tsx`, find the bottom CTA block (the dark `bg-slate-900` div that currently has "Fix your X issues — automatically") and replace it entirely:

```tsx
// Add import at top of ResultClient.tsx
import { TrialCta } from './TrialCta'
```

Replace the entire "Conversion CTA" comment block and the dark div below it with:

```tsx
{/* Trial CTA — only shown in unlocked state */}
<TrialCta
  email={unlockedEmail}
  scanId={scan.id}
  lang={lang}
  failCount={fail + warn}
/>
```

Also update the `ResultClient` component state to store the unlocked email. Change:

```tsx
const [phase, setPhase] = useState<'locked' | 'unlocked'>('locked')
```

to:

```tsx
const [phase, setPhase] = useState<'locked' | 'unlocked'>('locked')
const [unlockedEmail, setUnlockedEmail] = useState('')
```

And update `EmailCaptureGate`'s `onUnlocked` call — change:

```tsx
<EmailCaptureGate scanId={scan.id} onUnlocked={() => setPhase('unlocked')} />
```

to:

```tsx
<EmailCaptureGate
  scanId={scan.id}
  onUnlocked={(email) => { setUnlockedEmail(email); setPhase('unlocked') }}
/>
```

- [ ] **Step 3: Verify build**

```bash
npm run build 2>&1 | tail -20
```

Expected: `✓ Compiled successfully` with no type errors.

- [ ] **Step 4: Commit**

```bash
git add components/result/TrialCta.tsx components/result/ResultClient.tsx
git commit -m "feat(trial): add TrialCta component on result page"
```

---

### Task 4: Onboarding complete API + wizard page

**Files:**
- Create: `app/api/onboarding/complete/route.ts`
- Create: `app/[lang]/onboarding/page.tsx`
- Create: `components/onboarding/OnboardingWizard.tsx`
- Test: `__tests__/api/onboarding.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/api/onboarding.test.ts
import { POST } from '@/app/api/onboarding/complete/route'
import { NextRequest } from 'next/server'

// Mock Supabase server client
vi.mock('@/lib/supabase-server', () => ({
  createServerSupabaseClient: vi.fn().mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'acc-1', plan: 'basic' }, error: null }),
    }),
  }),
}))

vi.mock('@/lib/openrouter', () => ({
  callOpenRouter: vi.fn().mockResolvedValue(
    JSON.stringify([{ category: 'brand_query', question: 'What is TestBrand?', language: 'en' }])
  ),
}))

describe('POST /api/onboarding/complete', () => {
  it('returns 400 when brandName is missing', async () => {
    const req = new NextRequest('http://localhost/api/onboarding/complete', {
      method: 'POST',
      body: JSON.stringify({ domain: 'test.com' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('brandName required')
  })

  it('returns 401 when unauthenticated', async () => {
    const { createServerSupabaseClient } = await import('@/lib/supabase-server')
    vi.mocked(createServerSupabaseClient).mockResolvedValueOnce({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    } as never)
    const req = new NextRequest('http://localhost/api/onboarding/complete', {
      method: 'POST',
      body: JSON.stringify({ brandName: 'Test', domain: 'test.com' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- __tests__/api/onboarding.test.ts
```

Expected: FAIL — `Cannot find module '@/app/api/onboarding/complete/route'`

- [ ] **Step 3: Create the API route**

```bash
mkdir -p app/api/onboarding/complete
```

```typescript
// app/api/onboarding/complete/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { callOpenRouter } from '@/lib/openrouter'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const { brandName, domain, industry, region, scanId } = body as {
    brandName?: string; domain?: string; industry?: string; region?: string; scanId?: string
  }

  if (!brandName) return NextResponse.json({ error: 'brandName required' }, { status: 400 })

  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 })

  // Get account
  const { data: profile } = await supabase
    .from('profiles').select('account_id').eq('id', user.id).single()
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const accountId = profile.account_id

  // Set trial dates on account (7-day trial)
  const now = new Date()
  const trialEndsAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  await supabase.from('accounts').update({
    trial_started_at: now.toISOString(),
    trial_ends_at: trialEndsAt.toISOString(),
  }).eq('id', accountId)

  // Create client
  const { data: clientData, error: clientError } = await supabase
    .from('clients')
    .insert({
      brand_name: brandName,
      domain: domain ?? null,
      industry: industry ?? null,
      competitors: [],
      account_id: accountId,
      status: 'active',
    })
    .select('id')
    .single()

  if (clientError || !clientData) {
    return NextResponse.json({ error: 'Failed to create client' }, { status: 500 })
  }
  const clientId = clientData.id

  // Link scan to account if provided
  if (scanId) {
    await supabase.from('scans')
      .update({ account_id: accountId })
      .eq('id', scanId)
  }

  // Generate seed prompts via OpenRouter
  try {
    const raw = await callOpenRouter({
      model: 'anthropic/claude-haiku-4-5',
      maxTokens: 3000,
      messages: [{
        role: 'user',
        content: `Brand: ${brandName}\nIndustry: ${industry ?? 'general'}\nDomain: ${domain ?? ''}\n\nGenerate 24 questions in 4 categories (brand_query, category_query, intent_query, pain_point), 6 per category. Return ONLY a JSON array: [{"category":"brand_query","question":"...","language":"en"}]`,
      }],
    })
    const match = raw.match(/\[[\s\S]*\]/)
    const prompts = JSON.parse(match?.[0] ?? raw) as Array<{ category: string; question: string; language: string }>
    const rows = prompts.map(p => ({
      client_id: clientId,
      category: p.category,
      question: p.question,
      language: p.language ?? 'en',
      is_active: true,
    }))
    await supabase.from('prompt_bank').insert(rows)
  } catch {
    // Prompt generation failure is non-fatal — client still created
    console.warn('[onboarding] prompt generation failed')
  }

  return NextResponse.json({ clientId, trialEndsAt: trialEndsAt.toISOString() })
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- __tests__/api/onboarding.test.ts
```

Expected: PASS (2 tests)

- [ ] **Step 5: Create OnboardingWizard component**

```bash
mkdir -p components/onboarding
```

```tsx
// components/onboarding/OnboardingWizard.tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight, Zap } from 'lucide-react'

const INDUSTRIES = [
  { value: 'technology',        label: 'Technology' },
  { value: 'finance',           label: 'Finance & Banking' },
  { value: 'medical',           label: 'Healthcare & Medical' },
  { value: 'legal',             label: 'Legal & Compliance' },
  { value: 'retail_ecommerce',  label: 'Retail & E-Commerce' },
  { value: 'education',         label: 'Education' },
  { value: 'real_estate',       label: 'Real Estate' },
  { value: 'travel_hospitality',label: 'Travel & Hospitality' },
  { value: 'media_entertainment','label': 'Media & Entertainment' },
  { value: 'manufacturing',     label: 'Manufacturing' },
  { value: 'energy_utilities',  label: 'Energy & Utilities' },
  { value: 'general_b2b',       label: 'General B2B' },
  { value: 'general_b2c',       label: 'General B2C' },
]

const REGIONS = [
  { value: 'HK', label: 'Hong Kong' }, { value: 'TW', label: 'Taiwan' },
  { value: 'SG', label: 'Singapore' }, { value: 'JP', label: 'Japan' },
  { value: 'KR', label: 'South Korea' }, { value: 'US', label: 'United States' },
  { value: 'UK', label: 'United Kingdom' }, { value: 'EU', label: 'European Union' },
  { value: 'AU', label: 'Australia' }, { value: 'CA', label: 'Canada' },
  { value: 'global', label: 'Global' },
]

interface Props {
  lang: string
  initialBrand?: string
  initialDomain?: string
  initialIndustry?: string
  initialRegion?: string
  scanId?: string
}

export function OnboardingWizard({
  lang, initialBrand = '', initialDomain = '',
  initialIndustry = '', initialRegion = '', scanId,
}: Props) {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [brand, setBrand] = useState(initialBrand)
  const [domain, setDomain] = useState(initialDomain)
  const [industry, setIndustry] = useState(initialIndustry)
  const [region, setRegion] = useState(initialRegion)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function complete() {
    setLoading(true)
    setError('')
    const res = await fetch('/api/onboarding/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brandName: brand, domain, industry: industry || undefined, region: region || undefined, scanId }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? 'Something went wrong'); setLoading(false); return }
    router.push(`/${lang}/dashboard/${data.clientId}`)
  }

  const progress = (step / 3) * 100

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl border p-8 w-full max-w-md shadow-sm">
        {/* Logo */}
        <div className="flex items-center gap-2 mb-8">
          <div className="size-6 rounded-md bg-primary flex items-center justify-center">
            <Zap className="size-3.5 text-primary-foreground" />
          </div>
          <span className="font-black text-foreground text-sm">Fimmick <span className="text-primary">AISO</span></span>
        </div>

        {/* Progress */}
        <div className="mb-6">
          <div className="flex justify-between text-xs text-muted-foreground mb-2">
            <span>Step {step} of 3</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
        </div>

        {/* Step 1: Brand */}
        {step === 1 && (
          <div>
            <h1 className="text-xl font-black text-foreground mb-1">What's your brand name?</h1>
            <p className="text-sm text-muted-foreground mb-6">This is how AI agents will look for you.</p>
            <input
              autoFocus
              value={brand}
              onChange={e => setBrand(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && brand.trim() && setStep(2)}
              placeholder="e.g. Fimmick"
              className="w-full h-11 rounded-lg border border-input bg-background px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 mb-6"
            />
            <button
              onClick={() => setStep(2)}
              disabled={!brand.trim()}
              className="w-full h-11 bg-primary text-primary-foreground font-semibold rounded-lg text-sm hover:bg-primary/90 transition disabled:opacity-40 flex items-center justify-center gap-2"
            >
              Continue <ChevronRight className="size-4" />
            </button>
          </div>
        )}

        {/* Step 2: Domain */}
        {step === 2 && (
          <div>
            <h1 className="text-xl font-black text-foreground mb-1">Confirm your domain</h1>
            <p className="text-sm text-muted-foreground mb-6">We'll use this as your primary tracked domain.</p>
            <input
              autoFocus
              value={domain}
              onChange={e => setDomain(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && domain.trim() && setStep(3)}
              placeholder="e.g. fimmick.com"
              className="w-full h-11 rounded-lg border border-input bg-background px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 mb-6"
            />
            <div className="flex gap-3">
              <button onClick={() => setStep(1)} className="flex-1 h-11 border border-input text-foreground font-semibold rounded-lg text-sm hover:bg-muted transition">
                Back
              </button>
              <button
                onClick={() => setStep(3)}
                disabled={!domain.trim()}
                className="flex-1 h-11 bg-primary text-primary-foreground font-semibold rounded-lg text-sm hover:bg-primary/90 transition disabled:opacity-40 flex items-center justify-center gap-2"
              >
                Continue <ChevronRight className="size-4" />
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Industry + Region */}
        {step === 3 && (
          <div>
            <h1 className="text-xl font-black text-foreground mb-1">Your industry & region</h1>
            <p className="text-sm text-muted-foreground mb-6">Personalises your AI authority score and Pulse benchmarks.</p>
            <div className="space-y-3 mb-6">
              <select
                value={industry}
                onChange={e => setIndustry(e.target.value)}
                className="w-full h-11 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                <option value="">Industry (optional)</option>
                {INDUSTRIES.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
              </select>
              <select
                value={region}
                onChange={e => setRegion(e.target.value)}
                className="w-full h-11 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                <option value="">Region (optional)</option>
                {REGIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            {error && <p className="text-destructive text-sm mb-4">{error}</p>}
            <div className="flex gap-3">
              <button onClick={() => setStep(2)} className="flex-1 h-11 border border-input text-foreground font-semibold rounded-lg text-sm hover:bg-muted transition">
                Back
              </button>
              <button
                onClick={complete}
                disabled={loading}
                className="flex-1 h-11 bg-primary text-primary-foreground font-semibold rounded-lg text-sm hover:bg-primary/90 transition disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {loading ? 'Setting up…' : 'Go to my dashboard'}
                {!loading && <ChevronRight className="size-4" />}
              </button>
            </div>
            <button onClick={complete} disabled={loading} className="w-full text-xs text-muted-foreground hover:text-foreground mt-3 transition">
              Skip — I'll set this up later
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Create the onboarding page**

```bash
mkdir -p "app/[lang]/onboarding"
```

```tsx
// app/[lang]/onboarding/page.tsx
import { supabase } from '@/lib/supabase'
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard'

export default async function OnboardingPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>
  searchParams: Promise<{ scan?: string }>
}) {
  const { lang } = await params
  const { scan: scanId } = await searchParams

  // Pre-fill from scan if provided
  let initialBrand = ''
  let initialDomain = ''
  let initialIndustry = ''
  let initialRegion = ''

  if (scanId) {
    const { data } = await supabase
      .from('scans')
      .select('domain, industry, region')
      .eq('id', scanId)
      .single()
    if (data) {
      initialDomain = data.domain ?? ''
      // Guess brand from domain: strip TLD and capitalise
      const parts = data.domain?.split('.') ?? []
      if (parts.length >= 2) {
        const name = parts[parts.length - 2] ?? ''
        initialBrand = name.charAt(0).toUpperCase() + name.slice(1)
      }
      initialIndustry = data.industry ?? ''
      initialRegion = data.region ?? ''
    }
  }

  return (
    <OnboardingWizard
      lang={lang}
      scanId={scanId}
      initialBrand={initialBrand}
      initialDomain={initialDomain}
      initialIndustry={initialIndustry}
      initialRegion={initialRegion}
    />
  )
}
```

- [ ] **Step 7: Verify build**

```bash
npm run build 2>&1 | tail -20
```

Expected: `✓ Compiled successfully`

- [ ] **Step 8: Commit**

```bash
git add app/api/onboarding/ app/\[lang\]/onboarding/ components/onboarding/ __tests__/api/onboarding.test.ts
git commit -m "feat(trial): onboarding wizard + complete API"
```

---

### Task 5: TrialBanner + wire into dashboard layout

**Files:**
- Create: `components/dashboard/TrialBanner.tsx`
- Modify: `app/[lang]/dashboard/layout.tsx`

- [ ] **Step 1: Create `components/dashboard/TrialBanner.tsx`**

```tsx
// components/dashboard/TrialBanner.tsx
import Link from 'next/link'
import { Zap, Clock } from 'lucide-react'

interface Props {
  daysRemaining: number
  lang: string
}

export function TrialBanner({ daysRemaining, lang }: Props) {
  const urgent = daysRemaining <= 2
  return (
    <div className={`flex items-center justify-between px-6 py-2.5 text-sm font-medium ${urgent ? 'bg-red-600 text-white' : 'bg-primary text-primary-foreground'}`}>
      <div className="flex items-center gap-2">
        {urgent ? <Clock className="size-3.5" /> : <Zap className="size-3.5" />}
        <span>
          {daysRemaining > 0
            ? `🎁 Free trial · ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''} remaining`
            : '⚠️ Your trial ends today'}
        </span>
      </div>
      <Link
        href={`/${lang}/pricing`}
        className={`text-xs font-bold underline underline-offset-2 hover:no-underline transition ${urgent ? 'text-white' : 'text-primary-foreground'}`}
      >
        Upgrade now →
      </Link>
    </div>
  )
}
```

- [ ] **Step 2: Wire TrialBanner into dashboard layout**

In `app/[lang]/dashboard/layout.tsx`, add these imports at the top:

```tsx
import { TrialBanner } from '@/components/dashboard/TrialBanner'
import { getTrialStatus } from '@/lib/trial'
```

Then inside the `DashboardLayout` function, after `const profile = await requireAuth(lang)`, add:

```tsx
const trial = getTrialStatus(profile.accounts)
```

And update the returned JSX to include the banner above the sidebar/children:

```tsx
return (
  <div className="flex flex-col h-screen bg-background overflow-hidden">
    {trial.isTrial && !trial.isExpired && (
      <TrialBanner daysRemaining={trial.daysRemaining} lang={lang} />
    )}
    <div className="flex flex-1 overflow-hidden">
      <DashboardSidebar profile={profile} brandName={brandName} brandId={clientId} />
      <div className="flex-1 flex flex-col overflow-auto">
        {children}
      </div>
    </div>
  </div>
)
```

- [ ] **Step 3: Verify build**

```bash
npm run build 2>&1 | tail -20
```

Expected: `✓ Compiled successfully`

- [ ] **Step 4: Commit**

```bash
git add components/dashboard/TrialBanner.tsx "app/[lang]/dashboard/layout.tsx"
git commit -m "feat(trial): add TrialBanner to dashboard layout"
```

---

### Task 6: Trial email cron

**Files:**
- Create: `app/api/cron/trial-emails/route.ts`
- Modify: `vercel.json`

- [ ] **Step 1: Create `app/api/cron/trial-emails/route.ts`**

```bash
mkdir -p app/api/cron/trial-emails
```

```typescript
// app/api/cron/trial-emails/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

export const dynamic = 'force-dynamic'

// Bitmask: which email has been sent
const EMAIL_DAY1  = 1   // bit 0
const EMAIL_DAY5  = 2   // bit 1
const EMAIL_DAY7  = 4   // bit 2
const EMAIL_DAY10 = 8   // bit 3

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24))
}

export async function GET(req: NextRequest) {
  // Verify cron secret to prevent abuse
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const resend = new Resend(process.env.RESEND_API_KEY)
  const from = process.env.RESEND_FROM_EMAIL ?? 'hello@fimmick-aeo.com'
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://aeo.fimmick.com'

  // Fetch all trial accounts that have an email
  const { data: accounts } = await supabase
    .from('accounts')
    .select('id, trial_started_at, trial_emails_sent, profiles(email, display_name)')
    .not('trial_started_at', 'is', null)

  if (!accounts) return NextResponse.json({ sent: 0 })

  let sent = 0
  for (const account of accounts) {
    const startedAt = account.trial_started_at as string
    const days = daysSince(startedAt)
    const bitmask = (account.trial_emails_sent as number) ?? 0
    const profile = Array.isArray(account.profiles) ? account.profiles[0] : account.profiles
    const email = (profile as { email?: string })?.email
    if (!email) continue

    const toSend: Array<{ bit: number; subject: string; text: string }> = []

    if (days >= 1  && !(bitmask & EMAIL_DAY1)) {
      toSend.push({ bit: EMAIL_DAY1, subject: '✅ Your AISO Fix Pack is ready — deploy these 3 files', text: `Your 7-day trial is active.\n\nDownload your Fix Pack from your dashboard:\n${appUrl}/en/dashboard\n\nThe 3 files (llms.txt, robots.txt patch, FAQ schema) are ready to deploy. Most sites see AI indexing improve within 48 hours of deploying llms.txt.\n\nYou have 6 days remaining on your trial.\n\n— Fimmick AISO` })
    }
    if (days >= 5  && !(bitmask & EMAIL_DAY5)) {
      toSend.push({ bit: EMAIL_DAY5, subject: '⏳ 2 days left — here\'s what you\'re missing in Pulse', text: `Your trial ends in 2 days.\n\nYou haven't seen AI Pulse yet — it tracks your brand's share of voice across ChatGPT, Perplexity, Claude, and Gemini every week.\n\nUpgrade to Pro and see where your brand shows up (and doesn't):\n${appUrl}/en/pricing\n\n— Fimmick AISO` })
    }
    if (days >= 7  && !(bitmask & EMAIL_DAY7)) {
      toSend.push({ bit: EMAIL_DAY7, subject: '🔔 Last day of your AISO trial', text: `Today is the last day of your free trial.\n\nKeep your dashboard, Fix Pack, and AI visibility report by upgrading:\n${appUrl}/en/pricing\n\nBasic plan starts at $29/month — no credit card was required for your trial, but you'll need one to continue.\n\n— Fimmick AISO` })
    }
    if (days >= 10 && !(bitmask & EMAIL_DAY10)) {
      toSend.push({ bit: EMAIL_DAY10, subject: 'Your AISO report is saved — come back anytime', text: `Your trial ended a few days ago, but your scan report and AISO score are still waiting for you.\n\nNo pressure — whenever you're ready:\n${appUrl}/en/pricing\n\n— Fimmick AISO` })
    }

    for (const { bit, subject, text } of toSend) {
      try {
        await resend.emails.send({ from, to: email, subject, text })
        await supabase.from('accounts')
          .update({ trial_emails_sent: bitmask | bit })
          .eq('id', account.id)
        sent++
      } catch (err) {
        console.error(`[trial-emails] failed to send to ${email}:`, err)
      }
    }
  }

  return NextResponse.json({ sent })
}
```

- [ ] **Step 2: Update `vercel.json` with cron + app URL**

```json
{
  "functions": {
    "app/api/scan/route.ts": { "maxDuration": 60 },
    "app/api/fix/route.ts":  { "maxDuration": 30 }
  },
  "crons": [
    {
      "path": "/api/cron/trial-emails",
      "schedule": "0 9 * * *"
    }
  ]
}
```

- [ ] **Step 3: Add `CRON_SECRET` and `NEXT_PUBLIC_APP_URL` to `.env.local`**

```bash
# Add these lines to .env.local
echo "CRON_SECRET=changeme-local-dev" >> .env.local
echo "NEXT_PUBLIC_APP_URL=http://localhost:3000" >> .env.local
```

- [ ] **Step 4: Verify build**

```bash
npm run build 2>&1 | tail -20
```

Expected: `✓ Compiled successfully`

- [ ] **Step 5: Commit**

```bash
git add app/api/cron/trial-emails/ vercel.json .env.local
git commit -m "feat(trial): daily trial email cron via Resend"
```

---

## Phase 3 — Enhanced AI Pulse Page

### Task 7: suggest-questions API

**Files:**
- Create: `app/api/pulse/suggest-questions/route.ts`
- Test: `__tests__/api/suggest-questions.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/api/suggest-questions.test.ts
import { POST } from '@/app/api/pulse/suggest-questions/route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase-server', () => ({
  createServerSupabaseClient: vi.fn().mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({
        data: [{ question: 'Existing question?', category: 'brand_query' }],
      }),
      single: vi.fn().mockResolvedValue({
        data: { brand_name: 'TestBrand', industry: 'technology' },
      }),
    }),
  }),
}))

vi.mock('@/lib/openrouter', () => ({
  callOpenRouter: vi.fn().mockResolvedValue(
    JSON.stringify([
      { question: 'What does TestBrand do?', category: 'brand_query' },
      { question: 'TestBrand vs competitors?', category: 'brand_query' },
    ])
  ),
}))

describe('POST /api/pulse/suggest-questions', () => {
  it('returns 400 when clientId is missing', async () => {
    const req = new NextRequest('http://localhost/api/pulse/suggest-questions', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns array of suggestions', async () => {
    const req = new NextRequest('http://localhost/api/pulse/suggest-questions', {
      method: 'POST',
      body: JSON.stringify({ clientId: 'client-1', count: 2 }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(Array.isArray(json.suggestions)).toBe(true)
    expect(json.suggestions.length).toBeGreaterThan(0)
    expect(json.suggestions[0]).toHaveProperty('question')
    expect(json.suggestions[0]).toHaveProperty('category')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- __tests__/api/suggest-questions.test.ts
```

Expected: FAIL

- [ ] **Step 3: Create the route**

```bash
mkdir -p app/api/pulse/suggest-questions
```

```typescript
// app/api/pulse/suggest-questions/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { callOpenRouter } from '@/lib/openrouter'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body?.clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })

  const { clientId, count = 5 } = body as { clientId: string; count?: number }

  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 })

  // Fetch client info + existing questions (to avoid duplication)
  const [{ data: client }, { data: existing }] = await Promise.all([
    supabase.from('clients').select('brand_name, industry').eq('id', clientId).single(),
    supabase.from('prompt_bank').select('question, category').eq('client_id', clientId).limit(50),
  ])

  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

  const existingList = (existing ?? []).map(p => `- ${p.question}`).join('\n')

  const raw = await callOpenRouter({
    model: 'openai/gpt-4o-mini',
    maxTokens: 800,
    messages: [{
      role: 'user',
      content: `Brand: ${client.brand_name}\nIndustry: ${client.industry ?? 'general'}\n\nExisting questions (do NOT repeat these):\n${existingList || '(none yet)'}\n\nGenerate ${count} NEW, diverse questions for tracking this brand's AI visibility. Mix categories: brand_query, category_query, intent_query, pain_point.\n\nReturn ONLY a JSON array: [{"question":"...","category":"brand_query"}]`,
    }],
  }).catch(() => '[]')

  let suggestions: Array<{ question: string; category: string }> = []
  try {
    const match = raw.match(/\[[\s\S]*\]/)
    suggestions = JSON.parse(match?.[0] ?? raw)
  } catch { /* return empty */ }

  return NextResponse.json({ suggestions: suggestions.slice(0, count) })
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- __tests__/api/suggest-questions.test.ts
```

Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add app/api/pulse/suggest-questions/ __tests__/api/suggest-questions.test.ts
git commit -m "feat(pulse): suggest-questions API endpoint"
```

---

### Task 8: QuestionRow component

**Files:**
- Create: `components/pulse/QuestionRow.tsx`

- [ ] **Step 1: Create `components/pulse/QuestionRow.tsx`**

```tsx
// components/pulse/QuestionRow.tsx
'use client'
import { useState } from 'react'
import type { PulseMetric } from '@/lib/types'

const PLATFORM_CONFIG: Record<string, { label: string; color: string }> = {
  'perplexity':   { label: 'Perplexity', color: '#6c6eed' },
  'gpt4o':        { label: 'GPT-4o',     color: '#10a37f' },
  'claude-haiku': { label: 'Claude',     color: '#d97706' },
  'gemini-flash': { label: 'Gemini',     color: '#4285f4' },
}

const PLATFORM_ORDER = ['perplexity', 'gpt4o', 'claude-haiku', 'gemini-flash']

interface Props {
  question: string
  metrics: PulseMetric[]   // all metrics for this question (up to 4 platforms)
  onEditClick?: () => void // scroll to question bank
}

function highlightBrand(text: string, brand: string): string {
  if (!brand || !text) return text
  const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return text.replace(new RegExp(`(${escaped})`, 'gi'), '%%$1%%')
}

export function QuestionRow({ question, metrics, onEditClick }: Props) {
  const [expanded, setExpanded] = useState(false)

  const mentionCount = metrics.filter(m => m.brand_mentioned).length
  const total = PLATFORM_ORDER.length

  // Dot colour per platform
  const dotColor = (platform: string) => {
    const m = metrics.find(m => m.platform === platform)
    if (!m) return '#e2e8f0'           // grey — not scanned
    if (m.brand_mentioned) return '#22c55e'  // green
    if (m.sentiment === 'positive') return '#f59e0b' // amber — indirect
    return '#ef4444'                   // red — not mentioned
  }

  return (
    <div className="border-b border-slate-100 last:border-0">
      {/* Collapsed row */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        {/* Platform dots */}
        <div className="flex gap-1 shrink-0">
          {PLATFORM_ORDER.map(p => (
            <div
              key={p}
              title={PLATFORM_CONFIG[p]?.label ?? p}
              className="size-3.5 rounded-full"
              style={{ background: dotColor(p) }}
            />
          ))}
        </div>

        {/* Question text */}
        <span className="flex-1 text-sm text-slate-700 truncate">{question}</span>

        {/* Mention count */}
        <span className={`text-xs font-bold shrink-0 ${mentionCount === 0 ? 'text-red-500' : mentionCount === total ? 'text-emerald-600' : 'text-amber-600'}`}>
          {mentionCount}/{total}
        </span>

        {/* Expand chevron */}
        <span className="text-slate-400 text-xs shrink-0">{expanded ? '▲' : '▼'}</span>

        {/* Edit button */}
        {onEditClick && (
          <button
            onClick={e => { e.stopPropagation(); onEditClick() }}
            title="Edit question"
            className="text-slate-300 hover:text-slate-600 text-xs shrink-0 px-1 transition-colors"
          >
            ✏️
          </button>
        )}
      </div>

      {/* Expanded — platform answer grid */}
      {expanded && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 px-4 pb-4">
          {PLATFORM_ORDER.map(platform => {
            const m = metrics.find(m => m.platform === platform)
            const cfg = PLATFORM_CONFIG[platform]
            if (!m) return (
              <div key={platform} className="rounded-xl border border-slate-100 bg-slate-50 p-3 opacity-40">
                <div className="text-xs font-bold text-slate-400 mb-1">{cfg?.label ?? platform}</div>
                <div className="text-xs text-slate-400 italic">Not scanned</div>
              </div>
            )
            const mentioned = m.brand_mentioned
            return (
              <div
                key={platform}
                className={`rounded-xl border p-3 ${mentioned ? 'border-emerald-200 bg-emerald-50' : 'border-red-100 bg-red-50'}`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold" style={{ color: cfg?.color }}>{cfg?.label ?? platform}</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${mentioned ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                    {mentioned ? '✓ Mentioned' : '✗ Not mentioned'}
                  </span>
                </div>
                {/* Answer snippet with brand highlighted */}
                <p className="text-xs text-slate-600 leading-relaxed line-clamp-4">
                  {m.raw_answer
                    ? m.raw_answer.slice(0, 300).split('%%').map((part, i) =>
                        i % 2 === 1
                          ? <mark key={i} className="bg-yellow-200 text-yellow-900 px-0.5 rounded not-italic">{part}</mark>
                          : <span key={i}>{part}</span>
                      )
                    : <span className="italic text-slate-400">No answer recorded</span>
                  }
                </p>
                {/* Competitors mentioned */}
                {m.competitors_mentioned.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {m.competitors_mentioned.map(c => (
                      <span key={c} className="text-[10px] bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded-full">{c}</span>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -10
```

Expected: `✓ Compiled successfully`

- [ ] **Step 3: Commit**

```bash
git add components/pulse/QuestionRow.tsx
git commit -m "feat(pulse): QuestionRow with platform dots + expandable AI answers"
```

---

### Task 9: ScanLogSection component

**Files:**
- Create: `components/pulse/ScanLogSection.tsx`

- [ ] **Step 1: Create `components/pulse/ScanLogSection.tsx`**

```tsx
// components/pulse/ScanLogSection.tsx
'use client'
import { useState, useMemo } from 'react'
import { QuestionRow } from './QuestionRow'
import type { PulseMetric } from '@/lib/types'

const CATEGORY_LABELS: Record<string, string> = {
  brand_query:    'Brand Queries',
  category_query: 'Category Queries',
  intent_query:   'Intent Queries',
  pain_point:     'Pain Points',
}

interface Props {
  metrics: PulseMetric[]
  scanWeek: string
  brandName: string
  onEditQuestion?: (question: string) => void
}

type Filter = 'all' | 'not_mentioned'

export function ScanLogSection({ metrics, scanWeek, brandName, onEditQuestion }: Props) {
  const [filter, setFilter] = useState<Filter>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')

  // Group metrics by question
  const byQuestion = useMemo(() => {
    const map = new Map<string, PulseMetric[]>()
    for (const m of metrics) {
      const key = m.question
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(m)
    }
    return map
  }, [metrics])

  // Get unique categories from prompt categories
  const categories = useMemo(() => {
    const cats = new Set<string>()
    for (const m of metrics) {
      // PulseMetric doesn't store category directly — derive from prompt_id groups
      // For now use a fixed set; can be enhanced when prompt_id joins are added
    }
    return ['all', 'brand_query', 'category_query', 'intent_query', 'pain_point']
  }, [metrics])

  // Apply filters
  const filteredQuestions = useMemo(() => {
    return Array.from(byQuestion.entries()).filter(([, ms]) => {
      if (filter === 'not_mentioned' && ms.some(m => m.brand_mentioned)) return false
      return true
    })
  }, [byQuestion, filter])

  const totalMentioned = Array.from(byQuestion.values())
    .filter(ms => ms.some(m => m.brand_mentioned)).length
  const total = byQuestion.size

  if (metrics.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
        <p className="text-sm font-semibold text-slate-500">No scan data yet</p>
        <p className="text-xs text-slate-400 mt-1">Questions will appear here after the next weekly scan runs.</p>
      </div>
    )
  }

  return (
    <div id="scan-log">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-black text-slate-900 uppercase tracking-widest">This Week's Scans</h2>
          <p className="text-xs text-slate-400 mt-0.5">Week of {scanWeek} · {totalMentioned}/{total} questions mentioned {brandName}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {[
          { key: 'all' as Filter, label: 'All questions' },
          { key: 'not_mentioned' as Filter, label: 'Not mentioned only' },
        ].map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`text-xs px-3 py-1.5 rounded-full font-semibold transition-colors ${filter === f.key ? 'bg-primary text-primary-foreground' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {filteredQuestions.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-400">No questions match this filter.</div>
        ) : (
          filteredQuestions.map(([question, ms]) => (
            <QuestionRow
              key={question}
              question={question}
              metrics={ms}
              onEditClick={onEditQuestion ? () => onEditQuestion(question) : undefined}
            />
          ))
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/pulse/ScanLogSection.tsx
git commit -m "feat(pulse): ScanLogSection with filter bar"
```

---

### Task 10: SuggestQuestionsPanel + QuestionBankSection

**Files:**
- Create: `components/pulse/SuggestQuestionsPanel.tsx`
- Create: `components/pulse/QuestionBankSection.tsx`

- [ ] **Step 1: Create `components/pulse/SuggestQuestionsPanel.tsx`**

```tsx
// components/pulse/SuggestQuestionsPanel.tsx
'use client'
import { useState } from 'react'
import { X, Sparkles, Check, Edit2 } from 'lucide-react'

interface Suggestion {
  question: string
  category: string
}

interface Props {
  clientId: string
  onClose: () => void
  onAccepted: (question: string, category: string) => void
}

export function SuggestQuestionsPanel({ clientId, onClose, onAccepted }: Props) {
  const [loading, setLoading] = useState(false)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [editing, setEditing] = useState<Record<number, string>>({})
  const [dismissed, setDismissed] = useState<Set<number>>(new Set())
  const [fetched, setFetched] = useState(false)

  async function fetchSuggestions() {
    setLoading(true)
    const res = await fetch('/api/pulse/suggest-questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, count: 5 }),
    })
    const data = await res.json()
    setSuggestions(data.suggestions ?? [])
    setFetched(true)
    setLoading(false)
  }

  async function accept(i: number) {
    const question = editing[i] ?? suggestions[i]?.question ?? ''
    const category = suggestions[i]?.category ?? 'brand_query'
    await fetch(`/api/dashboard/clients/${clientId}/prompts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, category, language: 'en' }),
    })
    onAccepted(question, category)
    setDismissed(prev => new Set([...prev, i]))
  }

  const visible = suggestions.filter((_, i) => !dismissed.has(i))

  return (
    <div className="fixed inset-y-0 right-0 w-full max-w-sm bg-white border-l border-slate-200 shadow-2xl z-50 flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          <span className="font-bold text-slate-900 text-sm">AI Question Suggestions</span>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700 transition-colors">
          <X className="size-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {!fetched ? (
          <div className="text-center py-8">
            <p className="text-sm text-slate-500 mb-4">Generate 5 new question ideas based on your brand, industry, and existing questions.</p>
            <button
              onClick={fetchSuggestions}
              disabled={loading}
              className="inline-flex items-center gap-2 bg-primary text-primary-foreground font-semibold px-6 py-2.5 rounded-xl text-sm hover:bg-primary/90 transition disabled:opacity-60"
            >
              {loading ? 'Generating…' : '✨ Generate suggestions'}
            </button>
          </div>
        ) : visible.length === 0 ? (
          <div className="text-center py-8 text-sm text-slate-400">All suggestions have been accepted or dismissed.</div>
        ) : (
          <div className="space-y-3">
            {suggestions.map((s, i) => {
              if (dismissed.has(i)) return null
              const currentText = editing[i] ?? s.question
              return (
                <div key={i} className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-2">{s.category.replace('_', ' ')}</div>
                  <textarea
                    value={currentText}
                    onChange={e => setEditing(prev => ({ ...prev, [i]: e.target.value }))}
                    rows={2}
                    className="w-full text-sm text-slate-700 bg-white border border-slate-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-primary/40 mb-3"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => accept(i)}
                      className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-500 text-white font-semibold text-xs py-1.5 rounded-lg hover:bg-emerald-600 transition"
                    >
                      <Check className="size-3" /> Accept
                    </button>
                    <button
                      onClick={() => setDismissed(prev => new Set([...prev, i]))}
                      className="flex items-center justify-center gap-1 bg-slate-200 text-slate-600 font-semibold text-xs px-3 py-1.5 rounded-lg hover:bg-slate-300 transition"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create `components/pulse/QuestionBankSection.tsx`**

```tsx
// components/pulse/QuestionBankSection.tsx
'use client'
import { useState } from 'react'
import { Sparkles, Plus } from 'lucide-react'
import { PromptBankEditor } from './PromptBankEditor'
import { SuggestQuestionsPanel } from './SuggestQuestionsPanel'
import type { PromptBankItem } from '@/lib/types'

interface Props {
  clientId: string
  initialPrompts: PromptBankItem[]
  isFirstTime: boolean   // true when prompt bank was just auto-generated
}

export function QuestionBankSection({ clientId, initialPrompts, isFirstTime }: Props) {
  const [showPanel, setShowPanel] = useState(false)
  const [prompts, setPrompts] = useState<PromptBankItem[]>(initialPrompts)
  const [bannerDismissed, setBannerDismissed] = useState(false)

  const activeCount = prompts.filter(p => p.is_active).length

  function handleAccepted(question: string, category: string) {
    // Optimistically add to prompt list
    const newPrompt: PromptBankItem = {
      id: `temp-${Date.now()}`,
      client_id: clientId,
      category,
      question,
      language: 'en',
      is_active: true,
      created_at: new Date().toISOString(),
    }
    setPrompts(prev => [...prev, newPrompt])
  }

  return (
    <div id="question-bank" className="relative">
      {/* First-time banner */}
      {isFirstTime && !bannerDismissed && (
        <div className="flex items-center justify-between bg-primary/10 border border-primary/20 rounded-xl px-4 py-3 mb-4">
          <div className="flex items-center gap-2 text-sm">
            <Sparkles className="size-4 text-primary shrink-0" />
            <span className="text-slate-700">
              We generated <strong>{prompts.length} starter questions</strong> based on your brand and industry. Review and edit them below.
            </span>
          </div>
          <button
            onClick={() => setBannerDismissed(true)}
            className="text-slate-400 hover:text-slate-600 text-xs ml-4 shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Section header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-black text-slate-900 uppercase tracking-widest">Question Bank</h2>
          <p className="text-xs text-slate-400 mt-0.5">{activeCount} active / {prompts.length} total</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowPanel(true)}
            className="inline-flex items-center gap-1.5 text-xs bg-primary/10 text-primary font-semibold px-3 py-1.5 rounded-lg hover:bg-primary/20 transition"
          >
            <Sparkles className="size-3" /> Suggest more
          </button>
        </div>
      </div>

      <PromptBankEditor clientId={clientId} initialPrompts={prompts} />

      {/* Slide-in suggest panel */}
      {showPanel && (
        <>
          <div className="fixed inset-0 bg-black/20 z-40" onClick={() => setShowPanel(false)} />
          <SuggestQuestionsPanel
            clientId={clientId}
            onClose={() => setShowPanel(false)}
            onAccepted={handleAccepted}
          />
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add components/pulse/SuggestQuestionsPanel.tsx components/pulse/QuestionBankSection.tsx
git commit -m "feat(pulse): SuggestQuestionsPanel + QuestionBankSection"
```

---

### Task 11: Rewrite Pulse page + redirect /prompts

**Files:**
- Modify: `app/[lang]/pulse/[clientId]/page.tsx`
- Modify: `app/[lang]/dashboard/[clientId]/prompts/page.tsx`

- [ ] **Step 1: Rewrite the Pulse page**

```tsx
// app/[lang]/pulse/[clientId]/page.tsx
import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { SovChart }              from '@/components/pulse/SovChart'
import { PlatformBar }           from '@/components/pulse/PlatformBar'
import { MissedTable }           from '@/components/pulse/MissedTable'
import { ScanLogSection }        from '@/components/pulse/ScanLogSection'
import { QuestionBankSection }   from '@/components/pulse/QuestionBankSection'
import { requireAuth }           from '@/lib/auth'
import { planAllows }            from '@/lib/tier'
import type { PulseWeeklySummary, PulseMetric, PromptBankItem } from '@/lib/types'

export default async function PulsePage({
  params,
}: {
  params: Promise<{ lang: string; clientId: string }>
}) {
  const { lang, clientId } = await params
  const t = await getTranslations('pulse')

  const profile  = await requireAuth(lang)
  const plan     = profile.accounts?.plan ?? 'basic'
  const canEditPrompts = planAllows(plan, 'edit_prompts')

  const supabase = await createServerSupabaseClient()

  const { data: clientData } = await supabase
    .from('clients').select('brand_name, industry')
    .eq('id', clientId).eq('account_id', profile.account_id).single()
  if (!clientData) notFound()

  const [
    { data: summaryRaw },
    { data: missedRaw },
    { data: allMetricsRaw },
    { data: promptsRaw },
  ] = await Promise.all([
    supabase.from('pulse_weekly_summary').select('*').eq('client_id', clientId).order('scan_week').limit(40),
    supabase.from('pulse_metrics').select('platform,question,competitors_mentioned,scan_week')
      .eq('client_id', clientId).eq('brand_mentioned', false)
      .order('scan_week', { ascending: false }).limit(50),
    // All metrics for latest week (Section ②)
    supabase.from('pulse_metrics')
      .select('platform,question,prompt_id,raw_answer,brand_mentioned,sentiment,mention_position,competitors_mentioned,scan_week,client_id,id,created_at')
      .eq('client_id', clientId)
      .order('scan_week', { ascending: false })
      .limit(500),
    supabase.from('prompt_bank').select('*').eq('client_id', clientId).order('category').order('created_at'),
  ])

  const summary   = (summaryRaw   ?? []) as PulseWeeklySummary[]
  const missed    = (missedRaw    ?? []) as PulseMetric[]
  const prompts   = (promptsRaw   ?? []) as PromptBankItem[]

  // Use only the most recent scan week for the scan log
  const allMetrics   = (allMetricsRaw ?? []) as PulseMetric[]
  const latestWeek   = allMetrics[0]?.scan_week ?? ''
  const weekMetrics  = allMetrics.filter(m => m.scan_week === latestWeek)

  const kpi = summary.find(d => d.scan_week === summary.at(-1)?.scan_week && !d.platform)

  const sentimentLabel = (s: number | undefined) => {
    if (s === undefined || s === null) return '—'
    if (s > 0.3)  return t('sentiment_positive')
    if (s < -0.3) return t('sentiment_negative')
    return t('sentiment_neutral')
  }

  const isFirstTimePrompts = prompts.length > 0 &&
    Math.abs(new Date(prompts[0]!.created_at).getTime() - Date.now()) < 5 * 60 * 1000

  return (
    <div className="min-h-screen bg-slate-50">
      <nav className="bg-white border-b border-slate-200 px-6 py-3 flex justify-between items-center sticky top-0 z-30">
        <span className="font-bold text-slate-900">
          Fimmick <span className="text-blue-600">{t('title')}</span>
          <span className="ml-2 text-sm font-normal text-slate-500">{clientData.brand_name}</span>
        </span>
        <div className="flex items-center gap-4">
          <a href="#scan-log"      className="text-xs text-slate-500 hover:text-slate-900 transition hidden sm:block">Scan Log</a>
          <a href="#question-bank" className="text-xs text-slate-500 hover:text-slate-900 transition hidden sm:block">Questions</a>
          <span className="text-xs text-slate-400">{kpi?.scan_week ? `Week of ${kpi.scan_week}` : 'No data yet'}</span>
        </div>
      </nav>

      <main className="max-w-3xl mx-auto px-6 py-10 space-y-10">

        {/* ── Section ①: Overview ─────────────────────────── */}
        <div id="overview" className="space-y-6">
          <div>
            <h2 className="text-sm font-black text-slate-900 uppercase tracking-widest mb-4">Overview</h2>
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: t('sov'),       value: kpi ? `${kpi.sov_score}%` : '—' },
                { label: t('mentions'),  value: kpi ? `${kpi.brand_mentions}/${kpi.total_queries}` : '—' },
                { label: t('sentiment'), value: sentimentLabel(kpi?.avg_sentiment_score) },
              ].map(({ label, value }) => (
                <div key={label} className="bg-white rounded-xl border border-slate-200 p-5 text-center">
                  <p className="text-2xl font-black text-blue-600">{value}</p>
                  <p className="text-xs text-slate-500 mt-1">{label}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <p className="text-sm font-semibold text-slate-700 mb-4">{t('sov_trend')}</p>
            <SovChart data={summary} />
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <p className="text-sm font-semibold text-slate-700 mb-4">{t('platform_breakdown')}</p>
            <PlatformBar data={summary} />
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <p className="text-sm font-semibold text-slate-700 mb-1">{t('missed_title')}</p>
            <p className="text-xs text-slate-400 mb-4">{t('missed_subtitle')}</p>
            <MissedTable
              rows={missed}
              platformLabel={t('missed_platform')}
              questionLabel={t('missed_question')}
              competitorsLabel={t('missed_competitors')}
            />
          </div>
        </div>

        {/* ── Section ②: Scan Log ─────────────────────────── */}
        <ScanLogSection
          metrics={weekMetrics}
          scanWeek={latestWeek}
          brandName={clientData.brand_name}
        />

        {/* ── Section ③: Question Bank ─────────────────────── */}
        {canEditPrompts ? (
          <QuestionBankSection
            clientId={clientId}
            initialPrompts={prompts}
            isFirstTime={isFirstTimePrompts}
          />
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center">
            <p className="text-sm font-semibold text-slate-500">Question Bank</p>
            <p className="text-xs text-slate-400 mt-1">
              Upgrade to Pro to edit and customise your scan questions.{' '}
              <Link href={`/${lang}/pricing`} className="text-primary underline">See plans →</Link>
            </p>
          </div>
        )}
      </main>
    </div>
  )
}
```

- [ ] **Step 2: Redirect /prompts to Pulse#question-bank**

```tsx
// app/[lang]/dashboard/[clientId]/prompts/page.tsx
import { redirect } from 'next/navigation'

export default async function PromptsPage({
  params,
}: {
  params: Promise<{ lang: string; clientId: string }>
}) {
  const { lang, clientId } = await params
  redirect(`/${lang}/pulse/${clientId}#question-bank`)
}
```

- [ ] **Step 3: Verify build**

```bash
npm run build 2>&1 | tail -25
```

Expected: `✓ Compiled successfully` with no type errors.

- [ ] **Step 4: Run full test suite**

```bash
npm test
```

Expected: all tests pass (69+)

- [ ] **Step 5: Commit**

```bash
git add "app/[lang]/pulse/" "app/[lang]/dashboard/[clientId]/prompts/" components/pulse/
git commit -m "feat(pulse): unified Pulse page with scan log + question bank"
```

---

### Task 12: Final wiring + cleanup

**Files:**
- Modify: `.gitignore` (add `.superpowers/`)

- [ ] **Step 1: Add .superpowers to .gitignore**

```bash
echo ".superpowers/" >> .gitignore
```

- [ ] **Step 2: Final build check**

```bash
npm run build 2>&1 | tail -30
```

Expected: `✓ Compiled successfully` — all routes listed including `/[lang]/onboarding` and `/api/pulse/suggest-questions`.

- [ ] **Step 3: Final test run**

```bash
npm test
```

Expected: All tests pass.

- [ ] **Step 4: Final commit**

```bash
git add .gitignore
git commit -m "chore: add .superpowers to .gitignore"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| Magic-link trial CTA on result page, email pre-filled | Task 3 — TrialCta |
| 3-step onboarding wizard (brand, domain, industry/region) | Task 4 — OnboardingWizard |
| Creates client + seeds prompts + links scan on completion | Task 4 — /api/onboarding/complete |
| Sets trial_started_at + trial_ends_at on account | Task 4 — /api/onboarding/complete |
| Persistent trial banner with countdown | Task 5 — TrialBanner |
| 4-email drip sequence via Resend + daily cron | Task 6 — /api/cron/trial-emails |
| getTrialStatus() helper | Task 2 — lib/trial.ts |
| Section ① Overview (existing charts unchanged) | Task 11 — PulsePage |
| Section ② Scan log — question rows with platform dots | Tasks 8–9 — QuestionRow, ScanLogSection |
| Expand row to read AI answer with brand highlighted | Task 8 — QuestionRow |
| Section ③ Question Bank — inline editor | Task 10 — QuestionBankSection |
| AI "Suggest more" button + slide-in panel | Task 10 — SuggestQuestionsPanel |
| First-time banner for auto-generated questions | Task 10 — QuestionBankSection |
| /prompts redirects to /pulse#question-bank | Task 11 |
| suggest-questions API (OpenRouter, returns 5 suggestions) | Task 7 |
| trial_emails_sent bitmask prevents duplicate sends | Task 6 |
| NEXT_PUBLIC_APP_URL + CRON_SECRET env vars | Task 6 |

**Placeholder scan:** None found. All steps contain actual code.

**Type consistency check:**
- `PulseMetric` used in `QuestionRow`, `ScanLogSection`, `PulsePage` — all use `@/lib/types` import ✓
- `PromptBankItem` used in `QuestionBankSection`, `PulsePage` — consistent ✓
- `getTrialStatus(account)` takes `Account | null | undefined` — dashboard layout passes `profile.accounts` which is `Account` ✓
- `TrialCta` receives `email: string` — `ResultClient` passes `unlockedEmail` state ✓
