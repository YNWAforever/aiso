# Scan-to-signup activation funnel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an anonymous visitor finish a scan, authenticate with Google or Magic Link, return to the same result, and immediately claim the complete report without running a second scan.

**Architecture:** Keep anonymous scan creation and the existing race-safe `POST /api/scans/[id]/claim` boundary. Add a short-lived signed claim-intent cookie, route the existing result-page auth card back to `/:lang/result/:id?claim=1`, and let a client return handler claim the scan before replacing the URL with the clean result path. Add a redacted structured funnel-event adapter without a third-party SDK, database table, or migration.

**Tech Stack:** Next.js 16 App Router, React 19 client components, Neon Auth, Neon serverless SQL, TypeScript, Vitest, Playwright, Node `crypto` HMAC/SHA-256.

## Global Constraints

- Public scan happens before signup; Google is the primary provider and Magic Link is the fallback.
- Successful auth returns to the same result and immediately unlocks/saves the complete free report; it never starts a second scan.
- The intent cookie is signed, HttpOnly, SameSite=Lax, and expires after 15 minutes. Use the existing server secret provider with a claim-intent domain separator.
- Only same-origin relative `next` paths are accepted. Reuse the current `normalizeAuthNext`/`safeNext` contract and reject external targets.
- Keep the exact approved copy: `使用 Google 免費保存完整報告`, `Continue with Google to save your full report`, `無需信用卡 · 免費保存此掃描`, `No credit card · Save this scan for free`, `改用 Email Magic Link`, `Use Email Magic Link instead`, `報告已保存到你的工作區`, and `Report saved to your workspace`.
- Preserve URL/form inputs on scan errors and provide localized retry actions. Never silently rescan after an auth or claim error.
- Do not change plan entitlements, Stripe prices/Price IDs, scan scoring, report content, or paid upgrade behavior.
- Do not add a third-party analytics SDK, database table, production migration, or new secret.
- Funnel diagnostics must not log email, raw URLs, report results, or competitor input. Hash scan IDs before logging.
- Every implementation task follows TDD: failing test, focused failure run, minimal implementation, focused pass, then commit.

---

## File map and boundaries

| File | Responsibility in this plan |
| --- | --- |
| `lib/security/scan-claim-intent.ts` | Sign, verify, expire, and redact the claim-intent payload. |
| `app/api/scans/[id]/claim-intent/route.ts` | Validate an unowned scan, rate-limit the intent request, and set the signed cookie. |
| `components/result/ClaimScanOnReturn.tsx` | Claim an authenticated scan when `?claim=1` is present, show retryable status, and clean the URL. |
| `components/result/AccountUnlockCard.tsx` | Prefetch claim intent, launch Google first/Magic Link second, and preserve the result return path. |
| `components/result/ResultClient.tsx` | Mount the return handler, render approved copy, hide pricing before save, and emit result-view events. |
| `components/home/ScanForm.tsx` | Keep failed input, expose a retry label, and emit scan completion/retry events. |
| `lib/observability/funnel.ts` | Validate and redact the event contract; write structured server logs. |
| `lib/funnel-client.ts` | Generate an anonymous attempt ID and send client events with `keepalive`. |
| `app/api/funnel-events/route.ts` | Accept only the bounded, non-PII client event contract. |
| `messages/en.json`, `messages/zh-HK.json` | Add localized retry, claim status, and claim error strings. |
| `__tests__/lib/scan-claim-intent.test.ts`, `__tests__/api/scan-claim-intent.test.ts` | Token and route security contracts. |
| `__tests__/components/claim-scan-on-return.test.ts`, `__tests__/components/account-unlock-card.test.ts`, `__tests__/components/scan-form.test.ts` | Result return/claim, auth-card, and scan retry contracts. |
| `__tests__/lib/funnel-events.test.ts`, `__tests__/api/funnel-events.test.ts` | Event validation and redaction contracts. |
| `tests/e2e/pages/ResultPage.ts`, `tests/e2e/scan-flow.spec.ts`, `tests/e2e/google-auth-bridge.spec.ts` | Browser-level scan → auth → result verification. |

## Task 1: Add the signed claim-intent boundary

**Files:**

- Create: `lib/security/scan-claim-intent.ts`
- Create: `app/api/scans/[id]/claim-intent/route.ts`
- Test: `__tests__/lib/scan-claim-intent.test.ts`
- Test: `__tests__/api/scan-claim-intent.test.ts`

**Interfaces:**

```ts
export type ScanClaimIntent = {
  scanId: string
  lang: 'en' | 'zh-HK'
  returnPath: string
  attemptId: string
  exp: number
}

export const CLAIM_INTENT_COOKIE = 'fimmick_scan_claim_intent'

export function signScanClaimIntent(
  input: Omit<ScanClaimIntent, 'exp'>,
  nowMs?: number,
): string

export function verifyScanClaimIntent(token: string, nowMs?: number): ScanClaimIntent | null
```

- [ ] **Step 1: Write failing signer tests.**

```ts
it('round-trips a valid intent and uses a 15-minute expiry', () => {
  vi.stubEnv('REPORT_SHARE_SECRET', 'x'.repeat(32))
  const now = 1_700_000_000_000
  const token = signScanClaimIntent(
    { scanId: 'scan-1', lang: 'en', returnPath: '/en/result/scan-1?claim=1', attemptId: 'attempt-1' },
    now,
  )

  expect(verifyScanClaimIntent(token, now)).toMatchObject({
    scanId: 'scan-1', lang: 'en', returnPath: '/en/result/scan-1?claim=1', attemptId: 'attempt-1',
    exp: now + 15 * 60 * 1000,
  })
})

it.each([
  ['tampered signature', (token: string) => token.slice(0, -1) + 'A'],
  ['expired token', (token: string) => token],
])('rejects %s', (_name, mutate) => {
  vi.stubEnv('REPORT_SHARE_SECRET', 'x'.repeat(32))
  const now = 1_700_000_000_000
  const token = signScanClaimIntent(
    { scanId: 'scan-1', lang: 'zh-HK', returnPath: '/zh-HK/result/scan-1?claim=1', attemptId: 'attempt-1' },
    now,
  )
  expect(verifyScanClaimIntent(mutate(token), now + 15 * 60 * 1000 + 1)).toBeNull()
})

it('fails closed when REPORT_SHARE_SECRET is absent or too short', () => {
  vi.stubEnv('REPORT_SHARE_SECRET', '')
  expect(() => signScanClaimIntent({
    scanId: 'scan-1', lang: 'en', returnPath: '/en/result/scan-1?claim=1', attemptId: 'attempt-1',
  })).toThrow('REPORT_SHARE_SECRET')
})
```

- [ ] **Step 2: Run the focused signer test and confirm RED.**

Run: `npm.cmd exec vitest run __tests__/lib/scan-claim-intent.test.ts`

Expected: FAIL because the helper module and exports do not exist.

- [ ] **Step 3: Implement the minimal HMAC helper.** Use `createHmac('sha256')`, `timingSafeEqual`, base64url JSON/signature segments, the canonical domain string `fimmick-scan-claim-intent:v1`, and a 900-second TTL. Validate `scanId`, supported locale, same-locale `returnPath`, `attemptId`, expiry, and the 43-character base64url signature before comparing digests. Reuse `REPORT_SHARE_SECRET` through a local `claimIntentSecret()` function; do not add an environment variable.

```ts
const TTL_MS = 15 * 60 * 1000
const DOMAIN = 'fimmick-scan-claim-intent:v1'

function canonical(payload: ScanClaimIntent) {
  return `${DOMAIN}:${payload.scanId}:${payload.lang}:${payload.returnPath}:${payload.attemptId}:${payload.exp}`
}
```

- [ ] **Step 4: Run the signer tests and confirm GREEN.**

Run: `npm.cmd exec vitest run __tests__/lib/scan-claim-intent.test.ts`

Expected: all signer cases pass.

- [ ] **Step 5: Write failing claim-intent route tests.** Mock `@/lib/db`, `@/lib/security/public-scan-rate-limit`, and use `NextRequest`/`NextResponse` directly. Cover: invalid locale (`400`), missing scan (`404`), owned scan (`409`), rate limit (`429` with `Retry-After`), valid anonymous scan (`200`, `ok: true`, `Set-Cookie` with `HttpOnly`, `SameSite=Lax`, `Max-Age=900`), and database failure (`500`). Assert the token verifies to `/${lang}/result/${id}?claim=1` and that the route never returns report data.

```ts
it('sets a short-lived intent cookie for an unowned scan', async () => {
  nextRows = [[{ id: 'scan-1', account_id: null }]]
  const response = await post('scan-1', { lang: 'en' })

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ ok: true })
  const setCookie = response.headers.get('set-cookie') ?? ''
  expect(setCookie).toContain(`${CLAIM_INTENT_COOKIE}=`)
  expect(setCookie).toContain('HttpOnly')
  expect(setCookie).toContain('SameSite=Lax')
  expect(setCookie).toContain('Max-Age=900')
  const token = setCookie.split(`${CLAIM_INTENT_COOKIE}=`)[1].split(';')[0]
  expect(verifyScanClaimIntent(token)).toMatchObject({
    scanId: 'scan-1', lang: 'en', returnPath: '/en/result/scan-1?claim=1',
  })
})
```

- [ ] **Step 6: Run the route test and confirm RED.**

Run: `npm.cmd exec vitest run __tests__/api/scan-claim-intent.test.ts`

Expected: FAIL because the route does not exist.

- [ ] **Step 7: Implement `POST /api/scans/[id]/claim-intent`.** Parse `{ lang }`, validate `en | zh-HK`, call `consumePublicScanRateLimit(req)` before the database lookup, select only `id, account_id`, return the explicit status codes above, sign `{ scanId, lang, returnPath, attemptId: crypto.randomUUID() }`, and set the cookie on the JSON response:

```ts
response.cookies.set(CLAIM_INTENT_COOKIE, token, {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 15 * 60,
  path: '/',
})
```

Use `dynamic = 'force-dynamic'`, log only a stable route error category, and never include SQL/provider messages in the response.

- [ ] **Step 8: Run both focused suites and commit.**

Run: `npm.cmd exec vitest run __tests__/lib/scan-claim-intent.test.ts __tests__/api/scan-claim-intent.test.ts`

Expected: all tests pass.

```bash
git add lib/security/scan-claim-intent.ts app/api/scans/[id]/claim-intent/route.ts __tests__/lib/scan-claim-intent.test.ts __tests__/api/scan-claim-intent.test.ts
git commit -m "feat: add signed scan claim intent"
```

## Task 2: Return to the original result and claim it in place

**Files:**

- Create: `components/result/ClaimScanOnReturn.tsx`
- Modify: `components/result/AccountUnlockCard.tsx`
- Modify: `components/result/ResultClient.tsx`
- Modify: `components/home/ScanForm.tsx`
- Modify: `messages/en.json`
- Modify: `messages/zh-HK.json`
- Create: `__tests__/components/claim-scan-on-return.test.ts`
- Modify: `__tests__/components/account-unlock-card.test.ts`
- Modify: `__tests__/lib/auth-client.test.ts`

**Interfaces:**

```ts
export type ClaimReturnState =
  | 'idle' | 'claiming' | 'claimed' | 'already-owned'
  | 'not-found' | 'conflict' | 'error'

export function buildScanClaimNext(lang: string, scanId: string): string {
  return `/${lang}/result/${encodeURIComponent(scanId)}?claim=1`
}

export function classifyClaimResponse(status: number, body: unknown): Exclude<ClaimReturnState, 'idle' | 'claiming'>
```

- [ ] **Step 1: Write failing pure/component contract tests.** Cover exact result targets for `en` and `zh-HK`, `200 + alreadyOwned:false → claimed`, `200 + alreadyOwned:true → already-owned`, `404 → not-found`, `409 → conflict`, all other non-2xx → error, and the approved Google/Magic Link callback target. Update existing auth-client and account-unlock tests from `/onboarding?scan=...` to `/result/...?...claim=1`.

```ts
it.each([
  ['en', 'scan-123', '/en/result/scan-123?claim=1'],
  ['zh-HK', 'scan-123', '/zh-HK/result/scan-123?claim=1'],
])('builds the result return target', (lang, scanId, expected) => {
  expect(buildScanClaimNext(lang, scanId)).toBe(expected)
})

it.each([
  [200, { ok: true, alreadyOwned: false }, 'claimed'],
  [200, { ok: true, alreadyOwned: true }, 'already-owned'],
  [404, { error: 'Scan not found' }, 'not-found'],
  [409, { error: 'Scan belongs to another account' }, 'conflict'],
  [500, { error: 'Failed to claim scan' }, 'error'],
])('classifies claim response %s', (status, body, expected) => {
  expect(classifyClaimResponse(status, body)).toBe(expected)
})
```

- [ ] **Step 2: Run focused tests and confirm RED.**

Run: `npm.cmd exec vitest run __tests__/components/claim-scan-on-return.test.ts __tests__/components/account-unlock-card.test.ts __tests__/lib/auth-client.test.ts`

Expected: FAIL because the return helper and new target are not implemented.

- [ ] **Step 3: Implement `ClaimScanOnReturn`.** Read `useSearchParams`; only run once when `claim=1`. POST to `/api/scans/${encodeURIComponent(scanId)}/claim`, map the response through `classifyClaimResponse`, emit the success/error event from Task 3, and on `claimed`/`already-owned` call `router.replace(\`/${lang}/result/${encodeURIComponent(scanId)}\`)`. Keep `?claim=1` on failure so the retry button can run the same request. Render `role="status"`, `aria-live="polite"`, `data-testid="claim-status"`, the approved saved copy, and localized `重試保存` / `Retry saving`.

```tsx
useEffect(() => {
  if (searchParams.get('claim') !== '1' || attempted.current) return
  attempted.current = true
  void claim()
}, [searchParams, scanId])
```

- [ ] **Step 4: Refactor `AccountUnlockCard`.** Keep the existing embedded-browser Google launcher and popup isolation behavior. On mount, call `POST /api/scans/${scanId}/claim-intent` with `{ lang }`; disable both auth actions until the intent is ready, show a localized retry on intent failure, and use `buildScanClaimNext(lang, scanId)` for both `buildGoogleAuthStartUrl` and `buildAuthCompleteUrl`. Update the card copy to the exact approved strings, add `data-testid="save-report-cta"` to the card, preserve `google-signup` and `create-account` test IDs, and emit `signup_started` with the selected provider.

- [ ] **Step 5: Update `ResultClient` and `ScanForm`.** Mount `<ClaimScanOnReturn scanId={summary.id} lang={lang} />` near the result header. Hide the existing pricing link while `fullScan` is absent so an anonymous visitor sees the save CTA before a plan choice. Keep the full report path unchanged for owners. In `ScanForm`, retain the current URL state on failure, change the submit label to localized retry copy after the first failure, and emit `scan_retry_clicked` on the next submission. Keep the current URL normalization and `aria-invalid`/focus behavior.

- [ ] **Step 6: Add message keys and run focused tests.** Add `retry_scan`, `claiming_report`, `report_saved`, `retry_saving`, `scan_not_found`, `scan_conflict`, and `claim_failed` to both locale JSON files with the exact approved saved/CTA copy and clear, non-secret error text. Update `__tests__/components/scan-form.test.ts` to cover the retry-label contract. Run:

`npm.cmd exec vitest run __tests__/components/claim-scan-on-return.test.ts __tests__/components/account-unlock-card.test.ts __tests__/lib/auth-client.test.ts __tests__/components/scan-form.test.ts`

Expected: all focused component/navigation tests pass.

- [ ] **Step 7: Commit the result-flow implementation.**

```bash
git add components/result/ClaimScanOnReturn.tsx components/result/AccountUnlockCard.tsx components/result/ResultClient.tsx components/home/ScanForm.tsx messages/en.json messages/zh-HK.json __tests__/components/claim-scan-on-return.test.ts __tests__/components/account-unlock-card.test.ts __tests__/lib/auth-client.test.ts
git commit -m "feat: return authenticated scans to their report"
```

## Task 3: Add redacted funnel diagnostics

**Files:**

- Create: `lib/observability/funnel.ts`
- Create: `lib/funnel-client.ts`
- Create: `app/api/funnel-events/route.ts`
- Test: `__tests__/lib/funnel-events.test.ts`
- Test: `__tests__/api/funnel-events.test.ts`
- Modify: `components/home/ScanForm.tsx`
- Modify: `components/result/ResultClient.tsx`
- Modify: `components/result/AccountUnlockCard.tsx`
- Modify: `components/result/ClaimScanOnReturn.tsx`
- Modify: `__tests__/components/scan-form.test.ts`

**Interfaces:**

```ts
export const FUNNEL_EVENTS = [
  'scan_completed', 'scan_result_viewed', 'signup_cta_viewed',
  'signup_started', 'signup_succeeded', 'scan_claim_succeeded',
  'scan_claim_failed', 'scan_retry_clicked',
] as const

export type FunnelEventName = typeof FUNNEL_EVENTS[number]
export type FunnelEventInput = {
  name: FunnelEventName
  attemptId: string
  locale: 'en' | 'zh-HK'
  scanId?: string
  provider?: 'google' | 'magic_link'
  errorCode?: 'not_found' | 'conflict' | 'unauthorized' | 'rate_limited' | 'temporary'
}

export function redactFunnelEvent(input: unknown): Record<string, string> | null
export function logFunnelEvent(input: FunnelEventInput): void
export function trackFunnelEvent(input: Omit<FunnelEventInput, 'attemptId'>): void
```

- [ ] **Step 1: Write failing redaction tests.** Assert that valid events keep only the allowlisted fields, raw scan IDs become a fixed-length SHA-256 prefix, unknown event/provider/error values return `null`, and payloads containing `email`, `url`, `results`, or `competitors` are rejected rather than logged.

```ts
it('redacts identifiers and rejects user content', () => {
  const event = redactFunnelEvent({
    name: 'signup_started', attemptId: 'attempt-1', locale: 'en',
    scanId: 'scan-1', provider: 'google',
    email: 'person@example.com', url: 'https://example.com',
  })
  expect(event).toBeNull()
})
```

- [ ] **Step 2: Run the focused event test and confirm RED.**

Run: `npm.cmd exec vitest run __tests__/lib/funnel-events.test.ts`

Expected: FAIL because the event adapter does not exist.

- [ ] **Step 3: Implement the server adapter and client sender.** `redactFunnelEvent` must enforce the union values, hash `scanId`, cap `errorCode`, and return only `name`, `attemptId`, `locale`, `scanHash`, `provider`, and `errorCode`. `logFunnelEvent` must call `console.info('[funnel]', JSON.stringify(redacted))`. `trackFunnelEvent` must create/reuse a `sessionStorage` attempt ID and send a JSON `POST /api/funnel-events` with `{ keepalive: true }`; it must swallow network errors so analytics cannot block scanning or auth.

- [ ] **Step 4: Write failing route tests and implement the route.** `POST /api/funnel-events` accepts a JSON object under 2 KB, calls `redactFunnelEvent`, returns `{ ok: true }` for valid events, `400` for malformed/PII/unknown events, and never echoes the raw payload. The route logs the redacted event and does not write to Neon.

- [ ] **Step 5: Instrument the approved funnel points.** Emit `scan_completed` after the homepage scan receives a valid ID, `scan_result_viewed` and `signup_cta_viewed` once per result mount, `signup_started` at Google/Magic Link click, `signup_succeeded` after the claim return has an authenticated session, `scan_claim_succeeded`/`scan_claim_failed` from the return handler, and `scan_retry_clicked` on scan/claim retries. Do not send the submitted URL, email, report results, or competitor list.

- [ ] **Step 6: Run event tests and commit.**

Run: `npm.cmd exec vitest run __tests__/lib/funnel-events.test.ts __tests__/api/funnel-events.test.ts`

Expected: all event/redaction tests pass.

```bash
git add lib/observability/funnel.ts lib/funnel-client.ts app/api/funnel-events/route.ts __tests__/lib/funnel-events.test.ts __tests__/api/funnel-events.test.ts components/home/ScanForm.tsx components/result/ResultClient.tsx components/result/AccountUnlockCard.tsx components/result/ClaimScanOnReturn.tsx
git commit -m "feat: instrument scan signup funnel"
```

## Task 4: Update browser contracts and verify the complete flow

**Files:**

- Modify: `tests/e2e/pages/ResultPage.ts`
- Modify: `tests/e2e/scan-flow.spec.ts`
- Modify: `tests/e2e/google-auth-bridge.spec.ts`
- Modify: `__tests__/api/scan-claim.test.ts` only if the new client return mapping needs an explicit existing-status assertion.

**Interfaces:**

The `ResultPage` object must expose `saveReportCta`, `claimStatus`, `retrySaving`, `googleSignupButton`, and `emailInput`, while retaining the existing `createAccountButton` alias for unaffected tests.

- [ ] **Step 1: Write failing browser-contract assertions.** Update the public scan journey to expect the auth callback target `/en/result/${TEST_SCAN_ID}?claim=1`, not `/en/onboarding?scan=...`; assert the claim-intent request is made before auth; assert the result CTA is visible, the pricing link is absent before claim, and the saved status appears after a mocked successful claim. Update the localized case to expect `/zh-HK/result/${TEST_SCAN_ID}?claim=1`. Keep the separate authenticated onboarding test unchanged to protect the existing brand-association workflow.

```ts
expect(callback.searchParams.get('next')).toBe('/en/result/' + TEST_SCAN_ID + '?claim=1')
await expect(result.saveReportCta).toBeVisible()
await expect(page.getByRole('link', { name: /Get full access/i })).toHaveCount(0)
```

- [ ] **Step 2: Run the targeted E2E contracts and confirm RED.**

Run: `npm.cmd exec playwright test tests/e2e/scan-flow.spec.ts tests/e2e/google-auth-bridge.spec.ts --project=chromium`

Expected: the old onboarding target assertions fail until the browser contract is updated.

- [ ] **Step 3: Update the page object and route mocks.** Add locators for the new CTA/status/retry controls, mock `POST /api/scans/${TEST_SCAN_ID}/claim-intent` with `{ ok: true }`, mock the claim response where the test reaches the return handler, and preserve the existing magic-link/social provider request capture. Do not mock away the `next` sanitization assertions.

- [ ] **Step 4: Run targeted E2E and unit suites.**

Run:

```bash
npm.cmd exec playwright test tests/e2e/scan-flow.spec.ts tests/e2e/google-auth-bridge.spec.ts --project=chromium
npm.cmd exec vitest run __tests__/api/scan-claim.test.ts __tests__/api/scan-claim-intent.test.ts __tests__/components/claim-scan-on-return.test.ts __tests__/components/account-unlock-card.test.ts
```

Expected: all enabled browser-contract and focused unit tests pass. Credential-gated tests may remain skipped with their existing explicit reason.

- [ ] **Step 5: Run the full verification set.**

```bash
npm.cmd run test:unit
npm.cmd exec tsc -- --noEmit
npm.cmd run lint
git diff --check
```

Expected: the unit suite passes, TypeScript exits 0, lint has 0 errors, and diff check is clean. Treat any existing lint warnings separately from new errors.

- [ ] **Step 6: Run the production build with process-local test values.**

```powershell
$env:NEON_AUTH_BASE_URL='https://example.neonauth.test'
$env:NEON_AUTH_COOKIE_SECRET='0123456789abcdef0123456789abcdef'
$env:DATABASE_URL='postgresql://test:test@localhost:5432/test'
$env:NEXT_PUBLIC_SUPABASE_URL='https://example.supabase.co'
$env:NEXT_PUBLIC_SUPABASE_ANON_KEY='test-anon'
$env:SUPABASE_SERVICE_ROLE_KEY='test-service-role'
$env:REPORT_SHARE_SECRET='0123456789abcdef0123456789abcdef'
$env:NEXT_PUBLIC_APP_URL='https://fimmick-aeo-oitb.vercel.app'
npm.cmd run build
```

Expected: Next.js build completes successfully and no production secret is written to a file.

- [ ] **Step 7: Commit the verification-contract updates.**

```bash
git add tests/e2e/pages/ResultPage.ts tests/e2e/scan-flow.spec.ts tests/e2e/google-auth-bridge.spec.ts __tests__/api/scan-claim.test.ts
git commit -m "test: cover scan signup return flow"
```

- [ ] **Step 8: Preview verification before production.** Push the branch and open a Vercel preview. Verify `/en` and `/zh-HK` manually: scan success → result CTA → Google/Magic Link callback → same result → saved confirmation. Verify a failed scan retains the URL and a failed claim exposes retry. Promote only after local tests, preview checks, and the existing CI checks are green.

## Self-review checklist

- Spec coverage: claim intent/security is Task 1; result/auth/UI/error behavior is Task 2; event names/privacy/KPI are Task 3; browser acceptance and release gates are Task 4.
- No database migration, Stripe change, or third-party analytics dependency is introduced.
- `next` remains locale-local and sanitized; `claim` is idempotent and ownership-checked by the existing route.
- The existing onboarding flow remains covered by its current authenticated E2E test; only the public result unlock path changes.
- All new exported types and helper names are defined in the task that introduces them and reused consistently by later tasks.
