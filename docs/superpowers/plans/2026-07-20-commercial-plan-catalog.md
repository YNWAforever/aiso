# Commercial Plan Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one typed, client-safe Plan Catalog the source of truth for Fimmick AISO plan identifiers, prices, allowances, release states, Stripe mappings, runtime entitlements, and honest bilingual pricing presentation.

**Architecture:** Add a pure `lib/plans/catalog.ts` module with no environment-variable or framework imports so both Client Components and Route Handlers can consume it safely. Keep `lib/tier.ts` as a compatibility facade for existing dashboard and API callers, but derive all legacy `PlanFeatures` and commercial entitlements from the catalog. Stripe secrets remain in the server-side `lib/stripe.ts`; checkout and webhook code use pure catalog validators and reverse mapping rather than maintaining their own plan lists.

**Tech Stack:** Next.js 16.2 App Router, React 19, TypeScript, next-intl, Stripe, Vitest, ESLint.

## Global Constraints

- Preserve the existing paid identifiers and displayed monthly prices: Basic `$29`, Pro `$79`, Enterprise `$199`.
- Do not change production Stripe price IDs, currency, checkout mode, webhook persistence RPCs, or subscription lifecycle semantics.
- Keep Stripe environment variables server-only; `lib/plans/catalog.ts` must not import `lib/stripe.ts`, `server-only`, Next.js, or `process.env`.
- Pro is a 3-brand workspace; Enterprise is a 10-brand workspace; billing is not per seat.
- Pro history remains 26 weeks. Enterprise history is represented canonically as account-lifetime (`null`) and exposed through the legacy interface as `999` weeks until downstream history queries are migrated.
- Basic retains 3 authenticated scans per month. Pro and Enterprise retain fair-use on-demand scanning (`monthlyScanLimit: null`) with existing abuse protection.
- Do not claim unfinished Pro reports, Enterprise white-label PDF, public API, or custom-platform support as currently available.
- Public API, custom AI platforms, SSO, SLA, and dedicated customer success are Enterprise Custom capabilities, not self-serve Enterprise entitlements.
- Preserve EN and `zh-HK` feature parity and exact platform/brand names.
- Route Handler `POST` methods remain uncached and continue using `NextRequest`/`NextResponse` as supported by the bundled Next.js 16 guide.
- Only serializable, secret-free catalog data may cross into the existing Pricing Client Component.
- Follow TDD: observe each focused test fail before implementing the matching production change.
- Do not add a database migration or a new dependency in this phase.

## Program Decomposition

This plan implements only **Phase 0 ??Commercial Source of Truth** from `docs/superpowers/specs/2026-07-20-pro-enterprise-product-design.md`. Later plans independently cover:

1. Pro monitoring foundation.
2. Pro Action Queue, Monthly Review, and attributed client reports.
3. Self-serve Enterprise portfolio, white-label, CSV, and PDF.
4. Enterprise Custom sales, policy overrides, SSO, API, and governance after validated demand.

## File Structure

| File | Responsibility |
|---|---|
| `lib/plans/catalog.ts` | Pure plan IDs, typed definitions, allowances, target modes, release states, validators, and Stripe-price reverse mapping |
| `lib/types.ts` | Re-export `PlanFeatures` for existing consumers without creating a duplicate definition |
| `lib/tier.ts` | Compatibility facade and paid/trial entitlement resolver derived from the catalog |
| `lib/stripe.ts` | Server-side Stripe client and a typed environment-backed price map |
| `app/api/stripe/checkout/route.ts` | Validate checkout plan through the catalog and use the typed Stripe price map |
| `app/api/stripe/webhook/route.ts` | Resolve canonical Stripe prices through the catalog before persistence |
| `app/[lang]/pricing/page.tsx` | Render catalog prices and honest self-serve versus Custom boundaries |
| `messages/en.json` | English fair-use, planned-feature, priority-support, and Enterprise Custom copy |
| `messages/zh-HK.json` | Hong Kong Traditional Chinese parity for the same commercial copy |
| `__tests__/lib/plan-catalog.test.ts` | Catalog values, fallback, release-state, and reverse-price contracts |
| `__tests__/lib/commercial-entitlement.test.ts` | Paid, trial, failed-payment, history, and scan-limit compatibility |
| `__tests__/api/stripe-checkout.test.ts` | Checkout validation, locale, metadata, and price selection |
| `__tests__/api/stripe-entitlement-integrity.test.ts` | Canonical webhook price mapping and lifecycle integrity |
| `__tests__/lib/pricing-billing-truth.test.ts` | Cross-surface pricing, localization, and unsupported-promise drift guard |

---

### Task 1: Introduce the typed Plan Catalog and preserve entitlement compatibility

**Files:**
- Create: `lib/plans/catalog.ts`
- Create: `__tests__/lib/plan-catalog.test.ts`
- Modify: `lib/types.ts:300-314`
- Modify: `lib/tier.ts:1-121`
- Modify: `__tests__/lib/commercial-entitlement.test.ts`
- Test: `__tests__/lib/plan-catalog.test.ts`
- Test: `__tests__/lib/commercial-entitlement.test.ts`
- Test: `__tests__/lib/tier.test.ts`
- Test: `__tests__/lib/tier-phase3b.test.ts`

**Interfaces:**
- Produces: `PlanId`, `CheckoutPlanId`, `PlanFeatures`, `PlanDefinition`, `StripePriceMap`, `PLAN_IDS`, `CHECKOUT_PLAN_IDS`, `PLAN_CATALOG`, `getPlanDefinition(value)`, `getCheckoutPlanId(value)`, and `getPlanFromStripePrice(priceId, prices)`.
- Preserves: `getPlanFeatures(plan)`, `planAllows(plan, feature)`, `maxBrandsForPlan(plan)`, and `resolveCommercialEntitlement(account, now)` from `lib/tier.ts`.
- Invariant: unknown or malformed plans resolve to Free; only `basic`, `pro`, and `enterprise` pass checkout validation.

- [ ] **Step 1: Write the failing catalog tests**

Create `__tests__/lib/plan-catalog.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  CHECKOUT_PLAN_IDS,
  PLAN_CATALOG,
  getCheckoutPlanId,
  getPlanDefinition,
  getPlanFromStripePrice,
  type StripePriceMap,
} from '@/lib/plans/catalog'

const prices: StripePriceMap = {
  basic: 'price_basic_test',
  pro: 'price_pro_test',
  enterprise: 'price_enterprise_test',
}

describe('Plan Catalog', () => {
  it('defines the three self-serve paid plans in display order', () => {
    expect(CHECKOUT_PLAN_IDS).toEqual(['basic', 'pro', 'enterprise'])
    expect(CHECKOUT_PLAN_IDS.map(id => PLAN_CATALOG[id].monthlyPriceUsd)).toEqual([29, 79, 199])
  })

  it('keeps canonical allowances aligned with legacy feature fields', () => {
    for (const plan of Object.values(PLAN_CATALOG)) {
      expect(plan.features.plan).toBe(plan.id)
      expect(plan.features.max_brands).toBe(plan.maxBrands)
      expect(plan.features.history_weeks).toBe(plan.historyWeeks ?? 999)
    }
  })

  it('captures the approved Pro and Enterprise target boundaries without claiming release', () => {
    expect(PLAN_CATALOG.pro).toMatchObject({
      maxBrands: 3,
      historyWeeks: 26,
      monthlyScanLimit: null,
      competitorMode: 'summary',
      reportBranding: 'fimmick',
      supportLevel: 'standard',
    })
    expect(PLAN_CATALOG.pro.release).toMatchObject({
      monitoring: 'planned',
      competitorSummary: 'planned',
      clientReports: 'planned',
    })
    expect(PLAN_CATALOG.enterprise).toMatchObject({
      maxBrands: 10,
      historyWeeks: null,
      competitorMode: 'full',
      reportBranding: 'white-label',
      supportLevel: 'priority',
    })
    expect(PLAN_CATALOG.enterprise.release).toMatchObject({
      whiteLabelPdf: 'planned',
      publicApi: 'custom',
      customPlatforms: 'custom',
      dedicatedSuccess: 'custom',
    })
  })

  it('fails closed for unknown plans and excludes Free from checkout', () => {
    expect(getPlanDefinition('unexpected').id).toBe('free')
    expect(getPlanDefinition(null).id).toBe('free')
    expect(getCheckoutPlanId('free')).toBeNull()
    expect(getCheckoutPlanId('pro')).toBe('pro')
    expect(getCheckoutPlanId({})).toBeNull()
  })

  it('maps a canonical Stripe price to exactly one paid plan', () => {
    expect(getPlanFromStripePrice('price_basic_test', prices)).toBe('basic')
    expect(getPlanFromStripePrice('price_pro_test', prices)).toBe('pro')
    expect(getPlanFromStripePrice('price_enterprise_test', prices)).toBe('enterprise')
    expect(getPlanFromStripePrice('price_unknown', prices)).toBeNull()
  })

  it('rejects ambiguous or missing Stripe price mappings', () => {
    expect(getPlanFromStripePrice('', prices)).toBeNull()
    expect(getPlanFromStripePrice('same', {
      basic: 'same',
      pro: 'same',
      enterprise: 'price_enterprise_test',
    })).toBeNull()
  })
})
```

Extend `__tests__/lib/commercial-entitlement.test.ts` with:

```ts
it('derives limits and features from the canonical catalog', () => {
  const enterprise = resolveCommercialEntitlement(account({
    plan: 'enterprise',
    stripe_subscription_id: 'sub_enterprise',
  }), NOW)

  expect(enterprise).toMatchObject({
    plan: 'enterprise',
    monthlyScanLimit: null,
    features: { max_brands: 10, history_weeks: 999 },
  })
})
```

- [ ] **Step 2: Run the focused tests and observe the missing-module failure**

Run:

```powershell
npm.cmd test -- __tests__/lib/plan-catalog.test.ts __tests__/lib/commercial-entitlement.test.ts
```

Expected: FAIL with a module-resolution error for `@/lib/plans/catalog`.

- [ ] **Step 3: Add the complete client-safe catalog**

Create `lib/plans/catalog.ts`:

```ts
export const PLAN_IDS = ['free', 'basic', 'pro', 'enterprise'] as const
export const CHECKOUT_PLAN_IDS = ['basic', 'pro', 'enterprise'] as const

export type PlanId = (typeof PLAN_IDS)[number]
export type CheckoutPlanId = (typeof CHECKOUT_PLAN_IDS)[number]
export type ReleaseState = 'available' | 'planned' | 'custom' | 'unavailable'
export type CompetitorMode = 'none' | 'summary' | 'full'
export type ReportBranding = 'none' | 'fimmick' | 'white-label'
export type SupportLevel = 'standard' | 'priority' | 'contractual'
export type MonitoringCadence = 'manual' | 'weekly'
export type ExportFormat = 'csv' | 'pdf' | 'api'
export type StripePriceMap = Record<CheckoutPlanId, string>

export interface PlanFeatures {
  plan: PlanId
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

export interface PlanReleaseState {
  monitoring: ReleaseState
  competitorSummary: ReleaseState
  clientReports: ReleaseState
  whiteLabelPdf: ReleaseState
  publicApi: ReleaseState
  customPlatforms: ReleaseState
  dedicatedSuccess: ReleaseState
}

export interface PlanDefinition {
  id: PlanId
  checkout: boolean
  monthlyPriceUsd: number
  maxBrands: number
  historyWeeks: number | null
  monthlyScanLimit: number | null
  monitoringCadence: MonitoringCadence
  competitorMode: CompetitorMode
  reportBranding: ReportBranding
  exportFormats: readonly ExportFormat[]
  supportLevel: SupportLevel
  release: PlanReleaseState
  features: PlanFeatures
}

const unavailableRelease: PlanReleaseState = {
  monitoring: 'unavailable',
  competitorSummary: 'unavailable',
  clientReports: 'unavailable',
  whiteLabelPdf: 'unavailable',
  publicApi: 'unavailable',
  customPlatforms: 'unavailable',
  dedicatedSuccess: 'unavailable',
}

export const PLAN_CATALOG: Record<PlanId, PlanDefinition> = {
  free: {
    id: 'free', checkout: false, monthlyPriceUsd: 0,
    maxBrands: 1, historyWeeks: 0, monthlyScanLimit: 0,
    monitoringCadence: 'manual', competitorMode: 'none', reportBranding: 'none',
    exportFormats: [], supportLevel: 'standard', release: unavailableRelease,
    features: {
      plan: 'free', platform_access: [],
      agent_recs: false, agent_progress: false, agent_competitors: false,
      alerts: false, csv_export: false, max_brands: 1, history_weeks: 0,
      edit_prompts: false, local_trust_roi: false,
      local_trust_competitors: false, local_trust_export: false,
    },
  },
  basic: {
    id: 'basic', checkout: true, monthlyPriceUsd: 29,
    maxBrands: 1, historyWeeks: 4, monthlyScanLimit: 3,
    monitoringCadence: 'manual', competitorMode: 'none', reportBranding: 'none',
    exportFormats: [], supportLevel: 'standard', release: unavailableRelease,
    features: {
      plan: 'basic', platform_access: ['gemini'],
      agent_recs: true, agent_progress: false, agent_competitors: false,
      alerts: false, csv_export: false, max_brands: 1, history_weeks: 4,
      edit_prompts: false, local_trust_roi: false,
      local_trust_competitors: false, local_trust_export: false,
    },
  },
  pro: {
    id: 'pro', checkout: true, monthlyPriceUsd: 79,
    maxBrands: 3, historyWeeks: 26, monthlyScanLimit: null,
    monitoringCadence: 'weekly', competitorMode: 'summary', reportBranding: 'fimmick',
    exportFormats: [], supportLevel: 'standard',
    release: {
      ...unavailableRelease,
      monitoring: 'planned', competitorSummary: 'planned', clientReports: 'planned',
    },
    features: {
      plan: 'pro',
      platform_access: ['gemini', 'gpt4o', 'claude', 'perplexity-s', 'perplexity-p'],
      agent_recs: true, agent_progress: true, agent_competitors: false,
      alerts: true, csv_export: false, max_brands: 3, history_weeks: 26,
      edit_prompts: true, local_trust_roi: true,
      local_trust_competitors: false, local_trust_export: false,
    },
  },
  enterprise: {
    id: 'enterprise', checkout: true, monthlyPriceUsd: 199,
    maxBrands: 10, historyWeeks: null, monthlyScanLimit: null,
    monitoringCadence: 'weekly', competitorMode: 'full', reportBranding: 'white-label',
    exportFormats: ['csv'], supportLevel: 'priority',
    release: {
      monitoring: 'planned', competitorSummary: 'available', clientReports: 'planned',
      whiteLabelPdf: 'planned', publicApi: 'custom', customPlatforms: 'custom',
      dedicatedSuccess: 'custom',
    },
    features: {
      plan: 'enterprise',
      platform_access: ['gemini', 'gpt4o', 'claude', 'perplexity-s', 'perplexity-p'],
      agent_recs: true, agent_progress: true, agent_competitors: true,
      alerts: true, csv_export: true, max_brands: 10, history_weeks: 999,
      edit_prompts: true, local_trust_roi: true,
      local_trust_competitors: true, local_trust_export: true,
    },
  },
}

export function getPlanDefinition(value: unknown): PlanDefinition {
  return typeof value === 'string' && PLAN_IDS.includes(value as PlanId)
    ? PLAN_CATALOG[value as PlanId]!
    : PLAN_CATALOG.free
}

export function getCheckoutPlanId(value: unknown): CheckoutPlanId | null {
  return typeof value === 'string' && CHECKOUT_PLAN_IDS.includes(value as CheckoutPlanId)
    ? value as CheckoutPlanId
    : null
}

export function getPlanFromStripePrice(
  priceId: string,
  prices: StripePriceMap,
): CheckoutPlanId | null {
  if (!priceId) return null
  const matches = CHECKOUT_PLAN_IDS.filter(plan => prices[plan] === priceId)
  return matches.length === 1 ? matches[0]! : null
}
```

- [ ] **Step 4: Replace the duplicate `PlanFeatures` definition with a type re-export**

In `lib/types.ts`, replace the existing `PlanFeatures` interface with:

```ts
export type { PlanFeatures } from '@/lib/plans/catalog'
```

- [ ] **Step 5: Convert `lib/tier.ts` into a catalog-backed compatibility facade**

Remove the local `FEATURES` object. Import the catalog:

```ts
import {
  PLAN_CATALOG,
  getPlanDefinition,
  type PlanFeatures,
  type PlanId,
} from '@/lib/plans/catalog'

export type EffectivePlan = PlanId
```

Keep the existing commercial account and entitlement types, then implement the public helpers as:

```ts
export function getPlanFeatures(plan: string): PlanFeatures {
  return getPlanDefinition(plan).features
}

export function planAllows(plan: string, feature: keyof PlanFeatures): boolean {
  return Boolean(getPlanFeatures(plan)[feature])
}

export function maxBrandsForPlan(plan: string): number {
  return getPlanDefinition(plan).maxBrands
}
```

In `freeEntitlement`, derive values from `PLAN_CATALOG.free`:

```ts
return {
  plan: 'free',
  source,
  features: PLAN_CATALOG.free.features,
  monthlyScanLimit: PLAN_CATALOG.free.monthlyScanLimit,
}
```

After `freeEntitlement`, add one exact helper for paid and trial branches:

```ts
function activeEntitlement(
  plan: Exclude<EffectivePlan, 'free'>,
  source: Extract<EntitlementSource, 'paid' | 'trial'>,
): CommercialEntitlement {
  const definition = PLAN_CATALOG[plan]
  return {
    plan,
    source,
    features: definition.features,
    monthlyScanLimit: definition.monthlyScanLimit,
  }
}
```

In the active subscription branch, return:

```ts
return activeEntitlement(plan, 'paid')
```

In the live trial branch, return:

```ts
return activeEntitlement(plan, 'trial')
```

Retain the existing paid/trial validation, `past_due`/`cancelled` fail-closed behavior, and unknown-plan handling unchanged.

- [ ] **Step 6: Run catalog and compatibility tests**

Run:

```powershell
npm.cmd test -- __tests__/lib/plan-catalog.test.ts __tests__/lib/commercial-entitlement.test.ts __tests__/lib/tier.test.ts __tests__/lib/tier-phase3b.test.ts
```

Expected: all focused files pass; no existing entitlement assertion changes except the new catalog-derived assertion.

- [ ] **Step 7: Run TypeScript before committing**

Run:

```powershell
npm.cmd exec tsc -- --noEmit
```

Expected: exit code `0`.

- [ ] **Step 8: Commit the catalog boundary**

```powershell
git add lib/plans/catalog.ts lib/types.ts lib/tier.ts __tests__/lib/plan-catalog.test.ts __tests__/lib/commercial-entitlement.test.ts
git commit -m "refactor: centralize commercial plan catalog"
```

---

### Task 2: Make Stripe checkout and webhook consume the catalog

**Files:**
- Modify: `lib/stripe.ts:21-25`
- Modify: `app/api/stripe/checkout/route.ts:1-43`
- Modify: `app/api/stripe/webhook/route.ts:1-45`
- Modify: `__tests__/api/stripe-checkout.test.ts`
- Modify: `__tests__/api/stripe-entitlement-integrity.test.ts`
- Test: `__tests__/api/stripe-checkout.test.ts`
- Test: `__tests__/api/stripe-entitlement-integrity.test.ts`
- Test: `__tests__/api/stripe-webhook-full.test.ts`

**Interfaces:**
- Consumes: `CheckoutPlanId`, `StripePriceMap`, `getCheckoutPlanId`, and `getPlanFromStripePrice` from Task 1.
- Preserves: checkout request `{ plan, lang }`, checkout response `{ url }`, Stripe metadata `{ account_id, plan }`, canonical subscription retrieval, lease RPC ordering, and DB-safe account states.
- Produces: one typed `STRIPE_PRICES` map used only on the server.

- [ ] **Step 1: Add failing checkout validation tests**

Append to `__tests__/api/stripe-checkout.test.ts`:

```ts
it.each(['free', 'unexpected', '', null])('rejects non-checkout plan %j', async plan => {
  const response = await postCheckout({ plan, lang: 'en' })

  expect(response.status).toBe(400)
  expect(createCheckoutSession).not.toHaveBeenCalled()
  await expect(response.json()).resolves.toEqual({
    error: 'Invalid plan. Use basic, pro, or enterprise.',
  })
})

it.each([
  ['basic', 'price_basic_test'],
  ['pro', 'price_pro_test'],
  ['enterprise', 'price_enterprise_test'],
] as const)('selects the catalog-backed Stripe price for %s', async (plan, price) => {
  const response = await postCheckout({ plan, lang: 'en' })

  expect(response.status).toBe(200)
  expect(createCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({
    line_items: [{ price, quantity: 1 }],
    metadata: { account_id: 'account-1', plan },
  }))
})
```

In `__tests__/api/stripe-entitlement-integrity.test.ts`, add this property inside the existing `vi.hoisted` object:

```ts
stripePrices: {
  basic: 'price_basic_test',
  pro: 'price_pro_test',
  enterprise: 'price_enterprise_test',
},
```

Replace the mock's inline `STRIPE_PRICES` object with:

```ts
STRIPE_PRICES: mocks.stripePrices,
```

At the start of the existing `beforeEach`, reset it exactly:

```ts
Object.assign(mocks.stripePrices, {
  basic: 'price_basic_test',
  pro: 'price_pro_test',
  enterprise: 'price_enterprise_test',
})
```

Then add the ambiguous-price test:

```ts
it('rejects an ambiguous canonical Stripe price without changing entitlement', async () => {
  mocks.stripePrices.basic = 'duplicate_price'
  mocks.stripePrices.pro = 'duplicate_price'
  mocks.retrieveSubscription.mockResolvedValue(subscription({ price: 'duplicate_price' }))

  const response = await postWebhook(subscriptionEvent())

  expect(response.status).toBe(400)
  expect(applyRpcArgs()).toBeUndefined()
})
```

- [ ] **Step 2: Run the Stripe tests and observe the ambiguous-price failure**

Run:

```powershell
npm.cmd test -- __tests__/api/stripe-checkout.test.ts __tests__/api/stripe-entitlement-integrity.test.ts __tests__/api/stripe-webhook-full.test.ts
```

Expected: the new ambiguous-price test fails because the webhook's local `getPlan()` returns the first matching plan.

- [ ] **Step 3: Type the server-side Stripe price map**

In `lib/stripe.ts`, add a type-only import and replace the untyped map:

```ts
import type { StripePriceMap } from '@/lib/plans/catalog'

export const STRIPE_PRICES: StripePriceMap = {
  basic: process.env.STRIPE_PRICE_BASIC!,
  pro: process.env.STRIPE_PRICE_PRO!,
  enterprise: process.env.STRIPE_PRICE_ENTERPRISE!,
}
```

Do not move this map into the client-safe catalog and do not add `NEXT_PUBLIC_` price variables.

- [ ] **Step 4: Replace checkout's local plan list with catalog validation**

In `app/api/stripe/checkout/route.ts`, import:

```ts
import { getCheckoutPlanId } from '@/lib/plans/catalog'
```

Remove `VALID_PLANS`. Replace destructuring and validation with:

```ts
const body = await req.json() as { plan?: unknown; lang?: unknown }
const plan = getCheckoutPlanId(body.plan)
const supportedLang = getSupportedLang(body.lang)
const profile = await getProfile()
if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

if (!plan) {
  return NextResponse.json(
    { error: 'Invalid plan. Use basic, pro, or enterprise.' },
    { status: 400 },
  )
}
```

Keep price lookup, missing-price handling, Stripe session creation, locale-safe return URLs, and error handling. The validated `plan` is the value written to metadata.

- [ ] **Step 5: Replace webhook's local reverse mapping with the ambiguity-safe catalog helper**

In `app/api/stripe/webhook/route.ts`, import:

```ts
import {
  getPlanFromStripePrice,
  type CheckoutPlanId as Plan,
} from '@/lib/plans/catalog'
```

Delete the local `Plan` alias and `getPlan()` function. Change `getPurchasedPlan` to:

```ts
function getPurchasedPlan(subscription: CanonicalSubscription): Plan | null {
  const items = subscription.items?.data
  if (!Array.isArray(items) || items.length !== 1) return null
  return getPlanFromStripePrice(items[0]?.price?.id ?? '', STRIPE_PRICES)
}
```

Do not change canonical subscription retrieval, state mapping, leases, RPC arguments, or retry responses.

- [ ] **Step 6: Run focused Stripe tests**

Run:

```powershell
npm.cmd test -- __tests__/api/stripe-checkout.test.ts __tests__/api/stripe-entitlement-integrity.test.ts __tests__/api/stripe-webhook-full.test.ts __tests__/api/stripe-webhook.test.ts
```

Expected: all Stripe test files pass, including canonical-price and lifecycle-ordering coverage.

- [ ] **Step 7: Commit the Stripe integration**

```powershell
git add lib/stripe.ts app/api/stripe/checkout/route.ts app/api/stripe/webhook/route.ts __tests__/api/stripe-checkout.test.ts __tests__/api/stripe-entitlement-integrity.test.ts
git commit -m "refactor: derive Stripe plans from catalog"
```

---

### Task 3: Render honest bilingual pricing from the catalog

**Files:**
- Modify: `app/[lang]/pricing/page.tsx:1-384`
- Modify: `messages/en.json:344-410`
- Modify: `messages/zh-HK.json:344-410`
- Rewrite: `__tests__/lib/pricing-billing-truth.test.ts`
- Test: `__tests__/lib/pricing-billing-truth.test.ts`

**Interfaces:**
- Consumes: `CHECKOUT_PLAN_IDS`, `getPlanDefinition`, `CheckoutPlanId`, and catalog release states from Task 1.
- Preserves: localized checkout request, login continuation, monthly self-serve checkout, responsive comparison table, and Basic/Pro/Enterprise card order.
- Produces: honest public distinction between available, planned, and Enterprise Custom capabilities.
- Transitional sales destination: `mailto:aeo@fimmick.com`; the localized Enterprise Custom lead form remains Phase 3 work.

- [ ] **Step 1: Rewrite the pricing truth test to fail on the current hardcoded surface**

Replace `__tests__/lib/pricing-billing-truth.test.ts` with:

```ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CHECKOUT_PLAN_IDS, PLAN_CATALOG } from '@/lib/plans/catalog'
import enMessages from '@/messages/en.json'
import zhMessages from '@/messages/zh-HK.json'

const pricingSource = readFileSync(
  resolve(process.cwd(), 'app/[lang]/pricing/page.tsx'),
  'utf8',
)

describe('pricing billing truth', () => {
  it('renders paid prices from the catalog instead of duplicated literals', () => {
    expect(CHECKOUT_PLAN_IDS.map(id => PLAN_CATALOG[id].monthlyPriceUsd)).toEqual([29, 79, 199])
    expect(pricingSource).toContain('getPlanDefinition')
    expect(pricingSource).not.toMatch(/price:\s*['"]\$(29|79|199)['"]/)
    expect(pricingSource).toContain("body: JSON.stringify({ plan: planName, lang })")
  })

  it('does not sell Custom-only capabilities as self-serve Enterprise features', () => {
    expect(PLAN_CATALOG.enterprise.release).toMatchObject({
      publicApi: 'custom',
      customPlatforms: 'custom',
      dedicatedSuccess: 'custom',
    })
    expect(enMessages.pricing.enterprise_custom_body).toContain('API')
    expect(enMessages.pricing.enterprise_custom_body).toContain('SSO')
    expect(zhMessages.pricing.enterprise_custom_body).toContain('API')
    expect(zhMessages.pricing.enterprise_custom_body).toContain('SSO')
    expect(pricingSource).toContain('mailto:aeo@fimmick.com')
  })

  it('labels unreleased reports honestly in both locales', () => {
    expect(PLAN_CATALOG.pro.release.clientReports).toBe('planned')
    expect(PLAN_CATALOG.enterprise.release.whiteLabelPdf).toBe('planned')
    expect(enMessages.pricing.coming_soon).toBe('Coming soon')
    expect(zhMessages.pricing.coming_soon).toBe('即將推出')
    expect(enMessages.pricing.row_scans_p).toContain('fair-use')
    expect(enMessages.pricing.row_scans_e).toContain('fair-use')
    expect(zhMessages.pricing.row_scans_p).toContain('合理使用')
    expect(zhMessages.pricing.row_scans_e).toContain('合理使用')
  })

  it('keeps monthly-only checkout and locale parity', () => {
    expect(enMessages.pricing.per_month).toBe('/mo')
    expect(zhMessages.pricing.per_month).toBe('/??)
    expect(JSON.stringify(enMessages.pricing)).not.toMatch(/annual|yearly/i)
    expect(JSON.stringify(zhMessages.pricing)).not.toMatch(/年繳|按年/)
    expect(Object.keys(enMessages.pricing).sort()).toEqual(Object.keys(zhMessages.pricing).sort())
  })
})
```

- [ ] **Step 2: Run the pricing contract and observe the hardcoded-price/copy failures**

Run:

```powershell
npm.cmd test -- __tests__/lib/pricing-billing-truth.test.ts
```

Expected: FAIL because the page still hardcodes prices and the new bilingual keys do not exist.

- [ ] **Step 3: Add the exact bilingual commercial copy**

Update the existing pricing keys in `messages/en.json`:

```json
"row_scans_p": "Fair-use on-demand scans",
"row_scans_e": "Fair-use on-demand scans",
"coming_soon": "Coming soon",
"row_monitoring": "Automated weekly monitoring",
"priority_support": "Priority product support",
"row_client_report": "Client-ready report",
"enterprise_custom_title": "Need SSO, API, custom AI platforms, or more than 10 brands?",
"enterprise_custom_body": "Enterprise Custom adds SSO, scoped API access, custom AI platforms, contractual SLA, custom quotas, and dedicated customer success.",
"enterprise_custom_cta": "Contact sales"
```

Add the exact parity keys to `messages/zh-HK.json`:

```json
"row_scans_p": "合理使用的按需掃描",
"row_scans_e": "合理使用的按需掃描",
"coming_soon": "即將推出",
"row_monitoring": "自動每週監測",
"priority_support": "優先產品支援",
"row_client_report": "客戶交付報告",
"enterprise_custom_title": "需要 SSO、API、自訂 AI 平台或超過 10 個品牌？",
"enterprise_custom_body": "Enterprise Custom 提供 SSO、具權限範圍的 API、自訂 AI 平台、合約 SLA、客製配額及專屬客戶成功服務。",
"enterprise_custom_cta": "聯絡銷售"
```

Replace the old `row_support` wording that implies a dedicated success manager in self-serve Enterprise with `priority_support`. Keep dedicated success only in the Custom callout.

- [ ] **Step 4: Derive plan card prices and plan IDs from the catalog**

At the top of `app/[lang]/pricing/page.tsx`, import:

```ts
import {
  CHECKOUT_PLAN_IDS,
  getPlanDefinition,
  type CheckoutPlanId,
} from '@/lib/plans/catalog'
```

Change `startCheckout` to accept the catalog type:

```ts
const startCheckout = async (planName: CheckoutPlanId) => {
```

Replace the hardcoded `plans` array with:

```ts
const plans = CHECKOUT_PLAN_IDS.map(key => {
  const definition = getPlanDefinition(key)
  return {
    key,
    name: key === 'basic' ? t('basic_name') : key === 'pro' ? t('pro_name') : t('enterprise_name'),
    tag: key === 'basic' ? t('basic_tag') : key === 'pro' ? t('pro_tag') : t('enterprise_tag'),
    price: `$${definition.monthlyPriceUsd}`,
    priceSub: t('per_month'),
    cta: loading
      ? t('cta_loading')
      : key === 'basic' ? t('cta_basic') : key === 'pro' ? t('cta_pro') : t('cta_enterprise'),
    popular: key === 'pro',
    ctaAction: () => startCheckout(key),
  }
})
```

Retain monthly checkout and remove no Stripe logic from the Route Handler.

- [ ] **Step 5: Make the feature table honest about availability**

In the comparison rows:

```ts
const pro = getPlanDefinition('pro')
const enterprise = getPlanDefinition('enterprise')

const rows: FeatureRow[] = [
  { label: t('row_scans'), basic: t('row_scans_s'), pro: t('row_scans_p'), enterprise: t('row_scans_e') },
  {
    label: t('row_monitoring'),
    basic: false,
    pro: pro.release.monitoring === 'available' ? true : t('coming_soon'),
    enterprise: enterprise.release.monitoring === 'available' ? true : t('coming_soon'),
  },
  { label: t('row_checks'), basic: true, pro: true, enterprise: true },
  { label: t('row_fixpack'), basic: true, pro: true, enterprise: true },
  { label: t('row_fixpack_adv'), basic: false, pro: true, enterprise: true, highlight: true },
  { label: t('row_brands'), basic: t('row_brands_s'), pro: t('row_brands_p'), enterprise: t('row_brands_e') },
  { label: t('row_history'), basic: t('row_history_s'), pro: t('row_history_p'), enterprise: t('row_history_e') },
  { label: t('row_prompts'), basic: false, pro: true, enterprise: true },
  { label: t('row_alerts'), basic: false, pro: true, enterprise: true },
  {
    label: t('row_competitor'),
    basic: false,
    pro: pro.release.competitorSummary === 'available' ? true : t('coming_soon'),
    enterprise: enterprise.features.agent_competitors,
  },
  { label: t('row_authority'), basic: t('row_authority_s'), pro: t('row_authority_p'), enterprise: t('row_authority_e'), highlight: true },
  {
    label: t('row_client_report'),
    basic: false,
    pro: pro.release.clientReports === 'available' ? true : t('coming_soon'),
    enterprise: enterprise.release.clientReports === 'available' ? true : t('coming_soon'),
  },
  { label: t('row_csv'), basic: false, pro: false, enterprise: enterprise.features.csv_export },
  {
    label: t('row_pdf'),
    basic: false,
    pro: false,
    enterprise: enterprise.release.whiteLabelPdf === 'available' ? true : t('coming_soon'),
  },
  { label: t('row_api'), basic: false, pro: false, enterprise: false },
  { label: t('row_custom_platforms'), basic: false, pro: false, enterprise: false },
  { label: t('row_support'), basic: false, pro: false, enterprise: t('priority_support') },
]
```

Define one card-highlights record after `plans`:

```ts
const cardHighlights: Record<CheckoutPlanId, string[]> = {
  basic: [
    `${t('row_scans_s')} ${t('row_scans')}`,
    t('row_checks'),
    t('row_fixpack'),
    `${t('row_brands_s')} ${t('row_brands').toLowerCase()}`,
    `${t('row_history_s')} ${t('row_history').toLowerCase()}`,
  ],
  pro: [
    `${t('row_scans_p')} — ${t('row_scans')}`,
    t('row_checks'),
    t('row_fixpack_adv'),
    t('row_prompts'),
    t('row_alerts'),
    `${t('coming_soon')}: ${t('row_monitoring')}`,
    `${t('coming_soon')}: ${t('row_competitor')}`,
    `${t('coming_soon')}: ${t('row_client_report')}`,
  ],
  enterprise: [
    `${t('row_scans_e')} — ${t('row_scans')}`,
    `${t('row_brands_e')} ${t('row_brands').toLowerCase()}`,
    t('row_competitor'),
    t('row_csv'),
    t('priority_support'),
    `${t('coming_soon')}: ${t('row_monitoring')}`,
    `${t('coming_soon')}: ${t('row_client_report')}`,
    `${t('coming_soon')}: ${t('row_pdf')}`,
  ],
}
```

Replace the three conditional highlight `<ul>` blocks with one catalog-keyed render:

```tsx
<ul className="mb-7 flex-1 space-y-2.5 text-sm">
  {cardHighlights[plan.key].map(feature => (
    <li key={feature} className="flex items-start gap-2.5">
      <Check
        aria-hidden="true"
        className={`mt-0.5 size-3.5 shrink-0 ${plan.key === 'pro' ? 'text-primary' : 'text-emerald-500'}`}
      />
      <span className="text-xs text-slate-700">{feature}</span>
    </li>
  ))}
</ul>
```

API, custom platforms, SLA, and dedicated success must not appear in `cardHighlights` because they belong to the Custom callout.

- [ ] **Step 6: Add the transitional Enterprise Custom callout**

Below the three self-serve cards and above checkout errors, add:

```tsx
<aside className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-6 sm:flex sm:items-center sm:justify-between sm:gap-6">
  <div>
    <h3 className="font-bold text-foreground">{t('enterprise_custom_title')}</h3>
    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
      {t('enterprise_custom_body')}
    </p>
  </div>
  <a
    href="mailto:aeo@fimmick.com"
    className="mt-4 inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl border border-border bg-white px-5 text-sm font-semibold text-foreground transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:mt-0"
  >
    {t('enterprise_custom_cta')}
  </a>
</aside>
```

This is explicitly transitional. Do not collect lead data or create a new API route in Phase 0.

- [ ] **Step 7: Run pricing, localization, and checkout tests**

Run:

```powershell
npm.cmd test -- __tests__/lib/pricing-billing-truth.test.ts __tests__/api/stripe-checkout.test.ts
```

Expected: all present focused tests pass; EN and `zh-HK` pricing keys match.

- [ ] **Step 8: Verify the Pricing page visually before committing**

Run:

```powershell
npm.cmd run dev
```

Open `/en/pricing` and `/zh-HK/pricing` at 375px and 1440px. Verify:

- prices remain `$29`, `$79`, `$199`;
- no annual toggle appears;
- Pro remains visually recommended;
- unavailable reports are labelled Coming soon / 即將推出;
- API, custom platforms, SLA, and dedicated success appear only in the Enterprise Custom callout;
- the comparison table remains horizontally contained at 375px;
- keyboard focus reaches all checkout and contact actions;
- clicking a paid CTA still sends only `{ plan, lang }`.

Stop the development server after verification.

- [ ] **Step 9: Commit the honest pricing projection**

```powershell
git add app/[lang]/pricing/page.tsx messages/en.json messages/zh-HK.json __tests__/lib/pricing-billing-truth.test.ts
git commit -m "feat: align pricing with plan catalog"
```

---

### Task 4: Add a cross-surface drift guard and run the release gate

**Files:**
- Create: `__tests__/lib/commercial-surface-contract.test.ts`
- Test: `__tests__/lib/commercial-surface-contract.test.ts`
- Verify: all files changed in Tasks 1-3

**Interfaces:**
- Consumes: catalog, tier facade, Stripe routes, Pricing page, and locale messages.
- Produces: a test that fails if future work reintroduces local paid-plan lists, hardcoded prices, or self-serve Custom-only promises.

- [ ] **Step 1: Write the cross-surface contract test**

Create `__tests__/lib/commercial-surface-contract.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CHECKOUT_PLAN_IDS, PLAN_CATALOG } from '@/lib/plans/catalog'
import { getPlanFeatures, maxBrandsForPlan } from '@/lib/tier'

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('commercial surface contract', () => {
  it.each(CHECKOUT_PLAN_IDS)('keeps %s catalog and compatibility values aligned', plan => {
    const definition = PLAN_CATALOG[plan]
    expect(getPlanFeatures(plan)).toBe(definition.features)
    expect(maxBrandsForPlan(plan)).toBe(definition.maxBrands)
  })

  it('routes checkout and webhook plan decisions through the catalog', () => {
    const checkout = source('app/api/stripe/checkout/route.ts')
    const webhook = source('app/api/stripe/webhook/route.ts')

    expect(checkout).toContain('getCheckoutPlanId')
    expect(checkout).not.toMatch(/const VALID_PLANS\s*=/)
    expect(webhook).toContain('getPlanFromStripePrice')
    expect(webhook).not.toMatch(/function getPlan\(priceId/)
  })

  it('keeps secret-backed Stripe prices outside the client-safe catalog', () => {
    const catalog = source('lib/plans/catalog.ts')
    const stripe = source('lib/stripe.ts')

    expect(catalog).not.toMatch(/process\.env|STRIPE_PRICE_|@\/lib\/stripe|next\//)
    expect(stripe.match(/STRIPE_PRICE_(BASIC|PRO|ENTERPRISE)/g)).toEqual([
      'STRIPE_PRICE_BASIC',
      'STRIPE_PRICE_PRO',
      'STRIPE_PRICE_ENTERPRISE',
    ])
  })

  it('keeps Pricing free of duplicated monthly price literals', () => {
    const pricing = source('app/[lang]/pricing/page.tsx')
    expect(pricing).toContain('getPlanDefinition')
    expect(pricing).not.toMatch(/price:\s*['"]\$(29|79|199)['"]/)
  })
})
```

- [ ] **Step 2: Run the new contract test**

Run:

```powershell
npm.cmd test -- __tests__/lib/commercial-surface-contract.test.ts
```

Expected: PASS. If it fails, fix the production surface that bypasses the catalog; do not weaken the assertion unless the approved design changed.

- [ ] **Step 3: Run the complete automated verification gate**

Run, separately:

```powershell
npm.cmd test
npm.cmd exec tsc -- --noEmit
npm.cmd run lint
```

Expected:

- all Vitest files pass with zero failed tests;
- TypeScript exits `0`;
- ESLint reports zero errors. Existing unrelated warnings may remain and must be reported separately.

- [ ] **Step 4: Run the production build with the repository's required non-secret local placeholders**

In PowerShell, set command-scoped local validation values and run:

```powershell
$env:NEON_AUTH_BASE_URL='https://auth.example.test'
$env:NEON_AUTH_COOKIE_SECRET='local-build-only-cookie-secret-32-chars-minimum'
npm.cmd run build
```

Expected: exit code `0`, successful TypeScript and page generation, with `/[lang]/pricing`, `/api/stripe/checkout`, and `/api/stripe/webhook` present in the route manifest. Report existing workspace-root or dynamic-cookie diagnostics separately if the build still succeeds.

- [ ] **Step 5: Review the final diff against Phase 0 scope**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; only Phase 0 catalog, Stripe, pricing, locale, and test files are changed. Do not stage `.codebase-memory/`.

- [ ] **Step 6: Commit the drift guard**

```powershell
git add __tests__/lib/commercial-surface-contract.test.ts
git commit -m "test: prevent commercial plan drift"
```

## Completion Criteria

Phase 0 is complete only when:

- every plan ID, monthly display price, brand allowance, history allowance, scan limit, target mode, and release state has one canonical definition;
- existing dashboard and API consumers still work through the catalog-backed `lib/tier.ts` facade;
- checkout accepts only paid catalog plans and preserves localized return URLs;
- webhook entitlements derive from one unambiguous canonical Stripe price;
- Stripe price secrets remain outside the client bundle;
- Pricing renders catalog prices and distinguishes available, planned, and Enterprise Custom capabilities honestly in EN and `zh-HK`;
- all focused tests, full tests, TypeScript, lint, production build, and manual Pricing checks pass;
- no database migration, production price change, paid service, or new dependency was introduced.
