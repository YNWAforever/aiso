# AISO — Codex GPT-6.1 Sol Implementation Plan

Execution handoff v2 · 2026-10-07 HKT · Plan only; no application changes or new live verification performed while preparing this handoff.

> **For agentic workers:** Use `superpowers:executing-plans` to implement this plan task by task. Steps use checkboxes for tracking. The requested implementation model is **Codex GPT-6.1 Sol**. Do not spawn other agents unless the execution session authorizes that method.

**Goal:** Close the two unresolved code defects found in the re-audit, validate the existing authentication repair, and take the existing remediation candidate through an evidence-based release gate.

**Architecture:** Continue PR #68; preserve its durable Pulse runs, version approvals, resumable onboarding, pagination and authentication design. Add focused changes to activation derivation and factual-density evidence. Keep production, isolated test, mocked browser and normal human-session evidence separate.

**Tech Stack:** Existing Next.js/React/TypeScript, Neon PostgreSQL/Auth, Vitest, existing browser tests and Cloudflare Worker. Use the repository lockfile and scripts; this plan does not request dependency upgrades.

**Spec:** `AISO-audit-report-2026-10-07.md`, `AISO-findings-2026-10-07.csv`, `AISO-repair-tasks-2026-10-07.csv`, and evidence E21–E37 in this package. Original F01–F19 and their implementation design travel in `prior/audit/` and `candidate-docs/docs/superpowers/plans/2026-10-03-aiso-full-remediation.md`.

## Global constraints

- Recorded production/main: `f49e1bd8951394cf88250b3ea88847d0038db491`; candidate: `6f7b84a0f24e1f4427369ec12e304f618b2f68aa`, branch `codex/aiso-full-remediation-20261003`, draft PR #68. Re-read all three before starting.
- Preserve F01–F22, T00–T23, UC01–UC22 and OP01–OP67. Do not renumber old findings or relabel a historical pass as current acceptance.
- The original `AISO-audit-evidence.zip` SHA-256 is `c8479913f5ca74f476aa6b9d0e78f75cc9c69597a5c82eb0d8378069343218a5`. The exact requested `AISO-audit-evidence-2026-10-07.zip` SHA-256 is `c5ba2f07aee65f1eb72fe4486d92205ab496302f24b7f4382e0540133141189d` (2,695,283 bytes, 134 members; archive integrity checked).
- Read `AGENTS.md`, `CLAUDE.md` and any applicable nested instructions. Before changing Next.js code, follow the repository's local documentation requirement.
- Use a clean isolated checkout; preserve user changes. Do not duplicate or revert PR #68's completed fixes merely to follow old task order.
- Default task states: T21/T23 待開始; T00/T16/T17 受阻; other tasks, including T22, 待驗收. A passing unit suite alone never means deployed or fully accepted.
- The audit and this planning request do not authorize production migration, merge/deployment, scheduler enablement, paid provider jobs, email, privilege changes, production source approval/agent permission/revocation or destructive cleanup. Reuse any concrete authorization already present in the implementation session; do not ask again for an authorized action. Complete isolated implementation and reviewable evidence first; perform consequential release actions only when authorized in the implementation session.
- Keep `en` and `zh-HK` aligned. Store dates consistently and show operator schedules in HKT. Never invent a next due time, provider cost, approved event, industry benchmark or observed visibility.
- Preserve historical scans, scoring versions, source approval history and successful Pulse answers. Do not rewrite historical evidence to make new tests pass.

## Review focus

1. An imported but never approved source must not complete an approval milestone; another tenant's approval must not affect this account. T21 owns these tests.
2. Repeat approval, a later source version and withdrawal must not change the timestamp of an event that already happened. T21 owns the historical-milestone tests.
3. Provider outage, malformed JSON, numeric strings, null, non-finite or out-of-range scores and invalid claims must never become fake measurements or NaN. T23 owns these tests.
4. An old stored `50` without provenance must not be silently treated as a new confirmed observation; partial evidence must not create a definite repair priority. T23 owns reader/version tests.
5. A session reaching renewal/expiry during protected navigation must not throw from read-only rendering, leak another user or keep a revoked session alive. T22 owns SDK and normal-session tests.

---

## Input, authority and completion contract

The input is the exact October 7 archive, not only the earlier October 3 pack. Its top-level audit root is `AISO-reaudit-2026-10-07/`. Extract it into `input/evidence/`; keep the original ZIP unchanged. Audit observations below are **recorded evidence**, not statements that the deployment is still in that state today.

| Recorded evidence | Implementation consequence |
|---|---|
| 22 findings; 24 tasks; 19 awaiting acceptance, 3 blocked, 2 not started | Retain IDs and status history; no task starts this execution as verified complete |
| PR #68 candidate `6f7b84a…`; main/live `f49e1bd…` | Continue the candidate after checking drift; do not reconstruct all earlier repairs |
| Candidate unit run: 372 files, 5,303 passed; CI run 37366000350 attempt 2: 10 successful jobs | Historical evidence only; inspect new reports on the selected SHA and do not reuse author-reported DB/browser counts |
| T21/F20 and T23/F22 remain reproducible code defects; T22/F21 has candidate repair | New code primarily T21/T23; validate and amend T22 only for a reproduced remaining gap |
| Recorded production schema lacks 054–059; no candidate deployment found in audit | Schema/preview/role/job acceptance remain release gates, not assumed code defects |
| Worker control-plane evidence is historical; source defaults differ from live origin | Read actual deployed ownership, target and schedules before scheduling conclusions or changes |

Authority order: current repository instructions and session authorization → verified current code/runtime observations → this v2 execution plan and new execution matrices → October 7 audit findings/status → October 3 design as background. Resolve drift in an evidence note, not by deleting an old finding. The older design's “Create” paths already exist in the recorded candidate; inspect and reuse them. Old proposed command lines are superseded by the command corrections below.

Deliver one coherent PR update with: focused commits, updated 24-task register, 36-case acceptance matrix, redacted test artifacts, normal-session UAT evidence where available, and a concrete rollout/rollback proposal. Stop at a reviewable implementation if consequential release actions lack authorization; continue all independent local work.

Task state rules: `待開始` → `進行中` → `待驗收` → `已驗證完成`, with `受阻` recording a precise missing gate. Also track local/isolated/preview/production acceptance separately. A task may be locally verified while production is pending. A disabled optional feature can have an explicitly accepted exception, but may not be relabelled as verified healthy or fixed.

Evidence receipt fields: task and acceptance IDs, UTC timestamp and HKT display, SHA, environment, redacted target identity, fixture/role, command, exit code, discovered/pass/fail/skip counts, observed result, artifact path/hash, cleanup result, and remaining blocker. Capture the test process exit code even when redacting or teeing logs. Missing discovery/report and skipped required tests are failures of the gate, not passes.

## Execution batches

| Batch | Ordered work | Exit condition |
|---|---|---|
| B0 | Package/hash, repo rules and drift, baseline; start T00 readback | Reproducible candidate selected; unknown access items recorded without stopping code work |
| B1 | Inspect T14 → T22 focused auth checks; T04 → T21; T01 → T03 → T23; verify T02 | Two new fixes committed; supporting candidate behavior retained; external auth timing may remain pending |
| B2 | T06/T05 → T07/T08 → T09; T10 → T11; T12/T13/T18/T19/T20 → T15 | Remaining implemented features pass their applicable unit, DB and browser checks |
| B3 | Complete T00 and T16, including T22 normal-provider UAT | Exact runtime inventory and role/tenant/onboarding/maintenance evidence, or explicit blockers |
| B4 | T17 CI, preview, release proposal; authorized rollout and schedule observation | Same-SHA release evidence; no claim of full closure while a required gate remains open |

Arrows express acceptance dependencies, not a requirement to rewrite already-correct code. T00 and normal-session waits do not block T21/T23 or other independent checks. The execution CSV gives a dependency-valid review order; prepare fixtures early and resume blocked tasks when access becomes available.

## B0 — Establish the execution baseline

- [ ] Read this report and E21/E29/E30/E33/E35/E36 before changing code. Compare current main/PR head/live alias with the recorded SHAs and record drift.
- [ ] Verify Git working-tree changes, read the current PR diff, and record main/head SHA. If the recorded fix is already superseded, test its behavior and document the mapping rather than cherry-picking blindly.
- [ ] Fetch enough Git history for migration-history tests. Run `npm ci`, then the exact `npm run test:unit` command. Do not use bare `npx vitest run` as the unit gate; it also selects DB integration suites without the guarded integration setup.
- [ ] Establish a reproducible local test environment. This audit's Node 24.19.0 inherited an HTTP proxy; three synthetic `public.example` tests pinned to `127.0.0.1` timed out until that test host was added to `NO_PROXY`/`no_proxy`. Preserve current exceptions and only change the subprocess environment if the same condition is reproduced. Do not change product transport to satisfy a local proxy fixture.
- [ ] Expect 372 files / 5,303 passing unit tests at the recorded candidate; a newer candidate may legitimately have a different count. Record discovered/passed/failed/skipped, command exit and SHA rather than forcing the old count.
- [ ] Run the package's R08/R09 probes against the selected checkout to confirm F22. They currently **pass when a defect is present**. New acceptance tests must assert the corrected behaviour; do not copy the unsafe expected values into product tests.
- [ ] Copy the updated plan and matrices into the repository's documented plan/evidence location. Keep the input archive immutable and reference it by hash. Make a focused baseline/evidence commit if needed.

## T21 — Derive approval progress from actual approved versions

**Files**

- Modify `lib/telemetry/activation.ts` (`readActivation`).
- Extend `__tests__/lib/activation.test.ts`, `__tests__/components/portfolio-activation.test.tsx` and `__tests__/lib/activation-progress.test.ts`.
- Create `__tests__/integration/activation-approval.test.ts` using the existing guarded disposable-DB fixture conventions.
- Keep `messages/en.json` / `messages/zh-HK.json` labels “First approved source” / “首個已批核來源”. No new migration should be needed: `client_source_versions.approved_at` already exists.

**Interfaces**

- Preserve `readActivation(accountId: string, now?: Date): Promise<Activation>` and existing milestone key `first_source` for compatibility.
- `reached.first_source` means the earliest real approval timestamp for a source version owned by that account. It is a historical event, independent of current agent-use permission and current revocation.

- [ ] Write a real-DB regression named `unapproved_source_does_not_complete_approval_milestone`. Create only isolated fixtures: an account with first scan/workspace and one source version with `approved_at=null`; assert `first_source === null`, `furthest === 'first_workspace'`, and progress is 2/6 with approval as next step. Run via the existing guarded integration wrapper; expect this test to fail on the recorded candidate.
- [ ] Add cases for first approval, repeat approval, newer unapproved version, later approval and revoked-but-previously-approved source. Assert the earliest timestamp remains stable. Add another-account approved source; assert no cross-tenant influence. No production fixtures or role changes are needed.
- [ ] Replace the source-creation subquery with an account-scoped minimum approval timestamp from `client_source_versions`, joined to owned source identity if required by the existing tenancy convention. Retain the single-statement snapshot and error propagation. Do not backfill approvals or inspect agent-use permission to infer an approval event.
- [ ] Run `npm run test:unit -- __tests__/lib/activation.test.ts __tests__/lib/activation-progress.test.ts __tests__/components/portfolio-activation.test.tsx`, plus the new isolated integration file through the guarded wrapper. Require no skipped cases and verify both locales' next-step rendering.
- [ ] Commit the focused fix, tests and evidence. Update T21/UC20/OP64 with SHA and results. Keep production status open until a deployed normal-session read shows the corrected state.

**Rollback:** Revert the derivation/UI commit; do not mutate source rows or approval history.

## T23 — Represent unavailable GEO uniqueness honestly

**Files**

- Modify `lib/checks/factualDensity.ts`, `lib/types.ts` (`FactualDensityResult`), `components/result/ResultClient.tsx`, `components/result/DeepGeoSection.tsx`.
- Inspect the actual c18 writer/reader consumers with `rg 'uniquenessScore|c18_factual_density'`; update affected snapshots and DTOs together. Relevant scoring/evidence paths are `lib/scoring.ts`, `lib/pillar-scores.ts`, `lib/scan-evidence.ts`, `lib/scan-evidence-capture.ts`, `lib/result-access.ts`, `app/api/scan/route.ts` and opportunity priority projection. Read `docs/contracts/versioning.md`; update its registry documentation with the change.
- Extend `__tests__/checks/factualDensity.test.ts`; add `__tests__/components/factual-density-evidence.test.tsx` and targeted existing projection/version tests.

**Interfaces and decisions**

- Keep `checkFactualDensity(html, context)` as the caller-facing function.
- Introduce `parseFactualUniqueness(value: unknown): {score: number; claims: string[]} | null` in the check module or a small adjacent parser. Implementation decision for this repair (not a platform ranking requirement): accept only integer scores in `[0,100]`, an array of at most 3 string claims, each nonempty and at most 500 characters. Reject rather than coerce numeric strings, booleans, missing fields or invalid values. Match the provider JSON schema to these same bounds.
- New `FactualDensityResult` records use `uniquenessScore: number | null`, `qualityScore: number | null`, plus `uniquenessStatus: 'observed' | 'unavailable'`. Deterministically counted fields remain numeric. Keep a reader-compatible representation for legacy rows lacking the new status; do not assert their provenance retrospectively.
- On provider failure/invalid output: uniqueness and aggregate c18 quality are null, claims are empty, diagnostic stays `partial` with its documented reason, and new UI says “未能量度” / “Unavailable”. Never manufacture 50 or zero as a successful measurement.
- Keep the existing `CheckStatus` union. For unavailable c18 results, use compatibility `status: 'fail'` solely to preserve the existing no-credit headline calculation, alongside a dedicated localized unavailable message, `diagnostic.collection: 'partial'`, nullable metrics and evidence `assessment: 'not-verifiable'`. This compatibility sentinel is never a finding of poor content: no red fail badge, numeric quality bar, confirmed-failure count, impact uplift or definitive repair priority may be derived from it. Do not change headline weights/grade or silently impute a measured zero. Render the existing headline as a technical score with the existing incomplete-evidence disclosure; diagnostic pillars continue to gate by coverage. If any consumer cannot honor this distinction, fix that consumer before enabling the new writer.
- Version any changed scan/scoring interpretation using the repository's existing scanner/method snapshot mechanism. Keep historical stored totals intact; readers disclose historical limitations. Do not apply a new score silently to an old scan. Register the previous `2026-10-03.v1` scanner/check registry explicitly before bumping current scanner/c18 versions: the recorded `readScanEvidence` recognizes only the current version and `2026-09-05.v1`, so a constant bump alone invalidates October 3 evidence. Add fixtures for both historical registries, the new version, and an unsupported future version. Preserve their original comparison signatures; reject comparisons across incompatible methods. Keep headline/pillar method IDs unchanged if their formulas remain unchanged.

- [ ] Write acceptance tests for outage, malformed JSON, missing score, `null`, `"50"`, `"invalid"`, `-1`, `101`, `NaN`/Infinity at the parser boundary, too many claims and wrong claim types. Assert nullable metrics, partial evidence and no NaN. On the current code, the outage/string tests must fail against R08/R09's demonstrated output.
- [ ] Add valid `0`, `50`, `100` score cases and valid empty claims. Assert values survive unchanged and collection is complete. Repair existing provider mocks that use `uniquenessScore` instead of the actual `{score, claims}` contract; do not hide that invalid old mock behind broad assertions.
- [ ] Implement validation and nullable metrics before computing quality. Do not silently clamp invalid provider scores into a valid result. Preserve deterministic counts and untrusted-content fencing.
- [ ] Update the actual result renderer to use finite-number checks and the explicit status; unavailable metrics render a textual state without a numeric progress bar. Update the duplicated C18 view types or centralize their shared type. In both locales, clearly distinguish deterministic counts from model assessment. A valid provider score means a schema-valid model assessment, not externally verified fact, ranking or observed consumer visibility.
- [ ] Add renderer/projection tests: provider unavailable, invalid stored number, legacy stored50 with no status, valid new50, and partial collection with other complete failing checks. Assert partial c18 never becomes a definitive top repair claim; legacy rows do not acquire invented new provenance. Confirm historical method comparison remains gated.
- [ ] Run the focused check/renderer/projection tests, `npm run typecheck` and `npm run lint`. Run complete unit gate after the focused tests pass. Record new method identifiers and a before/after rendered example with synthetic data.
- [ ] Commit code/tests/evidence as one coherent change. Update T23/UC22/OP66; keep production open until rollout verification.

**Rollback:** Revert the writer/UI entrypoint while retaining readers capable of consuming already-written new nullable/versioned evidence. Preserve stored scans; no destructive migration.

## T22 — Validate the existing authentication repair

**Files**

- Existing candidate fix: `lib/neon-auth.ts`, `lib/auth.ts`, `components/auth/SessionRefresh.tsx`, protected layouts and Auth route.
- Existing tests: `__tests__/lib/auth-rsc-session.test.ts`, `__tests__/components/session-refresh.test.ts`, `__tests__/lib/auth.test.ts`.
- Update evidence and `docs/runbooks/aiso-remediation-uat.md`; only change application code if these checks reveal a concrete remaining fault.

**Interfaces**

- Preserve `getServerSession(): Promise<SessionResult>` and the normal Auth provider's identity/expiry validation.
- Read-only rendering calls the handler with `disableCookieCache=true&disableRefresh=true`; browser protected navigation renews through the writable Auth route. Never resolve the error by disabling session validation or swallowing unrelated service failures.

- [ ] Run `npm run test:unit -- __tests__/lib/auth-rsc-session.test.ts __tests__/components/session-refresh.test.ts __tests__/lib/auth.test.ts`. Assert only the known read-only cookie guard is handled; transport errors, mismatched identity and expired sessions remain rejected.
- [ ] In an authorized isolated app with normal provider login, open all five tools in `en` and `zh-HK`, then navigate at a real renewal boundary. Verify the browser receives the renewed session and a fresh protected request succeeds. Keep credentials/session values out of evidence.
- [ ] Verify expiry/revocation sends the user to the served login route with the safe tool destination preserved; complete return-to tests with Google and, when configured, magic link. A mocked session or mapped DB profile does not count as signup or normal login evidence.
- [ ] Record the current limitation: renewal runs on protected pathname changes; long same-path editing/API-only activity does not itself trigger this effect. Default scope: preserve and document that behavior; do not add polling merely to make this audit broader. If an already agreed product requirement or a reproduced loss of the intended session contradicts it, add a bounded renewal lifecycle as an explicit T22 change, testing logout/unmount cancellation, concurrent tabs and visible failures. Do not claim same-path renewal without that change and acceptance evidence.
- [ ] Update T22 to 待驗收 with unit and isolated evidence; only mark production verified after authorized release and a matching live renewal check plus absence of the known cookie-mutation failure in the observed window. Record window and request count; do not infer zero incidents from empty logs.

**Rollback:** Evaluate auth regression risk before reverting. Preserve security checks; never keep a revoked session alive as a workaround.

## All 24 tasks at a glance

| Order | Task | Work | Audit state | Dependencies | Acceptance |
|---|---|---|---|---|---|
| 1 | T00 | 確認正式排程與rollout證據 | 受阻 | — | AC01;AC36 |
| 2 | T14 | 安全保留工具登入目的地 | 待驗收 | — | AC13;AC26;AC31;AC32 |
| 3 | T22 | 驗收並完成session讀取與续期修復 | 待驗收 | T14 | AC31;AC32;AC33 |
| 4 | T04 | 修復既有來源版本核准與匯入原子性 | 待驗收 | — | AC02;AC22;AC28 |
| 5 | T21 | 修正首個已批核來源啟用里程碑 | 待開始 | — | AC27;AC28 |
| 6 | T01 | 統一檢查語義與AI平台證據 | 待驗收 | — | AC03;AC30;AC34 |
| 7 | T02 | 撤下未有依據的行業平均 | 待驗收 | — | AC04 |
| 8 | T03 | 以完整證據決定首項改善 | 待驗收 | T01 | AC16;AC30 |
| 9 | T23 | 消除GEO provider失敗的假50分與NaN | 待開始 | T01;T03 | AC29;AC30;AC34 |
| 10 | T06 | 避免不合資格客戶餓死排程 | 待驗收 | — | AC05;AC36 |
| 11 | T05 | 建立Pulse固定run與attempt ledger | 待驗收 | — | AC07;AC24;AC36 |
| 12 | T07 | 持久續跑、隔離失敗及時間預算 | 待驗收 | T05;T06 | AC08;AC24;AC36 |
| 13 | T08 | 分類降級顯式化並建立準確度基準 | 待驗收 | T05 | AC09;AC25 |
| 14 | T09 | 可覆核的觀察詳情及採集定義 | 待驗收 | T05;T08 | AC10 |
| 15 | T10 | 讓onboarding可恢復及可觀察 | 待驗收 | — | AC06 |
| 16 | T11 | 正確保存問題語言與市場 | 待驗收 | T10 | AC15 |
| 17 | T12 | 來源與改善候選分頁及批次維護 | 待驗收 | T04 | AC18;AC23 |
| 18 | T13 | 補齊問題庫可存取控件 | 待驗收 | — | AC14 |
| 19 | T18 | 補齊網域驗證的首次取得內容流程 | 待驗收 | — | AC11 |
| 20 | T19 | 改善建議改為可理解及可行動的內容 | 待驗收 | T01;T03 | AC17 |
| 21 | T20 | 所有草稿入口載入完整清單首頁 | 待驗收 | — | AC12 |
| 22 | T15 | 建立每日工作摘要與工具下一步 | 待驗收 | T07;T09;T12 | AC19;AC36 |
| 23 | T16 | 完成尚受方案、角色及資料限制的登入後UAT | 受阻 | — | AC20;AC35 |
| 24 | T17 | 修復後完整回歸與正式發布驗收 | 受阻 | All other tasks | AC21;AC35;AC36 |

T17 depends on all other tasks. This long dependency list is retained in the CSV; phase completion must not conceal an individual blocker.

## T01–T20 — Reuse the existing implementation, finish acceptance

The detailed original task design is included under `candidate-docs/`. Use the updated repair CSV as the status authority. The mapping below avoids rebuilding code already in PR #68.

| Existing work | Findings/tasks | Remaining acceptance |
|---|---|---|
| Check semantics, actual crawler roles, benchmarks and priority | F01–F04 → T01–T03 | Bilingual hydrated report; historical version compatibility; no invented visibility/benchmark claim |
| Exact-version source approval and key identity | F09 → T04 | Normal session same-content approval, repeat/concurrent actions, independent permissions; never activate old AUDIT content |
| Durable Pulse runs, eligibility, repair and classification | F05–F08 → T05–T08 | Guarded real DB crash/retry/lease tests; fixed denominator; no deletion of successes; controlled actual job only when authorized |
| Observation detail and provenance | F12 → T09 | Nonempty normal-session detail, exact prompt/model/time/market/source, unknown legacy data, cross-tenant denial |
| Resumable onboarding and language | F10/F11 → T10/T11 | Fresh normal signup, interrupted seed/retry, same client/trial dates, `zh-HK` + HK preservation |
| Pagination and batch maintenance | F13 → T12 | 201 sources, 250 observations, keyset continuity, stale cursor response, idempotent partial retries; page-bounded content reads |
| Accessible prompt bank and login return path | F14/F15 → T13/T14 | Pro role keyboard/mobile/reader; saved mutation and retry; normal OAuth destination and expiry handling |
| Daily workspace | F12/F13/F16 → T15 | Honest freshness/coverage, owner/action, unknown/disabled/failed distinction, next due only from active configuration |
| Verification first use and readable opportunity/draft lists | F17–F19 → T18–T20 | New domain token flow; readable ranked advice; every open/save entry retains existing drafts; pagination |

Review current primary platform guidance in E37 while finishing T01/T03: local content/chunk/link thresholds are product heuristics, not proven platform ranking rules. A passing technical check must not imply that a brand appears in a consumer answer.

## Exact test runners and evidence handling

These commands were checked against the archived candidate's local checkout at `6f7b84a0f24e1f4427369ec12e304f618b2f68aa`. Re-read scripts/configs if the head changes. No product test was rerun merely to prepare this plan.

1. Unit: `npm run test:unit -- <named unit files>`; final unit gate: `npm run test:unit`. Do not use bare `npx vitest run` as a unit-only gate.
2. Default DB integration: `REQUIRE_INTEGRATION_TESTS=1 npm run test:integration -- <included integration files>`. It provisions/resets a guarded disposable branch through the existing setup. Confirm the existing scope authorization and target guard; never point it at production or disable its guards. Include new `__tests__/integration/activation-approval.test.ts` here.
3. **Excluded exact-target suites:** `feature-store-tenancy.test.ts` and nine other suites are excluded from `vitest.integration.config.ts`. `npm run test:integration -- ...feature-store-tenancy.test.ts` cannot prove tenancy acceptance. Use **`node scripts/ci/run-exact-target-suites.mjs`** via the repository's approved integration job/environment. It creates its own verified disposable target and runs its registered configurations; do not manufacture `C9*` target values. Existing role-password authorization must come from the session/repository workflow, not from setting an approval variable merely to bypass refusal. Keep its provisioning/teardown receipt and all discovered report totals. Run the wrapper once per affected candidate, not once per task that references it.
4. Browser discovery: `npm run e2e -- --list`; named Chromium/mobile suites use the existing `BASE_URL` / `START_DEV_SERVER` conventions and CI build setup. Inspect project discovery before executing. Mocked browser fixtures do not count as provider login or real DB persistence.
5. Authenticated browser: `npm run e2e:authenticated -- tests/e2e/authenticated/aiso-maintenance.spec.ts`, using the existing allowed issuer and explicit test storage state from normal login. This wrapper selects `authenticated-mobile`; add desktop normal-session coverage to T16 explicitly rather than assuming the wrapper covers both. Do not commit credentials/state or export an unrelated browser session.
6. Worker: install its own lockfile once with `npm --prefix cloudflare/cron-worker ci`; then its own `run test` and `run typecheck`. Root unit/lint do not cover it.

Final candidate gates, once after meaningful focused checks:

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run build
REQUIRE_INTEGRATION_TESTS=1 npm run test:integration
node scripts/ci/run-exact-target-suites.mjs
npm --prefix cloudflare/cron-worker run test
npm --prefix cloudflare/cron-worker run typecheck
```

DB commands require the existing approved disposable setup and secret-safe runner. Run browser fixture and authenticated suites separately as above. Reuse `.github/workflows/pr-gate.yml` for redaction, JSON/JUnit reports, actual count aggregation and exit propagation. Read artifacts before reporting numbers. Running `REQUIRE_INTEGRATION_TESTS=1 npm test` alone does not cover the ten excluded configurations. Missing credentials/role approval/normal Auth session is a named blocker; never record it as a behavioral regression or a skip-success. Do not weaken discovery/count gates or pin historical counts to make CI green.

For T23, create `__tests__/components/factual-density-evidence.test.tsx`, extend `__tests__/checks/factualDensity.test.ts`, `__tests__/lib/scan-evidence.test.ts` and `__tests__/lib/scan-evidence-capture.test.ts`; extend the actual priority/public-result tests where the affected readers are exercised. Run these named suites through `npm run test:unit -- ...`, then typecheck/lint. Use synthetic provider responses: no paid provider call is needed to fix F22.

## T00 / T16 / T17 — Operational and release gates

- [ ] **T00 current runtime inventory:** use read-only tools to confirm active Worker name/version/schedules and deployed `APP_BASE_URL`, Vercel alias/SHA, app-bound DB project/branch/application role, schema and target feature flags. The source default `https://aeo.fimmick.com` and the historical `aiso-cron-worker` are not proof of the live site's scheduler target. Do not enable either Worker until ownership and origin are confirmed.
- [ ] For Pulse weekly, alerts, daily trial emails, Search Console and candidate daily repair, record `enabled`, last attempt, last complete success, expected/attempted/succeeded/failed/skipped/unknown items, last error class and `nextDueAt` in HKT. Empty ledger means no recorded evidence; an explicitly empty active schedule means disabled. Never convert one into the other.
- [ ] **T16 isolated role acceptance:** provision or reuse only explicitly authorized disposable fixtures and normal Auth sessions for Pro owner, an independent reviewer, account B and a fresh signup. Complete the 22 user cases and 67 operation records, recording partial coverage honestly. Account B controlled by the owner is useful for tenancy, not independent human review.
- [ ] Run the repository's guarded integration and browser/Worker CI workflows on the new committed SHA. Keep exact commands, discovered/pass/fail/skip counts and cleanup receipts. Inspect uploaded reports before quoting their numeric totals. The audit independently verified prior CI job status, not all uploaded numeric reports.
- [ ] **T17 reviewable release package:** build at the selected SHA, make a preview when authorized, record its immutable deployment, and run the same selected role journeys against it. Produce a concrete migration/flags/Worker rollout and rollback plan before seeking production approval.
- [ ] Read the current release runbook. The recorded target lacks **054–059**, including 054 already present on main. Verify actual current migration filenames, table/column/index/constraint/grant state and application-role access. Never mark a migration applied solely by its ledger row, and never baseline an unknown persistent DB to bypass migration checks.
- [ ] After explicit release authorization: use the existing expand-first rollout, pause duplicate producers, verify schema/application binding, deploy the exact app and Worker, then enable only the approved jobs/flags. A controlled provider run requires its own authorized scope and cost bound; test email requires an approved recipient.
- [ ] After rollout, verify alias→deployment→SHA, five tools, F20's actual progress, F22's failure presentation, F21's real renewal path and one approved job's manifest/item results. Observe the next scheduled execution too. Preserve success evidence through retries and rollback drills.
- [ ] Final handoff: updated findings/tasks/cases/operations, commands/exits, evidence index/hashes, exact production/preview versions, remaining blockers and deliberate product limitations. Mark 已驗證完成 only for the environment and behaviour actually accepted. Do not say all fixed if a required gate is still blocked.

## Task-by-task checklist for the existing candidate

Apply these checklists to existing code. All listed older-design paths were found in the recorded candidate. Inspect the current interface before changing it; the source design below describes the behavioral contract and is not a request to rename a working implementation. Tests already passing for the intended reason need evidence, not artificial failing rewrites. Only a reproduced missing behavior calls for a failing regression and minimal fix. New T21/T22/T23 details are above.

### T14 — 安全保留工具登入目的地

**Scope:** F15 · B1 · dependencies: none · audit state: 待驗收 · acceptance: AC13;AC26;AC31;AC32.

**Files to inspect/reuse:** `lib/auth.ts`, `lib/auth-client.ts`, `components/auth/LoginForm.tsx`, `components/auth/AuthComplete.tsx`, `app/[lang]/dashboard/layout.tsx`, `proxy.ts`, `lib/auth-return-to.ts`, `__tests__/lib/auth-return-to.test.ts`, `tests/e2e/auth-return-to.spec.ts`.

**Contract:** safeReturnTo(raw:unknown,lang:en|zh-HK):string，以URL parser及path allowlist只接受本站已知dashboard子路徑。requireAuth新增可選returnTo；login→auth/complete→站內目的地共享同一sanitizer。保留目前SDK verifier/challenge分支。

- [ ] Inspect the current implementation and matching tests at the selected SHA; compare with the named acceptance scenarios.

- [ ] Verify the behavioral assertion: deep_link_returns_to_same_tool：五工具各驗一次安全目的地。reject_encoded_external_return：//evil、反斜線、%2f%2f、雙重編碼、javascript:、CRLF、登入循環都fallback dashboard；OAuth secret query不寫進return-to或log。

- [ ] Include edge cases: 編碼return-to及過期session.

- [ ] If a gap reproduces, add a failing behavior test, confirm a meaningful failure, apply the smallest complete repair, and rerun the affected checks. Otherwise preserve the implemented fix.

- [ ] Execute applicable named checks (DB/browser prerequisites and dedicated-runner rules above apply):

```bash
npm run test:unit -- __tests__/lib/auth-return-to.test.ts __tests__/components/google-auth-start-route.test.ts __tests__/lib/auth-client.test.ts __tests__/proxy.test.ts
npm run e2e -- tests/e2e/auth-return-to.spec.ts --project=chromium
```

- [ ] Complete the linked user case/operation in the required environment; retain normal-session and persistence evidence separately from fixture tests.

- [ ] Record SHA, discovered results and receipts under `artifacts/aiso/T14/`; update the register and acceptance rows. Commit only changed scope. Remaining environment gates keep the task awaiting acceptance.

**Task acceptance:** 五條深連結登入後回原工具；拒絕外站與//URL；過期session重登入仍可恢復；敏感query不進紀錄。

**Rollback:** 回退return-to功能；fallback dashboard

### T04 — 修復既有來源版本核准與匯入原子性

**Scope:** F09 · B1 · dependencies: none · audit state: 待驗收 · acceptance: AC02;AC22;AC28.

**Files to inspect/reuse:** `lib/sources/store.ts`, `lib/sources/service.ts`, `lib/sources/schema.ts`, `lib/view-models/source-pack.ts`, `app/[lang]/dashboard/[clientId]/sources/page.tsx`, `components/sources/SourcePackWorkspace.tsx`, `messages/en.json`, `messages/zh-HK.json`, `__tests__/integration/client-sources.test.ts`, `app/api/clients/[clientId]/sources/[sourceId]/versions/[versionId]/approve/route.ts`, `__tests__/api/source-version-approval.test.ts`.

**Contract:** 新增 approveSourceVersion(scope: SourceScope, input: {sourceId:string; versionId:string; expectedLatestVersion:number; expectedContentHash:string}): Promise<ApprovalResult>。ApprovalResult.kind為approved/already-approved/conflict/revoked/not-found。POST /api/clients/:clientId/sources/:sourceId/versions/:versionId/approve；actor從session取得。DTO補approvedBy，沿用既有approved_at/approved_by欄位。

- [ ] Inspect the current implementation and matching tests at the selected SHA; compare with the named acceptance scenarios.

- [ ] Verify the behavioral assertion: source_v1_same_content_can_be_approved：先approve=false匯入，核准同v1後expect(latestVersion).toBe(1)、expect(approvedAt).not.toBeNull()、actor正確、agentUseAllowed仍false。重複核准不改首次actor/time。新v2與舊v1核准並行，舊expected version回409；A不可核准B來源。

- [ ] Include edge cases: 來源v1核准與v2匯入並行.

- [ ] If a gap reproduces, add a failing behavior test, confirm a meaningful failure, apply the smallest complete repair, and rerun the affected checks. Otherwise preserve the implemented fix.

- [ ] Execute applicable named checks (DB/browser prerequisites and dedicated-runner rules above apply):

```bash
npm run test:unit -- __tests__/api/source-version-approval.test.ts __tests__/lib/source-pack.test.ts __tests__/components/source-pack-render.test.tsx
REQUIRE_INTEGRATION_TESTS=1 npm run test:integration -- __tests__/integration/client-sources.test.ts
```

- [ ] Complete the linked user case/operation in the required environment; retain normal-session and persistence evidence separately from fixture tests.

- [ ] Record SHA, discovered results and receipts under `artifacts/aiso/T04/`; update the register and acceptance rows. Commit only changed scope. Remaining environment gates keep the task awaiting acceptance.

**Task acceptance:** 未核准v1同內容可核准；重覆核准不增版本；無權限者拒絕；並行版本衝突明確；pointer更新失敗整筆回滾；R07改成期望已核准。

**Rollback:** 向後相容欄位；回退新入口，保留核准審計資料

### T01 — 統一檢查語義與AI平台證據

**Scope:** F01;F03 · B1 · dependencies: none · audit state: 待驗收 · acceptance: AC03;AC30;AC34.

**Files to inspect/reuse:** `lib/checks/llmsFullTxt.ts`, `lib/checks/botAccess.ts`, `lib/checks/robots.ts`, `lib/robots-policy.ts`, `lib/impact.ts`, `lib/types.ts`, `lib/scan-evidence.ts`, `lib/checkExplanations.ts`, `components/result/TopIssueCard.tsx`, `components/result/ResultClient.tsx`, `messages/en.json`, `messages/zh-HK.json`, `__tests__/checks/llms-content-quality.test.ts`.

**Contract:** 沿用check key c6_llms_full_txt與checkLlmsFullTxt(baseUrl, fetcher)呼叫簽名；新版契約明定檢查/llms.txt的內容完整度，展示名改「llms.txt內容完整度（選配）」。新增CollectorAccess DTO {crawler,role:search|training|user_triggered,policy:allowed|blocked|unknown,probe:reachable|unreachable|not_measured}；實際品牌曝光另欄，不由此推導。

- [ ] Inspect the current implementation and matching tests at the selected SHA; compare with the named acceptance scenarios.

- [ ] Verify the behavioral assertion: markdown_links_are_counted：三個Markdown連結的R01 fixture不再得0；純文字URL、混合/重複/相對連結有固定規則。gptbot_block_does_not_block_search：只封GPTBot，OAI搜尋不得被判不可見；沒有consumer觀察時所有曝光結論為未量度。

- [ ] If a gap reproduces, add a failing behavior test, confirm a meaningful failure, apply the smallest complete repair, and rerun the affected checks. Otherwise preserve the implemented fix.

- [ ] Execute applicable named checks (DB/browser prerequisites and dedicated-runner rules above apply):

```bash
npm run test:unit -- __tests__/checks/llms-content-quality.test.ts __tests__/checks/robots-policy.test.ts __tests__/checks/botAccess.test.ts __tests__/checks/scan-compatibility-freeze.test.ts __tests__/components/result-platform-status.test.ts __tests__/lib/impact.test.ts
```

- [ ] Complete the linked user case/operation in the required environment; retain normal-session and persistence evidence separately from fixture tests.

- [ ] Record SHA, discovered results and receipts under `artifacts/aiso/T01/`; update the register and acceptance rows. Commit only changed scope. Remaining environment gates keep the task awaiting acceptance.

**Task acceptance:** fixture驗證llms.txt/llms-full有無與Markdown連結；只封GPTBot不判OAI搜尋不可見；GoogleAIO未量測則顯示未量測；不聲稱llms為排名必要條件；score改動須版本化。

**Rollback:** 獨立commit回退；保留舊score版本

### T02 — 撤下未有依據的行業平均

**Scope:** F02 · B1 · dependencies: none · audit state: 待驗收 · acceptance: AC04.

**Files to inspect/reuse:** `lib/impact.ts`, `components/result/ScoreReveal.tsx`, `messages/en.json`, `messages/zh-HK.json`.

**Contract:** ImpactReport中的benchmark改為可空：benchmark:null在沒有已核實資料集時為唯一正式預設。可驗證benchmark若日後加入必須有source/sampleSize/asOf/methodVersion，不在此任务製造資料。

- [ ] Inspect the current implementation and matching tests at the selected SHA; compare with the named acceptance scenarios.

- [ ] Verify the behavioral assertion: unverified_benchmark_is_hidden：technology掃描不顯示「平均61」與相對平均+12；自身技術分数和明確標示的改善情境估算仍可讀。

- [ ] If a gap reproduces, add a failing behavior test, confirm a meaningful failure, apply the smallest complete repair, and rerun the affected checks. Otherwise preserve the implemented fix.

- [ ] Execute applicable named checks (DB/browser prerequisites and dedicated-runner rules above apply):

```bash
npm run test:unit -- __tests__/lib/impact.test.ts __tests__/components/public-impact-estimate.test.tsx __tests__/sample-report.test.tsx
```

- [ ] Complete the linked user case/operation in the required environment; retain normal-session and persistence evidence separately from fixture tests.

- [ ] Record SHA, discovered results and receipts under `artifacts/aiso/T02/`; update the register and acceptance rows. Commit only changed scope. Remaining environment gates keep the task awaiting acceptance.

**Task acceptance:** en／zh-HK兩語均不把常數稱市場平均；有資料才顯示source/n/date；公開與登入版一致。

**Rollback:** 回退文案commit

### T03 — 以完整證據決定首項改善

**Scope:** F04 · B1 · dependencies: T01 · audit state: 待驗收 · acceptance: AC16;AC30.

**Files to inspect/reuse:** `lib/result-access.ts`, `lib/view-models/owner-priorities.ts`, `components/result/ResultClient.tsx`, `lib/view-models/check-priority.ts`, `__tests__/lib/check-priority.test.ts`.

**Contract:** rankActionableChecks(checks):RankedCheck[]先collection=complete且applicable，再fail>warn，最後穩定check key tie-break；不可行動的unknown/collection-failed另輸出資料不足卡。public結果、owner及T19使用同一resolver。

- [ ] Inspect the current implementation and matching tests at the selected SHA; compare with the named acceptance scenarios.

- [ ] Verify the behavioral assertion: confirmed_failure_precedes_warning：R04 c6 warn/c8 fail選c8。incomplete_check_is_retry_not_fix：較嚴重但採集不完整者不當已證實缺陷；全unknown時只提供重試。

- [ ] If a gap reproduces, add a failing behavior test, confirm a meaningful failure, apply the smallest complete repair, and rerun the affected checks. Otherwise preserve the implemented fix.

- [ ] Execute applicable named checks (DB/browser prerequisites and dedicated-runner rules above apply):

```bash
npm run test:unit -- __tests__/lib/check-priority.test.ts __tests__/lib/result-access.test.ts __tests__/lib/owner-priorities.test.ts __tests__/components/top-issue-card.test.tsx
```

- [ ] Complete the linked user case/operation in the required environment; retain normal-session and persistence evidence separately from fixture tests.

- [ ] Record SHA, discovered results and receipts under `artifacts/aiso/T03/`; update the register and acceptance rows. Commit only changed scope. Remaining environment gates keep the task awaiting acceptance.

**Task acceptance:** c6warn/c8fail選擇符合公開規則；collectionfailed不當已確認fail；全部unknown時提供重試而非確定修復。

**Rollback:** Revert resolver and projection adapters; no stored evidence or historical scores rewritten

### T06 — 避免不合資格客戶餓死排程

**Scope:** F07 · B2 · dependencies: none · audit state: 待驗收 · acceptance: AC05;AC36.

**Files to inspect/reuse:** `lib/pulse/schedule.ts`, `app/api/cron/pulse/route.ts`, `__tests__/api/cron-pulse.test.ts`, `__tests__/lib/pulse-schedule-pagination.test.ts`.

**Contract:** 新增selectPendingClientPage(sql, {limit,after,scanWeek,deadlineMs}): Promise<{items:PendingClient[];nextCursor:CandidateCursor|null;exhausted:boolean;scanned:number}>。CandidateCursor={createdAt:string;clientId:string}。保留既有PendingClient形狀到T05/T07接管；不得把items=[]等同exhausted。

- [ ] Inspect the current implementation and matching tests at the selected SHA; compare with the named acceptance scenarios.

- [ ] Verify the behavioral assertion: expired_oldest_does_not_starve_paid_client：R05的過期override排最前，limit=1仍可找到後面有效付費品牌。連續101個無效候選跨頁後仍找到有效者；到deadline返回exhausted=false及cursor。

- [ ] If a gap reproduces, add a failing behavior test, confirm a meaningful failure, apply the smallest complete repair, and rerun the affected checks. Otherwise preserve the implemented fix.

- [ ] Execute applicable named checks (DB/browser prerequisites and dedicated-runner rules above apply):

```bash
npm run test:unit -- __tests__/lib/pulse-schedule-pagination.test.ts __tests__/api/cron-pulse.test.ts
REQUIRE_INTEGRATION_TESTS=1 npm run test:integration -- __tests__/integration/pulse-summary.test.ts
```

- [ ] Complete the linked user case/operation in the required environment; retain normal-session and persistence evidence separately from fixture tests.

- [ ] Record SHA, discovered results and receipts under `artifacts/aiso/T06/`; update the register and acceptance rows. Commit only changed scope. Remaining environment gates keep the task awaiting acceptance.

**Task acceptance:** 最舊過期override後仍選下一付費品牌；連續多個無效候選不誤判done；無品牌與全完成分開；不複製商業規則。

**Rollback:** 回退selector；不刪任何工作紀錄

### T05 — 建立Pulse固定run與attempt ledger

**Scope:** F06 · B2 · dependencies: none · audit state: 待驗收 · acceptance: AC07;AC24;AC36.

**Files to inspect/reuse:** `app/api/pulse/run/route.ts`, `lib/openrouter.ts`, `lib/pulse/summary.ts`, `lib/pulse/observed-summary.ts`, `lib/pulse/schedule.ts`, `lib/pulse/platforms.ts`, `lib/flags.ts`, `scripts/schema-equivalence/manifest.mjs`, `lib/pulse/runs/schema.ts`, `lib/pulse/runs/store.ts`, `lib/pulse/runs/service.ts`, `supabase/migrations/057_pulse_run_ledger.sql`, `__tests__/lib/pulse-run-ledger.test.ts`, `__tests__/integration/pulse-runs.test.ts`.

**Contract:** 定義PulseRun/PulseRunItem/PulseItemAttempt及RunCoverage（見共享契約C3）。createOrResumeRun(scope,{scanWeek,manifest}):Promise<PulseRun>；claimDueItems(runId,{owner,leaseUntil,limit}):Promise<LeasedItem[]>；commitAttempt(lease,output):Promise<committed|stale-lease|already-recorded>；readRunCoverage(scope,runId):Promise<RunCoverage>。所有HTTP成功/失敗均保留item與attempt證據。

- [ ] Inspect the current implementation and matching tests at the selected SHA; compare with the named acceptance scenarios.

- [ ] Verify the behavioral assertion: three_by_five_has_fifteen_items：3題×5個實際model variants=15；首題全失敗仍有5個failed/retry_wait項，後兩題不被跳過。two_workers_one_item_one_commit：同item同lease只一個被接受。rerun_keeps_success：已成功答案不被delete。late_worker_cannot_overwrite_new_lease：舊lease晚到結果不得覆寫。

- [ ] Include edge cases: lease過期後舊worker晚到及provider成功/DB失敗.

- [ ] If a gap reproduces, add a failing behavior test, confirm a meaningful failure, apply the smallest complete repair, and rerun the affected checks. Otherwise preserve the implemented fix.

- [ ] Execute applicable named checks (DB/browser prerequisites and dedicated-runner rules above apply):

```bash
npm run test:unit -- __tests__/lib/pulse-run-ledger.test.ts __tests__/api/pulse-run.test.ts __tests__/lib/pulse-summary.test.ts
REQUIRE_INTEGRATION_TESTS=1 npm run test:integration -- __tests__/integration/pulse-runs.test.ts __tests__/integration/pulse-summary.test.ts
```

- [ ] Complete the linked user case/operation in the required environment; retain normal-session and persistence evidence separately from fixture tests.

- [ ] Record SHA, discovered results and receipts under `artifacts/aiso/T05/`; update the register and acceptance rows. Commit only changed scope. Remaining environment gates keep the task awaiting acceptance.

**Task acceptance:** 3題×5模型產生15預期項；首題全失敗不漏題；部分成功顯示coverage；雙worker不重複；重試不刪成功答案；修改問題庫不改既有manifest；跨週續跑原run。

**Rollback:** expand-contract migration；停用新writer；保留既有metrics及新attempt審計

### T07 — 持久續跑、隔離失敗及時間預算

**Scope:** F08 · B2 · dependencies: T05;T06 · audit state: 待驗收 · acceptance: AC08;AC24;AC36.

**Files to inspect/reuse:** `app/api/cron/pulse/route.ts`, `app/api/pulse/run/route.ts`, `cloudflare/cron-worker/src/index.ts`, `cloudflare/cron-worker/test/scheduled.test.ts`, `lib/cron/recordRun.ts`, `lib/alerts/evaluate.ts`, `vercel.json`, `docs/runbooks/deploy-cron-worker.md`, `lib/pulse/runs/worker.ts`, `__tests__/lib/pulse-worker.test.ts`.

**Contract:** consumeDuePulseWork({deadlineAt,owner,mode:weekly|repair}):Promise<{outcome:complete|partial|failed|blocked;processed:number;remaining:number;failed:number;runIds:string[]}>。使用T05 lease/attempt，不以HTTP self-call當持久狀態。候選遍歷採T06的exhausted契約。

- [ ] Inspect the current implementation and matching tests at the selected SHA; compare with the named acceptance scenarios.

- [ ] Verify the behavioral assertion: interrupted_after_budget_resumes_original_week：一項slow45s與中途終止留下可恢復checkpoint；隔天repair續同scanWeek。bad_client_does_not_block_next：A錯誤仍處理B。chain_cap_is_partial：cap不能記成完整成功。

- [ ] Include edge cases: lease過期後舊worker晚到及provider成功/DB失敗.

- [ ] If a gap reproduces, add a failing behavior test, confirm a meaningful failure, apply the smallest complete repair, and rerun the affected checks. Otherwise preserve the implemented fix.

- [ ] Execute applicable named checks (DB/browser prerequisites and dedicated-runner rules above apply):

```bash
npm run test:unit -- __tests__/lib/pulse-worker.test.ts __tests__/api/cron-pulse.test.ts __tests__/api/cron/evaluate-alerts.test.ts __tests__/config/function-durations.test.ts
npm --prefix cloudflare/cron-worker run test
npm --prefix cloudflare/cron-worker run typecheck
REQUIRE_INTEGRATION_TESTS=1 npm run test:integration -- __tests__/integration/pulse-runs.test.ts
```

- [ ] Complete the linked user case/operation in the required environment; retain normal-session and persistence evidence separately from fixture tests.

- [ ] Record SHA, discovered results and receipts under `artifacts/aiso/T07/`; update the register and acceptance rows. Commit only changed scope. Remaining environment gates keep the task awaiting acceptance.

**Task acceptance:** slow45s情境在route截止前保存checkpoint；壞client不阻塞其他；self-call丟失可補跑；chaincap標partial；每日repair可續原週；告警不基於不完整分母。

**Rollback:** 停新scheduler；單一consumer；保留queue供回退接續

### T08 — 分類降級顯式化並建立準確度基準

**Scope:** F05 · B2 · dependencies: T05 · audit state: 待驗收 · acceptance: AC09;AC25.

**Files to inspect/reuse:** `lib/pulse/analysis.ts`, `app/api/pulse/run/route.ts`, `lib/pulse/summary.ts`, `lib/pulse/runs/schema.ts`, `lib/pulse/runs/store.ts`, `lib/pulse/analysis-fallback.ts`, `__tests__/lib/pulse-analysis-fallback.test.ts`, `tests/fixtures/pulse-analysis-labelled.json`, `scripts/evaluate-pulse-analysis.ts`.

**Contract:** AnswerAnalysisV2={classificationStatus:classified|fallback|failed|legacy_unknown;method:string;version:string;brandMentioned:boolean|null;sentiment:positive|neutral|negative|unknown;matchedText:string[];competitorsMentioned:string[]}。naiveAnalysis保留可疑字面匹配證據，但不產生肯定情緒；unknown不進提及或情緒已分類分母。

- [ ] Inspect the current implementation and matching tests at the selected SHA; compare with the named acceptance scenarios.

- [ ] Verify the behavioral assertion: fallback_negative_is_unknown：R02負評在classifier失敗時sentiment=unknown，不是positive。pineapple_is_not_apple：R03不認Apple。unicode_brand_match_is_explicit：NFC、全半形、中文連續字及混合語言有固定fixture；無把握回unknown。

- [ ] Include edge cases: Unicode、混合語言及品牌歧義.

- [ ] If a gap reproduces, add a failing behavior test, confirm a meaningful failure, apply the smallest complete repair, and rerun the affected checks. Otherwise preserve the implemented fix.

- [ ] Execute applicable named checks (DB/browser prerequisites and dedicated-runner rules above apply):

```bash
npm run test:unit -- __tests__/lib/pulse-analysis-fallback.test.ts __tests__/lib/pulse-summary.test.ts
```

- [ ] Complete the linked user case/operation in the required environment; retain normal-session and persistence evidence separately from fixture tests.

- [ ] Record SHA, discovered results and receipts under `artifacts/aiso/T08/`; update the register and acceptance rows. Commit only changed scope. Remaining environment gates keep the task awaiting acceptance.

**Task acceptance:** R02負評fallback不是positive；R03不直接認Apple；分類失敗顯示unknown並排除情緒分母；中英標註集公布n、precision/recall與混淆矩陣。

**Rollback:** 可停新分類器；歷史欄位不破壞；保存方法版本

### T09 — 可覆核的觀察詳情及採集定義

**Scope:** F12 · B2 · dependencies: T05;T08 · audit state: 待驗收 · acceptance: AC10.

**Files to inspect/reuse:** `lib/observations/types.ts`, `lib/observations/schema.ts`, `lib/observations/store.ts`, `lib/observations/service.ts`, `components/observations/ObservationWorkspace.tsx`, `messages/en.json`, `messages/zh-HK.json`, `app/api/clients/[clientId]/observations/[observationId]/route.ts`, `components/observations/ObservationDetail.tsx`, `__tests__/api/observation-detail.test.ts`.

**Contract:** GET /api/clients/:clientId/observations/:observationId → {observation:ObservationDetailDto}，含rawAnswer、promptSnapshot、model/collector/market/collectedAt、classification、links[{url,kind:text-link|provider-citation}]及limitations。只讀T05/T08持久欄位；legacy可null。

- [ ] Inspect the current implementation and matching tests at the selected SHA; compare with the named acceptance scenarios.

- [ ] Verify the behavioral assertion: observation_detail_replays_snapshot：改現行題目/模型後，舊觀察detail仍讀原快照。other_tenant_gets_404：A不能讀B原文。text_link_is_not_verified_citation：regex URL不能標provider citation；unsafe URL不成可執行連結。

- [ ] If a gap reproduces, add a failing behavior test, confirm a meaningful failure, apply the smallest complete repair, and rerun the affected checks. Otherwise preserve the implemented fix.

- [ ] Execute applicable named checks (DB/browser prerequisites and dedicated-runner rules above apply):

```bash
npm run test:unit -- __tests__/api/observation-detail.test.ts __tests__/observations/projection.test.ts __tests__/components/observation-render.test.tsx
node scripts/ci/run-exact-target-suites.mjs
npm run e2e -- tests/e2e/c9b-observations.spec.ts --project=chromium
```

- [ ] Complete the linked user case/operation in the required environment; retain normal-session and persistence evidence separately from fixture tests.

- [ ] Record SHA, discovered results and receipts under `artifacts/aiso/T09/`; update the register and acceptance rows. Commit only changed scope. Remaining environment gates keep the task awaiting acceptance.

**Task acceptance:** 授權角色可讀原文與快照；跨租戶不可讀；API sample不寫成consumer rank；文字URL與verified citation分開；舊資料仍明示unknown。

**Rollback:** 新增詳情feature flag；保留舊投影

### T10 — 讓onboarding可恢復及可觀察

**Scope:** F10 · B2 · dependencies: none · audit state: 待驗收 · acceptance: AC06.

**Files to inspect/reuse:** `components/onboarding/OnboardingWizard.tsx`, `app/api/onboarding/complete/route.ts`, `messages/en.json`, `messages/zh-HK.json`, `__tests__/api/onboarding-flow.test.ts`, `lib/onboarding/schema.ts`, `lib/onboarding/store.ts`, `lib/onboarding/service.ts`, `supabase/migrations/056_onboarding_progress.sql`, `__tests__/integration/onboarding-resume.test.ts`, `tests/e2e/onboarding-recovery.spec.ts`.

**Contract:** OnboardingProgress={clientId:string|null;brand:pending|ready;prompts:pending|running|ready|failed;promptCount:number;scanId:string|null;retryable:boolean;errorCode:string|null}。complete/resume使用同一account+intentKey；回應保留原clientId/scanId/trialEndsAt並新增progress。retryOnboardingSeed(scope,clientId):Promise<OnboardingProgress>僅恢復缺失步驟。

- [ ] Inspect the current implementation and matching tests at the selected SHA; compare with the named acceptance scenarios.

- [ ] Verify the behavioral assertion: network_rejection_releases_loading：fetch拒絕與invalid JSON都解除loading且保留輸入。seed_failure_resumes_same_client：第一次brand成功/seed失敗，第二次只補題；expect(clientCount).toBe(1)，trial起訖不變；兩個並行重試不重複24題。

- [ ] If a gap reproduces, add a failing behavior test, confirm a meaningful failure, apply the smallest complete repair, and rerun the affected checks. Otherwise preserve the implemented fix.

- [ ] Execute applicable named checks (DB/browser prerequisites and dedicated-runner rules above apply):

```bash
npm run test:unit -- __tests__/api/onboarding-flow.test.ts __tests__/components/onboarding-wizard-bilingual.test.tsx
REQUIRE_INTEGRATION_TESTS=1 npm run test:integration -- __tests__/integration/onboarding-resume.test.ts
npm run e2e -- tests/e2e/onboarding-recovery.spec.ts --project=chromium
```

- [ ] Complete the linked user case/operation in the required environment; retain normal-session and persistence evidence separately from fixture tests.

- [ ] Record SHA, discovered results and receipts under `artifacts/aiso/T10/`; update the register and acceptance rows. Commit only changed scope. Remaining environment gates keep the task awaiting acceptance.

**Task acceptance:** networkreject/invalidJSON/seedtimeout皆有下一步；草稿保留loading解除；重試同client不重開試用；已建品牌但0題有明確恢復入口。

**Rollback:** 停新resume入口；保留舊成功路徑及step紀錄

### T11 — 正確保存問題語言與市場

**Scope:** F11 · B2 · dependencies: T10 · audit state: 待驗收 · acceptance: AC15.

**Files to inspect/reuse:** `components/pulse/PromptBankEditor.tsx`, `components/onboarding/OnboardingWizard.tsx`, `app/api/onboarding/complete/route.ts`, `app/api/dashboard/clients/[clientId]/prompts/route.ts`, `app/api/dashboard/clients/[clientId]/prompts/[promptId]/route.ts`, `lib/onboarding/service.ts`, `messages/en.json`, `messages/zh-HK.json`, `lib/prompts/context.ts`, `supabase/migrations/059_prompt_context.sql`, `__tests__/lib/prompt-context.test.ts`.

**Contract:** PromptContext={language:en|zh-HK;market:string|null}；parsePromptContext(input,brandDefaults):PromptContext使用repo既有市場值驗證，UI locale僅作初次預設。prompt語言／市場隨T05 manifest快照。舊language值需adapter，不能破壞既有可讀資料。

- [ ] Inspect the current implementation and matching tests at the selected SHA; compare with the named acceptance scenarios.

- [ ] Verify the behavioral assertion: zh_hk_prompt_round_trips_context：中文新增後重讀language=zh-HK、market=香港對應既有enum。seed_payload_contains_context：生成指令有確認語言與市場；非法值拒絕、未分類舊值顯示未知不盲改。

- [ ] If a gap reproduces, add a failing behavior test, confirm a meaningful failure, apply the smallest complete repair, and rerun the affected checks. Otherwise preserve the implemented fix.

- [ ] Execute applicable named checks (DB/browser prerequisites and dedicated-runner rules above apply):

```bash
npm run test:unit -- __tests__/lib/prompt-context.test.ts __tests__/api/prompt-bank.test.ts __tests__/components/onboarding-wizard-bilingual.test.tsx
REQUIRE_INTEGRATION_TESTS=1 npm run test:integration -- __tests__/integration/onboarding-resume.test.ts __tests__/integration/pulse-runs.test.ts
```

- [ ] Complete the linked user case/operation in the required environment; retain normal-session and persistence evidence separately from fixture tests.

- [ ] Record SHA, discovered results and receipts under `artifacts/aiso/T11/`; update the register and acceptance rows. Commit only changed scope. Remaining environment gates keep the task awaiting acceptance.

**Task acceptance:** 繁中與英文新增后重讀標籤正確；市場可確認；server拒絕未知enum；seed包括locale/market；不盲目覆寫舊資料。

**Rollback:** Revert context entrypoints; retain nullable market metadata and immutable run/provider-input history; no historical language rewrite

### T12 — 來源與改善候選分頁及批次維護

**Scope:** F13 · B2 · dependencies: T04 · audit state: 待驗收 · acceptance: AC18;AC23.

**Files to inspect/reuse:** `lib/sources/store.ts`, `lib/sources/schema.ts`, `lib/sources/service.ts`, `lib/view-models/source-pack.ts`, `app/api/clients/[clientId]/sources/route.ts`, `app/[lang]/dashboard/[clientId]/sources/page.tsx`, `components/sources/SourcePackWorkspace.tsx`, `lib/opportunities/store.ts`, `lib/opportunities/service.ts`, `lib/opportunities/types.ts`, `app/api/clients/[clientId]/opportunities/route.ts`, `app/[lang]/dashboard/[clientId]/opportunities/page.tsx`, `components/opportunities/OpportunityWorkspace.tsx`, `lib/observations/query.ts`, `messages/en.json`, `messages/zh-HK.json`, `lib/sources/query.ts`, `lib/sources/import-preview.ts`, `app/api/clients/[clientId]/sources/import-preview/route.ts`, `__tests__/lib/source-pagination.test.ts`, `__tests__/lib/source-import-preview.test.ts`.

**Contract:** SourcePage={items:SourceSummary[];nextCursor:string|null;total:number;asOf:string}；預設50/max100，summary不含entries。詳細沿用readSource。PreviewRows={rows:[{rowNumber,entry|null,errorCode|null,duplicateOf|null}];validCount;invalidCount;contentHash}。preview不持久匯入；正式import仍server重驗並使用expectedLatestVersion。

- [ ] Inspect the current implementation and matching tests at the selected SHA; compare with the named acceptance scenarios.

- [ ] Verify the behavioral assertion: all_201_sources_are_reachable：按游標取得201筆無重複遺漏。all_250_observations_have_candidate_scope：latest週250觀察可翻頁。retry_invalid_csv_rows_preserves_valid_rows：預覽200行含錯誤，重驗失敗行後完整有效集合仍在，最終一次匯入只增一版，不以修正行覆蓋全包。

- [ ] Include edge cases: CSV重試錯誤行保留其餘有效問答.

- [ ] If a gap reproduces, add a failing behavior test, confirm a meaningful failure, apply the smallest complete repair, and rerun the affected checks. Otherwise preserve the implemented fix.

- [ ] Execute applicable named checks (DB/browser prerequisites and dedicated-runner rules above apply):

```bash
npm run test:unit -- __tests__/lib/source-pagination.test.ts __tests__/lib/source-import-preview.test.ts __tests__/opportunities/store.test.ts __tests__/opportunities/service.test.ts __tests__/components/source-pack-render.test.tsx __tests__/components/opportunity-render.test.tsx __tests__/lib/work-item-sources.test.ts
REQUIRE_INTEGRATION_TESTS=1 npm run test:integration -- __tests__/integration/client-sources.test.ts
```

- [ ] Complete the linked user case/operation in the required environment; retain normal-session and persistence evidence separately from fixture tests.

- [ ] Record SHA, discovered results and receipts under `artifacts/aiso/T12/`; update the register and acceptance rows. Commit only changed scope. Remaining environment gates keep the task awaiting acceptance.

**Task acceptance:** 201來源可全到達且總數正確；250觀察候選範圍完整或清晰選擇；混合200列預覽逐筆錯誤；重試只重送失敗列且無重複；明示本頁/全部符合。

**Rollback:** 回退前端入口；游標API向後相容；保留原資料

### T13 — 補齊問題庫可存取控件

**Scope:** F14 · B2 · dependencies: none · audit state: 待驗收 · acceptance: AC14.

**Files to inspect/reuse:** `components/pulse/PromptBankEditor.tsx`, `messages/en.json`, `messages/zh-HK.json`, `tests/e2e/prompt-bank-accessibility.spec.ts`.

**Contract:** 每題toggle具role=switch、aria-checked及包含問題名稱的accessible name；編輯input有顯式label；保存狀態透過status/alert宣讀。

- [ ] Inspect the current implementation and matching tests at the selected SHA; compare with the named acceptance scenarios.

- [ ] Verify the behavioral assertion: keyboard_toggle_announces_question_and_state：鍵盤定位與切換後名稱/checked正確；network failure保留原值及草稿、可重試，focus回到原題。360/390px無遮蔽且觸控區至少44 CSS px。

- [ ] If a gap reproduces, add a failing behavior test, confirm a meaningful failure, apply the smallest complete repair, and rerun the affected checks. Otherwise preserve the implemented fix.

- [ ] Execute applicable named checks (DB/browser prerequisites and dedicated-runner rules above apply):

```bash
npm run test:unit -- __tests__/components/prompt-bank-editor.test.tsx __tests__/components/prompt-bank-network.test.tsx
npm run e2e -- tests/e2e/prompt-bank-accessibility.spec.ts --project=chromium --project=mobile
```

- [ ] Complete the linked user case/operation in the required environment; retain normal-session and persistence evidence separately from fixture tests.

- [ ] Record SHA, discovered results and receipts under `artifacts/aiso/T13/`; update the register and acceptance rows. Commit only changed scope. Remaining environment gates keep the task awaiting acceptance.

**Task acceptance:** 鍵盤可新增編輯取消；每題開關報名稱與狀態；失敗訊息讀出；360/390px無操作遮蔽；不靠顏色傳達。

**Rollback:** 回退CSS/markup commit

### T18 — 補齊網域驗證的首次取得內容流程

**Scope:** F17 · B2 · dependencies: none · audit state: 待驗收 · acceptance: AC11.

**Files to inspect/reuse:** `components/entities/DomainVerificationPanel.tsx`, `lib/domain-verification/service.ts`, `app/[lang]/dashboard/[clientId]/entities/page.tsx`, `messages/en.json`, `messages/zh-HK.json`, `__tests__/components/domain-verification-first-use.test.tsx`.

**Contract:** DomainVerificationPanel增加needs-token/loading-token/ready/checking/error視圖狀態；明確「取得驗證內容」按鈕呼叫現有GET domain-verification。取得內容後才顯示放檔說明及檢查按鈕。POST仍只由檢查動作觸發。

- [ ] Inspect the current implementation and matching tests at the selected SHA; compare with the named acceptance scenarios.

- [ ] Verify the behavioral assertion: new_brand_gets_token_before_probe：token=null時不能先POST檢查；按取得內容後看到path和token。GET失敗顯示可重試，reload不重設既有token；domain變更按既有規則invalidate。

- [ ] If a gap reproduces, add a failing behavior test, confirm a meaningful failure, apply the smallest complete repair, and rerun the affected checks. Otherwise preserve the implemented fix.

- [ ] Execute applicable named checks (DB/browser prerequisites and dedicated-runner rules above apply):

```bash
npm run test:unit -- __tests__/components/domain-verification-first-use.test.tsx __tests__/api/domain-verification.test.ts
REQUIRE_INTEGRATION_TESTS=1 npm run test:integration -- __tests__/integration/domain-verification.test.ts
npm run e2e -- tests/e2e/c9a-entities.spec.ts --project=chromium
```

- [ ] Complete the linked user case/operation in the required environment; retain normal-session and persistence evidence separately from fixture tests.

- [ ] Record SHA, discovered results and receipts under `artifacts/aiso/T18/`; update the register and acceptance rows. Commit only changed scope. Remaining environment gates keep the task awaiting acceptance.

**Task acceptance:** 全新品牌先取得完整內容才顯示檢查步驟；重試沿用token；取得失敗不顯空內容要求上傳；既有已驗證品牌不被重設；仍遵守tenant及domain變更規則。

**Rollback:** 回退前端新入口；保留已發token及驗證審計。

### T19 — 改善建議改為可理解及可行動的內容

**Scope:** F18 · B2 · dependencies: T01;T03 · audit state: 待驗收 · acceptance: AC17.

**Files to inspect/reuse:** `lib/opportunities/rules.ts`, `lib/opportunities/service.ts`, `components/opportunities/OpportunityWorkspace.tsx`, `messages/en.json`, `messages/zh-HK.json`, `lib/checkExplanations.ts`.

**Contract:** 重用現有check explanation/catalogue，新增opportunity title/action映射；排序呼叫T03 rankActionableChecks。raw checkKey仍保留為debug/evidence識別，不作主標。

- [ ] Inspect the current implementation and matching tests at the selected SHA; compare with the named acceptance scenarios.

- [ ] Verify the behavioral assertion: localized_action_describes_check_without_guessing_page：c11呈「檢查常見問題內容」等人可理解標題；origin-only資料不能冒出頁面路徑；c10 warn不能只因字典順序排在c11 fail前。

- [ ] If a gap reproduces, add a failing behavior test, confirm a meaningful failure, apply the smallest complete repair, and rerun the affected checks. Otherwise preserve the implemented fix.

- [ ] Execute applicable named checks (DB/browser prerequisites and dedicated-runner rules above apply):

```bash
npm run test:unit -- __tests__/opportunities/rules.test.ts __tests__/components/opportunity-render.test.tsx __tests__/lib/check-explanations-parity.test.ts
npm run e2e -- tests/e2e/c9c-opportunities.spec.ts --project=chromium
```

- [ ] Complete the linked user case/operation in the required environment; retain normal-session and persistence evidence separately from fixture tests.

- [ ] Record SHA, discovered results and receipts under `artifacts/aiso/T19/`; update the register and acceptance rows. Commit only changed scope. Remaining environment gates keep the task awaiting acceptance.

**Task acceptance:** en／zh-HK兩語卡片主標不用裸checkKey；只按保留證據描述；origin-only不捏造確切頁；c10warn不僅因字典順序凌駕較嚴重項；既有英文草稿快照不強制重寫。

**Rollback:** 回退卡片呈現；保留原始evidence和draft snapshot。

### T20 — 所有草稿入口載入完整清單首頁

**Scope:** F19 · B2 · dependencies: none · audit state: 待驗收 · acceptance: AC12.

**Files to inspect/reuse:** `components/opportunities/OpportunityWorkspace.tsx`, `tests/e2e/opportunity-draft-list.spec.ts`.

**Contract:** 同一ensureDraftListLoaded():Promise<void>供tab click、save成功與open成功使用；listState=idle|loading|loaded|error，selectedId與editor dirty state獨立。游標append按workItem.id去重。

- [ ] Inspect the current implementation and matching tests at the selected SHA; compare with the named acceptance scenarios.

- [ ] Verify the behavioral assertion: saving_b_keeps_existing_a_visible：fixture已有A，save B進drafts，等待後A/B均可見且B選中。list_failure_keeps_editor：list失敗不丟B或未存內容；retry成功恢復清單。

- [ ] If a gap reproduces, add a failing behavior test, confirm a meaningful failure, apply the smallest complete repair, and rerun the affected checks. Otherwise preserve the implemented fix.

- [ ] Execute applicable named checks (DB/browser prerequisites and dedicated-runner rules above apply):

```bash
npm run test:unit -- __tests__/components/opportunity-render.test.tsx
npm run e2e -- tests/e2e/opportunity-draft-list.spec.ts --project=chromium --project=mobile
```

- [ ] Complete the linked user case/operation in the required environment; retain normal-session and persistence evidence separately from fixture tests.

- [ ] Record SHA, discovered results and receipts under `artifacts/aiso/T20/`; update the register and acceptance rows. Commit only changed scope. Remaining environment gates keep the task awaiting acceptance.

**Task acceptance:** 已有A草稿時由suggestion保存B，即顯示A/B或明確loading；open同樣載入首頁；列表失敗可重試；不丟尚未儲存編輯；cursor append去重；重整後選中B。

**Rollback:** 回退單一前端commit，不更改已儲存草稿資料。

### T15 — 建立每日工作摘要與工具下一步

**Scope:** F12;F13;F16 · B2 · dependencies: T07;T09;T12 · audit state: 待驗收 · acceptance: AC19;AC36.

**Files to inspect/reuse:** `lib/view-models/workspace-home.ts`, `lib/view-models/owner-priorities.ts`, `components/dashboard/WorkspaceHome.tsx`, `components/observations/ObservationWorkspace.tsx`, `components/opportunities/OpportunityWorkspace.tsx`, `components/sources/SourcePackWorkspace.tsx`, `messages/en.json`, `messages/zh-HK.json`.

**Contract:** DailyWorkSummary={coverage:RunCoverage|null;lastCompleteAt:string|null;nextDueAt:string|null;state:not_configured|pending|partial|complete|failed|disabled|unknown;nextActions:Action[]}，nextActions最多3項。從既有persisted run/source/work-item狀態derive，不增第二套狀態真相。

- [ ] Inspect the current implementation and matching tests at the selected SHA; compare with the named acceptance scenarios.

- [ ] Verify the behavioral assertion: partial_run_guides_to_failed_items：缺2/15項時首頁顯partial而非100%；可進失敗篩選。unapproved_source_links_to_exact_version：待核准工作到正確來源版本。free_empty_is_not_scheduler_failure：Free0觀察不展示錯誤漏跑結論。

- [ ] If a gap reproduces, add a failing behavior test, confirm a meaningful failure, apply the smallest complete repair, and rerun the affected checks. Otherwise preserve the implemented fix.

- [ ] Execute applicable named checks (DB/browser prerequisites and dedicated-runner rules above apply):

```bash
npm run test:unit -- __tests__/lib/workspace-home.test.ts __tests__/components/workspace-home-priorities.test.tsx
npm run e2e -- tests/e2e/c8a-workspace-home.spec.ts --project=chromium --project=mobile
```

- [ ] Complete the linked user case/operation in the required environment; retain normal-session and persistence evidence separately from fixture tests.

- [ ] Record SHA, discovered results and receipts under `artifacts/aiso/T15/`; update the register and acceptance rows. Commit only changed scope. Remaining environment gates keep the task awaiting acceptance.

**Task acceptance:** 首頁可辨資料是否新鮮及未完成原因；從失敗觀察到機會到草稿可追溯；來源顯示核准/可用/撤回；別名目前不影響觀察須保持明示；不暗示自動發布。

**Rollback:** 獨立UIflag回退；不更動狀態語义

## Suggested execution order and effort

1. B0 and T22 targeted validation first: stabilize access and establish evidence.
2. T21 and T23 as separate focused commits; they are independently implementable offline. Rough effort 1.5–3 engineering days combined, excluding environment setup and review.
3. Finish T00 readback and T16 role/large-data journeys while validating existing T01–T20. Access and real session timing dominate uncertainty; do not promise a release date from unit counts.
4. T17 preview/release package, followed by separately authorized rollout and live verification. Allow an actual scheduling window; a forced dry run does not prove the scheduler fired.

## Handoff and self-review

- [ ] All 22 findings map to the 24 original task IDs; original AC01–AC26 remain intact and AC27–AC36 add new regression/runtime acceptance.
- [ ] T21/T23 changes are focused, bilingual and evidence-aware; T22 is validated on normal Auth boundaries, not only mocked sessions.
- [ ] Old scanner registries remain readable; partial c18 cannot create confirmed content failure or fabricated measurement.
- [ ] Default and excluded DB suites are both discovered; local/isolated/preview/production results have separate fields.
- [ ] Migration 054–059 state, actual Worker target/schedules, app-bound DB and runtime role are verified before rollout; rollback preserves history and disables incompatible producers.
- [ ] Final handoff reports exact pending gates. No production completion is inferred from this plan or historical green CI.

Use `AISO-Codex-kickoff-prompt-2026-10-07.txt` as the first Codex instruction and attach the complete implementation pack. The package includes the exact immutable October 7 evidence archive, so the executor does not need the earlier conversation to understand the findings.
