# Phase 3A Design Spec — Auth · Multi-tenancy · Stripe Billing

**Date:** 2026-04-24  
**Project:** Fimmick AEO  
**Branch:** phase3a

---

## Context

Phases 1 and 2 are live at `fimmick-aeo.vercel.app`. Phase 1 is a public AEO check tool (5 checks + AI fix pack). Phase 2 is a public AI Pulse dashboard fed by weekly n8n runs. Currently there is no auth — all data is public and admin-seeded.

Phase 3A adds the SaaS foundation: Supabase Auth (Google OAuth + Magic Link), multi-tenant accounts, Stripe billing (3 tiers), an authenticated dashboard shell with dark sidebar, and a Fimmick super-admin panel. This is the prerequisite for everything in 3B and 3C.

**Decisions made:**
- Pricing: Starter (free) · Pro ($99/mo) · Enterprise (custom/sales)
- Auth: Google OAuth + Magic Link — both Supabase native
- Dashboard shell: dark sidebar + top bar
- Prompt bank: client self-serve (Pro+) + Fimmick admin override
- Billing: Stripe self-serve checkout for Starter/Pro; manual for Enterprise

---

## 1. Data Model Changes

### New tables

```sql
CREATE TABLE accounts (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_customer_id     text UNIQUE,
  stripe_subscription_id text,
  plan                   text NOT NULL DEFAULT 'starter',
  status                 text NOT NULL DEFAULT 'active',
  created_at             timestamptz DEFAULT now()
);

CREATE TABLE profiles (
  id           uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id   uuid REFERENCES accounts(id) ON DELETE CASCADE,
  display_name text,
  is_admin     boolean DEFAULT false,
  created_at   timestamptz DEFAULT now()
);
```

### Altered tables

```sql
ALTER TABLE clients ADD COLUMN account_id uuid REFERENCES accounts(id) ON DELETE CASCADE;
```

### Row-Level Security

- `accounts`: user sees only their own account
- `clients`: user sees brands belonging to their account
- `prompt_bank`, `pulse_metrics`, `pulse_weekly_summary`: via clients FK
- Admin (`is_admin = true`) uses service-role context to bypass RLS

---

## 2. New File Structure

```
app/
  pricing/page.tsx
  auth/
    login/page.tsx
    callback/route.ts
  [lang]/dashboard/
    layout.tsx               # auth guard + sidebar shell
    page.tsx                 # brand list home
    [clientId]/
      page.tsx               # AI Pulse (auth-gated, migrated from /pulse/[clientId])
      prompts/page.tsx       # prompt editor stub (Pro+ gate)
    settings/page.tsx
  admin/
    layout.tsx
    page.tsx
    [clientId]/page.tsx
  api/
    stripe/
      checkout/route.ts
      webhook/route.ts
      portal/route.ts
    admin/clients/route.ts

components/
  dashboard/
    Sidebar.tsx
    TopBar.tsx
    BrandCard.tsx
    PlanGate.tsx
  auth/LoginForm.tsx

lib/
  auth.ts                    # requireAuth(), requireAdmin(), getProfile()
  stripe.ts                  # Stripe singleton + price IDs
  tier.ts                    # planAllows(plan, feature)
  supabase-server.ts         # createServerSupabaseClient() using @supabase/ssr
```

---

## 3. Auth Flow

1. `/pricing` → pick plan → Starter: `/auth/login` directly | Pro: Stripe Checkout first
2. After payment: Stripe webhook creates `accounts` row with plan
3. User completes auth (Google / Magic Link) → callback creates `profiles` row linked to account
4. Middleware guards `/dashboard/**` and `/admin/**`

---

## 4. Stripe Integration

**Webhook events handled:**
| Event | Action |
|---|---|
| `checkout.session.completed` | Create/update `accounts` |
| `customer.subscription.updated` | Update plan + status |
| `customer.subscription.deleted` | Downgrade to starter |
| `invoice.payment_failed` | Set status = past_due |

---

## 5. Tier Feature Gates

```typescript
const TIER_FEATURES = {
  starter:    { maxBrands: 1, editPrompts: false, historyWeeks: 4,  alerts: false },
  pro:        { maxBrands: 1, editPrompts: true,  historyWeeks: 26, alerts: true  },
  enterprise: { maxBrands: 10, editPrompts: true, historyWeeks: 999, alerts: true },
}
export function planAllows(plan: string, feature: keyof typeof TIER_FEATURES.starter): boolean
```

---

## 6. Page Routes

| Route | Auth | Tier | Description |
|---|---|---|---|
| `/pricing` | public | — | Pricing page + Stripe CTAs |
| `/auth/login` | public | — | Google OAuth + Magic Link |
| `/en/dashboard` | ✅ | any | Brand list home |
| `/en/dashboard/[clientId]` | ✅ | any | AI Pulse dashboard |
| `/en/dashboard/[clientId]/prompts` | ✅ | Pro+ | Prompt editor stub |
| `/en/dashboard/settings` | ✅ | any | Account + billing portal |
| `/admin` | ✅ admin | — | Super-admin client list |
| `/admin/[clientId]` | ✅ admin | — | Edit any client |

---

## 7. Out of Scope (Phase 3B / 3C)

- Prompt bank CRUD UI (3B)
- Multi-brand switcher (3B)
- Competitor benchmarking (3B)
- SoV alerts / email digest (3C)
- White-label PDF reports (3C)
- API access + API key management (3C)
