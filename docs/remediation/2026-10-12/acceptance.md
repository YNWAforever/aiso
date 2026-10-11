# Acceptance and release status

## Implementation

- AI homepage draft with one explicit provider call, 700 output-token ceiling, 8,000-character page input, 256 KiB fetch cap, 8-second website timeout and 15-second model timeout. DNS pinning, redirect validation and private-network denial reuse `public-url.ts`.
- Authenticated account quota: five attempts per hour, durable and fail closed. No automatic retries, no brand write until confirmation, no inferred language/market/competitors. Existing idempotent onboarding and question setup handle confirmed data.
- Editable bilingual draft review, manual fallback, network error recovery and chosen-context preservation. Corrected copy that implied a description could improve citation accuracy; unselected language stays unknown.
- Platform directory: users (including unprovisioned auth users), accounts, brands, scans, questions, answer excerpts, monitoring runs, approved-source metadata and improvement-work metadata. Search, 25-row pages and exact account drilldown. The directory is read-only; access metadata is logged. It is not a raw database export or a complete audit-log retention system.
- Existing plan management preserved at `/admin/billing`. Sidebar corrected to `/admin?lang=…`. No new administrators or permissions granted.

## Verification record

- Latest targeted run: **131/131** across 11 files, including **13 local PostgreSQL (PGlite) cases** exercising production directory SQL. Includes two tenants, unprovisioned users, literal wildcard search, plan resolution, withheld unverified scores and legacy classifications.
- Expanded unit run: **5,894/5,894 passed**, excluding integration files and the 42-case `public-url.test.ts` boundary file (reported separately below). Two initial catalogue/fixture inventory assertions were updated for the new namespaces and admin fixture; the subsequent expanded run passed. The heading/focus adjustment also passed its eight component cases.
- Typecheck, lint and production build passed locally on the final implementation. No new package or migration is needed by this change. The already-merged 063–070 migrations remain an operational prerequisite for the existing creation/monitoring flow.
- The full local unit attempt was interrupted by automatic approval review for a request naming `public.example`. Source inspection found a synthetic `scan-1` request and an explicitly pinned `127.0.0.1` target in the existing `public-url.test.ts`. The separately reviewed boundary suite ran: **39 passed / 3 failed**, all three real pinned-request cases timed out in this environment. It is not a green network boundary result. Do not modify or weaken production fetch validation to make it pass.
- Local browser attempt: **0 functional cases executed / 8 launch failures**, because the pinned Chromium executable is absent. `playwright install chromium` returned corrupt/empty download archives. New synthetic, outbound-denying desktop/mobile specs are registered in the normal CI pipeline; pending execution is not success.
- No live AI call, brand creation, paid monitoring run, email, payment, schema migration or Worker publication performed.

## Bounded live review

Inventory at this checkout: 92 API files and 54 page files; this is a surface count, **not a claim every route was tested**. Reviewed relevant auth, onboarding, admin, AI transport, quota, SQL and deployment code; browser checks used the signed-in tenant session.

| Operation | Result at baseline production |
|---|---|
| Public homepage, Chinese | pass: rendered scan and product navigation |
| Tenant portfolio, Chinese | fail: visibility and activation unavailable |
| Tenant portfolio, English | fail: same unavailable datasets |
| Failed historical scan card | pass: incomplete label, withheld score |
| Onboarding entry | pass: renders, four-step manual path; AI shortcut absent |
| Tenant visits `/admin` | pass: redirects to tenant dashboard |
| Brand home | fail: monitoring options and visibility unavailable |
| Brand home evidence/next-step presentation | pass: saved scan and question-bank link rendered |
| Platform-admin session and live new directory | blocked: current session is not a platform admin |
| Live new AI onboarding transaction | not-tested: new branch not deployed and schema drift unresolved |
| Hosted two-tenant isolation | not-tested; local API/SQL evidence only |
| Real provider, scheduler, payment and delivery flows | not-tested; no synthetic substitutes counted as live |

8 bounded live checks: 5 passed, 3 failed. Four additional acceptance scopes remain blocked/not-tested. Previous F38–F50 evidence and exclusions remain in `../2026-10-11/`; nothing here promotes those findings to verified_live.

## Release gates

1. Review this PR and required CI. Resolve the existing network-test/Chromium environment limitations without bypassing controls.
2. Independently confirm Vercel → Neon production project/branch/role binding. Review missing 063–070 and apply the existing `../2026-10-11/release-runbook.md`: backup, isolated branch rehearsal, exact migration ledger/grants and compatible rollback. Do not replay old migrations or invent backfills.
3. Verify the designated platform admin using the audited `npm run grant-admin` procedure if no authorized admin exists. No browser-based role escalation endpoint is added.
4. Preview: two synthetic tenants plus an authorized admin; 401/403 denial, all nine directory datasets, pagination and account scoping, EN/zh-HK keyboard/mobile checks, draft edit and failed-create recovery.
5. A separately bounded provider smoke is required to establish factual quality on real websites. Evaluate name/domain accuracy, supported description claims, empty/blocked website recovery and human review; this change does not establish a model-accuracy percentage.
6. Only after those gates, merge/deploy and recheck portfolio, first-brand creation and run status. Production is not verified by this report.

Rollback: revert this feature commit to remove the two new routes and restore the old admin entry; no data migration or role changes to reverse. Keep the existing migration-compatible rollback guidance for F51 separate.
