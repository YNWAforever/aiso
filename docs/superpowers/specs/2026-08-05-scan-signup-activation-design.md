# Scan-to-signup activation funnel

**Status:** Design approved by the product owner on 2026-08-05

## Goal

Increase the rate at which a visitor who completes a public scan creates an account and returns to the same report. The account is free, requires no card, and immediately owns the completed scan.

The primary KPI is:

> completed scans that become registered accounts / successful completed scans

## Scope

This phase covers the public scan result CTA, Google-first authentication with Magic Link fallback, return-to-report behavior, anonymous scan claiming, retryable errors, and funnel diagnostics.

It does not change plan entitlements, Stripe prices or Price IDs, scan scoring, report content, or paid upgrade UX. It does not add a third-party analytics SDK or require a new database table.

## Existing seams to preserve

- `POST /api/scan` already accepts anonymous scans and persists them with `account_id = null`.
- `/:lang/result/:id` is the public result route and already distinguishes anonymous and owned access.
- `POST /api/scans/[id]/claim` already implements the ownership transition and returns `claimed`, `already-owned`, `not-found`, `conflict`, or `error` outcomes.
- `LoginForm` already supports Google and Magic Link and accepts a `next` destination.
- `AuthComplete` already validates the session and uses a safe relative `next` destination.
- Existing scan-claim, auth-bridge, result-access, and funnel-contract tests remain the regression baseline.

## User journey and data flow

1. A visitor submits the homepage scan form. The scan runs without authentication and returns a `scanId` plus the public result route.
2. The result page renders the score summary and a primary “save full report” CTA. The result remains viewable before registration.
3. The CTA calls a same-origin `POST /api/scans/[id]/claim-intent` route. The route verifies that the scan exists and is still unowned, then creates a short-lived claim intent containing only the `scanId`, locale, and safe return path. The intent is stored in a signed, HttpOnly, SameSite=Lax cookie with a 15-minute lifetime; the signer reuses the existing server secret provider with a distinct claim-intent domain separator. No report payload, email, or full URL is placed in the auth target.
4. The visitor is sent to the localized login page. Google is the primary action; Magic Link is the secondary fallback. Both preserve the same relative result path in the auth callback.
5. After either provider completes, `AuthComplete` verifies the session and redirects to the original result route.
6. The result page submits an idempotent claim request. The server authorizes the current account and updates only an unowned scan. The intent cookie is cleared after a terminal claim outcome. If the Magic Link is completed on another device and the cookie is absent, the result route may still retry the claim by `scanId`; the claim API remains the authorization boundary.
7. On `claimed` or `already-owned`, the page immediately renders the complete report and a saved confirmation. No second scan is executed. The report is now available from the dashboard.

## UI/UX contract

### Result page before authentication

- Primary CTA (zh-HK): `使用 Google 免費保存完整報告`
- Primary CTA (English): `Continue with Google to save your full report`
- Supporting copy: `無需信用卡 · 免費保存此掃描` / `No credit card · Save this scan for free`
- Secondary action: `改用 Email Magic Link` / `Use Email Magic Link instead`
- Do not show a pricing choice before the report is saved.

### Authentication states

- Disable the Google action while the redirect is starting.
- Keep the return destination when Magic Link is sent, and show the localized “check your email” confirmation.
- Preserve the scan result context behind the auth state so a failed attempt can be retried without re-entering the URL.

### Result page after authentication

- Show `報告已保存到你的工作區` / `Report saved to your workspace`.
- Keep the report view as the primary action; offer a secondary Dashboard link.
- Use `aria-live` for claim and authentication status, visible focus states, and touch-sized controls.

### Recoverable errors

- Keep the original URL and form inputs for invalid URL, fetch, rate-limit, and scan failures.
- Offer `重試掃描` / `Retry scan` for scan failures.
- Offer `重試保存` / `Retry saving` for claim failures.
- Use a specific localized message for `conflict`, `not-found`, authentication failure, and temporary service failure. Never silently restart a scan.

## Security and privacy

- Accept only same-origin relative return paths; reuse the existing `safeNext` contract and test external redirect rejection.
- Sign and expire claim intents. Do not put report data, email addresses, or complete target URLs in cookies or query strings.
- `POST /api/scans/[id]/claim-intent` is same-origin and rate-limited with the result route; it never returns report data and does not create a database row.
- The claim route remains the source of truth: the caller must be authenticated, the scan must be unowned or already owned by that account, and cross-account claims must return `conflict`.
- Funnel diagnostics record only an anonymous attempt ID, a hashed scan ID, locale, provider, and a bounded error code. No email, raw URL, report result, or user-entered competitor data is logged.

## Funnel diagnostics and KPI

Use a typed funnel-event adapter that writes redacted structured events through the existing observability boundary. No third-party tracker is introduced in this phase.

Events:

- `scan_completed`
- `scan_result_viewed`
- `signup_cta_viewed`
- `signup_started` with `provider = google | magic_link`
- `signup_succeeded`
- `scan_claim_succeeded`
- `scan_claim_failed` with a bounded error category
- `scan_retry_clicked`

The primary KPI is calculated from existing scan timestamps and the `account_id` transition. Provider success, claim success, error rate, and retry success are secondary diagnostics.

## Testing and acceptance

### Unit and contract tests

- The CTA uses Google as the primary provider and Magic Link as fallback in both locales.
- The auth callback preserves and sanitizes the original result path.
- Claim outcomes map to the correct saved, retry, conflict, and not-found UI states.
- Claim is idempotent and never changes another account’s scan.
- Funnel events reject PII and raw report data.

### End-to-end tests

- Anonymous visitor completes a scan, starts Google auth, returns to the same result, claims it, and sees the full report without rescanning.
- Magic Link follows the same return path and displays the saved confirmation.
- External `next` targets are rejected.
- A scan failure preserves the submitted URL and a retry can succeed.
- A failed claim can be retried without losing the report context.

### Release acceptance

Run the existing unit suite, TypeScript check, lint, production build, auth bridge tests, scan-claim tests, and funnel E2E contract. Verify both `/en` and `/zh-HK` result flows in a Vercel preview before production promotion.

## Rollout boundary

Implement the flow behind the existing result-page components and routes, preserve current anonymous result access, and ship without a database migration. Production release requires all local checks and preview verification to pass. Stripe configuration and paid-plan behavior remain unchanged.
