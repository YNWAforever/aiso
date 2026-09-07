# C8c–g local implementation handoff — 2026-09-06

## Scope and baseline

Approved consolidated design: `../specs/2026-09-06-c8c-g-workspace-design.md`. Branch: `codex/c8c-g-workspace`. Base: `3c831721a41383dff416d79574963e1dfc985bed` (reviewed C8b local checkpoint). This batch is uncommitted and unpublished; the original continuation plan remains excluded and untouched. C7/C8a/C8b are not repeated.

## Changed behavior

- C8c: authenticated, owned read-only Pulse route and Monitor share validated observations, explicit unknown/error/empty states and honest weekly chart gaps. Invalid IDs fail before SQL. Prompt network failures roll back edits or preserve drafts and release pending controls.
- C8d: reachable Fix Pack and agent output use localized draft language. Generation and clipboard failures remain retryable, and asynchronous responses are isolated by scan. Generation does not promise persistence, delivery or publication. Orphan components remain fenced.
- C8e: both localized sample-report routes render a separate synthetic example without database/view-counter/provider calls. Exact demo aliases redirect with 307; the existing metadata API and NAV-derived sitemap now cover exactly 50 localized public URLs. Signed-report, revocation, snapshot and comparison contracts remain intact.
- C8f: Alerts rejects failed/malformed responses, supports safe retries and client changes, and exposes named accessible controls. Local Trust read/write gates and deduplication were audited and regression-tested; no scheduler or service rewrite was needed.
- C8g: settings presents localized catalogue and billing/status copy, including explicit unknown status, while preserving entitlement, branding, portal and onboarding boundaries.

Exact source/field semantics are appended to `../../contracts/fields.md`.

## Verification

Final evidence is recorded in `.codex/c8cg-unit.log`, `c8cg-lint.log`, `c8cg-build.log`, `c8cg-fixtures.log` and `c8cg-browser.log`. Full offline units: 201 files / 2,185 tests passed. Source lint and isolated default Next production build passed (exit 0). Installed Next typegen and standalone tsc passed (exit 0; tool output). Fixture generation passed 6 tests. Source equivalence passed for all 38 changed/new TS/TSX/JSON files, and the original continuation plan SHA-256 matches the C8b baseline. Browser acceptance: initial run 58/58 passed; final-build run 57/58 passed with one existing C7 zh-HK malformed-success retry test timing out on an empty status. Both localized cases passed on immediate rerun (2/2) and five repetitions each (10/10). All new C8 browser cases passed. The intermittent timeout cause remains unconfirmed; no speculative product change was made. Logs: `.codex/c8cg-browser-retry.log` and `c8cg-browser-repeat.log`.

Independent reviews covered Pulse ownership/denominators/chart gaps, generated-work request races, Alerts client switching, settings entitlements and sample-report isolation. Findings were fixed and re-reviewed: malformed Pulse UUIDs, stale client alert errors, cross-scan generated output and draft-only wrapper copy. No blocking review finding remains.

Initial integration testing found an obsolete settings English-string assertion, a missing Pulse loader mock and a newly unused legacy table inventory entry. All were updated with behavior-preserving tests or inventory documentation. An intermediate unused-variable edit was corrected before final TypeScript validation. The first source lint warning was removed. These are local development failures, not production incidents.

## Evidence limits and remaining work

SQL/Auth/provider tests use mocks; tagged-query ownership assertions do not prove live Neon equivalence. Pulse/settings browser acceptance uses real rendered components and built CSS with blocked networking, not a real authenticated session. Sample/public acceptance runs the isolated Next production server with dummy settings. Generated-work/Alerts use bilingual interaction renderers, not live generation, clipboard integration, alert persistence or email. No real Stripe portal was opened. No database, environment, credential, provider or customer mutation; migration, paid scan, real email, deployment, push or merge occurred. Remote PR/CI state was not refreshed.

C9 still requires material entity ownership verification, approval-role and delivery/attribution contracts. C10 requires selected connector/provider scopes and named operator ownership. C11 requires target environment, named owners, canary/write fences and restore/cutover proof. None is represented as implemented or operationally verified by this handoff; no next product slice starts implicitly.

## Review and rollback

Exact review patch: `.codex/c8cg-review.patch`; manifest: `.codex/c8cg-files.json`. The 42-file exporter uses a separate temporary index and checks reverse applicability without modifying the real index. Inspect against the pinned base. Roll back only this source patch after checking for intervening edits; no data/schema rollback is required. No rollback has been applied.

Reproduction: `node .codex/c7-unit.cjs`; isolated runner `node .codex/c8cg-run.cjs sync`, then `build`, `typegen`, `tsc`, `fixtures`, `start` and `batch`. The local runner excludes environment/credential files and uses loopback port 3120. Fixture tests require C8C/C8G HTML and CSS artifact paths supplied by the runner; ordinary unconfigured optional fixture tests are not acceptance evidence.
