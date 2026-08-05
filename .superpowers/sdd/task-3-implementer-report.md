# Task 3 implementation report: redacted funnel diagnostics

## Commit

- `3c95167 feat: instrument scan signup funnel`

## Files changed

- `lib/observability/funnel.ts` — allowlisted server contract, SHA-256 scan-ID prefix hashing, redacted console logging.
- `app/api/funnel-events/route.ts` — JSON-only `POST` endpoint, sub-2-KB enforcement, invalid-payload rejection, fixed success/error responses.
- `components/home/ScanForm.tsx` — emits `scan_completed` only after a valid scan ID is returned.
- `components/result/ResultClient.tsx` — emits a result view per mount and a signup-CTA view for public results.
- `components/result/AccountUnlockCard.tsx` — emits a retry event when claim-intent preparation is retried.
- `__tests__/lib/funnel-events.test.ts` — redaction, hashing, sensitive-field rejection, and logging tests.
- `__tests__/api/funnel-events.test.ts` — success, malformed, sensitive, oversized, and no-echo route tests.

`lib/funnel-client.ts`, `ClaimScanOnReturn.tsx`, and the existing scan-form test were retained unchanged because prior completed tasks already supplied the safe keepalive sender, signup/claim events, and scan retry coverage.

## Contract decisions

- Accepted fields are `name`, `attemptId`, `locale`, plus optional `scanId`, `provider`, and `errorCode`; enum values are checked at the server boundary.
- The log payload contains only `name`, `attemptId`, `locale`, optional `scanHash`, `provider`, and `errorCode`.
- `scanHash` is the first 16 hex characters of a server-side SHA-256 digest; no raw scan ID is logged.
- The endpoint returns only `{ ok: true }` on success and `{ error: 'Invalid funnel event' }` on rejection. It does not echo request data or write to Neon.

## Privacy reasoning

- Top-level `email`, `url`, `results`, and `competitors` fields are rejected before the event can be logged.
- Client instrumentation passes only the existing scan ID, selected provider, locale, and normalized failure category. Submitted URL, magic-link email, report data, and competitor data are never included.
- Network errors remain swallowed by the client sender, preserving scan and auth flow behavior.

## Verification

- RED observed: `npm.cmd exec vitest run __tests__/lib/funnel-events.test.ts` failed because `@/lib/observability/funnel` did not exist.
- `npm.cmd exec vitest run __tests__/lib/funnel-events.test.ts __tests__/api/funnel-events.test.ts`: 2 files, 5 tests passed.
- `npm.cmd exec vitest run __tests__/lib/funnel-events.test.ts __tests__/api/funnel-events.test.ts __tests__/lib/funnel-client.test.ts __tests__/components/scan-form.test.ts`: 4 files, 12 tests passed.
- `npm.cmd exec vitest run __tests__/components/scan-form.test.ts __tests__/components/result-platform-status.test.ts __tests__/components/account-unlock-card.test.ts __tests__/components/claim-scan-on-return.test.ts`: 4 files, 27 tests passed.
- `npm.cmd exec -- tsc --noEmit`: passed.
- `git diff --check` and `git diff --cached --check`: passed.

## Concerns

- `git` emits existing global-ignore permission and line-ending warnings in this environment; neither affected the staged Task 3 diff or verification.

## Review fix: recursive funnel PII rejection

### Finding and root cause

- The initial adapter checked `email`, `url`, `results`, and `competitors` only on the root event object. Unknown nested metadata was discarded from the eventual log record, but a nested sensitive key still made the request appear valid and receive `200`.

### Fix

- `containsSensitiveKey` now walks every nested plain object and array, rejecting an event when any sensitive key is found. It uses a `WeakSet` so direct adapter calls with cyclic values cannot recurse indefinitely.
- `POST /api/funnel-events` now calls `logFunnelEvent` once. That function validates/redacts and returns the redacted record or `null`, so valid scan IDs are hashed once and invalid input is never logged.
- Regression coverage proves nested object and array PII is rejected by both the adapter and the route, while the route retains its fixed non-echoing error response.

### Verification

- RED observed: `npm.cmd exec vitest run __tests__/lib/funnel-events.test.ts __tests__/api/funnel-events.test.ts` failed with the nested event accepted by both adapter and route.
- GREEN: the same focused event suite passed: 2 files, 6 tests.
- Component/event regression suite passed: 7 files, 34 tests.
- `npm.cmd exec -- tsc --noEmit` passed.
- `git diff --check` passed.
