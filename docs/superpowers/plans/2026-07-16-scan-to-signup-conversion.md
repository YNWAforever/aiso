# Scan-to-Signup Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Fimmick AISO public journey into a proof-before-gate funnel that gets visitors to complete a free scan, create a free account, and continue with the same scan inside the product.

**Architecture:** Server-render the localized acquisition surface and isolate scan interaction in a focused Client Component. Build a sanitized public result view on the server, render the full report only for the owning account, replace the current email-plus-trial double gate with one Neon Auth account unlock, and claim the anonymous scan during pre-filled onboarding without triggering a duplicate scan.

**Tech Stack:** Next.js 16.2.4 App Router, React 19.2.5, TypeScript 5.9, next-intl 4.9, Neon Auth 0.4.2 beta, Supabase, Tailwind CSS 4, Vitest 4.1, Playwright 1.60.

## Global Constraints

- Use Node.js `24.x`, matching `package.json` and Vercel.
- Read the relevant local Next.js 16 guides under `node_modules/next/dist/docs/` before editing layouts, metadata, route handlers, Server Components, or Client Components.
- Do not add a production dependency, paid service, analytics vendor, database provider, auth provider, or billing model.
- Keep the public scan anonymous and free; the first conversion is a free account with no credit card.
- Use exactly 5 tracked platform names: ChatGPT, Google AI, Perplexity, Claude, and Gemini.
- Define the core Fix Pack consistently as `llms.txt`, a `robots.txt` patch, and FAQ JSON-LD.
- Preserve EN and `zh-HK` feature parity and use Hong Kong business language for critical conversion copy.
- Preserve the existing score algorithm, scan checks, Stripe price IDs, and subscription behavior.
- Do not expose the full scan result object to an unauthenticated Client Component or RSC payload.
- Use semantic HTML, visible labels, `focus-visible` styles, accessible status text, live regions, 44px practical touch targets, and reduced-motion fallbacks.
- Keep public pages usable at 375px, 768px, 1024px, and 1440px with no page-level horizontal scroll.
- Use `apply_patch` for source edits and make one focused commit after each task.

---

## File Structure

### New files

- `lib/product-facts.ts` — one source of truth for platform names, check count, Fix Pack outputs, and public product claims.
- `lib/seo.ts` — canonical base URL, locale alternates, localized metadata, and structured-data builders.
- `lib/result-access.ts` — pure access and public-result summarization functions.
- `components/home/ScanForm.tsx` — URL validation, personalization disclosure, scan submission, progress, and recovery state.
- `components/result/AccountUnlockCard.tsx` — Google and magic-link signup that continues to pre-filled onboarding with the scan ID.
- `app/robots.ts` — Next.js metadata route for crawler policy.
- `app/sitemap.ts` — localized public sitemap.
- `app/llms.txt/route.ts` — stable plain-text AI discovery document.
- `__tests__/lib/product-facts.test.ts` — claim and localization source-of-truth coverage.
- `__tests__/lib/result-access.test.ts` — public/owner access and sanitized summary coverage.
- `__tests__/seo/discovery.test.ts` — robots, sitemap, llms.txt, canonical, and structured-data coverage.
- `__tests__/api/scan-claim.test.ts` — ownership and idempotency coverage for claiming an anonymous scan.

### Modified files

- `app/layout.tsx` — metadata base, localized document language, theme initialization, and shared metadata.
- `app/[lang]/layout.tsx` — locale validation and request-locale registration required by Next.js 16/next-intl.
- `app/[lang]/page.tsx` — Server Component conversion hierarchy and server-rendered product evidence.
- `app/[lang]/result/[id]/page.tsx` — server-side access decision and sanitized/full result branching.
- `app/[lang]/pricing/page.tsx` — consistent claims, accessible billing toggle, and localized checkout recovery.
- `app/api/onboarding/complete/route.ts` — safe scan claim before existing-client return and no duplicate work.
- `app/api/scans/[id]/claim/route.ts` — explicit missing/already-owned/conflict responses.
- `components/result/ResultClient.tsx` — render a sanitized locked report or an owned full report without a local email unlock phase.
- `components/onboarding/OnboardingWizard.tsx` — shorter pre-filled path and redirect to the existing report.
- `components/auth/AuthComplete.tsx` — actionable auth completion status and preserved continuation.
- `messages/en.json` — approved acquisition, account-unlock, pricing, and error copy.
- `messages/zh-HK.json` — matching Hong Kong Traditional Chinese copy.
- `app/globals.css` — public surface tokens, reduced-motion behavior, scroll margin, and focus/interaction safeguards.
- `tests/e2e/pages/HomePage.ts` — semantic locators for the new scan island.
- `tests/e2e/pages/ResultPage.ts` — account unlock and report-access locators.
- `tests/e2e/scan-flow.spec.ts` — anonymous scan to account-unlock journey.
- `tests/e2e/email-gate.spec.ts` — replace the obsolete lead-only gate expectations with signup continuation expectations.

### Removed after replacement is verified

- `components/result/EmailCaptureGate.tsx` — obsolete lead-only gate.
- `components/result/TrialCta.tsx` — obsolete second conversion gate.
- `__tests__/api/lead-capture.test.ts` — obsolete public lead-only behavior if `/api/scan/lead` is no longer referenced.

Do not delete `app/api/scan/lead/route.ts` until code search confirms it has no remaining runtime consumers. If the endpoint is retained for historical integrations, leave it in place but remove it from the public journey.

---

### Task 1: Establish the Next.js 16 baseline and product-fact source of truth

**Files:**
- Create: `lib/product-facts.ts`
- Create: `__tests__/lib/product-facts.test.ts`
- Modify: `messages/en.json`
- Modify: `messages/zh-HK.json`

**Interfaces:**
- Produces: `PRODUCT_FACTS`, `PlatformName`, and `getLocalizedProductFacts(locale)` for all later public-page, result, SEO, and pricing tasks.
- Consumes: no new application interfaces.

- [ ] **Step 1: Install the locked dependency graph and read the local Next.js 16 guides**

Run:

```powershell
npm.cmd ci
rg --files node_modules/next/dist/docs | rg "metadata|robots|sitemap|route-handler|server-and-client|layout"
```

Read the matched guides that cover metadata files, route handlers, layouts, and Server/Client Component boundaries. Expected: `node_modules/next/dist/docs/` exists and the guides describe Next.js 16.2.4 behavior.

- [ ] **Step 2: Record the targeted baseline**

Run:

```powershell
npm.cmd test -- --run __tests__/api/scan.test.ts __tests__/api/onboarding-flow.test.ts __tests__/lib/impact.test.ts
npm.cmd run lint
```

Expected: targeted tests pass. Record any pre-existing lint failure separately before changing source.

- [ ] **Step 3: Write the failing product-fact tests**

Create `__tests__/lib/product-facts.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { PRODUCT_FACTS, getLocalizedProductFacts } from '@/lib/product-facts'

describe('PRODUCT_FACTS', () => {
  it('uses the approved five-platform claim everywhere', () => {
    expect(PRODUCT_FACTS.platforms).toEqual([
      'ChatGPT',
      'Google AI',
      'Perplexity',
      'Claude',
      'Gemini',
    ])
    expect(PRODUCT_FACTS.platforms).toHaveLength(5)
  })

  it('defines the core Fix Pack without marketing drift', () => {
    expect(PRODUCT_FACTS.fixPack).toEqual([
      'llms.txt',
      'robots.txt patch',
      'FAQ JSON-LD',
    ])
  })

  it('keeps critical English and Hong Kong Chinese facts aligned', () => {
    const en = getLocalizedProductFacts('en')
    const zh = getLocalizedProductFacts('zh-HK')
    expect(en.platformCount).toBe(zh.platformCount)
    expect(en.checkCount).toBe(zh.checkCount)
    expect(en.fixPack).toEqual(zh.fixPack)
  })
})
```

- [ ] **Step 4: Run the test and verify the missing module failure**

Run:

```powershell
npm.cmd test -- --run __tests__/lib/product-facts.test.ts
```

Expected: FAIL because `@/lib/product-facts` does not exist.

- [ ] **Step 5: Implement the product facts**

Create `lib/product-facts.ts`:

```ts
export const PRODUCT_FACTS = {
  checkCount: 20,
  scoreMaximum: 100,
  platforms: ['ChatGPT', 'Google AI', 'Perplexity', 'Claude', 'Gemini'],
  fixPack: ['llms.txt', 'robots.txt patch', 'FAQ JSON-LD'],
} as const

export type PlatformName = (typeof PRODUCT_FACTS.platforms)[number]

export function getLocalizedProductFacts(locale: string) {
  const isZh = locale === 'zh-HK'
  return {
    checkCount: PRODUCT_FACTS.checkCount,
    platformCount: PRODUCT_FACTS.platforms.length,
    platforms: PRODUCT_FACTS.platforms,
    fixPack: PRODUCT_FACTS.fixPack,
    noCreditCard: isZh ? '無需信用卡' : 'No credit card',
    freeAccount: isZh ? '免費帳戶' : 'Free account',
  }
}
```

Update critical EN and `zh-HK` messages to reference 5 platforms and the defined three Fix Pack outputs. Remove “6 AI platforms,” “Content Brief,” “Chunk Rewriter,” and “Cluster Map” from the core public scan promise; those terms may remain only where the product genuinely exposes separate advanced outputs.

- [ ] **Step 6: Run the focused tests**

Run:

```powershell
npm.cmd test -- --run __tests__/lib/product-facts.test.ts
```

Expected: PASS with 3 tests.

- [ ] **Step 7: Commit**

```powershell
git add lib/product-facts.ts __tests__/lib/product-facts.test.ts messages/en.json messages/zh-HK.json
git commit -m "fix: centralize public AISO product claims"
```

---

### Task 2: Add crawlability, localized metadata, and structured product evidence

**Files:**
- Create: `lib/seo.ts`
- Create: `app/robots.ts`
- Create: `app/sitemap.ts`
- Create: `app/llms.txt/route.ts`
- Create: `__tests__/seo/discovery.test.ts`
- Modify: `app/layout.tsx`
- Modify: `app/[lang]/layout.tsx`

**Interfaces:**
- Consumes: `PRODUCT_FACTS` from Task 1.
- Produces: `SITE_URL`, `buildLocalizedMetadata(locale, path)`, `buildSoftwareApplicationJsonLd(locale)`, and first-party discovery routes.

- [ ] **Step 1: Write failing discovery tests**

Create `__tests__/seo/discovery.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import robots from '@/app/robots'
import sitemap from '@/app/sitemap'
import { GET as getLlmsTxt } from '@/app/llms.txt/route'
import { buildLocalizedMetadata, buildSoftwareApplicationJsonLd } from '@/lib/seo'

describe('public discovery', () => {
  it('allows crawling and advertises the sitemap', () => {
    const value = robots()
    expect(value.rules).toEqual([{ userAgent: '*', allow: '/' }])
    expect(value.sitemap).toMatch(/\/sitemap\.xml$/)
  })

  it('lists both locales and public acquisition routes', () => {
    const urls = sitemap().map(entry => entry.url)
    expect(urls).toEqual(expect.arrayContaining([
      expect.stringMatching(/\/en$/),
      expect.stringMatching(/\/zh-HK$/),
      expect.stringMatching(/\/en\/pricing$/),
      expect.stringMatching(/\/zh-HK\/pricing$/),
    ]))
  })

  it('serves a useful plain-text llms.txt', async () => {
    const response = await getLlmsTxt()
    expect(response.headers.get('content-type')).toContain('text/plain')
    const body = await response.text()
    expect(body).toContain('# Fimmick AISO')
    expect(body).toContain('20 AI readiness checks')
    expect(body).toContain('/en/pricing')
  })

  it('builds canonical and hreflang metadata', () => {
    const metadata = buildLocalizedMetadata('en', '')
    expect(metadata.alternates?.canonical).toMatch(/\/en$/)
    expect(metadata.alternates?.languages).toMatchObject({
      en: expect.stringMatching(/\/en$/),
      'zh-HK': expect.stringMatching(/\/zh-HK$/),
      'x-default': expect.stringMatching(/\/$/),
    })
  })

  it('describes the software without guaranteeing third-party outcomes', () => {
    const json = buildSoftwareApplicationJsonLd('en')
    expect(json['@type']).toBe('SoftwareApplication')
    expect(json.description).toContain('checks')
    expect(json.description).not.toMatch(/guarantee|every AI search engine/i)
  })
})
```

- [ ] **Step 2: Run the test and verify missing-module failures**

Run:

```powershell
npm.cmd test -- --run __tests__/seo/discovery.test.ts
```

Expected: FAIL because the SEO files do not exist.

- [ ] **Step 3: Implement the SEO helper and discovery routes**

Create `lib/seo.ts` with this public interface:

```ts
import type { Metadata } from 'next'
import { PRODUCT_FACTS } from '@/lib/product-facts'

export const SITE_URL = new URL(
  process.env.NEXT_PUBLIC_APP_URL ?? 'https://fimmick-aeo-oitb.vercel.app',
)

export function localizedUrl(locale: string, path = ''): string {
  const suffix = path ? `/${path.replace(/^\//, '')}` : ''
  return new URL(`/${locale}${suffix}`, SITE_URL).toString().replace(/\/$/, '')
}

export function buildLocalizedMetadata(locale: string, path = ''): Metadata {
  const isZh = locale === 'zh-HK'
  const title = isZh ? 'Fimmick AISO｜AI 搜尋能見度掃描' : 'Fimmick AISO | AI Visibility Scan'
  const description = isZh
    ? '免費檢查網站是否容易被主要 AI 平台發現、理解及引用，並取得可執行的修復建議。'
    : 'Check whether leading AI platforms can find, understand, and cite your website, then get prioritized fixes.'
  return {
    title,
    description,
    alternates: {
      canonical: localizedUrl(locale, path),
      languages: {
        en: localizedUrl('en', path),
        'zh-HK': localizedUrl('zh-HK', path),
        'x-default': new URL('/', SITE_URL).toString(),
      },
    },
    openGraph: {
      type: 'website',
      url: localizedUrl(locale, path),
      siteName: 'Fimmick AISO',
      locale: isZh ? 'zh_HK' : 'en_US',
      title,
      description,
    },
    twitter: { card: 'summary_large_image', title, description },
  }
}

export function buildSoftwareApplicationJsonLd(locale: string) {
  const isZh = locale === 'zh-HK'
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Fimmick AISO',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    url: localizedUrl(locale),
    description: isZh
      ? `執行 ${PRODUCT_FACTS.checkCount} 項 AI 搜尋就緒檢查，提供證據分數及優先修復建議。`
      : `Runs ${PRODUCT_FACTS.checkCount} AI search readiness checks and returns an evidence score with prioritized fixes.`,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD', description: isZh ? '免費網站掃描' : 'Free website scan' },
  }
}
```

Implement `app/robots.ts`, `app/sitemap.ts`, and `app/llms.txt/route.ts` with the URLs and facts from `lib/seo.ts` and `lib/product-facts.ts`. The llms.txt response must set `Content-Type: text/plain; charset=utf-8` and `Cache-Control: public, max-age=3600`.

- [ ] **Step 4: Update layouts using the local Next.js 16 and next-intl guidance**

In `app/layout.tsx`, set `metadataBase: SITE_URL`, use an async root layout, resolve the request locale with the supported next-intl server API, and set `<html lang={locale}>`. Preserve the existing theme bootstrap but add a nonce only if the local Next.js CSP guide requires it.

In `app/[lang]/layout.tsx`, call the supported next-intl request-locale registration before `getMessages()` and keep the existing locale allowlist.

- [ ] **Step 5: Run discovery tests and build metadata routes**

Run:

```powershell
npm.cmd test -- --run __tests__/seo/discovery.test.ts
npm.cmd run build
```

Expected: discovery tests pass and the build lists `/robots.txt`, `/sitemap.xml`, and `/llms.txt`.

- [ ] **Step 6: Commit**

```powershell
git add lib/seo.ts app/robots.ts app/sitemap.ts app/llms.txt/route.ts app/layout.tsx app/[lang]/layout.tsx __tests__/seo/discovery.test.ts
git commit -m "feat: add localized AI discovery foundation"
```

---

### Task 3: Server-render the proof-first homepage with a focused scan island

**Files:**
- Create: `components/home/ScanForm.tsx`
- Modify: `app/[lang]/page.tsx`
- Modify: `app/globals.css`
- Modify: `messages/en.json`
- Modify: `messages/zh-HK.json`
- Modify: `tests/e2e/pages/HomePage.ts`
- Modify: `tests/e2e/scan-flow.spec.ts`

**Interfaces:**
- Consumes: `PRODUCT_FACTS`, `buildLocalizedMetadata`, and the existing `POST /api/scan` response `{ id: string }`.
- Produces: `ScanForm({ lang }: { lang: string })` and stable accessible labels used by Playwright.

- [ ] **Step 1: Update the Playwright page object and write the failing hero test**

Update `tests/e2e/pages/HomePage.ts` to expose:

```ts
readonly urlInput = this.page.getByLabel('Website URL')
readonly scanButton = this.page.getByRole('button', { name: 'Run Free Scan' })
readonly personalizeButton = this.page.getByRole('button', { name: /Personalise/i })
readonly scanStatus = this.page.getByRole('status')
```

Add an English homepage test to `tests/e2e/scan-flow.spec.ts` that asserts:

```ts
await page.goto('/en')
await expect(page.getByRole('heading', { level: 1, name: /See whether AI recommends your brand/i })).toBeVisible()
await expect(home.urlInput).toBeVisible()
await expect(home.scanButton).toBeVisible()
await expect(page.getByText('No signup to scan')).toBeVisible()
await expect(page.getByText('5 AI platforms')).toBeVisible()
```

- [ ] **Step 2: Run the test and verify the old homepage fails the new contract**

Run:

```powershell
npm.cmd run e2e -- tests/e2e/scan-flow.spec.ts --grep "proof-first homepage"
```

Expected: FAIL on the new heading or visible Website URL label.

- [ ] **Step 3: Extract the interactive scan island**

Create `components/home/ScanForm.tsx` as a Client Component. It must:

```ts
export type ScanFormProps = { lang: string }

export function normalizeSubmittedUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error('empty_url')
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  const parsed = new URL(withProtocol)
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('invalid_protocol')
  return parsed.toString()
}
```

The form uses a visible `<label htmlFor="scan-url">`, `type="url"`, `name="url"`, `autoComplete="url"`, an optional personalization disclosure with `aria-expanded`/`aria-controls`, labeled industry and region selects, an `aria-live="polite"` status region, and localized actionable errors. It posts the normalized URL plus optional industry and region to `/api/scan` and routes to `/${lang}/result/${data.id}` on success.

- [ ] **Step 4: Convert the homepage to a Server Component**

Remove `'use client'` from `app/[lang]/page.tsx`. Export localized metadata with `generateMetadata`, render the approved hierarchy, and embed `<ScanForm lang={lang} />` in the hero and bottom conversion section. The order is:

1. Semantic public header with “Run Free Scan” anchor.
2. Outcome-led hero.
3. Proof strip using `PRODUCT_FACTS`.
4. Realistic dossier preview.
5. Three-step explanation.
6. Methodology and product capabilities.
7. Repeated scan form.
8. Footer with pricing and sign-in links.

Add the `SoftwareApplication` JSON-LD with a script whose content is `JSON.stringify(buildSoftwareApplicationJsonLd(lang)).replace(/</g, '\\u003c')`.

- [ ] **Step 5: Add interaction and reduced-motion safeguards**

In `app/globals.css` add:

```css
html { scroll-behavior: smooth; }
[id] { scroll-margin-top: 5rem; }

@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

Use `transition-colors`, `transition-shadow`, or `transition-transform`; do not add `transition-all`.

- [ ] **Step 6: Run focused checks**

Run:

```powershell
npm.cmd run e2e -- tests/e2e/scan-flow.spec.ts --grep "proof-first homepage"
npm.cmd run lint -- app/[lang]/page.tsx components/home/ScanForm.tsx
npm.cmd run build
```

Expected: hero test passes, touched files lint cleanly, and build succeeds.

- [ ] **Step 7: Commit**

```powershell
git add app/[lang]/page.tsx components/home/ScanForm.tsx app/globals.css messages/en.json messages/zh-HK.json tests/e2e/pages/HomePage.ts tests/e2e/scan-flow.spec.ts
git commit -m "feat: make the free scan the primary acquisition action"
```

---

### Task 4: Replace the double gate with a secure inline account unlock

**Files:**
- Create: `lib/result-access.ts`
- Create: `components/result/AccountUnlockCard.tsx`
- Create: `__tests__/lib/result-access.test.ts`
- Modify: `app/[lang]/result/[id]/page.tsx`
- Modify: `components/result/ResultClient.tsx`
- Modify: `components/auth/AuthComplete.tsx`
- Modify: `tests/e2e/pages/ResultPage.ts`
- Modify: `tests/e2e/email-gate.spec.ts`
- Stop importing: `components/result/EmailCaptureGate.tsx`
- Stop importing: `components/result/TrialCta.tsx`

**Interfaces:**
- Consumes: `getProfile()`, `computeImpact()`, existing `Scan` and `ScanResults`, `authClient`, and `buildAuthCompleteUrl()`.
- Produces: `canViewFullResult(scanAccountId, viewerAccountId)`, `buildPublicResultSummary(scan)`, `PublicResultSummary`, and `AccountUnlockCard({ scanId, lang })`.

- [ ] **Step 1: Write failing access and sanitization tests**

Create `__tests__/lib/result-access.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildPublicResultSummary, canViewFullResult } from '@/lib/result-access'

const scan = {
  id: 'scan-1',
  account_id: null,
  domain: 'example.com',
  score: 62,
  grade: 'C',
  industry: 'technology',
  region: 'HK',
  created_at: '2026-07-16T00:00:00.000Z',
  results: {
    c1_robots: { status: 'pass', message: 'robots_ai_allowed', details: 'private raw evidence' },
    c2_llms_txt: { status: 'fail', message: 'llms_txt_missing', details: 'private remediation detail' },
  },
}

describe('result access', () => {
  it('unlocks only for the owning account', () => {
    expect(canViewFullResult('account-1', 'account-1')).toBe(true)
    expect(canViewFullResult('account-1', 'account-2')).toBe(false)
    expect(canViewFullResult(null, 'account-1')).toBe(false)
    expect(canViewFullResult('account-1', null)).toBe(false)
  })

  it('returns a teaser without the full results object', () => {
    const summary = buildPublicResultSummary(scan)
    expect(summary.domain).toBe('example.com')
    expect(summary.score).toBe(62)
    expect(summary.topIssueKey).toBe('c2_llms_txt')
    expect(summary).not.toHaveProperty('results')
    expect(JSON.stringify(summary)).not.toContain('private remediation detail')
  })
})
```

- [ ] **Step 2: Run the test and verify the missing module failure**

Run:

```powershell
npm.cmd test -- --run __tests__/lib/result-access.test.ts
```

Expected: FAIL because `@/lib/result-access` does not exist.

- [ ] **Step 3: Implement the pure access and summary layer**

Create `lib/result-access.ts` with:

```ts
import { computeImpact } from '@/lib/impact'
import type { Scan } from '@/lib/types'

const ISSUE_PRIORITY = [
  'c1_robots', 'c2_llms_txt', 'c3_bot_access', 'c4_structured_data', 'c5_extractability',
  'c6_llms_full_txt', 'c7_mcp_card', 'c8_sitemap', 'c9_meta_desc', 'c10_headings',
  'c11_faq', 'c12_canonical', 'c13_render', 'c14_internal_links', 'c15_entity', 'c16_freshness',
  'c17_citation_density', 'c18_factual_density', 'c19_topical_authority', 'c20_chunkability',
] as const

export function canViewFullResult(scanAccountId?: string | null, viewerAccountId?: string | null) {
  return Boolean(scanAccountId && viewerAccountId && scanAccountId === viewerAccountId)
}

export function buildPublicResultSummary(scan: Scan & { account_id?: string | null; created_at?: string }) {
  const results = scan.results as Record<string, { status?: string } | unknown>
  const statuses = Object.values(results).filter(
    (value): value is { status: string } => Boolean(value && typeof value === 'object' && 'status' in value),
  )
  const topIssueKey = ISSUE_PRIORITY.find(key => {
    const value = results[key]
    return Boolean(value && typeof value === 'object' && 'status' in value && value.status !== 'pass')
  }) ?? null
  const impact = computeImpact(results, {
    score: scan.score,
    grade: scan.grade ?? 'F',
    industry: scan.industry,
  })
  return {
    id: scan.id,
    domain: scan.domain,
    score: scan.score,
    grade: scan.grade ?? 'F',
    industry: scan.industry ?? null,
    region: scan.region ?? null,
    createdAt: scan.created_at ?? null,
    counts: {
      pass: statuses.filter(value => value.status === 'pass').length,
      warn: statuses.filter(value => value.status === 'warn').length,
      fail: statuses.filter(value => value.status === 'fail').length,
      total: statuses.length,
    },
    topIssueKey,
    teaser: {
      headlineStat: impact.headlineStat,
      projectedScore: impact.projectedScore,
      projectedGrade: impact.projectedGrade,
      platformVisibility: impact.platformVisibility,
    },
  }
}

export type PublicResultSummary = ReturnType<typeof buildPublicResultSummary>
```

- [ ] **Step 4: Build the single account-unlock component**

Create `components/result/AccountUnlockCard.tsx` as a Client Component with `scanId` and `lang` props. It uses:

```ts
const next = `/${lang}/onboarding?scan=${encodeURIComponent(scanId)}`
const callbackURL = buildAuthCompleteUrl(lang, next)
```

The Google button calls `authClient.signIn.social({ provider: 'google', callbackURL })`. The email form calls `authClient.signIn.magicLink({ email, callbackURL })`. Render a visible email label, `name="email"`, `autoComplete="email"`, `spellCheck={false}`, a polite status region, a specific too-many-attempts message, “Create Free Account,” “Continue with Google,” and “No credit card · Your scan will be saved automatically.”

- [ ] **Step 5: Make the result route decide access on the server**

In `app/[lang]/result/[id]/page.tsx`:

```ts
const [scan, profile] = await Promise.all([getScan(id), getProfile()])
if (!scan) notFound()
const unlocked = canViewFullResult(scan.account_id, profile?.account_id)
const summary = buildPublicResultSummary(scan)

return (
  <ResultClient
    lang={lang}
    summary={summary}
    fullScan={unlocked ? scan : undefined}
  />
)
```

Update the scan query/type so `account_id` is available server-side. Never serialize `scan.results` when `unlocked` is false.

- [ ] **Step 6: Replace the client-side phase machine**

Change `ResultClient` props to:

```ts
type Props = {
  lang: string
  summary: PublicResultSummary
  fullScan?: Scan
}
```

Always render score, counts, platform summary, and top issue from `summary`. When `fullScan` is absent, render `ImpactTeaser`, `LockedPreview`, and `AccountUnlockCard`. When `fullScan` exists, render `ImpactPanel`, the three check sections, `DeepGeoSection`, and the existing Fix Pack action. Remove local `phase`, `unlockedEmail`, `EmailCaptureGate`, and `TrialCta` usage.

- [ ] **Step 7: Update E2E expectations**

Replace the obsolete lead-only assertions in `tests/e2e/email-gate.spec.ts` with:

```ts
await expect(result.score).toBeVisible()
await expect(result.topIssue).toBeVisible()
await expect(result.createAccountButton).toBeVisible()
await expect(result.googleSignupButton).toBeVisible()
await expect(page.getByText(/No credit card/i)).toBeVisible()
await expect(result.fullCheckBreakdown).not.toBeVisible()
```

Use the auth fixture to verify the magic-link request includes a callback that returns to localized onboarding with the same scan ID.

- [ ] **Step 8: Run focused checks**

Run:

```powershell
npm.cmd test -- --run __tests__/lib/result-access.test.ts __tests__/lib/impact.test.ts
npm.cmd run e2e -- tests/e2e/email-gate.spec.ts
npm.cmd run build
```

Expected: access tests pass, locked page does not render the full breakdown, callback preserves scan ID, and build succeeds.

- [ ] **Step 9: Commit**

```powershell
git add lib/result-access.ts components/result/AccountUnlockCard.tsx app/[lang]/result/[id]/page.tsx components/result/ResultClient.tsx components/auth/AuthComplete.tsx __tests__/lib/result-access.test.ts tests/e2e/pages/ResultPage.ts tests/e2e/email-gate.spec.ts
git commit -m "feat: unlock scan reports with one free account gate"
```

---

### Task 5: Claim the scan safely and continue to the completed report

**Files:**
- Create: `__tests__/api/scan-claim.test.ts`
- Modify: `app/api/scans/[id]/claim/route.ts`
- Modify: `app/api/onboarding/complete/route.ts`
- Modify: `components/onboarding/OnboardingWizard.tsx`
- Modify: `app/[lang]/onboarding/page.tsx`
- Modify: `__tests__/api/onboarding-flow.test.ts`

**Interfaces:**
- Consumes: authenticated profile account ID, optional `scanId`, and existing onboarding client creation.
- Produces: idempotent `claimScanForAccount(scanId, accountId)` behavior and onboarding response `{ clientId, scanId, trialEndsAt }`.

- [ ] **Step 1: Write failing claim tests**

Create `__tests__/api/scan-claim.test.ts` covering these exact states:

```ts
it('returns 401 when no profile exists')
it('claims an unowned scan for the authenticated account')
it('returns ok when the scan already belongs to the same account')
it('returns 409 when the scan belongs to another account')
it('returns 404 when the scan does not exist')
```

Use the existing Supabase query-chain mock style from `__tests__/api/onboarding-flow.test.ts`. Assert that an update includes `{ account_id: 'account-1' }` and is guarded by `.is('account_id', null)`.

- [ ] **Step 2: Run claim and onboarding tests and verify failures**

Run:

```powershell
npm.cmd test -- --run __tests__/api/scan-claim.test.ts __tests__/api/onboarding-flow.test.ts
```

Expected: new claim state tests fail against the current unconditional success response.

- [ ] **Step 3: Implement explicit, idempotent claim behavior**

In `app/api/scans/[id]/claim/route.ts`, first select `id, account_id`. Return 404 for no scan, 409 for a different owner, and `{ ok: true, alreadyOwned: true }` for the same owner. For an unowned scan, update with both `.eq('id', id)` and `.is('account_id', null)`, then return `{ ok: true, alreadyOwned: false }`.

Extract the database logic to a local exported helper only if it makes the tests simpler; do not create a second API route.

- [ ] **Step 4: Claim before the existing-client early return**

In `app/api/onboarding/complete/route.ts`, after resolving `accountId` and before querying for `existingClient`, perform the same ownership checks for `scanId`. Return:

- 404 when the supplied scan does not exist.
- 409 when it belongs to another account.
- 500 when an unowned scan cannot be persisted.

Include `scanId: scanId ?? null` in both the existing-client response and new-client response. Keep OpenRouter prompt generation non-fatal.

- [ ] **Step 5: Shorten the pre-filled onboarding path and stop duplicate scanning**

In `OnboardingWizard` initialize:

```ts
const hasScanPrefill = Boolean(scanId && initialBrand && initialDomain)
const [step, setStep] = useState(hasScanPrefill ? 3 : 1)
```

After successful completion use:

```ts
if (scanId) {
  router.push(`/${lang}/dashboard/${data.clientId}/result/${scanId}`)
  return
}
const scanUrl = domain
  ? `?step=scan&url=${encodeURIComponent(domain.startsWith('http') ? domain : `https://${domain}`)}`
  : '?step=scan'
router.push(`/${lang}/dashboard/${data.clientId}${scanUrl}`)
```

Add visible labels and stable names to all onboarding inputs and selects touched by this path. Replace `autoFocus` on the mobile-first flow with programmatic focus after a step transition only when the viewport is desktop-sized.

- [ ] **Step 6: Run focused tests**

Run:

```powershell
npm.cmd test -- --run __tests__/api/scan-claim.test.ts __tests__/api/onboarding-flow.test.ts __tests__/api/onboarding.test.ts
npm.cmd run build
```

Expected: ownership states pass, existing client still receives the claimed scan, and no result path triggers a second `/api/scan` call.

- [ ] **Step 7: Commit**

```powershell
git add app/api/scans/[id]/claim/route.ts app/api/onboarding/complete/route.ts components/onboarding/OnboardingWizard.tsx app/[lang]/onboarding/page.tsx __tests__/api/scan-claim.test.ts __tests__/api/onboarding-flow.test.ts
git commit -m "fix: preserve anonymous scans through onboarding"
```

---

### Task 6: Reconcile pricing, localization, and touched-surface accessibility

**Files:**
- Modify: `app/[lang]/pricing/page.tsx`
- Modify: `messages/en.json`
- Modify: `messages/zh-HK.json`
- Modify: `app/globals.css`
- Modify: `__tests__/lib/product-facts.test.ts`
- Modify: `__tests__/lib/tier.test.ts`

**Interfaces:**
- Consumes: `PRODUCT_FACTS` and existing `getPlanFeatures()`/Stripe checkout plan IDs.
- Produces: consistent public claims without changing Stripe price IDs or entitlement logic.

- [ ] **Step 1: Add failing copy-consistency tests**

Extend `__tests__/lib/product-facts.test.ts`:

```ts
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

it('does not advertise six tracked platforms', () => {
  expect(JSON.stringify(en)).not.toMatch(/6 AI platforms|6 AI Platforms/)
  expect(JSON.stringify(zh)).not.toMatch(/6 個 AI 平台/)
})

it('does not describe the paid Basic card as permanently free Starter', () => {
  expect(en.pricing.faq_4_a).not.toMatch(/Starter plan is permanently free/i)
  expect(zh.pricing.faq_4_a).not.toMatch(/入門版永久免費/)
})

it('uses the core Fix Pack outputs in the public promise', () => {
  const publicCopy = `${en.home.cta_bottom_body} ${en.pricing.bottom_body}`
  for (const item of PRODUCT_FACTS.fixPack) expect(publicCopy).toContain(item)
})
```

- [ ] **Step 2: Run the tests and verify current contradictions fail**

Run:

```powershell
npm.cmd test -- --run __tests__/lib/product-facts.test.ts __tests__/lib/tier.test.ts
```

Expected: product-fact tests fail on the existing 6-platform, free-Starter, or Fix Pack wording.

- [ ] **Step 3: Reconcile pricing without changing billing behavior**

Keep the current Basic/Pro/Enterprise price values and checkout plan identifiers. Change the pricing FAQ to distinguish:

- Free account: saved scan and public-to-owned report continuity, no card.
- Paid Basic/Pro/Enterprise: subscription features shown by the existing plan cards.

Change any Enterprise CTA that says “Contact Sales” while invoking self-serve Stripe checkout to “Start Enterprise.” Preserve locale in checkout success and cancel URLs by including `lang` in the request and validating it server-side before constructing the URLs.

Render one shared `checkoutError` region under the pricing cards with `role="alert"`; do not attach the error only to the Pro card.

- [ ] **Step 4: Make pricing controls accessible**

For the annual toggle use:

```tsx
<button
  type="button"
  role="switch"
  aria-checked={annual}
  aria-label={t('billing_frequency_label')}
  onClick={() => setAnnual(value => !value)}
  className="relative inline-flex h-11 w-16 items-center rounded-full bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
>
```

Use explicit `transition-colors`/`transition-transform`, remove scale distortion from the Pro card, make all plan actions at least 44px high, and contain the comparison table in an overflow region with an accessible label.

- [ ] **Step 5: Run focused tests and lint**

Run:

```powershell
npm.cmd test -- --run __tests__/lib/product-facts.test.ts __tests__/lib/tier.test.ts
npm.cmd run lint -- app/[lang]/pricing/page.tsx
npm.cmd run build
```

Expected: copy/tier tests pass, pricing file lint is clean, and build succeeds.

- [ ] **Step 6: Commit**

```powershell
git add app/[lang]/pricing/page.tsx messages/en.json messages/zh-HK.json app/globals.css __tests__/lib/product-facts.test.ts __tests__/lib/tier.test.ts
git commit -m "fix: align pricing and conversion claims"
```

---

### Task 7: Verify the complete funnel and remove obsolete public-gate code

**Files:**
- Modify: `tests/e2e/pages/HomePage.ts`
- Modify: `tests/e2e/pages/ResultPage.ts`
- Modify: `tests/e2e/scan-flow.spec.ts`
- Modify: `tests/e2e/email-gate.spec.ts`
- Delete when unreferenced: `components/result/EmailCaptureGate.tsx`
- Delete when unreferenced: `components/result/TrialCta.tsx`
- Delete when endpoint is unreferenced and no integration depends on it: `__tests__/api/lead-capture.test.ts`
- Keep or delete after code search: `app/api/scan/lead/route.ts`

**Interfaces:**
- Consumes: the completed anonymous scan, result summary, Neon Auth continuation, onboarding claim, and dashboard result route.
- Produces: verified end-to-end scan-to-signup behavior and a clean runtime dependency graph.

- [ ] **Step 1: Search for obsolete runtime consumers**

Run:

```powershell
rg -n "EmailCaptureGate|TrialCta|/api/scan/lead" app components lib tests __tests__
```

Expected: only obsolete component files/tests remain. If another runtime consumer uses `/api/scan/lead`, retain the endpoint and its API test while removing it from the public funnel.

- [ ] **Step 2: Complete the Playwright journey**

The final `tests/e2e/scan-flow.spec.ts` must cover:

```text
/en -> labeled URL input -> POST /api/scan -> /en/result/:id
-> score and top issue visible -> full report absent
-> Create Free Account visible -> auth continuation contains scan ID
-> /en/onboarding?scan=:id pre-filled -> complete
-> /en/dashboard/:clientId/result/:scanId
-> full check report visible -> no second POST /api/scan
```

Add the equivalent `zh-HK` smoke path for localized heading, URL label, account-unlock label, and continuation locale.

- [ ] **Step 3: Remove obsolete files only after the search is clean**

Delete `EmailCaptureGate.tsx` and `TrialCta.tsx` after their imports are gone. Delete `app/api/scan/lead/route.ts` and `__tests__/api/lead-capture.test.ts` only if Step 1 shows no runtime integration. Re-run the search and expect zero obsolete component references.

- [ ] **Step 4: Run the full automated verification**

Run:

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run build
npm.cmd run e2e -- tests/e2e/scan-flow.spec.ts tests/e2e/email-gate.spec.ts tests/e2e/auth.spec.ts
```

Expected: all unit tests pass, lint passes or only previously recorded baseline debt remains, production build succeeds, and the three funnel/auth E2E specs pass.

- [ ] **Step 5: Run local browser verification**

Start the app:

```powershell
npm.cmd run dev
```

Verify at 375px and 1440px:

- Header and hero fit without horizontal scroll.
- URL field, personalization controls, and account signup are keyboard reachable with visible focus.
- Progress and errors announce through live regions.
- Score and top issue remain visible beside the inline account unlock.
- Reduced-motion preference removes continuous/count-up animation.
- EN/`zh-HK` layouts preserve hierarchy and do not truncate the primary action.
- Pricing toggle announces checked state and comparison content remains contained.

- [ ] **Step 6: Verify discovery endpoints locally**

Run:

```powershell
curl.exe -I http://localhost:3000/robots.txt
curl.exe -I http://localhost:3000/sitemap.xml
curl.exe -I http://localhost:3000/llms.txt
curl.exe -s http://localhost:3000/en | rg "canonical|hreflang|application/ld\+json|Fimmick AISO"
```

Expected: all three endpoints return 200; homepage HTML contains canonical, hreflang, JSON-LD, and the localized product title.

- [ ] **Step 7: Commit final verification cleanup**

```powershell
git add tests/e2e app components __tests__
git commit -m "test: verify the scan-to-signup funnel"
```

- [ ] **Step 8: Final branch review**

Run:

```powershell
git status --short
git log --oneline --decorate -8
git diff origin/main...HEAD --stat
git diff --check origin/main...HEAD
```

Expected: only intentional local tooling artifacts remain untracked, the task commits are present, and the branch diff has no whitespace errors.

Do not push, open a pull request, change production prices, provision resources, or deploy until the user explicitly requests publication.
