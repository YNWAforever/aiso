# Pro Client Report Workflow Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let effective Pro and Enterprise accounts turn an owned scan into a reviewed, branded, immutable, revocable public client report while keeping every private workspace field server-side.

**Architecture:** Build a snapshot-first report domain behind the existing commercial entitlement resolver. Authenticated Route Handlers rebuild report facts from account-owned database rows, persist immutable versions through service-only Postgres functions, and publish only an allowlisted DTO through an HMAC-signed server route. The dashboard provides Compose, Review, and Publish steps; the public report is request-time rendered, unindexed, mobile-first, and independent of login.

**Tech Stack:** Next.js 16.2 App Router, React 19, TypeScript, Supabase/Postgres, next-intl, Vitest, Playwright, existing OpenRouter and SSRF-safe public URL helpers. Add no runtime dependency.

**Approved design:** `docs/superpowers/specs/2026-07-21-pro-client-report-workflow-design.md`

## Implementation rules

- Work only on `codex/pro-client-reports` in `.worktrees/pro-client-reports`.
- Follow red-green-refactor for every task: add the focused failing test, run it and observe the expected failure, make the smallest implementation, rerun it, then commit.
- Read the relevant installed guide under `node_modules/next/dist/docs/` before changing a Next.js convention. For this plan, the relevant guides are Route Handlers, Dynamic Routes, Server and Client Components, `generateMetadata`, and environment variables.
- Await `params` in Next.js 16 pages and Route Handlers. Do not use the Next.js 14 synchronous parameter shape.
- Keep `REPORT_SHARE_SECRET` server-only. Never use a `NEXT_PUBLIC_` name and never return it or an HMAC input in an API payload.
- Every authenticated mutation must call `resolveCommercialEntitlement` and require `features.client_reports_online === true`. UI gating is not authorization.
- Service-role database access is not authorization. Resolve the profile and verify account, client, scan, report, and normalized-domain ownership before any service query or RPC.
- The browser may submit identifiers, locale, and edited executive summary only. It may not submit score, grade, comparison, fixes, branding snapshot, counters, public status, or snapshot JSON.
- Do not mutate migrations `001` through `026`.
- Stop after preview verification. Production migration `027`, production `REPORT_SHARE_SECRET`, and production deployment require a new explicit approval.

## Task 1: Add the commercial capability and pure report domain

**Files:**

- Modify: `lib/plans/catalog.ts`
- Create: `lib/reports/types.ts`
- Create: `lib/reports/comparison.ts`
- Create: `lib/reports/summary.ts`
- Create: `lib/reports/snapshot.ts`
- Modify: `__tests__/lib/plan-catalog.test.ts`
- Modify: `__tests__/lib/commercial-entitlement.test.ts`
- Create: `__tests__/lib/report-comparison.test.ts`
- Create: `__tests__/lib/report-snapshot.test.ts`

### Step 1: Write failing catalog and domain tests

Add `client_reports_online: boolean` to the expected `PlanFeatures` contract in the catalog tests. Assert `false` for Free and Basic and `true` for Pro and Enterprise. Keep `whiteLabelPdf` planned and do not expose PDF or attribution removal.

In `report-comparison.test.ts`, cover:

- URL normalization to a lowercase hostname with leading `www.` removed;
- same normalized domain selection only;
- nearest earlier usable scan, never a later or cross-account scan;
- finite scores only;
- `baseline` when no eligible earlier scan exists;
- `not_comparable` for structurally incompatible evidence;
- missing values as data gaps, never zero;
- improved, regressed, unchanged, added coverage, and lost coverage classifications.

In `report-snapshot.test.ts`, cover:

- stable `snapshot_schema_version: 1`;
- deterministic output for identical input;
- baseline omits previous score, delta, and previous date;
- comparable snapshots compute the signed score delta;
- fixes are ordered recommendations, regressions, failures, warnings;
- materially equivalent fixes are deduplicated and capped at five;
- snapshot excludes account/profile IDs, raw results, prompts, assignees, model metadata, and HTML;
- English and `zh-HK` deterministic summaries contain only supported evidence.

Run:

```powershell
npm.cmd test -- __tests__/lib/plan-catalog.test.ts __tests__/lib/commercial-entitlement.test.ts __tests__/lib/report-comparison.test.ts __tests__/lib/report-snapshot.test.ts
```

Expected: FAIL because the capability and report modules do not exist.

### Step 2: Define the explicit report types

In `lib/reports/types.ts`, define JSON-safe, readonly interfaces and unions for:

```ts
export const REPORT_SNAPSHOT_SCHEMA_VERSION = 1 as const
export const REPORT_LOCALES = ['en', 'zh-HK'] as const
export type ReportLocale = (typeof REPORT_LOCALES)[number]
export type ComparisonState = 'baseline' | 'comparable' | 'not_comparable'
export type ReportStatus = 'draft' | 'published' | 'revoked'
export type ChangeKind = 'improved' | 'regressed' | 'unchanged' | 'added_coverage' | 'lost_coverage' | 'data_gap'

export interface ReportBrandingSnapshot {
  agencyName: string
  logoUrl: string | null
  primaryColor: string
  contactLabel: string | null
  contactUrl: string | null
  attribution: 'Powered by Fimmick AISO'
}

export interface ReportPriorityFix {
  key: string
  title: string
  rationale: string
  expectedImpact: 'high' | 'medium' | 'low'
  nextStep: string
}

export interface ClientReportSnapshotV1 {
  snapshotSchemaVersion: 1
  locale: ReportLocale
  branding: ReportBrandingSnapshot
  client: { name: string; domain: string }
  evidence: { scanDate: string; evidenceTimestamp: string }
  score: { current: number; grade: string; comparisonState: ComparisonState; previous?: number; delta?: number; previousScanDate?: string }
  changes: ReadonlyArray<{ key: string; label: string; kind: ChangeKind }>
  priorityFixes: ReadonlyArray<ReportPriorityFix>
  executiveSummary: string
  methodology: string
}

export type PublicClientReportDto = Readonly<{
  report: ClientReportSnapshotV1
  publishedAt: string
  logoProxyUrl: string | null
  contactProxyUrl: string | null
}>
```

Also define server input shapes for scans, recommendations, branding, and clients. Do not type raw database JSON as `any`; accept `unknown` and narrow it in pure functions.

### Step 3: Implement comparison and deterministic snapshot construction

In `comparison.ts` export:

- `normalizeReportDomain(value: string): string | null` using `URL`, accepting an implicit `https://` prefix but rejecting credentials, non-HTTP(S), IP literals, and empty hostnames;
- `selectPreviousReportScan(current, candidates)` with account, normalized-domain, date, score, and result validation;
- `compareReportEvidence(current: unknown, previous: unknown)` over an explicit allowlist of known reportable check keys.

In `summary.ts`, use fixed English and Hong Kong Traditional Chinese templates. Treat baseline and non-comparable states explicitly. Never infer revenue, rankings, traffic, citations, competitor results, or AI-platform outcomes that are absent from the allowlist.

In `snapshot.ts`, export `buildClientReportSnapshot(input)` and `replaceExecutiveSummary(snapshot, summary)`. Normalize plain text, reject control characters, require 40-1200 characters for an edited summary, preserve all server-built facts, and cap priority fixes at five.

### Step 4: Wire the plan capability

Add `client_reports_online` to `PlanFeatures` and all catalog entries. Set it to `true` only for Pro and Enterprise. Change `release.clientReports` from `planned` to `available` for Pro and Enterprise only after the report UI is complete in Task 7; until then tests should verify runtime capability independently from marketing release state.

### Step 5: Verify and commit

Run the focused test command from Step 1, then:

```powershell
.\node_modules\.bin\tsc.cmd --noEmit
git diff --check
git add lib/plans/catalog.ts lib/reports __tests__/lib/plan-catalog.test.ts __tests__/lib/commercial-entitlement.test.ts __tests__/lib/report-comparison.test.ts __tests__/lib/report-snapshot.test.ts
git commit -m "feat: add client report domain"
```

## Task 2: Create migration 027 and the tenant-safe report store

**Files:**

- Create: `supabase/migrations/027_client_report_snapshots.sql`
- Create: `lib/reports/store.ts`
- Create: `__tests__/db/client-report-migration.test.ts`
- Create: `__tests__/lib/report-store.test.ts`

### Step 1: Write failing migration contract tests

Read migration text using the established `readFileSync(resolve(process.cwd(), 'supabase/migrations/027_client_report_snapshots.sql'), 'utf8')` pattern. Assert:

- all three tables and required checks from the design exist;
- `(id, account_id, client_id)` and `(report_id, version_number)` are unique;
- versions reference the full parent tenant tuple;
- `latest_version_id` and `published_version_id` are separate;
- RLS is enabled and no anon/public SELECT policy exists;
- every function uses `security definer` plus `set search_path = ''`;
- function execution is revoked from `public`, `anon`, and `authenticated`;
- append uses `pg_advisory_xact_lock` and locks the parent report;
- counter functions update counters/timestamps only;
- revoke and rotate increment `share_version` and replace `public_slug`;
- migrations 001-026 remain byte-for-byte untouched in the branch diff.

Run:

```powershell
npm.cmd test -- __tests__/db/client-report-migration.test.ts __tests__/lib/report-store.test.ts
```

Expected: FAIL because the migration and store do not exist.

### Step 2: Implement the schema

Create the three tables exactly as approved. Add:

- `check (status in ('draft','published','revoked'))`;
- `check (share_version > 0)`;
- non-negative counter checks;
- branding length, hex color, and paired contact label/URL checks;
- locale, summary length, schema version, and positive version-number checks;
- composite foreign keys that prevent cross-account/client version attachment;
- indexes for account/client report lists, public slug lookup, and same-domain scan history lookup where not already covered.

Use `gen_random_uuid()` for IDs and a high-entropy base64url-compatible slug derived from 24 random bytes. Do not store a bearer token or signature.

### Step 3: Implement atomic functions

Create service-only functions with typed return rows:

- `create_client_report_with_version(...)`;
- `append_client_report_version(...)`;
- `publish_client_report_latest(...)`;
- `revoke_client_report(...)`;
- `rotate_client_report_link(...)`;
- `increment_client_report_view(...)`;
- `increment_client_report_cta_click(...)`.

Creation inserts the parent and version in one transaction and sets `latest_version_id`. Append takes an advisory transaction lock keyed by report ID, verifies the full tenant tuple, assigns `max(version_number) + 1`, inserts the immutable version, and updates only `latest_version_id` plus timestamps. Publish locks the report and sets `published_version_id = latest_version_id`, `status = 'published'`, and `published_at`. A new draft version must not change `published_version_id` or the public response.

Revoke sets `status = 'revoked'`, increments `share_version`, rotates the slug, and records `revoked_at`. Publishing a revoked report also rotates slug/share version before publishing. Rotate changes the credential without changing the published version.

### Step 4: Implement the store boundary

Mark `lib/reports/store.ts` with `import 'server-only'`. Export typed operations that accept an already-authorized `accountId` and never infer authorization from service access:

- load owned client, current scan, previous candidate scans, recommendations, and branding;
- create/append/publish/revoke/rotate through RPC;
- list account/client reports and versions;
- resolve one public report by slug/share version with its account commercial state;
- increment view/CTA counters best-effort.

The previous-scan query must filter `account_id`, normalized client domain, and `created_at < current.created_at`, order descending, and then pass candidates through the pure selector. Do not reuse the account-wide scan query from `app/api/clients/[clientId]/overview/route.ts`.

### Step 5: Verify and commit

```powershell
npm.cmd test -- __tests__/db/client-report-migration.test.ts __tests__/lib/report-store.test.ts
.\node_modules\.bin\tsc.cmd --noEmit
git diff --check
git add supabase/migrations/027_client_report_snapshots.sql lib/reports/store.ts __tests__/db/client-report-migration.test.ts __tests__/lib/report-store.test.ts
git commit -m "feat: persist immutable client reports"
```

Do not apply migration 027 to production in this task.

## Task 3: Add HMAC sharing and safe branding/logo primitives

**Files:**

- Create: `lib/reports/share.ts`
- Create: `lib/reports/branding.ts`
- Create: `__tests__/lib/report-share.test.ts`
- Create: `__tests__/lib/report-branding.test.ts`
- Modify: `.env.example`

### Step 1: Write failing security tests

Test:

- signature is HMAC-SHA-256 over a versioned canonical string containing slug and positive share version;
- URL-safe signature round-trips;
- a changed slug, version, or one-byte signature fails;
- comparisons use equal-length buffers and `timingSafeEqual` behavior;
- missing/short `REPORT_SHARE_SECRET` fails closed without leaking the value;
- report URLs preserve the requested valid locale only;
- agency name/color/contact validation and normalization;
- logo accepts HTTPS PNG/JPEG/WebP only, rejects credentials/private IP/redirect-to-private/oversize/HTML/SVG;
- logo proxy output uses bounded cache headers and no upstream cookies, CSP, or redirect headers.

Run:

```powershell
npm.cmd test -- __tests__/lib/report-share.test.ts __tests__/lib/report-branding.test.ts
```

### Step 2: Implement share signing

Mark `share.ts` server-only. Use `node:crypto` `createHmac` and `timingSafeEqual`. Export:

- `signReportShare({ slug, shareVersion })`;
- `verifyReportShare({ slug, shareVersion, signature })`;
- `buildReportShareUrl({ origin, locale, slug, shareVersion })`.

Canonical input must be `fimmick-report:v1:<slug>:<shareVersion>`. Require a server secret of at least 32 characters. Encode the signature as base64url. Reject non-positive/non-integer versions and malformed signatures before database work.

### Step 3: Implement branding validation and logo fetch

In `branding.ts`, export pure validators plus `fetchReportLogo`. Reuse `fetchPublicUrl` from `lib/security/public-url.ts` for every redirect hop. Send an image-only `Accept` header, a neutral user agent, no credentials, and a bounded abort signal. Accept `image/png`, `image/jpeg`, and `image/webp`; enforce a 2 MiB streamed byte cap even when `Content-Length` is absent. Return only bytes, validated content type, ETag/Last-Modified where safe, and fixed cache metadata.

Validate contact URLs as HTTPS or `mailto:` only. Strip control characters and forbid CR/LF to prevent header injection.

### Step 4: Document the secret and verify

Add `REPORT_SHARE_SECRET=` to `.env.example` with a comment that it is server-only and requires at least 32 random characters. Never add a real value.

```powershell
npm.cmd test -- __tests__/lib/report-share.test.ts __tests__/lib/report-branding.test.ts __tests__/lib/public-url.test.ts
.\node_modules\.bin\tsc.cmd --noEmit
git diff --check
git add lib/reports/share.ts lib/reports/branding.ts __tests__/lib/report-share.test.ts __tests__/lib/report-branding.test.ts .env.example
git commit -m "feat: secure client report sharing"
```

## Task 4: Build authenticated report and branding APIs with AI fallback

**Files:**

- Create: `lib/reports/service.ts`
- Create: `lib/reports/ai.ts`
- Modify: `lib/openrouter.ts`
- Create: `app/api/report-branding/route.ts`
- Create: `app/api/clients/[clientId]/reports/route.ts`
- Create: `app/api/client-reports/[reportId]/versions/route.ts`
- Create: `app/api/client-reports/[reportId]/ai-summary/route.ts`
- Create: `app/api/client-reports/[reportId]/publish/route.ts`
- Create: `app/api/client-reports/[reportId]/revoke/route.ts`
- Create: `app/api/client-reports/[reportId]/rotate-link/route.ts`
- Create: `__tests__/api/client-reports.test.ts`
- Create: `__tests__/api/report-branding.test.ts`
- Create: `__tests__/lib/report-ai.test.ts`

### Step 1: Write failing API and AI tests

Use hoisted Vitest mocks following existing Route Handler tests. Cover every route for 401, effective Free/Basic 403, wrong account/client/report 404, malformed body 400, service failure 503, and success. Add explicit tests that:

- a past-due Pro account is denied;
- submitted score/delta/fixes/branding/snapshot fields are ignored or rejected;
- create rebuilds current and previous evidence from owned rows;
- domain mismatch is rejected;
- append creates a new draft while preserving the published version;
- publish/republish/rotate return only the new signed URL and safe report metadata;
- revoke returns no usable URL;
- AI receives only whitelisted facts;
- timeout/provider/malformed/numeric-claim failure returns deterministic fallback with `polished: false`;
- valid AI output is plain text, 40-1200 characters, and contains no unsupported numeric claim.

Run:

```powershell
npm.cmd test -- __tests__/api/client-reports.test.ts __tests__/api/report-branding.test.ts __tests__/lib/report-ai.test.ts
```

### Step 2: Add one authorization/service seam

In `service.ts`, centralize:

- `requireClientReportEntitlement(profile)` using `resolveCommercialEntitlement`;
- owned client/scan/report loading;
- current-domain equality;
- snapshot rebuilding;
- safe API DTO mapping;
- neutral `ReportServiceError` codes mapped to 400/401/403/404/409/503.

Do not expose the existence of another tenant's object. An ownership failure is always 404.

### Step 3: Implement branding and report Route Handlers

Use the exact Next.js 16 route literals in `RouteContext`, including `RouteContext<'/api/clients/[clientId]/reports'>` and `RouteContext<'/api/client-reports/[reportId]/publish'>`, and `await ctx.params`. Apply the equivalent exact literal to each sibling report route. Set authenticated JSON responses to `Cache-Control: no-store`. Parse JSON once, enforce exact lengths and allowed locale values, and call the service boundary.

`POST /api/clients/[clientId]/reports` accepts `{ scanId, locale, executiveSummary? }`. `POST /api/client-reports/[reportId]/versions` accepts `{ locale, executiveSummary }`. All server facts are rebuilt. The list response includes status, latest/published version numbers, publication/view/click timestamps and counts, and an optional signed URL only when currently published and entitled.

### Step 4: Implement bounded AI polish

Extend `CallOptions` in `lib/openrouter.ts` with `signal?: AbortSignal` and pass it to `fetch`. Keep existing callers compatible.

In `ai.ts`, make one OpenRouter request with `AbortSignal.timeout(15_000)`, a maximum of 450 tokens, temperature only if the current wrapper supports it without affecting other callers, and no automatic retry. The prompt must enumerate the exact supplied facts and instruct the model to return plain text only. Validate:

- normalized plain text, no Markdown headings/links/HTML;
- 40-1200 characters;
- every digit-bearing token in output must be present in the whitelisted input facts;
- no currency, percentage, traffic, revenue, rank, or competitor claim absent from facts.

On any failure, return the deterministic summary and a localized machine code such as `ai_unavailable`; never fail report creation or overwrite the saved summary.

### Step 5: Verify and commit

```powershell
npm.cmd test -- __tests__/api/client-reports.test.ts __tests__/api/report-branding.test.ts __tests__/lib/report-ai.test.ts
npm.cmd test -- __tests__/api/authenticated-scan-entitlement.test.ts __tests__/api/scan-security.test.ts
.\node_modules\.bin\tsc.cmd --noEmit
git diff --check
git add lib/reports/service.ts lib/reports/ai.ts lib/openrouter.ts app/api/report-branding app/api/clients/[clientId]/reports app/api/client-reports __tests__/api/client-reports.test.ts __tests__/api/report-branding.test.ts __tests__/lib/report-ai.test.ts
git commit -m "feat: add client report APIs"
```

## Task 5: Build the dashboard report workflow and localization

**Files:**

- Create: `components/reports/ReportBuilder.tsx`
- Create: `components/reports/ReportPreview.tsx`
- Create: `components/reports/ReportsList.tsx`
- Create: `components/reports/ReportBrandingForm.tsx`
- Create: `components/reports/ReportStatusBadge.tsx`
- Create: `app/[lang]/dashboard/[clientId]/reports/page.tsx`
- Create: `app/[lang]/dashboard/[clientId]/reports/[reportId]/page.tsx`
- Create: `app/[lang]/dashboard/[clientId]/reports/new/page.tsx`
- Modify: `app/[lang]/dashboard/[clientId]/result/[scanId]/page.tsx`
- Modify: `app/[lang]/dashboard/[clientId]/page.tsx`
- Modify: `app/[lang]/dashboard/settings/page.tsx`
- Modify: `messages/en.json`
- Modify: `messages/zh-HK.json`
- Create: `__tests__/components/report-builder.test.tsx`
- Create: `__tests__/components/reports-list.test.tsx`
- Create: `__tests__/components/report-branding-form.test.tsx`
- Create: `__tests__/lib/report-message-parity.test.ts`

### Step 1: Write failing UI contract tests

Test the three-step Compose/Review/Publish state machine, editable summary, AI loading/fallback announcement, unsaved-change warning, first-publish/update confirmation, copy/open link, rotate/revoke confirmation, and published-with-unpublished-changes label. Assert all controls have accessible names, keyboard operation, visible focus, and 44px minimum targets.

Add a key-parity test that flattens `reports` and `reportBranding` message namespaces in both JSON files and requires identical key sets.

Run:

```powershell
npm.cmd test -- __tests__/components/report-builder.test.tsx __tests__/components/reports-list.test.tsx __tests__/components/report-branding-form.test.tsx __tests__/lib/report-message-parity.test.ts
```

### Step 2: Build server pages and small client islands

Keep page-level profile, entitlement, and initial data loading in Server Components. Use Client Components only for form state, fetch actions, clipboard, confirmations, and live status. Do not place the report snapshot or share secret in a global client store.

The new-report page requires `scanId` in `searchParams`, validates it through the server service, and shows an upgrade panel for ineligible plans. The scan result CTA remains visible for Free/Basic but routes to that upgrade state. Do not promise PDF or white-label behavior.

### Step 3: Implement the workflow UI

Compose shows scan identity, branding summary, deterministic summary, editable plain-text area, and AI polish. Review renders `ReportPreview` from the API-safe snapshot. Publish distinguishes first publish from updating an already-public version. Preserve the existing public version until publish succeeds.

The report list renders draft, published, published-with-unpublished-changes, and revoked states; latest/published versions; first/last view; views/clicks; and actions. A failed engagement read renders ?navailable?? not zero.

Branding settings include Agency name, optional HTTPS logo URL, six-digit color, optional paired contact label/URL, initials fallback, and mandatory attribution preview.

### Step 4: Add natural bilingual copy

Add complete English and Hong Kong Traditional Chinese copy for headings, explanations, validation, confirmations, fallback warnings, empty/loading/error/upgrade states, status labels, methodology, and public attribution. Preserve product name `Fimmick AISO`. Do not machine-literalize ?aseline?? use client-friendly local phrasing.

### Step 5: Verify and commit

```powershell
npm.cmd test -- __tests__/components/report-builder.test.tsx __tests__/components/reports-list.test.tsx __tests__/components/report-branding-form.test.tsx __tests__/lib/report-message-parity.test.ts
.\node_modules\.bin\tsc.cmd --noEmit
npm.cmd run lint
git diff --check
git add components/reports app/[lang]/dashboard/[clientId]/reports app/[lang]/dashboard/[clientId]/result/[scanId]/page.tsx app/[lang]/dashboard/[clientId]/page.tsx app/[lang]/dashboard/settings/page.tsx messages/en.json messages/zh-HK.json __tests__/components __tests__/lib/report-message-parity.test.ts
git commit -m "feat: add client report workspace"
```

## Task 6: Render the public report, logo, CTA, and engagement safely

**Files:**

- Create: `lib/reports/public.ts`
- Create: `app/[lang]/r/[slug]/page.tsx`
- Create: `app/[lang]/r/[slug]/not-found.tsx`
- Create: `app/api/public/client-reports/[slug]/logo/route.ts`
- Create: `app/api/public/client-reports/[slug]/contact/route.ts`
- Create: `__tests__/api/public-client-reports.test.ts`
- Create: `__tests__/public-report-page.test.tsx`

### Step 1: Write failing public-boundary tests

Cover valid rendering plus identical neutral 404 behavior for malformed signature, stale version, unknown slug, draft, revoked, missing published version, account downgrade, and failed-closed entitlement state. Assert:

- only `PublicClientReportDto` fields cross the boundary;
- a newer draft does not affect the published page;
- view counter failure does not block render;
- logo proxy verifies the report signature/publication/entitlement before fetching;
- the public HTML references only the same-origin logo proxy, never Agency host;
- CTA destination comes only from the stored published snapshot;
- CTA counter failure does not block a valid redirect;
- redirect rejects CR/LF and any non-HTTPS/non-mailto destination;
- responses use `no-store`, `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer`, and a restrictive CSP.

Run:

```powershell
npm.cmd test -- __tests__/api/public-client-reports.test.ts __tests__/public-report-page.test.tsx
```

### Step 2: Implement one public resolver

In `lib/reports/public.ts`, mark server-only and implement `resolvePublishedClientReport`. Validate query `v` and `s`, verify HMAC before database lookup, load by slug/share version, resolve the owning account's current commercial entitlement, require online reports, require status published and `published_version_id`, parse the versioned snapshot strictly, and map an explicit allowlist to the public DTO.

Return a single `null` outcome for all invalid/unavailable states. Log only a coarse internal reason without slug, signature, contact URL, or snapshot.

### Step 3: Build the public page

Use awaited Next.js 16 params/searchParams and request-time rendering. `generateMetadata` returns a localized generic title plus:

```ts
robots: { index: false, follow: false, nocache: true }
```

Render one semantic `main`, Agency identity, client/domain, summary, score/grade, truthful baseline/delta, material changes, maximum five priority fixes, methodology, optional contact CTA, and mandatory `Powered by Fimmick AISO`. Include text/icon status in addition to color. Avoid dashboard navigation and client JavaScript where possible.

Set a CSS variable only after validating the six-digit Agency color. At 375px there must be no document-level horizontal scrolling. Include print styles but no PDF action.

Increment the view counter after authorization as best-effort. If it fails, still render 200.

### Step 4: Build proxy handlers

Both handlers reuse the public resolver. Logo streams only validated image bytes and fixed safe headers. Contact increments the counter best-effort and returns a 303 to the snapshot destination. Invalid state uses the same 404 body and headers as the page.

### Step 5: Verify and commit

```powershell
npm.cmd test -- __tests__/api/public-client-reports.test.ts __tests__/public-report-page.test.tsx __tests__/lib/report-share.test.ts __tests__/lib/report-branding.test.ts
.\node_modules\.bin\tsc.cmd --noEmit
npm.cmd run lint
git diff --check
git add lib/reports/public.ts app/[lang]/r app/api/public/client-reports __tests__/api/public-client-reports.test.ts __tests__/public-report-page.test.tsx
git commit -m "feat: publish secure client reports"
```

## Task 7: Complete commercial truth, browser coverage, and preview release gates

**Files:**

- Modify: `lib/plans/catalog.ts`
- Modify: `app/[lang]/pricing/page.tsx` only if it derives availability text outside the catalog
- Modify: `messages/en.json`
- Modify: `messages/zh-HK.json`
- Modify: `__tests__/lib/product-facts.test.ts`
- Modify: `__tests__/lib/plan-catalog.test.ts`
- Create: `e2e/client-reports.spec.ts`
- Create: `docs/superpowers/verification/2026-07-21-pro-client-report-workflow.md`

### Step 1: Write failing release and browser tests

Set the expected `release.clientReports` state to `available` for Pro and Enterprise. Assert pricing copy describes a powered online client report, not PDF or full white-label output.

In Playwright cover both `en` and `zh-HK` at 375x812 and 1440x900:

- branding save and initials fallback;
- baseline draft;
- comparable draft with improvement and regression;
- AI failure leaves deterministic summary editable;
- manual edit, preview, first publish, and copy link;
- public content and mandatory attribution;
- new draft leaves public version unchanged;
- publish update changes public content;
- counters, contact redirect, rotate, revoke, and old-link 404;
- Free/Basic API denial and upgrade state;
- keyboard flow, focus, live announcements, console errors, and overflow.

Run the focused release tests and observe failure before flipping release state.

### Step 2: Flip the release truth and eliminate copy drift

Change Pro and Enterprise `release.clientReports` to `available`. Ensure product facts, pricing comparison, dashboard gate, and runtime capability derive from catalog values. Enterprise uses the same powered online report for this phase; keep `whiteLabelPdf: 'planned'` and PDF absent.

### Step 3: Run the complete local quality gate

Use a local test secret only for build and browser verification:

```powershell
$env:REPORT_SHARE_SECRET='local-only-client-report-test-secret-32-characters'
npm.cmd test
.\node_modules\.bin\tsc.cmd --noEmit
npm.cmd run lint
npm.cmd run build
npm.cmd run e2e -- e2e/client-reports.spec.ts
git diff --check
git status --short
```

Record exact commands, pass/fail counts, build output, browser widths/locales, and any baseline failures separately in the verification document. Run a secret scan and confirm the local secret value is absent from tracked files and build output.

### Step 4: Review security and product acceptance

Manually verify:

- no direct public SELECT policy was added;
- no raw scan JSON or tenant identifier appears in public HTML/RSC/API payloads;
- old link fails after rotate/revoke;
- downgrade returns the same neutral 404;
- viewer browser makes no request to the Agency logo host;
- published version remains stable while latest draft changes;
- report at 375px has no horizontal overflow;
- both locales contain mandatory attribution;
- no PDF or attribution-removal control exists.

Use `superpowers:requesting-code-review` for an independent review, fix all High/Medium findings, and rerun affected gates. Then use `superpowers:verification-before-completion` before claiming readiness.

### Step 5: Commit the completed preview-ready feature

```powershell
git add lib/plans/catalog.ts app/[lang]/pricing/page.tsx messages/en.json messages/zh-HK.json __tests__/lib/product-facts.test.ts __tests__/lib/plan-catalog.test.ts e2e/client-reports.spec.ts docs/superpowers/verification/2026-07-21-pro-client-report-workflow.md
git commit -m "test: verify Pro client report workflow"
```

If `app/[lang]/pricing/page.tsx` did not need modification, omit it from `git add` rather than touching it mechanically.

## Task 8: Preview deployment and production approval checkpoint

**Files:**

- Modify: `docs/superpowers/verification/2026-07-21-pro-client-report-workflow.md`

### Step 1: Prepare preview safely

Confirm the Vercel project link and preview database strategy. Migration 027 must be applied only to the preview database. Generate a new preview-only 32-byte random `REPORT_SHARE_SECRET`; do not print it in commentary, logs, screenshots, or the verification document. Configure it only for Preview.

If the current Vercel/Supabase setup cannot isolate preview data from production, stop and request explicit approval before any migration. Do not use production as a preview fallback.

### Step 2: Deploy and smoke test preview

Deploy the branch to Preview and record the deployment ID/URL without secrets. Run the complete happy path and abuse cases:

- eligible create, edit, AI fallback, publish, public view, CTA, rotate, revoke;
- wrong tenant IDs, browser-submitted fake score/snapshot, stale signature, downgrade;
- both locales and both target widths;
- public response headers and viewer network requests.

Append deployment-specific evidence and logs to the verification document.

### Step 3: Stop for production authorization

Present the preview evidence and request one explicit approval covering all three production mutations:

1. apply `027_client_report_snapshots.sql` to production;
2. configure a newly generated production-only `REPORT_SHARE_SECRET`;
3. deploy/promote the verified build to production.

Do not perform any of these before approval. After approval, use the Vercel deployment skill and Supabase skill, apply migration before enabling UI, verify the newest deployment ID, and run production create/publish/view/rotate/revoke smoke tests with a designated test account.

### Step 4: Final branch handoff

After preview is verified and before integration, use `superpowers:finishing-a-development-branch`. Offer merge/PR options, preserve the verification artifact, and include the production approval state explicitly in the handoff.

## Final acceptance checklist

- Effective Pro/Enterprise can create, version, AI-polish, publish, rotate, and revoke an owned domain-matched report.
- Free, Basic, past-due, cancelled, malformed, and downgraded accounts fail closed in API and public routes.
- Baseline/comparison and maximum-five priority fixes are deterministic and evidence-bound.
- Published snapshots are immutable; a newer draft does not silently change public content.
- Signed links are reproducible, HMAC-protected, versioned, revocable, and contain no persisted bearer token.
- Public output is an allowlisted DTO, neutral-404 protected, unindexed, and free of tenant IDs/raw scan data.
- Agency logo is fetched only by the server after SSRF validation; the viewer never contacts Agency infrastructure.
- Engagement counts collect no viewer identity/IP/cookie and never block report delivery.
- English and Hong Kong Traditional Chinese pass message parity and browser coverage.
- 375px and 1440px layouts, keyboard use, focus, contrast-independent status, and target sizes are verified.
- Focused tests, full Vitest, typecheck, lint, build, browser suite, diff check, secret scan, and preview smoke tests have recorded evidence.
- Production migration, production secret, and production deployment remain blocked until explicit approval.
