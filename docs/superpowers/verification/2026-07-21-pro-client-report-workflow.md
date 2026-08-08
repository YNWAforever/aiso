# Pro Client Report Workflow — Task 7 Verification

**Verification date:** 2026-07-25
**Branch:** `codex/pro-client-reports`
**Task 7 base:** `4432d45`
**Production state:** Not authorized. Migration 027, production `REPORT_SHARE_SECRET`, and production deployment remain blocked pending explicit approval.

## Outcome

Task 7 makes the delivered attributed online client report commercially available for Pro and Enterprise, while Free and Basic remain ineligible. Enterprise uses the same `Powered by Fimmick AISO` online report in this phase. White-label PDF remains `planned`, is not an export format, and is absent from the rendered pricing comparison and plan cards.

The source, focused tests, full unit suite, generated Next route types, TypeScript, and ESLint gate were verified locally. A browser run and preview smoke test were not attempted because the required isolated database, applied migration, report secret, authenticated storage states, deterministic report fixtures, and target server URLs are absent. The production build also remains blocked by the existing Neon auth cookie-secret prerequisite.

## Commercial truth

| Plan | Runtime online report | Release state | Current report branding | PDF |
|---|---:|---|---|---|
| Free | No | Unavailable | None | Unavailable |
| Basic | No | Unavailable | None | Unavailable |
| Pro | Yes | Available | Mandatory Fimmick attribution | Not offered |
| Enterprise | Yes | Available | Mandatory Fimmick attribution | Planned, not rendered |

Pricing copy is intentionally bounded:

- English: `Online client report with Fimmick AISO attribution`
- Hong Kong Traditional Chinese: `附 Fimmick AISO 署名的網上客戶報告`

Neither string claims PDF, full white-label output, scheduled delivery, or report automation.

## TDD evidence

### RED

Command:

```powershell
C:\Users\laich\Documents\geoscanner\node_modules\.bin\vitest.cmd run __tests__/lib/plan-catalog.test.ts __tests__/lib/product-facts.test.ts
```

Observed before production changes: 2 files failed; 5 tests failed and 17 passed (22 total). The failures proved the old `planned` release states, Enterprise `white-label` branding target, drifted pricing copy, hard-coded `Coming soon`/PDF pricing claims, and missing E2E source.

After adding only the E2E contract, the same command still failed for the four remaining catalog/copy/pricing reasons and passed the E2E source contract (4 failed, 18 passed).

### Focused GREEN

Command:

```powershell
C:\Users\laich\Documents\geoscanner\node_modules\.bin\vitest.cmd run __tests__/lib/plan-catalog.test.ts __tests__/lib/product-facts.test.ts __tests__/lib/report-message-parity.test.ts
```

Result: 3 files passed; 24 tests passed.

## Complete local quality gate

### Full unit suite

Initial exact command:

```powershell
npm.cmd test
```

Initial result: failed with 89 files / 905 tests passing. Root causes were isolated:

1. Vitest classified the plan-mandated root `e2e/client-reports.spec.ts` as a unit test because it excluded only `tests/e2e/**`.
2. Vitest discovered ignored `.superpowers/sdd/patch-staging` test copies containing pre-Task-7 expectations.
3. One tracked pricing truth test still expected `clientReports: planned`.

The test boundary now excludes root `e2e/**` and ignored `.superpowers/**`; the scratch files were preserved. The stale tracked pricing expectation now distinguishes the available online report from planned PDF.

Fresh result:

```text
Test Files  89 passed (89)
Tests       875 passed (875)
Exit        0
```

### Next.js route types

Command:

```powershell
npm.cmd exec -- next typegen
```

Result: route types generated successfully; exit 0.

### TypeScript

Command:

```powershell
npm.cmd exec -- tsc --noEmit
```

Result: exit 0 with no diagnostics. This includes the root `e2e/client-reports.spec.ts` source because it is outside the TypeScript `tests` exclusion.

### ESLint

Command:

```powershell
npm.cmd run lint
```

Result: exit 0, 0 errors, 18 existing warnings. None of the warnings is in a Task 7 changed file. The warnings are existing unused-variable or unused-disable findings in older API tests, dashboard/API/check modules, and `lib/stripe.ts`.

### Production build

Command (no environment mutation and no invented secret):

```powershell
npm.cmd run build
```

Observed:

- Next.js 16.2.4 compiled successfully in 12.4 seconds.
- The build TypeScript phase finished in 14.3 seconds.
- Page-data collection then failed for `/api/auth/[...path]` with `Missing required config: cookies.secret`.
- Next.js also warned that multiple lockfiles caused workspace-root inference to select `C:\Users\laich\package-lock.json`.

This is an environment prerequisite, not evidence of a browser or production pass. No cookie secret or report secret was created or configured during Task 7.

### Diff and secret gates

`git diff --check`, final status, and changed-file secret scanning are recorded in the final verification section below after the artifact itself is included.

## Playwright source and discovery

The browser contract covers:

- English and Hong Kong Traditional Chinese;
- 375x812 and 1440x900;
- eligible and ineligible scan CTA states;
- branding save and initials fallback;
- baseline and comparable drafts with improvement and regression;
- deterministic editable summary after AI failure;
- manual edit, review, first publish, copy, open, newer draft stability, and explicit publish update;
- public attribution/content, counters, contact redirect, rotate, revoke, old-link invalidation, and neutral invalid link;
- Free and Basic 403 API denial plus upgrade state;
- keyboard focus, live announcements, 44px targets, console errors, and horizontal overflow;
- same-origin image requests and public HTML checks for private field markers or configured secret values.

### Initial repository discovery RED

Command:

```powershell
$env:SKIP_E2E_SEED='1'
C:\Users\laich\Documents\geoscanner\node_modules\.bin\playwright.cmd test --list e2e/client-reports.spec.ts
```

Initial result: exit 1, `No tests found`, total 0. The existing `playwright.config.ts` limited `testDir` to `./tests/e2e`, while the approved Task 7 path is `e2e/client-reports.spec.ts`.

### Final repository discovery GREEN

The repository config now uses the repository root with exact `tests/e2e/**/*.spec.ts` and `e2e/**/*.spec.ts` matches. The stateful Task 7 suite is ignored by the existing mobile project because the spec creates its own isolated 375x812 and 1440x900 contexts; this prevents duplicate concurrent mutations of the same fixtures.

Result: exit 0; 9 tests in 1 file were listed:

- four public pricing truth tests for the locale/viewport matrix;
- four Pro lifecycle tests for the same matrix;
- one Free/Basic entitlement gate.

This proves the Playwright source parses and registers. It is not a browser pass.

### Browser execution status

Browser execution was not attempted. Presence-only checks found all of the following absent:

- `.env.local`;
- `REPORT_SHARE_SECRET`;
- Supabase URL and service-role credentials;
- Neon auth configuration;
- authenticated Playwright storage state;
- `PLAYWRIGHT_CLIENT_REPORT_FIXTURE`;
- `BASE_URL`;
- `NEXT_PUBLIC_APP_URL`.

The migration file `supabase/migrations/027_client_report_snapshots.sql` exists, but no safe isolated database was available to prove that migration 027 is applied. Applying it is out of Task 7 scope.

## Preview browser prerequisites

Before the browser suite or preview smoke test can run, all of the following must be true:

1. Use an isolated non-production database. Never fall back to production data.
2. Apply migration `027_client_report_snapshots.sql` only to that isolated preview/test database.
3. Configure a preview/test-only `REPORT_SHARE_SECRET` of at least 32 characters without printing it to logs, screenshots, or this document.
4. Configure Neon auth including its cookie secret, and provide local authenticated storage-state files for active Pro, Free, and Basic accounts.
5. Set `BASE_URL` and `NEXT_PUBLIC_APP_URL` to the same preview/test origin so generated signed links remain on the target under test.
6. Provide an untracked fixture manifest through `PLAYWRIGHT_CLIENT_REPORT_FIXTURE`. It must identify four isolated Pro clients (one per locale/viewport target), each with an earliest baseline scan, a later comparable scan containing at least one improvement and regression, and a controlled preview-only logo URL/origin; it must also contain separate Free and Basic fixtures.
7. Run serially against resettable fixtures because publish, rotate, revoke, counters, and branding are intentionally stateful.

Storage-state JSON and the fixture manifest are bearer-sensitive local artifacts. They must remain untracked and must not be copied into verification output.

## Security and product acceptance status

| Acceptance item | Current evidence | Status |
|---|---|---|
| No direct public report/version SELECT policy added | Task 7 does not change migration 027; migration contract unit tests pass in the full suite | Source/unit verified |
| Public DTO excludes raw scan JSON and tenant identifiers | Existing DTO/public security unit tests pass; Playwright HTML assertion is present | Browser pending |
| Old link fails after rotate/revoke | Unit/API coverage passes; lifecycle browser assertion is present | Browser pending |
| Downgrade uses neutral 404 | Existing API/public unit coverage passes | Browser pending |
| Viewer does not contact Agency logo host | Same-origin browser request assertion is present | Browser pending |
| Published version stays stable while a newer draft exists | Existing API/unit coverage passes; browser assertion is present | Browser pending |
| 375px avoids document overflow | Browser assertion exists for pricing, builder, and public page | Browser pending |
| Mandatory attribution in both locales | Message/source/unit coverage passes; browser assertion is present | Browser pending |
| No PDF or attribution-removal control | Pricing source contract passes and PDF is not rendered | Source/unit verified |
| No secrets in changed tracked/source payloads | Final changed-file scan below; public HTML assertion is present | Source verified, browser pending |

## Production authorization boundary

Task 7 performed no deployment, migration, environment-variable change, secret generation, secret rotation, Supabase mutation, or Vercel mutation.

Before production, one explicit approval must cover all three production mutations together:

1. apply migration 027 to production;
2. configure a newly generated production-only `REPORT_SHARE_SECRET`;
3. deploy or promote the verified build to production.

Until preview evidence exists and that approval is given, pricing/catalog source may be code-complete but the overall feature must not be described as production-verified.

## Final verification snapshot

- Focused catalog/product-facts/message-parity suite: 3 files, 25 tests passed.
- Full Vitest suite: 89 files, 875 tests passed.
- Next.js route type generation: passed.
- TypeScript: passed with no diagnostics.
- ESLint: 0 errors and 18 unrelated baseline warnings.
- Isolated Playwright discovery: 9 tests in 1 file.
- Repository Playwright discovery: passed; 9 tests in 1 file, executed once through the chromium project.
- Browser execution: not attempted because the isolated authenticated fixture, preview server, applied preview migration, and test-only secrets are absent.
- Production build: compiled and type-checked, then stopped on the existing missing Neon `cookies.secret` prerequisite.
- Changed-source secret-value scan: 11 files scanned, 0 secret-value hits and 0 placeholder-secret hits.
- `git diff --check`: passed.
