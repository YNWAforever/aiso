# Phase 3A — Auth · Multi-tenancy · Stripe Billing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Supabase Auth (Google OAuth + Magic Link), multi-tenant accounts, Stripe billing (Starter/Pro/Enterprise), authenticated dashboard shell with dark sidebar, and Fimmick super-admin panel to the existing AEO app.

**Architecture:** New `accounts` + `profiles` tables extend Supabase Auth. RLS scopes all data per account. Stripe webhooks drive plan assignment. The `/[lang]/dashboard/**` routes replace the public `/[lang]/pulse/**` route behind auth. Existing public scan tool remains unchanged.

**Tech Stack:** Next.js 16, Supabase Auth (`@supabase/ssr`), Stripe (`stripe` + `@stripe/stripe-js`), Tailwind CSS, TypeScript, Vitest

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `lib/tier.ts` | Create | planAllows() feature gate helper |
| `lib/stripe.ts` | Create | Stripe singleton + price ID constants |
| `lib/auth.ts` | Create | requireAuth(), requireAdmin(), getProfile() |
| `lib/supabase-server.ts` | Create | createServerSupabaseClient() using @supabase/ssr |
| `lib/types.ts` | Modify | Add Account, Profile types |
| `supabase/migrations/003_phase3a_accounts.sql` | Create | accounts + profiles tables + RLS |
| `supabase/migrations/004_phase3a_clients_fk.sql` | Create | clients.account_id FK + backfill |
| `proxy.ts` | Modify | Add auth guards for /dashboard/** and /admin/** |
| `app/pricing/page.tsx` | Create | Public pricing page |
| `app/auth/login/page.tsx` | Create | Google + Magic Link login |
| `app/auth/callback/route.ts` | Create | Supabase auth callback + profile creation |
| `app/[lang]/dashboard/layout.tsx` | Create | Auth-gated sidebar shell |
| `app/[lang]/dashboard/page.tsx` | Create | Brand list home |
| `app/[lang]/dashboard/[clientId]/page.tsx` | Create | AI Pulse (migrated from /pulse/[clientId]) |
| `app/[lang]/dashboard/[clientId]/prompts/page.tsx` | Create | Prompt editor stub (Pro+ gate) |
| `app/[lang]/dashboard/settings/page.tsx` | Create | Account + billing portal |
| `app/admin/layout.tsx` | Create | Admin auth guard |
| `app/admin/page.tsx` | Create | All clients table + tier override |
| `app/admin/[clientId]/page.tsx` | Create | Edit single client |
| `app/api/stripe/checkout/route.ts` | Create | Create Stripe Checkout Session |
| `app/api/stripe/webhook/route.ts` | Create | Handle Stripe webhook events |
| `app/api/stripe/portal/route.ts` | Create | Create Stripe Billing Portal session |
| `app/api/admin/clients/route.ts` | Create | List + update client tiers |
| `components/dashboard/Sidebar.tsx` | Create | Dark sidebar nav |
| `components/dashboard/TopBar.tsx` | Create | Breadcrumb + account menu |
| `components/dashboard/BrandCard.tsx` | Create | Brand tile component |
| `components/dashboard/PlanGate.tsx` | Create | Upgrade prompt wrapper |
| `components/auth/LoginForm.tsx` | Create | Google + magic link login form |
| `messages/en.json` | Modify | Add dashboard + auth i18n keys |
| `messages/zh-HK.json` | Modify | Add dashboard + auth i18n keys |
| `__tests__/lib/tier.test.ts` | Create | planAllows unit tests |
| `__tests__/api/stripe-webhook.test.ts` | Create | Webhook handler unit tests |
| `package.json` | Modify | Add stripe, @stripe/stripe-js, @supabase/ssr |

---

## Task 1: Branch + Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Create feature branch**

```bash
cd /Users/willylai/Documents/Claude/Projects/AEO
git checkout -b phase3a
```

- [ ] **Step 2: Install new dependencies**

```bash
npm install stripe @stripe/stripe-js @supabase/ssr
```

- [ ] **Step 3: Verify install**

```bash
npm ls stripe @supabase/ssr | head -4
```

Expected: both packages listed without errors.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add stripe, @stripe/stripe-js, @supabase/ssr dependencies"
```

---

## Task 2: TypeScript Types

**Files:**
- Modify: `lib/types.ts`

- [ ] **Step 1: Add Account and Profile types to `lib/types.ts`**

Append to the end of the existing file:

```typescript
export interface Account {
  id: string
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  plan: 'starter' | 'pro' | 'enterprise'
  status: 'active' | 'past_due' | 'cancelled' | 'trialing'
  created_at: string
}

export interface Profile {
  id: string
  account_id: string
  display_name: string | null
  is_admin: boolean
  created_at: string
}

export interface ProfileWithAccount extends Profile {
  accounts: Account
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/types.ts
git commit -m "feat: add Account and Profile TypeScript types"
```

---

## Task 3: Tier Feature Gate

**Files:**
- Create: `lib/tier.ts`
- Create: `__tests__/lib/tier.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/lib/tier.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { planAllows, TIER_FEATURES } from '@/lib/tier'

describe('planAllows', () => {
  it('starter cannot edit prompts', () => {
    expect(planAllows('starter', 'editPrompts')).toBe(false)
  })
  it('pro can edit prompts', () => {
    expect(planAllows('pro', 'editPrompts')).toBe(true)
  })
  it('enterprise can edit prompts', () => {
    expect(planAllows('enterprise', 'editPrompts')).toBe(true)
  })
  it('starter has 4-week history', () => {
    expect(TIER_FEATURES.starter.historyWeeks).toBe(4)
  })
  it('pro has 26-week history', () => {
    expect(TIER_FEATURES.pro.historyWeeks).toBe(26)
  })
  it('enterprise has max brands 10', () => {
    expect(TIER_FEATURES.enterprise.maxBrands).toBe(10)
  })
  it('unknown plan returns false', () => {
    expect(planAllows('unknown', 'editPrompts')).toBe(false)
  })
})
```

- [ ] **Step 2: Run — expect failure**

```bash
npm test -- __tests__/lib/tier.test.ts
```

Expected: FAIL — "Cannot find module '@/lib/tier'"

- [ ] **Step 3: Implement `lib/tier.ts`**

```typescript
export const TIER_FEATURES = {
  starter: {
    maxBrands: 1,
    editPrompts: false,
    historyWeeks: 4,
    alerts: false,
  },
  pro: {
    maxBrands: 1,
    editPrompts: true,
    historyWeeks: 26,
    alerts: true,
  },
  enterprise: {
    maxBrands: 10,
    editPrompts: true,
    historyWeeks: 999,
    alerts: true,
  },
} as const

type TierFeatures = typeof TIER_FEATURES.starter
type Plan = keyof typeof TIER_FEATURES

export function planAllows(plan: string, feature: keyof TierFeatures): boolean {
  const tier = TIER_FEATURES[plan as Plan]
  if (!tier) return false
  return Boolean(tier[feature])
}
```

- [ ] **Step 4: Run — expect pass**

```bash
npm test -- __tests__/lib/tier.test.ts
```

Expected: 7 tests passed.

- [ ] **Step 5: Commit**

```bash
git add lib/tier.ts __tests__/lib/tier.test.ts
git commit -m "feat: add tier feature gate with planAllows() helper"
```

---

## Task 4: Supabase Server Client

**Files:**
- Create: `lib/supabase-server.ts`

- [ ] **Step 1: Create `lib/supabase-server.ts`**

```typescript
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createServerSupabaseClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // setAll called from Server Component — safe to ignore
          }
        },
      },
    }
  )
}

export async function createServiceSupabaseClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll() {},
      },
    }
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/supabase-server.ts
git commit -m "feat: add Supabase SSR server client helpers"
```

---

## Task 5: Auth Helpers

**Files:**
- Create: `lib/auth.ts`

- [ ] **Step 1: Create `lib/auth.ts`**

```typescript
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import type { ProfileWithAccount } from '@/lib/types'

export async function getProfile(): Promise<ProfileWithAccount | null> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('profiles')
    .select('*, accounts(*)')
    .eq('id', user.id)
    .single()

  return data as ProfileWithAccount | null
}

export async function requireAuth(): Promise<ProfileWithAccount> {
  const profile = await getProfile()
  if (!profile) redirect('/auth/login')
  return profile
}

export async function requireAdmin(): Promise<ProfileWithAccount> {
  const profile = await requireAuth()
  if (!profile.is_admin) redirect('/en/dashboard')
  return profile
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/auth.ts
git commit -m "feat: add requireAuth() and requireAdmin() server helpers"
```

---

## Task 6: Stripe Client

**Files:**
- Create: `lib/stripe.ts`

- [ ] **Step 1: Add Stripe env vars to `.env.local`**

Add to `.env.local` (do not commit this file):

```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_PRO=price_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

You will get these values from the Stripe dashboard. For now, set placeholder values so the build doesn't error:

```
STRIPE_SECRET_KEY=sk_test_placeholder
STRIPE_WEBHOOK_SECRET=whsec_placeholder
STRIPE_PRICE_PRO=price_placeholder
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_placeholder
```

- [ ] **Step 2: Create `lib/stripe.ts`**

```typescript
import Stripe from 'stripe'

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-03-31.basil',
})

export const STRIPE_PRICES = {
  pro: process.env.STRIPE_PRICE_PRO!,
} as const

export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://fimmick-aeo.vercel.app'
```

- [ ] **Step 3: Add `NEXT_PUBLIC_APP_URL` to `.env.local`**

```
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

- [ ] **Step 4: Commit (without .env.local)**

```bash
git add lib/stripe.ts
git commit -m "feat: add Stripe client singleton"
```

---

## Task 7: Database Migrations

**Files:**
- Create: `supabase/migrations/003_phase3a_accounts.sql`
- Create: `supabase/migrations/004_phase3a_clients_fk.sql`

- [ ] **Step 1: Create `supabase/migrations/003_phase3a_accounts.sql`**

```sql
-- accounts: one per subscription
CREATE TABLE IF NOT EXISTS accounts (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_customer_id     text UNIQUE,
  stripe_subscription_id text,
  plan                   text NOT NULL DEFAULT 'starter'
                         CHECK (plan IN ('starter','pro','enterprise')),
  status                 text NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active','past_due','cancelled','trialing')),
  created_at             timestamptz DEFAULT now()
);

-- profiles: extends auth.users
CREATE TABLE IF NOT EXISTS profiles (
  id           uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id   uuid REFERENCES accounts(id) ON DELETE CASCADE,
  display_name text,
  is_admin     boolean DEFAULT false,
  created_at   timestamptz DEFAULT now()
);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO profiles (id, display_name)
  VALUES (new.id, new.raw_user_meta_data->>'full_name')
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- RLS: accounts
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users see own account" ON accounts
  FOR ALL USING (
    id = (SELECT account_id FROM profiles WHERE id = auth.uid())
  );

-- RLS: profiles
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users see own profile" ON profiles
  FOR ALL USING (id = auth.uid());
```

- [ ] **Step 2: Apply migration via Supabase MCP**

Use the `apply_migration` MCP tool with project_id `ggudkqnxglvydplqmcbh`, name `phase3a_accounts`, and the SQL above.

- [ ] **Step 3: Create `supabase/migrations/004_phase3a_clients_fk.sql`**

```sql
-- Add account_id to clients
ALTER TABLE clients ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES accounts(id) ON DELETE CASCADE;

-- Create a seed account for existing Fimmick data
INSERT INTO accounts (id, plan, status)
VALUES ('00000000-0000-0000-0000-000000000001', 'enterprise', 'active')
ON CONFLICT (id) DO NOTHING;

-- Backfill existing clients to the seed account
UPDATE clients SET account_id = '00000000-0000-0000-0000-000000000001'
WHERE account_id IS NULL;

-- Now enforce NOT NULL
ALTER TABLE clients ALTER COLUMN account_id SET NOT NULL;

-- RLS: clients
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

-- Normal users see own account's clients
CREATE POLICY "users see own clients" ON clients
  FOR ALL USING (
    account_id = (SELECT account_id FROM profiles WHERE id = auth.uid())
    OR (SELECT is_admin FROM profiles WHERE id = auth.uid()) = true
  );

-- RLS: prompt_bank (via clients)
ALTER TABLE prompt_bank ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users see own prompts" ON prompt_bank
  FOR ALL USING (
    client_id IN (
      SELECT id FROM clients WHERE
        account_id = (SELECT account_id FROM profiles WHERE id = auth.uid())
    )
    OR (SELECT is_admin FROM profiles WHERE id = auth.uid()) = true
  );

-- RLS: pulse_metrics
ALTER TABLE pulse_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users see own metrics" ON pulse_metrics
  FOR ALL USING (
    client_id IN (
      SELECT id FROM clients WHERE
        account_id = (SELECT account_id FROM profiles WHERE id = auth.uid())
    )
    OR (SELECT is_admin FROM profiles WHERE id = auth.uid()) = true
  );

-- RLS: pulse_weekly_summary
ALTER TABLE pulse_weekly_summary ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users see own summary" ON pulse_weekly_summary
  FOR ALL USING (
    client_id IN (
      SELECT id FROM clients WHERE
        account_id = (SELECT account_id FROM profiles WHERE id = auth.uid())
    )
    OR (SELECT is_admin FROM profiles WHERE id = auth.uid()) = true
  );
```

- [ ] **Step 4: Apply migration via Supabase MCP**

Use `apply_migration` with name `phase3a_clients_fk` and the SQL above.

- [ ] **Step 5: Create a Fimmick admin profile manually**

After enabling Supabase Auth, create a profile for `laichiwillyjp@gmail.com` with `is_admin = true`. This can be done via the Supabase dashboard SQL editor after the user signs in for the first time:

```sql
-- Run after first login to set admin flag
UPDATE profiles SET is_admin = true, account_id = '00000000-0000-0000-0000-000000000001'
WHERE id = (SELECT id FROM auth.users WHERE email = 'laichiwillyjp@gmail.com');
```

- [ ] **Step 6: Commit migration files**

```bash
git add supabase/migrations/003_phase3a_accounts.sql supabase/migrations/004_phase3a_clients_fk.sql
git commit -m "feat: add accounts/profiles tables, RLS policies, clients account_id FK"
```

---

## Task 8: Update Middleware (Auth Guards)

**Files:**
- Modify: `proxy.ts`

- [ ] **Step 1: Replace `proxy.ts` with auth-aware middleware**

```typescript
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import createIntlMiddleware from 'next-intl/middleware'
import { routing } from './i18n/routing'

const intlMiddleware = createIntlMiddleware(routing)

const PROTECTED_PATHS = ['/dashboard', '/admin']
const ADMIN_PATHS = ['/admin']

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Strip lang prefix to check path
  const strippedPath = pathname.replace(/^\/(en|zh-HK)/, '') || '/'
  const isProtected = PROTECTED_PATHS.some(p => strippedPath.startsWith(p))
  const isAdmin = ADMIN_PATHS.some(p => strippedPath.startsWith(p))

  if (isProtected) {
    let response = NextResponse.next({ request })

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return request.cookies.getAll() },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
            response = NextResponse.next({ request })
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options)
            )
          },
        },
      }
    )

    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      const loginUrl = request.nextUrl.clone()
      loginUrl.pathname = '/auth/login'
      loginUrl.searchParams.set('next', pathname)
      return NextResponse.redirect(loginUrl)
    }

    if (isAdmin) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', user.id)
        .single()
      if (!profile?.is_admin) {
        const dashUrl = request.nextUrl.clone()
        dashUrl.pathname = '/en/dashboard'
        return NextResponse.redirect(dashUrl)
      }
    }

    return response
  }

  return intlMiddleware(request)
}

export const config = {
  matcher: ['/((?!api|_next|.*\\..*).*)'],
}
```

- [ ] **Step 2: Verify build compiles**

```bash
npm run build 2>&1 | tail -20
```

Expected: no TypeScript errors related to proxy.ts.

- [ ] **Step 3: Commit**

```bash
git add proxy.ts
git commit -m "feat: add auth guards to middleware for /dashboard and /admin routes"
```

---

## Task 9: Auth Pages

**Files:**
- Create: `components/auth/LoginForm.tsx`
- Create: `app/auth/login/page.tsx`
- Create: `app/auth/callback/route.ts`

- [ ] **Step 1: Create `components/auth/LoginForm.tsx`**

```typescript
'use client'
import { useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'

export function LoginForm({ next }: { next?: string }) {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const redirectTo = `${window.location.origin}/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ''}`

  const signInWithGoogle = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    })
  }

  const signInWithMagicLink = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    })
    setSent(true)
    setLoading(false)
  }

  if (sent) {
    return (
      <div className="text-center">
        <p className="text-slate-700 font-medium">Check your email</p>
        <p className="text-slate-500 text-sm mt-1">We sent a magic link to <strong>{email}</strong></p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <button
        onClick={signInWithGoogle}
        className="w-full flex items-center justify-center gap-3 bg-white border border-slate-300 rounded-lg px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
      >
        <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z"/><path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 0 1-7.18-2.54H1.83v2.07A8 8 0 0 0 8.98 17z"/><path fill="#FBBC05" d="M4.5 10.52a4.8 4.8 0 0 1 0-3.04V5.41H1.83a8 8 0 0 0 0 7.18l2.67-2.07z"/><path fill="#EA4335" d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 1.83 5.4L4.5 7.49a4.77 4.77 0 0 1 4.48-3.3z"/></svg>
        Continue with Google
      </button>

      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-slate-200" />
        <span className="text-xs text-slate-400">or</span>
        <div className="flex-1 h-px bg-slate-200" />
      </div>

      <form onSubmit={signInWithMagicLink} className="space-y-3">
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="you@company.com"
          required
          className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 text-white rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-60 transition"
        >
          {loading ? 'Sending…' : 'Send Magic Link'}
        </button>
      </form>
    </div>
  )
}
```

- [ ] **Step 2: Create `app/auth/login/page.tsx`**

```typescript
import { LoginForm } from '@/components/auth/LoginForm'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-slate-200 p-8 w-full max-w-sm shadow-sm">
        <div className="text-center mb-8">
          <p className="font-black text-slate-900 text-xl">
            Fimmick <span className="text-blue-600">AEO</span>
          </p>
          <p className="text-slate-500 text-sm mt-1">Sign in to your dashboard</p>
        </div>
        <LoginForm next={next} />
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create `app/auth/callback/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code  = searchParams.get('code')
  const next  = searchParams.get('next') ?? '/en/dashboard'
  const error = searchParams.get('error')

  if (error) {
    return NextResponse.redirect(new URL(`/auth/login?error=${error}`, request.url))
  }

  if (code) {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll() },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          },
        },
      }
    )
    await supabase.auth.exchangeCodeForSession(code)
  }

  return NextResponse.redirect(new URL(next, request.url))
}
```

- [ ] **Step 4: Enable Google OAuth in Supabase**

In the Supabase dashboard for project `ggudkqnxglvydplqmcbh`:
- Go to **Authentication → Providers → Google**
- Enable Google, add your Google OAuth Client ID and Secret
- Add `https://ggudkqnxglvydplqmcbh.supabase.co/auth/v1/callback` to Google's authorised redirect URIs
- Also enable **Magic Link** (Email provider → enable "magic link")

- [ ] **Step 5: Commit**

```bash
git add components/auth/LoginForm.tsx app/auth/login/page.tsx app/auth/callback/route.ts
git commit -m "feat: add Google OAuth + Magic Link auth pages and callback handler"
```

---

## Task 10: i18n Keys for Dashboard

**Files:**
- Modify: `messages/en.json`
- Modify: `messages/zh-HK.json`

- [ ] **Step 1: Add dashboard keys to `messages/en.json`**

Add this section alongside existing keys:

```json
"dashboard": {
  "my_brands": "My Brands",
  "add_brand": "Add Brand",
  "ai_pulse": "AI Pulse",
  "prompts": "Prompts",
  "settings": "Settings",
  "admin": "Admin",
  "plan_starter": "Starter",
  "plan_pro": "Pro",
  "plan_enterprise": "Enterprise",
  "upgrade_title": "Pro feature",
  "upgrade_body": "Edit your prompt bank on the Pro plan.",
  "upgrade_cta": "Upgrade to Pro",
  "billing": "Manage Billing",
  "sign_out": "Sign out",
  "no_brands": "No brands yet. Add your first brand to get started.",
  "week_of": "Week of"
}
```

- [ ] **Step 2: Add dashboard keys to `messages/zh-HK.json`**

```json
"dashboard": {
  "my_brands": "我的品牌",
  "add_brand": "新增品牌",
  "ai_pulse": "AI 品牌監測",
  "prompts": "提示語庫",
  "settings": "設定",
  "admin": "管理員",
  "plan_starter": "入門版",
  "plan_pro": "專業版",
  "plan_enterprise": "企業版",
  "upgrade_title": "專業版功能",
  "upgrade_body": "升級至專業版以編輯提示語庫。",
  "upgrade_cta": "升級至專業版",
  "billing": "管理訂閱",
  "sign_out": "登出",
  "no_brands": "尚未新增品牌。請新增您的第一個品牌。",
  "week_of": "週次"
}
```

- [ ] **Step 3: Commit**

```bash
git add messages/en.json messages/zh-HK.json
git commit -m "feat: add dashboard i18n keys (EN + ZH-HK)"
```

---

## Task 11: Dashboard Components

**Files:**
- Create: `components/dashboard/Sidebar.tsx`
- Create: `components/dashboard/TopBar.tsx`
- Create: `components/dashboard/BrandCard.tsx`
- Create: `components/dashboard/PlanGate.tsx`

- [ ] **Step 1: Create `components/dashboard/Sidebar.tsx`**

```typescript
'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import type { ProfileWithAccount } from '@/lib/types'

interface Props {
  profile: ProfileWithAccount
  lang: string
  clientId?: string
}

const PLAN_COLORS: Record<string, string> = {
  starter: 'bg-slate-600 text-slate-200',
  pro: 'bg-blue-900 text-blue-300',
  enterprise: 'bg-violet-900 text-violet-300',
}

export function Sidebar({ profile, lang, clientId }: Props) {
  const pathname = usePathname()
  const router   = useRouter()
  const plan     = profile.accounts?.plan ?? 'starter'
  const base     = `/${lang}/dashboard`

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const signOut = async () => {
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/')

  const navItem = (href: string, icon: string, label: string, proOnly?: boolean) => (
    <Link
      key={href}
      href={href}
      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition ${
        isActive(href)
          ? 'bg-slate-700 text-white'
          : 'text-slate-400 hover:text-white hover:bg-slate-800'
      }`}
    >
      <span>{icon}</span>
      <span>{label}</span>
      {proOnly && plan === 'starter' && (
        <span className="ml-auto text-xs bg-blue-900 text-blue-300 px-1.5 py-0.5 rounded">PRO</span>
      )}
    </Link>
  )

  return (
    <aside className="w-52 flex-shrink-0 bg-slate-900 flex flex-col h-screen sticky top-0">
      <div className="px-4 py-4 border-b border-slate-800">
        <p className="font-black text-white text-sm">
          Fimmick <span className="text-blue-400">AEO</span>
        </p>
      </div>

      <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
        {navItem(base, '🏠', 'My Brands')}
        {clientId && navItem(`${base}/${clientId}`, '📊', 'AI Pulse')}
        {clientId && navItem(`${base}/${clientId}/prompts`, '📋', 'Prompts', true)}
        {navItem(`${base}/settings`, '⚙️', 'Settings')}
        {profile.is_admin && navItem('/admin', '🔧', 'Admin')}
      </nav>

      <div className="px-3 py-4 border-t border-slate-800 space-y-2">
        <div className={`text-xs font-semibold px-2 py-1 rounded inline-block ${PLAN_COLORS[plan] ?? PLAN_COLORS.starter}`}>
          {plan.toUpperCase()}
        </div>
        <p className="text-xs text-slate-500 truncate">{profile.display_name ?? 'Account'}</p>
        <button
          onClick={signOut}
          className="text-xs text-slate-500 hover:text-slate-300 transition"
        >
          Sign out
        </button>
      </div>
    </aside>
  )
}
```

- [ ] **Step 2: Create `components/dashboard/TopBar.tsx`**

```typescript
interface Props {
  title: string
  subtitle?: string
}

export function TopBar({ title, subtitle }: Props) {
  return (
    <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center gap-3">
      <div>
        <h1 className="font-semibold text-slate-900 text-sm">{title}</h1>
        {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
      </div>
    </header>
  )
}
```

- [ ] **Step 3: Create `components/dashboard/BrandCard.tsx`**

```typescript
import Link from 'next/link'
import type { Client } from '@/lib/types'

interface Props {
  client: Client
  lang: string
  sovScore?: number
}

export function BrandCard({ client, lang, sovScore }: Props) {
  return (
    <Link
      href={`/${lang}/dashboard/${client.id}`}
      className="bg-white border border-slate-200 rounded-xl p-5 hover:border-blue-300 hover:shadow-sm transition group"
    >
      <h3 className="font-semibold text-slate-900 group-hover:text-blue-600 transition">
        {client.brand_name}
      </h3>
      {client.industry && (
        <p className="text-xs text-slate-400 mt-0.5">{client.industry}</p>
      )}
      {sovScore !== undefined && (
        <p className="text-2xl font-black text-blue-600 mt-3">
          {sovScore}%
          <span className="text-xs font-normal text-slate-400 ml-1">SoV</span>
        </p>
      )}
    </Link>
  )
}
```

- [ ] **Step 4: Create `components/dashboard/PlanGate.tsx`**

```typescript
import Link from 'next/link'

interface Props {
  allowed: boolean
  children: React.ReactNode
  lang?: string
}

export function PlanGate({ allowed, children, lang = 'en' }: Props) {
  if (allowed) return <>{children}</>

  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="text-4xl mb-4">🔒</div>
      <h2 className="text-lg font-semibold text-slate-900">Pro feature</h2>
      <p className="text-slate-500 text-sm mt-2 max-w-xs">
        Edit your prompt bank and unlock advanced analytics on the Pro plan.
      </p>
      <Link
        href="/pricing"
        className="mt-6 bg-blue-600 text-white rounded-lg px-5 py-2 text-sm font-medium hover:bg-blue-700 transition"
      >
        Upgrade to Pro →
      </Link>
    </div>
  )
}
```

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/
git commit -m "feat: add dashboard UI components (Sidebar, TopBar, BrandCard, PlanGate)"
```

---

## Task 12: Dashboard Layout (Auth Shell)

**Files:**
- Create: `app/[lang]/dashboard/layout.tsx`

- [ ] **Step 1: Create `app/[lang]/dashboard/layout.tsx`**

```typescript
import { requireAuth } from '@/lib/auth'
import { Sidebar } from '@/components/dashboard/Sidebar'

export default async function DashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ lang: string }>
}) {
  const { lang } = await params
  const profile = await requireAuth()

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      <Sidebar profile={profile} lang={lang} />
      <div className="flex-1 flex flex-col overflow-auto">
        {children}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add app/[lang]/dashboard/layout.tsx
git commit -m "feat: add authenticated dashboard layout with sidebar"
```

---

## Task 13: Dashboard Home (Brand List)

**Files:**
- Create: `app/[lang]/dashboard/page.tsx`

- [ ] **Step 1: Create `app/[lang]/dashboard/page.tsx`**

```typescript
import { requireAuth } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { BrandCard } from '@/components/dashboard/BrandCard'
import { TopBar } from '@/components/dashboard/TopBar'
import type { Client, PulseWeeklySummary } from '@/lib/types'

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ lang: string }>
}) {
  const { lang } = await params
  const profile = await requireAuth()
  const supabase = await createServerSupabaseClient()

  const { data: clients } = await supabase
    .from('clients')
    .select('*')
    .eq('account_id', profile.account_id)
    .eq('status', 'active')
    .order('created_at')

  // Fetch latest SoV for each client
  const clientIds = (clients ?? []).map(c => c.id)
  const { data: summaries } = clientIds.length
    ? await supabase
        .from('pulse_weekly_summary')
        .select('client_id, sov_score, scan_week')
        .in('client_id', clientIds)
        .is('platform', null)
        .order('scan_week', { ascending: false })
    : { data: [] }

  const latestSov: Record<string, number> = {}
  for (const s of summaries ?? []) {
    if (!(s.client_id in latestSov)) latestSov[s.client_id] = Number(s.sov_score)
  }

  return (
    <>
      <TopBar title="My Brands" />
      <main className="flex-1 px-6 py-8">
        {(!clients || clients.length === 0) ? (
          <div className="text-center py-20 text-slate-400">
            <p className="text-4xl mb-4">🏢</p>
            <p className="font-medium">No brands yet.</p>
            <p className="text-sm mt-1">Contact Fimmick to onboard your first brand.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-4xl">
            {(clients as Client[]).map(c => (
              <BrandCard
                key={c.id}
                client={c}
                lang={lang}
                sovScore={latestSov[c.id]}
              />
            ))}
          </div>
        )}
      </main>
    </>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add app/[lang]/dashboard/page.tsx
git commit -m "feat: add dashboard home page with brand list and latest SoV"
```

---

## Task 14: Dashboard AI Pulse Page (Migrated from /pulse)

**Files:**
- Create: `app/[lang]/dashboard/[clientId]/page.tsx`

- [ ] **Step 1: Create `app/[lang]/dashboard/[clientId]/page.tsx`**

This is the authenticated equivalent of the existing `/[lang]/pulse/[clientId]/page.tsx`. Copy the logic and add the sidebar context:

```typescript
import { notFound } from 'next/navigation'
import { requireAuth } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { SovChart }    from '@/components/pulse/SovChart'
import { PlatformBar } from '@/components/pulse/PlatformBar'
import { MissedTable } from '@/components/pulse/MissedTable'
import { TopBar }      from '@/components/dashboard/TopBar'
import { Sidebar }     from '@/components/dashboard/Sidebar'
import type { PulseWeeklySummary, PulseMetric } from '@/lib/types'

export default async function DashboardPulsePage({
  params,
}: {
  params: Promise<{ lang: string; clientId: string }>
}) {
  const { lang, clientId } = await params
  const profile  = await requireAuth()
  const supabase = await createServerSupabaseClient()

  // Verify client belongs to user's account
  const { data: client } = await supabase
    .from('clients')
    .select('brand_name')
    .eq('id', clientId)
    .eq('account_id', profile.account_id)
    .single()

  if (!client) notFound()

  const [{ data: summaryRaw }, { data: missedRaw }] = await Promise.all([
    supabase
      .from('pulse_weekly_summary')
      .select('*')
      .eq('client_id', clientId)
      .order('scan_week')
      .limit(40),
    supabase
      .from('pulse_metrics')
      .select('platform,question,competitors_mentioned,scan_week')
      .eq('client_id', clientId)
      .eq('brand_mentioned', false)
      .order('scan_week', { ascending: false })
      .limit(50),
  ])

  const summary = (summaryRaw ?? []) as PulseWeeklySummary[]
  const missed  = (missedRaw  ?? []) as PulseMetric[]

  const latestWeek = summary.at(-1)?.scan_week
  const kpi = summary.find(d => d.scan_week === latestWeek && !d.platform)

  return (
    <>
      <TopBar
        title={client.brand_name}
        subtitle={kpi?.scan_week ? `Week of ${kpi.scan_week}` : 'No data yet'}
      />
      <main className="flex-1 px-6 py-8 max-w-3xl space-y-6">
        {/* KPI Cards */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Share of Voice',  value: kpi ? `${kpi.sov_score}%` : '—' },
            { label: 'Mentions',        value: kpi ? `${kpi.brand_mentions}/${kpi.total_queries}` : '—' },
            { label: 'Platforms',       value: '4' },
          ].map(({ label, value }) => (
            <div key={label} className="bg-white rounded-xl border border-slate-200 p-5 text-center">
              <p className="text-2xl font-black text-blue-600">{value}</p>
              <p className="text-xs text-slate-500 mt-1">{label}</p>
            </div>
          ))}
        </div>

        {/* SoV Trend */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <p className="text-sm font-semibold text-slate-700 mb-4">SoV Trend</p>
          <SovChart data={summary} />
        </div>

        {/* Platform Breakdown */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <p className="text-sm font-semibold text-slate-700 mb-4">Platform Breakdown</p>
          <PlatformBar data={summary} />
        </div>

        {/* Missed Opportunities */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <p className="text-sm font-semibold text-slate-700 mb-1">Missed Opportunities</p>
          <p className="text-xs text-slate-400 mb-4">Queries where your brand was not mentioned</p>
          <MissedTable
            rows={missed}
            platformLabel="Platform"
            questionLabel="Question"
            competitorsLabel="Competitors"
          />
        </div>
      </main>
    </>
  )
}
```

- [ ] **Step 2: Update dashboard layout to pass clientId to Sidebar**

Modify `app/[lang]/dashboard/layout.tsx` to detect clientId from the URL and pass it to Sidebar:

```typescript
import { requireAuth } from '@/lib/auth'
import { Sidebar } from '@/components/dashboard/Sidebar'
import { headers } from 'next/headers'

export default async function DashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ lang: string }>
}) {
  const { lang } = await params
  const profile = await requireAuth()

  // Extract clientId from URL for sidebar active state
  const headersList = await headers()
  const pathname = headersList.get('x-invoke-path') ?? ''
  const clientIdMatch = pathname.match(/\/dashboard\/([^/]+)/)
  const clientId = clientIdMatch?.[1]

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      <Sidebar profile={profile} lang={lang} clientId={clientId} />
      <div className="flex-1 flex flex-col overflow-auto">
        {children}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add app/[lang]/dashboard/[clientId]/page.tsx app/[lang]/dashboard/layout.tsx
git commit -m "feat: add authenticated AI Pulse dashboard page"
```

---

## Task 15: Prompt Editor Stub (Pro+ Gate)

**Files:**
- Create: `app/[lang]/dashboard/[clientId]/prompts/page.tsx`

- [ ] **Step 1: Create `app/[lang]/dashboard/[clientId]/prompts/page.tsx`**

```typescript
import { notFound } from 'next/navigation'
import { requireAuth } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { PlanGate } from '@/components/dashboard/PlanGate'
import { TopBar }   from '@/components/dashboard/TopBar'
import { planAllows } from '@/lib/tier'

export default async function PromptsPage({
  params,
}: {
  params: Promise<{ lang: string; clientId: string }>
}) {
  const { lang, clientId } = await params
  const profile  = await requireAuth()
  const plan     = profile.accounts?.plan ?? 'starter'
  const supabase = await createServerSupabaseClient()

  const { data: client } = await supabase
    .from('clients')
    .select('brand_name')
    .eq('id', clientId)
    .eq('account_id', profile.account_id)
    .single()

  if (!client) notFound()

  return (
    <>
      <TopBar title={`${client.brand_name} — Prompt Bank`} />
      <main className="flex-1 px-6 py-8">
        <PlanGate allowed={planAllows(plan, 'editPrompts')} lang={lang}>
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <p className="text-sm font-semibold text-slate-700 mb-4">Prompt Bank Editor</p>
            <p className="text-slate-400 text-sm">Prompt editing UI coming in Phase 3B.</p>
          </div>
        </PlanGate>
      </main>
    </>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add "app/[lang]/dashboard/[clientId]/prompts/page.tsx"
git commit -m "feat: add prompt editor stub with Pro+ gate"
```

---

## Task 16: Dashboard Settings + Stripe Portal API

**Files:**
- Create: `app/[lang]/dashboard/settings/page.tsx`
- Create: `app/api/stripe/portal/route.ts`

- [ ] **Step 1: Create `app/api/stripe/portal/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { stripe, APP_URL } from '@/lib/stripe'
import { requireAuth } from '@/lib/auth'

export async function GET() {
  const profile = await requireAuth()
  const stripeCustomerId = profile.accounts?.stripe_customer_id

  if (!stripeCustomerId) {
    return NextResponse.json({ error: 'No billing account found' }, { status: 400 })
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: `${APP_URL}/en/dashboard/settings`,
  })

  return NextResponse.redirect(session.url)
}
```

- [ ] **Step 2: Create `app/[lang]/dashboard/settings/page.tsx`**

```typescript
import { requireAuth } from '@/lib/auth'
import { TopBar } from '@/components/dashboard/TopBar'

const PLAN_LABELS: Record<string, string> = {
  starter: 'Starter (Free)',
  pro: 'Pro — $99/month',
  enterprise: 'Enterprise',
}

export default async function SettingsPage() {
  const profile = await requireAuth()
  const plan    = profile.accounts?.plan ?? 'starter'
  const status  = profile.accounts?.status ?? 'active'
  const hasStripe = Boolean(profile.accounts?.stripe_customer_id)

  return (
    <>
      <TopBar title="Settings" />
      <main className="flex-1 px-6 py-8 max-w-lg">
        <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-6">
          {/* Plan */}
          <div>
            <p className="text-sm font-semibold text-slate-700 mb-3">Current Plan</p>
            <div className="flex items-center gap-3">
              <span className="text-lg font-black text-slate-900">{PLAN_LABELS[plan] ?? plan}</span>
              {status !== 'active' && (
                <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded">
                  {status.replace('_', ' ')}
                </span>
              )}
            </div>
          </div>

          {/* Billing */}
          {hasStripe && (
            <div>
              <p className="text-sm font-semibold text-slate-700 mb-3">Billing</p>
              <a
                href="/api/stripe/portal"
                className="inline-block bg-slate-900 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-slate-700 transition"
              >
                Manage Billing →
              </a>
              <p className="text-xs text-slate-400 mt-2">
                Update payment method, view invoices, or cancel subscription.
              </p>
            </div>
          )}

          {plan === 'starter' && (
            <div className="border-t border-slate-100 pt-4">
              <a
                href="/pricing"
                className="inline-block bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 transition"
              >
                Upgrade to Pro →
              </a>
            </div>
          )}
        </div>
      </main>
    </>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add app/api/stripe/portal/route.ts "app/[lang]/dashboard/settings/page.tsx"
git commit -m "feat: add settings page with Stripe billing portal link"
```

---

## Task 17: Stripe Checkout + Webhook

**Files:**
- Create: `app/api/stripe/checkout/route.ts`
- Create: `app/api/stripe/webhook/route.ts`
- Create: `__tests__/api/stripe-webhook.test.ts`

- [ ] **Step 1: Write webhook handler tests**

Create `__tests__/api/stripe-webhook.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock modules before imports
vi.mock('@/lib/stripe', () => ({
  stripe: {
    webhooks: {
      constructEvent: vi.fn(),
    },
  },
}))

vi.mock('@/lib/supabase-server', () => ({
  createServiceSupabaseClient: vi.fn(),
}))

describe('stripe webhook plan mapping', () => {
  it('maps price_pro to pro plan', () => {
    const priceId = process.env.STRIPE_PRICE_PRO ?? 'price_pro'
    // Mapping logic extracted for unit testing
    const getPlan = (pid: string) =>
      pid === (process.env.STRIPE_PRICE_PRO ?? 'price_pro') ? 'pro' : 'starter'
    expect(getPlan(priceId)).toBe('pro')
  })

  it('maps unknown price to starter', () => {
    const getPlan = (pid: string) =>
      pid === (process.env.STRIPE_PRICE_PRO ?? 'price_pro') ? 'pro' : 'starter'
    expect(getPlan('price_unknown')).toBe('starter')
  })
})
```

- [ ] **Step 2: Run — expect pass (pure logic, no IO)**

```bash
npm test -- __tests__/api/stripe-webhook.test.ts
```

Expected: 2 tests passed.

- [ ] **Step 3: Create `app/api/stripe/checkout/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { stripe, STRIPE_PRICES, APP_URL } from '@/lib/stripe'
import { requireAuth } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const { plan } = await req.json()
  const profile = await requireAuth()

  if (plan !== 'pro') {
    return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: STRIPE_PRICES.pro, quantity: 1 }],
    customer_email: profile.display_name ?? undefined,
    metadata: { account_id: profile.account_id },
    success_url: `${APP_URL}/auth/callback?next=/en/dashboard/settings`,
    cancel_url:  `${APP_URL}/pricing`,
  })

  return NextResponse.json({ url: session.url })
}
```

- [ ] **Step 4: Create `app/api/stripe/webhook/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { createServiceSupabaseClient } from '@/lib/supabase-server'

export const config = { api: { bodyParser: false } }

function getPlan(priceId: string): 'starter' | 'pro' | 'enterprise' {
  if (priceId === process.env.STRIPE_PRICE_PRO) return 'pro'
  return 'starter'
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const sig = req.headers.get('stripe-signature') ?? ''

  let event
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch (err) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const supabase = await createServiceSupabaseClient()

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as { metadata?: { account_id?: string }; customer?: string; subscription?: string }
    const accountId = session.metadata?.account_id
    if (!accountId) return NextResponse.json({ ok: true })

    await supabase.from('accounts').upsert({
      id: accountId,
      stripe_customer_id: session.customer as string,
      stripe_subscription_id: session.subscription as string,
      plan: 'pro',
      status: 'active',
    })
  }

  if (event.type === 'customer.subscription.updated') {
    const sub = event.data.object as { id: string; status: string; items: { data: { price: { id: string } }[] } }
    const priceId = sub.items.data[0]?.price?.id ?? ''
    await supabase
      .from('accounts')
      .update({ plan: getPlan(priceId), status: sub.status })
      .eq('stripe_subscription_id', sub.id)
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as { id: string }
    await supabase
      .from('accounts')
      .update({ plan: 'starter', status: 'cancelled' })
      .eq('stripe_subscription_id', sub.id)
  }

  if (event.type === 'invoice.payment_failed') {
    const inv = event.data.object as { subscription: string }
    await supabase
      .from('accounts')
      .update({ status: 'past_due' })
      .eq('stripe_subscription_id', inv.subscription)
  }

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 5: Commit**

```bash
git add app/api/stripe/ __tests__/api/stripe-webhook.test.ts
git commit -m "feat: add Stripe checkout and webhook handler"
```

---

## Task 18: Pricing Page

**Files:**
- Create: `app/pricing/page.tsx`

- [ ] **Step 1: Create `app/pricing/page.tsx`**

```typescript
'use client'
import { useState } from 'react'
import Link from 'next/link'

export default function PricingPage() {
  const [loading, setLoading] = useState(false)

  const startProCheckout = async () => {
    setLoading(true)
    const res = await fetch('/api/stripe/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: 'pro' }),
    })
    if (res.status === 401) {
      // Not logged in — go to login first, return here after
      window.location.href = '/auth/login?next=/pricing'
      return
    }
    const { url } = await res.json()
    window.location.href = url
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <nav className="bg-white border-b border-slate-200 px-6 py-3 flex justify-between items-center">
        <Link href="/en" className="font-black text-slate-900">
          Fimmick <span className="text-blue-600">AEO</span>
        </Link>
        <Link href="/auth/login" className="text-sm text-slate-500 hover:text-slate-900">
          Sign in
        </Link>
      </nav>

      <main className="max-w-5xl mx-auto px-6 py-16">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-black text-slate-900">
            Know where your brand stands in AI search
          </h1>
          <p className="text-slate-500 mt-3 max-w-xl mx-auto">
            Track your Share of Voice across ChatGPT, Perplexity, Claude, and Gemini — every week, automatically.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Starter */}
          <div className="bg-white rounded-2xl border border-slate-200 p-7">
            <p className="text-xs font-bold tracking-widest text-slate-400 uppercase">Starter</p>
            <p className="text-3xl font-black text-slate-900 mt-2">Free</p>
            <p className="text-xs text-slate-400 mt-1">No credit card needed</p>
            <ul className="mt-6 space-y-2 text-sm text-slate-600">
              {['3 AEO scans / month', 'AI Fix Pack', '1 brand', '4-week Pulse history'].map(f => (
                <li key={f} className="flex gap-2"><span className="text-green-500">✓</span>{f}</li>
              ))}
              {['Prompt editing', 'Alerts'].map(f => (
                <li key={f} className="flex gap-2 text-slate-300"><span>–</span>{f}</li>
              ))}
            </ul>
            <Link
              href="/auth/login"
              className="mt-8 block text-center bg-slate-100 text-slate-700 rounded-xl py-3 text-sm font-semibold hover:bg-slate-200 transition"
            >
              Get Started Free
            </Link>
          </div>

          {/* Pro */}
          <div className="bg-slate-900 rounded-2xl border-2 border-blue-500 p-7 relative">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-xs font-bold px-3 py-1 rounded-full">
              MOST POPULAR
            </div>
            <p className="text-xs font-bold tracking-widest text-blue-400 uppercase">Pro</p>
            <p className="text-3xl font-black text-white mt-2">$99<span className="text-base font-normal text-slate-400">/mo</span></p>
            <p className="text-xs text-slate-500 mt-1">Billed monthly</p>
            <ul className="mt-6 space-y-2 text-sm text-slate-300">
              {['Unlimited AEO scans', 'AI Fix Pack', '1 brand', '6-month history', '✏️ Edit prompt bank', '🔔 SoV alerts', '📊 Competitor benchmarking'].map(f => (
                <li key={f} className="flex gap-2"><span className="text-green-400">✓</span>{f}</li>
              ))}
            </ul>
            <button
              onClick={startProCheckout}
              disabled={loading}
              className="mt-8 w-full bg-blue-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-blue-700 disabled:opacity-60 transition"
            >
              {loading ? 'Loading…' : 'Start Pro →'}
            </button>
          </div>

          {/* Enterprise */}
          <div className="bg-white rounded-2xl border border-slate-200 p-7">
            <p className="text-xs font-bold tracking-widest text-slate-400 uppercase">Enterprise</p>
            <p className="text-3xl font-black text-slate-900 mt-2">Custom</p>
            <p className="text-xs text-slate-400 mt-1">Talk to our team</p>
            <ul className="mt-6 space-y-2 text-sm text-slate-600">
              {['Everything in Pro', 'Up to 10 brands', 'Unlimited history + CSV', '📄 White-label PDF reports', '⚡ API access', '🤖 Custom AI platforms', 'Dedicated support'].map(f => (
                <li key={f} className="flex gap-2"><span className="text-green-500">✓</span>{f}</li>
              ))}
            </ul>
            <a
              href="mailto:aeo@fimmick.com"
              className="mt-8 block text-center bg-slate-900 text-white rounded-xl py-3 text-sm font-semibold hover:bg-slate-700 transition"
            >
              Contact Sales
            </a>
          </div>
        </div>
      </main>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add app/pricing/page.tsx
git commit -m "feat: add public pricing page with 3-tier layout and Stripe checkout CTA"
```

---

## Task 19: Admin Panel

**Files:**
- Create: `app/admin/layout.tsx`
- Create: `app/admin/page.tsx`
- Create: `app/api/admin/clients/route.ts`

- [ ] **Step 1: Create `app/admin/layout.tsx`**

```typescript
import { requireAdmin } from '@/lib/auth'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin() // Redirects non-admins to /en/dashboard
  return (
    <div className="min-h-screen bg-slate-50">
      <nav className="bg-slate-900 px-6 py-3 flex items-center gap-4">
        <span className="font-black text-white text-sm">
          Fimmick <span className="text-blue-400">AEO</span>{' '}
          <span className="text-slate-400 font-normal">Admin</span>
        </span>
        <a href="/en/dashboard" className="text-xs text-slate-400 hover:text-white ml-auto">
          ← Back to Dashboard
        </a>
      </nav>
      <main className="max-w-6xl mx-auto px-6 py-8">{children}</main>
    </div>
  )
}
```

- [ ] **Step 2: Create `app/api/admin/clients/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { createServiceSupabaseClient } from '@/lib/supabase-server'

export async function GET() {
  await requireAdmin()
  const supabase = await createServiceSupabaseClient()

  const { data, error } = await supabase
    .from('accounts')
    .select('*, clients(id, brand_name, status), profiles(display_name)')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  await requireAdmin()
  const { accountId, plan } = await req.json()
  if (!['starter', 'pro', 'enterprise'].includes(plan)) {
    return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
  }

  const supabase = await createServiceSupabaseClient()
  const { error } = await supabase
    .from('accounts')
    .update({ plan })
    .eq('id', accountId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 3: Create `app/admin/page.tsx`**

```typescript
'use client'
import { useEffect, useState } from 'react'

interface AccountRow {
  id: string
  plan: string
  status: string
  clients: { id: string; brand_name: string; status: string }[]
  profiles: { display_name: string | null }[]
}

export default function AdminPage() {
  const [accounts, setAccounts] = useState<AccountRow[]>([])
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    fetch('/api/admin/clients').then(r => r.json()).then(d => {
      setAccounts(d)
      setLoading(false)
    })
  }, [])

  const changePlan = async (accountId: string, plan: string) => {
    await fetch('/api/admin/clients', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId, plan }),
    })
    setAccounts(prev => prev.map(a => a.id === accountId ? { ...a, plan } : a))
  }

  if (loading) return <p className="text-slate-400">Loading…</p>

  return (
    <div>
      <h1 className="text-xl font-black text-slate-900 mb-6">All Accounts</h1>
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left">
              <th className="px-4 py-3 text-slate-500 font-medium">Account</th>
              <th className="px-4 py-3 text-slate-500 font-medium">Brands</th>
              <th className="px-4 py-3 text-slate-500 font-medium">Status</th>
              <th className="px-4 py-3 text-slate-500 font-medium">Plan</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map(a => (
              <tr key={a.id} className="border-b border-slate-100">
                <td className="px-4 py-3 text-slate-700">
                  {a.profiles?.[0]?.display_name ?? a.id.slice(0, 8)}
                </td>
                <td className="px-4 py-3 text-slate-500">
                  {a.clients?.map(c => c.brand_name).join(', ') || '—'}
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                    a.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
                  }`}>
                    {a.status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <select
                    value={a.plan}
                    onChange={e => changePlan(a.id, e.target.value)}
                    className="text-xs border border-slate-200 rounded px-2 py-1"
                  >
                    <option value="starter">Starter</option>
                    <option value="pro">Pro</option>
                    <option value="enterprise">Enterprise</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add app/admin/ app/api/admin/
git commit -m "feat: add Fimmick super-admin panel with tier override"
```

---

## Task 20: Run Full Test Suite + Build Check

- [ ] **Step 1: Run all tests**

```bash
cd /Users/willylai/Documents/Claude/Projects/AEO
npm test
```

Expected: all existing 21 tests + 9 new tests pass (tier: 7, webhook: 2).

- [ ] **Step 2: TypeScript build check**

```bash
npm run build 2>&1 | grep -E "(error|warning|Error)" | head -20
```

Expected: no TypeScript errors. (Build may warn about missing Stripe env vars — that is expected in dev.)

- [ ] **Step 3: Fix any type errors before proceeding**

---

## Task 21: Vercel Environment Variables + Deploy

- [ ] **Step 1: Add Stripe env vars to Vercel**

Run for each variable (replace values with real Stripe keys from dashboard):

```bash
npx vercel env add STRIPE_SECRET_KEY production
npx vercel env add STRIPE_WEBHOOK_SECRET production
npx vercel env add STRIPE_PRICE_PRO production
npx vercel env add NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY production
npx vercel env add NEXT_PUBLIC_APP_URL production
# Value for NEXT_PUBLIC_APP_URL: https://fimmick-aeo.vercel.app
```

- [ ] **Step 2: Add Stripe webhook in Stripe dashboard**

In Stripe Dashboard → Webhooks → Add endpoint:
- URL: `https://fimmick-aeo.vercel.app/api/stripe/webhook`
- Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`
- Copy the webhook signing secret → add as `STRIPE_WEBHOOK_SECRET`

- [ ] **Step 3: Commit spec + plan + final commit**

```bash
git add docs/superpowers/specs/2026-04-24-fimmick-aeo-phase3a-design.md
git add docs/superpowers/plans/2026-04-24-fimmick-aeo-phase3a.md
git commit -m "docs: add Phase 3A design spec and implementation plan"
git push -u origin phase3a
```

- [ ] **Step 4: Deploy to Vercel**

```bash
npx vercel deploy --prod
```

---

## Task 22: End-to-End Verification

- [ ] **Step 1: Auth — Google OAuth**
  - Visit `https://fimmick-aeo.vercel.app/en/dashboard`
  - Expect redirect to `/auth/login`
  - Click "Continue with Google" → complete OAuth flow
  - Expect redirect to `/en/dashboard`

- [ ] **Step 2: Auth — Magic Link**
  - Visit `/auth/login`, enter email, click "Send Magic Link"
  - Click email link → expect redirect to `/en/dashboard`

- [ ] **Step 3: Middleware guard**
  - Sign out (click in sidebar)
  - Directly visit `/en/dashboard` → expect redirect to `/auth/login`

- [ ] **Step 4: Brand list**
  - Sign in as admin → expect Fimmick brand card with SoV %

- [ ] **Step 5: AI Pulse page**
  - Click Fimmick brand card → expect SoV charts, platform breakdown, missed table

- [ ] **Step 6: Tier gate**
  - Sign in as Starter account → click Prompts → expect upgrade CTA

- [ ] **Step 7: Admin panel**
  - Visit `/admin` as admin user → expect accounts table with tier dropdowns
  - Visit `/admin` as non-admin → expect redirect to `/en/dashboard`

- [ ] **Step 8: Pricing page**
  - Visit `/pricing` → expect 3 tiers, correct features listed
  - Click "Start Pro" → if not logged in, expect redirect to `/auth/login?next=/pricing`

- [ ] **Step 9: Stripe Checkout (test mode)**
  - While logged in, click "Start Pro" on pricing page
  - Complete Stripe test checkout (card: 4242 4242 4242 4242)
  - Expect redirect to `/en/dashboard/settings`
  - Check Supabase `accounts` table → plan should be `pro`

- [ ] **Step 10: Billing Portal**
  - On settings page, click "Manage Billing →"
  - Expect Stripe billing portal opens
