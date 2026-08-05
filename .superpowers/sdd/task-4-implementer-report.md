# Task 4 implementer report

## Scope delivered

- Updated the ResultPage browser page object with `saveReportCta`, `claimStatus`, and `retrySaving`, preserving the existing account, Google, and email locators.
- Updated the public English browser journey to mock `POST /api/scans/:id/claim-intent` before signup, assert the save CTA and absence of the pricing access link, retain the single-scan assertion, preserve magic-link provider/request capture, require the locale-local result claim return target, and mock the successful return claim with saved-status coverage.
- Updated the zh-HK magic-link callback contract to preserve `/zh-HK/result/:id?claim=1`.
- Updated the top-level Google auth bridge contract to retain provider capture and next sanitization while using the result claim return target.
- Left the separate authenticated onboarding E2E unchanged.

## TDD / contract evidence

- Pre-change targeted E2E attempt could not reach the application because no server was listening at `http://localhost:3000`; all runnable cases failed with `ERR_CONNECTION_REFUSED`, while credential-gated cases were skipped for their existing missing-Supabase reason.
- Focused units: 4 files / 35 tests passed.
- Targeted Playwright with `START_DEV_SERVER=1`: all 8 enabled cases passed; 3 credential-gated cases skipped with their existing explicit reasons. The runner process did not exit after reporting results, so the command wrapper timed out at 60 seconds.

## Full verification

- `npm.cmd run test:unit`: 100 files / 1031 tests passed.
- `npm.cmd exec tsc -- --noEmit`: passed.
- `git diff --check`: passed.
- `npm.cmd run lint`: 1 error and 12 warnings. The error is pre-existing/out of task scope in `components/result/AccountUnlockCard.tsx:174` (`react-hooks/set-state-in-effect` for the Task 2 `prepareClaimIntent` effect); all warnings are in unrelated existing files.
- Production build with process-local supplied test values: exited 0. It logged the existing `/admin` dynamic-server-usage/cookies diagnostic during static generation but completed the optimized production build.

## Scope and release concerns

- No production code, schemas, Stripe/entitlement/scoring/report code, secrets, analytics dependency, migration, or PII data was changed.
- The credential-gated public return contracts need a seeded Supabase environment for an actual execution; their contract code is present but was skipped locally for the existing reason.
- The prior Task 2-owned lint error is resolved in the review-fix follow-up below; the lint gate now has zero errors.

## Review-fix follow-up

- Replaced the public return contract's claim-success stub with the credentialed seeded fixture. The test now starts from the public CTA, waits for exactly one prepared claim intent, clicks the visible/enabled Google primary action, captures the social-provider request, and asserts the callback `next` is exactly `/en/result/${TEST_SCAN_ID}?claim=1`.
- The successful return continues through the real fixture-backed claim endpoint, waits for the clean result URL with no query string, and proves the server exposes the ownership-unlocked `full-check-breakdown` while the public `save-report-cta` is absent. The fixture ownership is reset before and after each credentialed return contract, and these contracts run serially to prevent shared-fixture races.
- Added the failed-claim retry contract: the first claim response is mocked as `500`, localized failure/retry UI is required, the retry produces exactly one additional claim POST without a scan POST, and the fallback real claim then unlocks the full result.
- Preserved the hostile-next Google bridge coverage and the separate authenticated onboarding test unchanged. The localized Magic Link callback contract remains `/zh-HK/result/${TEST_SCAN_ID}?claim=1`.
- Resolved the only lint error in `AccountUnlockCard` without suppression or UX/security changes: initial intent preparation runs once through a guarded mount callback (the initial `preparing` state is already rendered), while manual retries still set the preparing state. This avoids synchronous state work in an effect and prevents duplicate initial intent requests under strict-mode remounting.

## Review-fix verification

- Focused units: 4 files / 35 tests passed.
- Targeted Playwright with `START_DEV_SERVER=1`: 8 enabled cases passed; 4 credential-gated fixture/auth cases skipped with their explicit existing prerequisites. Playwright printed the completed case results but the dev-server wrapper remained open and the 120-second command limit ended the process.
- Full unit suite: 100 files / 1031 tests passed.
- TypeScript: `npm.cmd exec tsc -- --noEmit` passed.
- Lint: 0 errors and 12 pre-existing warnings.
- Production build with the required process-local test values passed; it retained the known non-fatal `/admin` dynamic cookies diagnostic during static generation.
- `git diff --check` passed.
