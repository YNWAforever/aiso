# 04 — Acceptance matrix

AC-01 … AC-15 from the implementation plan, against this branch on **2026-09-10**.

`PASS / FAIL / PARTIAL / BLOCKED / DEFERRED` describes what was **executed**. It is a
different axis from `Verified / Inferred / Blocked`, which describes how strong the
evidence is. The two are not mixed.

Nothing here claims a capability that was not exercised. A `BLOCKED` row is blocked
because a dependency is genuinely missing, and §3 names each one.

## 1. Commands this matrix rests on

Run in the worktree at commit `2be46c2`:

| Command | Exit | Totals |
|---|---|---|
| `npm run typecheck` | 0 | — |
| `npm run lint` | 0 | 0 errors, 0 warnings |
| `npm run test:unit` | 0 | **289 files / 3901 tests passed, 0 skipped** |

Baseline for comparison, at `5bb2dcc`: 284 files / 3714 tests.

**Not run:** the integration project and Playwright E2E. Both are BLOCKED — see §3.
A skip is not a pass, and `scripts/run-tests.mjs` prints a banner saying so.

## 2. The matrix

| AC | Behaviour that must be proven | Status | Evidence / limitation |
|---|---|---|---|
| **AC-01** | New owner gets a real baseline and understands three priorities | **PARTIAL** | Scan → result → claim is real and unit-tested. Home now leads with **at most three priorities and one named next action** (`lib/view-models/owner-priorities.ts`, rendered by `components/dashboard/WorkspaceHome.tsx`), ranked by points still at stake and derived from the evidence envelope so an unobservable check never becomes work to do; 30 tests across `__tests__/lib/owner-priorities.test.ts` and `__tests__/components/workspace-home-priorities.test.tsx`. **Still partial:** onboarding is orphaned (nothing links to `/[lang]/onboarding`), so the end-to-end first-run journey is not yet reachable, and it has not been exercised against a database. |
| **AC-02** | An unknown URL never receives another company's demo findings | **PASS** | `app/api/scan/route.ts` never imports `lib/e2e-fixtures.ts`; both fixture consumers are double-gated on `E2E_FIXTURE_MODE === '1'` **and** an exact scan id. Covered by `__tests__/api/scan-security.test.ts` (17 tests). Data mode is carried per check by `lib/scan-evidence.ts` `CollectionState`. |
| **AC-03** | Identity / claim / ownership is controlled | **PARTIAL** | **Fixed this session:** an absent intent cookie bypassed verification entirely on `/api/scans/[id]/claim`, and `/api/onboarding/complete` never checked it at all. Both now deny. Negative tests: anonymous, absent cookie, tampered, expired, mismatched return path, retargeted token, and both onboarding cases — `__tests__/api/scan-claim.test.ts` (14), `__tests__/api/onboarding-flow.test.ts` (27). **Still missing:** single-use replay consumption (`attemptId` is signed but never persisted) and domain-ownership verification — no `unverified` asset state exists outside a literal in `lib/entities/schema.ts`. |
| **AC-04** | Import / connect, coverage, sync and revoke are real | **BLOCKED** | There is no source-import surface at all to test. `client_entities` carries `display_name` + `aliases` only. Package C is a build, not a fix. |
| **AC-05** | Evidence retains source, time, scope, method and state | **PASS** | `lib/scan-evidence.ts` stores `collection`, `applicability`, `assessment`, per-check `CHECK_VERSIONS`, `collectedAt`, `comparison` + `comparisonSignature`, and an explicit `limitations` array. An immutable snapshot is copied onto the work version (`evidence_snapshot` + `evidence_fingerprint`, migration 041). Covered by `__tests__/lib/scan-evidence.test.ts`. |
| **AC-06** | A website finding and a question opportunity reach the same asset and task | **DEFERRED** | Phase 3 per the plan. `lib/opportunities/fingerprint.ts` already dedupes by canonical target, so the seam exists. Not exercised. |
| **AC-07** | An agent may draft but may not approve or publish | **PARTIAL** | Structurally strong: `work_item_decisions.actor->>'role'` must be `account_approver`, bound by composite FK to a live `account_approver_events` grant, and the app role holds no UPDATE/DELETE on the table. **But** the minimum agent-safety evaluation the plan requires *before pilot drafting ships* has no tests — see §4. |
| **AC-08** | Where separation is required, an editor cannot approve their own version | **PARTIAL** | What is enforced is *submitter* cannot approve (`lib/approvals/decision-store.ts` compares `submitter->>'profileId'`). A second editor who did not submit **can** approve. A single-owner policy is not distinguished from a two-person policy. |
| **AC-09** | The exact approved version is exported, with actor, time and result retained | **PARTIAL** | Export renders from the exact approved version and refuses an unapproved one (`lib/delivery/export.ts` → `DELIVERY_NOT_APPROVED`), returning the artifact digest as `X-Aiso-Export-Sha256`. **Gap:** that artifact hash is computed and returned but never persisted, and no row records that an export happened — so the approved-payload hash and the rendered-artifact hash are not both retained, as the brief requires. |
| **AC-10** | Recheck uses the same scope and method; incompatible means no improvement claim | **PARTIAL** | `compareScanChecks()` now produces the brief's vocabulary — `comparison_status` ∈ comparable / partially_comparable / not_comparable / insufficient_evidence and per-check `outcome` ∈ improved / unchanged / regressed / cannot_determine (`lib/scan-evidence.ts`, 16 tests in `__tests__/lib/scan-check-comparison.test.ts`). Comparability is decided by method, target and configuration; **content hashes are never compared**, since page content is expected to change. Page identity is proven without storing a path, by requiring both runs' `final` descriptor to have redacted nothing. A differing method refuses outright; an incomplete collection withholds every delta. Baselines remain immutable. **Still partial:** the adapter is not yet wired into `lib/outcomes/evaluate.ts`, whose self-validating DTO needs five coordinated changes plus localised copy, and nothing yet re-runs a scan after delivery. |
| **AC-11** | Technical, search/AI and business outcomes stay separate | **PARTIAL** | Separate inside `lib/outcomes` — a technical verdict cannot populate a business one, because no verdict exists at all. Outside it, `lib/localTrust/roi.ts` presents a computed ROI baseline to owners; that is the layer-mixing risk to close before any commercial claim. |
| **AC-12** | No cross-account read, mutation, inference or export | **PARTIAL** | Strong at the schema level: composite FKs make a cross-account reference rejectable by Postgres, and there is no RLS backstop by design. **But** those constraints are proven against SQL *text* in this session; the two-account integration suites did not run. There is also no route-inventory test that fails when a new handler ships with no gate. |
| **AC-13** | A disconnected or failing provider recovers honestly | **PASS (for what exists)** | `lib/delivery/service.ts` maps dependency failure to 503 and never a silent 200; `db()` throws, so a failed write cannot return 2xx; checks degrade to domain-specific messages with a `collection` diagnostic rather than a zero. Covered across `__tests__/delivery/**` and `__tests__/checks/**`. No external provider connector exists to disconnect. |
| **AC-14** | Mobile review, approve and request-changes | **BLOCKED** | A Pixel-5 Playwright project exists and resolves tests since 2026-09-03 (`__tests__/config/playwright-projects.test.ts` fails a project resolving to zero), but E2E was not run this session — no database. |
| **AC-15** | English and Traditional Chinese are equivalent in meaning, state and action | **PARTIAL** | For the Home priorities surface this is now asserted: `__tests__/components/workspace-home-priorities.test.tsx` renders every state in both languages, requires the two catalogues to declare identical keys, and requires the same state to produce *different* strings — so a missing translation silently falling back to English fails. **Still partial:** only this surface is covered; no bilingual walkthrough of the whole owner journey was executed, and no repo-wide key-parity assertion exists. |

### Tally

| Status | Count | Rows |
|---|---|---|
| PASS | 3 | AC-02, AC-05, AC-13 |
| PARTIAL | 9 | AC-01, AC-03, AC-07, AC-08, AC-09, AC-10, AC-11, AC-12, AC-15 |
| BLOCKED | 2 | AC-04, AC-14 |
| DEFERRED | 1 | AC-06 |
| FAIL | 0 | — |

Four rows moved this session: AC-03 (claim hole closed), AC-01 (priorities
surface built), AC-10 (comparison adapter built), AC-15 (bilingual equivalence
asserted for that surface). AC-15 moved from BLOCKED to PARTIAL.

**No row is marked PASS on the strength of a build succeeding.** A green build proves
neither runtime, provider nor database readiness.

## 3. Why the BLOCKED rows are blocked

1. **Migrations 040–043 are not applied** to the AISO development database.
   `npm run migrate -- --verify` reports `MISSING` for all seven tables of the owner
   loop. Applying them is a single additive `npm run migrate`; it was attempted and
   **denied by the permission classifier**, so it needs the user's approval. Until
   then no owner journey can be exercised end to end, which is what makes AC-04 and
   AC-14 unrunnable rather than merely unrun.
2. **The integration project did not run.** `neonctl` 4.13.0 is installed and
   authenticated but prompts interactively for an organisation.
   `REQUIRE_INTEGRATION_TESTS=1 npm test` is the command that proves the full suite
   ran; it needs `NEON_API_KEY` exported, or an interactive shell.

## 4. Minimum agent-safety evaluation — not yet met

The plan is explicit that this must not be deferred to Phase 2. It is not met:

| Requirement | Status |
|---|---|
| Draft traceable to permitted sources | **absent** — no LLM path constrains output to approved sources or attaches source ids |
| Abstain when evidence is missing | **partial** — `lib/checks/factualDensity.ts` emits a machine-readable `collection: 'partial'` diagnostic, but no drafting path tells the owner "insufficient evidence" |
| Malicious source cannot change tool authority | **untested** — no prompt-injection test exists anywhere in the repo, and `lib/checks/factualDensity.ts` concatenates fetched page text into a prompt with no fencing |
| Cross-tenant reference and approve/publish tool calls denied | **structurally enforced, untested at the prompt layer** — there is no tool-calling surface today; these are plain completions |
| Bounded budget | **absent** — no per-account, per-task or per-cost cap on any LLM route |

This gates pilot drafting, not the whole release.
