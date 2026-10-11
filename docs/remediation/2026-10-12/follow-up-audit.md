# AISO follow-up audit and implementation — 2026-10-12 HKT

## Current conclusion

PR #87 is now merged and deployed. Its website-assisted brand setup and nine-view super-admin directory are implemented; they must no longer be described as absent. The highest-priority unresolved problem is operational: the inspected AISO database remains at migration 062, while the deployed application expects 063–070. Portfolio, monitoring and CSV preview failures remain visible. No active platform administrator exists in that database.

This follow-up repairs a reproduced onboarding input-loss problem and adds a guarded, read-only schema diagnostic to the admin directory. It does not claim to repair production schema drift or bootstrap an administrator.

## Baseline and evidence

- Repository/base: `aa800fa072a4a0c7bc4964cee8d6c57d1039af40`, merge of PR #87. New branch: `codex/aiso-activation-recovery-health`.
- Live: https://aiso-kappa.vercel.app/zh-HK . Vercel production alias resolved to READY `dpl_3YzTYF7Drha316S9LYPxsZeXvqKL`, main SHA above, on 2026-10-11 19:17–19:33 UTC (2026-10-12 03:17–03:33 HKT).
- Browser: existing signed-in Pro tenant; no platform-admin access. No account/brand creation, paid generation, monitoring trigger, email, payment, role grant or production migration performed. Synthetic text entered for the UI checks was cleared; CSV was preview-only and failed before confirmation.
- Read-only Neon: project `weathered-wave-50814522`, branch `br-square-mountain-az6f82vi`, database `neondb`. Ledger ends at `062_pulse_grounding.sql`; `pulse_runs.purpose` and `onboarding_progress.request_aliases` absent; active platform-admin count is 0. Previous browser-brand matching corroborates the target, but independent Vercel connection/role attestation remains required before writes.
- E-R2-01: GitHub PR87 merged readback and Vercel production SHA/alias readback.
- E-R2-02: live onboarding AX observations: website example.com, language en and market HK entered; manual step 2 domain blank, step 3 retained old zh-HK and no market; back to step 1 discarded all assistant context.
- E-R2-03: live portfolio and brand home still report unavailable activation, visibility and monitoring.
- E-R2-04: read-only schema and active-admin aggregate queries above; no private user rows exported.
- E-R2-05: live question bank shows 8 existing questions; AI suggestion panel opens without generation, but close button has no accessible name. Source: `components/pulse/SuggestQuestionsPanel.tsx`.
- E-R2-06: one synthetic CSV row, inactive, preview-only: “讀取或驗證失敗，未儲存修改”. Source read verified preview does not call `applyPromptBatch`. Underlying precise server exception was not retrieved; schema drift is a strong related cause, not a separately proved exception trace.
- E-R2-07: tenant `/admin?lang=zh-HK` redirects to `/en/dashboard`.
- E-R2-08: focused SQL/API/component tests, typecheck, lint, production build; independent review found no important introduced issue. CI results are recorded in this branch’s PR description after completion.

## Bounded operation inventory

Source inventory: 92 API route files and 54 page files. These are surface counts, not executed-test counts. This follow-up selected 13 relevant operation/acceptance scopes: 9 live UI checks executed (4 pass, 5 fail), 2 blocked and 2 not-tested. Previous audit/CI evidence remains in the earlier documents; it is not relabelled as fresh live acceptance.

| OP | Route / control | Role / precondition | Expected and actual | Result | Case / evidence |
|---|---|---|---|---|---|
| R2-01 | `/zh-HK` homepage | Visitor surface | Scan/product navigation renders | pass | UC14 / E-R2-01 |
| R2-02 | `/zh-HK/onboarding` AI entry | Signed-in tenant | New URL/language/market UI and provider disclosure visible | pass | UC14 / E-R2-02 |
| R2-03 | AI inputs → manual steps → back | Tenant; unsaved synthetic draft | Preserve context; domain/market lost and language differs | fail | UC14 / E-R2-02 |
| R2-04 | Portfolio activation and visibility | Tenant with existing brand | Load saved state; unavailable | fail | UC18 / E-R2-03 |
| R2-05 | Brand monitoring status | Existing brand | Load saved status; unavailable | fail | UC18 / E-R2-03 |
| R2-06 | Question bank list | Existing brand | Eight saved questions render with language/unknown market | pass | UC18 / E-R2-05 |
| R2-07 | AI question suggestion panel | Open/close only | Named close control; unnamed icon-only button observed | fail | UC17 / E-R2-05 |
| R2-08 | CSV preview | One inactive synthetic row; no confirmation | Preview validation; read/validation error | fail | UC18 / E-R2-06 |
| R2-09 | `/admin` access | Non-admin tenant | Deny access; redirected | pass | UC16 / E-R2-07 |
| R2-10 | All nine admin datasets, hosted | Authorized platform admin | No active admin/session available | blocked | UC16 / E-R2-04 |
| R2-11 | First-brand creation through question setup | Known compatible schema | Schema prerequisites missing; no transaction attempted | blocked | UC18 / E-R2-04 |
| R2-12 | Real-provider draft accuracy | Bounded public-site sample | No provider call performed | not-tested | UC19 |
| R2-13 | Hosted two-tenant isolation | Two synthetic accounts + admin | Local SQL/API coverage only | not-tested | UC16 |

Payments, email delivery, scheduler receipts, Search Console, CMS publication and full raw-data exports were outside this follow-up’s executed scope. Performance percentiles and model-accuracy percentages were not measured. Build success is not a performance benchmark.

## Findings and implementation

| ID | Priority | Evidence / root cause | Status / change |
|---|---|---|---|
| F51 | P1 | Physical database prerequisites absent; live read failures persist | Still blocked. Use existing release runbook after target verification, backup and isolated rehearsal. |
| F52–F54 | Existing | PR87 merged/deployed: AI setup, admin directory, corrected admin navigation | Deployment confirmed; full live transaction/admin acceptance still separate. |
| F55 | P2 | Assistant owned independent URL/language/market state; unmount lost it; manual wizard never received it | Implemented in follow-up: shared parent context, account-scoped session draft, bidirectional updates, manual takeover/focus and pending-request cancellation. |
| F56 | P2 | Admin directory had no indication of recent schema prerequisites, despite F51 | Implemented in follow-up: streamed schema panel behind existing admin guard. Five capability groups; present/absent-or-invisible/unavailable; technical details collapsed. Metadata only, no DDL, no customer rows. |
| F57 | P1 | Active platform-admin aggregate count 0 | Blocked on user-designated administrator identity and verified database target. Use existing audited operator script; never infer the current tenant should be privileged. |
| F58 | P2 | Live AI suggestion drawer has unnamed close button; source also has unlabeled dismissal/edit controls and no dialog/focus management | Recorded for focused accessibility follow-up. Do not count the drawer as keyboard-accessible because it opens. |

F56 intentionally checks selected columns from migrations 063–070 through the application connection. It does not verify ledger hashes, types, constraints, write grants (including migration 066), provider configuration or actual completion. Failure does not turn into an empty healthy result. Tenant/customer queries and authorization remain unchanged. No new dependency, API route, migration or role is introduced.

## Verification and acceptance

- Expanded local unit suite: **5,902 passed / 0 skipped**, excluding integration and the 42-case public-url boundary file whose earlier local environment limitation remains documented. The unchanged boundary suite stays in required CI.
- Local: 100 focused tests passed across 10 files, including real production SQL executed on isolated PGlite, plus 9 catalogue parity checks. Typecheck, lint, production build and diff checks passed.
- Fixture bundling: first attempt under `/tmp` failed module resolution because the fixture entry was outside the repo dependency tree. Re-running under the normal `.next` tree passed for both actual component fixtures. No product code change was needed for that harness path issue.
- Browser regressions cover EN/zh-HK + desktop/mobile: failed AI request → refresh → manual takeover → retained context → edit manual context → back to assistant; pending request cancellation cannot apply a late result. Admin fixture covers diagnostic details alongside account rows and horizontal overflow/a11y. CI is required because local Chromium remains unavailable from the previous audit. A test declaration is not an execution result.
- UC14: one input of URL/language/market survives failed AI, reload and both navigation directions; manual button focuses brand name; final existing idempotent confirmation remains required. No AI call occurs on restore.
- UC15: missing columns identify affected business capabilities; query failure is unavailable; success says only inspected columns present; admin directory can stream independently of diagnostic query completion. No write action appears.
- UC16: tenant denied, authorized admin lists nine datasets with pagination/exact-account scoping, second tenant cannot read foreign data. New panel is behind the same page guard.
- UC17: suggestion drawer needs named controls, dialog semantics, focus entry/trap/restore, Escape handling and per-item saving/error recovery; verify phone and keyboard in both locales.
- UC18: after migration rehearsal and release, brand creation and retry do not duplicate brands; CSV preview validates before save; saved prompts preserve chosen language/market; monitor status loads; bounded collection produces traceable observations.
- UC19 proposed real-provider evaluation: 5 public sites across both supported languages, 2 runs each; require exact domain, supported brand name, zero unsupported description claims, correct explicit locale/market, editable review and failure fallback. Record actual provider/model/config, source timestamps, token/cost cap and disagreements; no accuracy percentage is currently claimed.

## Execution order for Codex GPT-6.1 Sol

1. Finish PR checks for F55/F56; preserve existing auth, tenant-scoped stores, SSRF, quota and onboarding idempotency. See `follow-up-tasks.csv` for dependencies and acceptance.
2. Resolve F51 operationally first: attest current Vercel → Neon binding/role, compare all eight exact migration hashes (rechecked unchanged), take backup, rehearse on isolated branch, inspect aeo_app grants. Execute only the exact approved packet; do not baseline/replay an unknown database. See `../2026-10-11/release-runbook.md`.
3. Resolve F57: obtain the intended existing login identity, map it to exactly one active profile on the verified target; prepare `npm run grant-admin -- --grant <profile-uuid> --reason <approved-reason>` dry run; apply only with the designated-recipient authorization. Role grant records a ledger entry; never add a public bootstrap endpoint. No actual recipient has been selected.
4. Run hosted UC14–UC18 with synthetic accounts and an authorized admin before declaring first-brand onboarding complete. Record deployed SHA, target, role, expected/actual and cleanup. No repeated paid calls on unknown outcomes.
5. Complete F58 and evaluate UC19. Then simplify the first-run question review to a small recommended starter set with an explicit editable language/market and bounded first-monitoring cost; retain the existing full bank as advanced controls. Use observed evidence to recommend the next task. Never describe diagnostic points as guaranteed AI ranking/revenue gains.

Rollback for this follow-up: revert its code commit; no schema or role changes to reverse. Preserve saved draft compatibility: older clients ignore the added optional websiteUrl field. Operational migration rollback remains a separate compatible-app/producer-pause procedure; do not drop evidence tables.
