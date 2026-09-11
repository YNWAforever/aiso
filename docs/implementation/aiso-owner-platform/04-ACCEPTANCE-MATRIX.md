# 04 — Acceptance matrix

AC-01 … AC-15 from the implementation plan, against this branch on **2026-09-10**.

`PASS / FAIL / PARTIAL / BLOCKED / DEFERRED` describes what was **executed**. It is a
different axis from `Verified / Inferred / Blocked`, which describes how strong the
evidence is. The two are not mixed.

Nothing here claims a capability that was not exercised. A `BLOCKED` row is blocked
because a dependency is genuinely missing, and §3 names each one.

## 1. Commands this matrix rests on

Run in the worktree on branch `claude/aiso-source-surface`:

| Command | Exit | Totals |
|---|---|---|
| `npm run typecheck` | 0 | — |
| `npm run lint` | 0 | 0 errors, 0 warnings |
| `npm run test:unit` | 0 | **299 files / 4160 tests passed, 0 skipped** |
| `npm test` | 0 | unit as above, **plus the integration project: 11 files / 92 tests passed** against a disposable Neon branch, which was provisioned, migrated through all 44 files and deleted. No skip banner was printed, so integration genuinely ran. |
| `node scripts/ci/run-exact-target-suites.mjs` (see §5) | 0 | **5 files / 117 tests passed** in 105s, on a disposable branch the wrapper provisions and destroys itself. Now also run by the `integration` CI job. |
| CI `PR gate` on pull request #21 | success | all 10 jobs green: `static`, `unit-contract`, `integration`, `e2e-accessibility` ×4 shards, `build`, `cloudflare-worker`, and the aggregating `pr-gate` |

Baseline for comparison, at `5bb2dcc`: 284 files / 3714 tests.

**Read the E2E result narrowly.** The `e2e-accessibility` job runs `npm run e2e`
unfiltered, so every Playwright project including Pixel-5 `mobile` does execute — but
it runs with `E2E_FIXTURE_MODE: 1` and a fixture DSN
(`postgresql://fixture:fixture@127.0.0.1:5432/fixture`). Under that flag
`getProfile()` returns `null`, so every authenticated route denies. What is green is
the public surface and the rendered component fixtures, **not** an authenticated
owner journey against a database. **CI therefore still proves nothing about AC-14** — what changed on 2026-09-11 is that the journey was run elsewhere: on a developer machine, against the real database, with a session captured by hand. The `authenticated-mobile` project exists only where that capture does, which is deliberately never CI.

## 2. The matrix

| AC | Behaviour that must be proven | Status | Evidence / limitation |
|---|---|---|---|
| **AC-01** | New owner gets a real baseline and understands three priorities | **PARTIAL** | Scan → result → claim is real and unit-tested. Home now leads with **at most three priorities and one named next action** (`lib/view-models/owner-priorities.ts`, rendered by `components/dashboard/WorkspaceHome.tsx`), ranked by points still at stake and derived from the evidence envelope so an unobservable check never becomes work to do; 30 tests across `__tests__/lib/owner-priorities.test.ts` and `__tests__/components/workspace-home-priorities.test.tsx`. **Still partial:** onboarding is orphaned (nothing links to `/[lang]/onboarding`), so the end-to-end first-run journey is not yet reachable, and it has not been exercised against a database. |
| **AC-02** | An unknown URL never receives another company's demo findings | **PASS** | `app/api/scan/route.ts` never imports `lib/e2e-fixtures.ts`; both fixture consumers are double-gated on `E2E_FIXTURE_MODE === '1'` **and** an exact scan id. Covered by `__tests__/api/scan-security.test.ts` (17 tests). Data mode is carried per check by `lib/scan-evidence.ts` `CollectionState`. |
| **AC-03** | Identity / claim / ownership is controlled | **PARTIAL** | **Fixed this session:** an absent intent cookie bypassed verification entirely on `/api/scans/[id]/claim`, and `/api/onboarding/complete` never checked it at all. Both now deny. Negative tests: anonymous, absent cookie, tampered, expired, mismatched return path, retargeted token, and both onboarding cases — `__tests__/api/scan-claim.test.ts` (14), `__tests__/api/onboarding-flow.test.ts` (27). **Still missing:** single-use replay consumption (`attemptId` is signed but never persisted) and domain-ownership verification — no `unverified` asset state exists outside a literal in `lib/entities/schema.ts`. |
| **AC-04** | Import / connect, coverage, sync and revoke are real | **PASS (for import; connect is not implemented)** | Migration 044 adds `client_sources` (mutable identity and policy) and append-only `client_source_versions`, with composite-FK tenancy, provenance (`import_method`, `origin_ref`, `imported_by/at`), approval (`approved_by/at`), a SHA-256 content hash, derived freshness, and revocation as a state rather than a delete so a draft that cited a source stays explainable. `agent_use_allowed` defaults to **false**, and `listAgentUsableSources` is the single server-side gate — allowed, not revoked, and actually approved. CSV and paste ingest treat content as data: formula injection is defused by preserving the value behind an apostrophe, and content is NFC-normalised before hashing. **The owner surface now exists** at `/{lang}/dashboard/{clientId}/sources`, linked from the sidebar: `lib/view-models/source-pack.ts` derives one honest answer per source — in use / not approved / agent use off / revoked — from the *same three conditions the SQL gate applies*, and `__tests__/integration/client-sources.test.ts` pins the agreement on real Postgres by asserting the projection’s in-use set equals what `listAgentUsableSources` returns. The case that drove the design is an owner switching agent use on over an unapproved version: the switch changes nothing, and the screen says so rather than showing it as ready. **Import is stated as an import, not a connection** — the page says in both languages that each version is a copy of the text as it stood on the import day and nothing re-reads the origin, so there is no sync that can fall behind; `originRef` is labelled a note that is never fetched. Freshness is shown as an age and explicitly does **not** gate use, because the SQL gate ignores it — a stale pack is still being quoted, and presenting age as an exclusion would invert the risk. 29 schema unit tests + 19 view-model + 29 render + 19 integration. **Corrected by migration 046:** 044 declared `revoked_by` and `approved_by` as profile foreign keys with `on delete set null`, while a CHECK on each table required the actor and its timestamp to be null together — the referential action performed exactly the write the CHECK forbade, so deleting the referenced profile failed on a constraint naming no profile. It was present twice, and the append-only `client_source_versions` half was masked by constraint-creation order. 046 drops those two FKs and relaxes **neither** CHECK: a decision stays indivisible on write and the recorded uuid becomes a frozen identity, which is the rule 042 and 043 already state in their headers. `created_by`/`imported_by` keep their FK and their working `set null`, because provenance is erasable and a decision is not; the integration test pins both halves, so an over-broad fix dropping all four FKs would fail it. **Remaining limitation, by design:** there is still no live *connection* to any external system, so sync is not implemented rather than partly implemented, and nothing in the product claims otherwise. |
| **AC-05** | Evidence retains source, time, scope, method and state | **PASS** | `lib/scan-evidence.ts` stores `collection`, `applicability`, `assessment`, per-check `CHECK_VERSIONS`, `collectedAt`, `comparison` + `comparisonSignature`, and an explicit `limitations` array. An immutable snapshot is copied onto the work version (`evidence_snapshot` + `evidence_fingerprint`, migration 041). Covered by `__tests__/lib/scan-evidence.test.ts`. |
| **AC-06** | A website finding and a question opportunity reach the same asset and task | **DEFERRED** | Phase 3 per the plan, and the status is right — but **the reason this row gave until 2026-09-11 was false, and the row was its own only evidence.** It claimed `lib/opportunities/fingerprint.ts` "already dedupes by canonical target, so the seam exists". Three things are wrong with that. `opportunityKey` (`fingerprint.ts:200-202`) returns `${ruleVersion}:${source.kind}:${source.id}:${source.checkKey ?? ''}` — keyed by **source**, never by target; `canonicalize` in that file is deterministic JSON serialisation (key ordering, `-0`, cycles), a different sense of the word; and nothing in the file dedupes at all — `fingerprintEvidence` hashes, and every consumer (`work-items/service.ts`, `change-sets/*`, `delivery/export.ts`) uses the result as a staleness or integrity witness. A repo-wide grep for `canonical target|assetKey|targetKey|asset_key|target_key` returned exactly one hit: this row. **The real blockers, both structural.** *Asset:* there is no page-level target on either side to join on. A scan finding keeps `url.origin` and reduces path, query and fragment to booleans under `URL_REDACTION_VERSION = 'origin-only.v1'` (`lib/scan-evidence.ts`), so it names a **site, never a page**; a Pulse observation (`lib/observations/types.ts`) carries no url, page or citation field at all, and the pulse rule's args are exactly `{question, platform}`. There is also no "asset" in this schema — `grep -rni asset supabase/migrations/*.sql` returns nothing, and `client_entities` (`040`) is a brand `display_name` + `aliases` with no URL. *Task:* `evidence_work_items` is single-source by constraint — `evidence_work_items_rule_source_check` (`041:36-40`) binds `source_kind` to `rule_version` on the one row, and the only uniqueness is `unique (account_id, client_id, opportunity_key)` (`041:46`) over a source-derived key. **Do not "fix" this by making the two keys collide:** `saveAuthenticatedDraft` (`lib/work-items/service.ts`) returns the existing draft by that key *before* it loads or validates the second source, so the second finding's evidence snapshot is never built and the row would describe one source while claiming to represent two — the provenance lie migrations `041`–`046` exist to prevent. `__tests__/opportunities/ac-06-convergence.test.ts` (5 tests) pins the disjoint keyspaces, the single-source CHECK and the absence of any asset column, so this row cannot drift back into claiming a seam that is not there. **One asset signal the product already observes and nothing reads:** `ai_citation_log` (`012:51-63`) records `cited_url` and `cited_domain` for every URL a Pulse answer cited. It is write-only today — `app/api/pulse/run/route.ts` inserts, and no module in `lib/` or `app/` selects from it — and it cannot be joined to a metric anyway: it carries no `prompt_id`, no `scan_week`, and its `platform` CHECK uses a different vocabulary from `pulse_metrics.platform`. That is the nearest real starting point, and it is a Phase 3 change: a migration plus a decision nobody has made about which page answers a question. **What AC-06 is waiting on is that decision, not wiring.** |
| **AC-07** | An agent may draft but may not approve or publish | **PASS (for the minimum evaluation)** | The minimum agent-safety evaluation now exists — see §4. Two live prompt-injection sites were fenced, and the four required properties are asserted against the real code: injection resistance including the fence-escape attempt, forbidden-tool denial, cross-tenant denial and abstention. **Bounded budget remains absent** and is asserted as absent, so the gap fails loudly the day it changes. |
| **AC-08** | Where separation is required, an editor cannot approve their own version | **PASS** | Fixed in this session. The guard compared only `v.submitter->>'profileId'`, so a second editor who wrote the item but did not submit that version could approve it. The `owned` CTE now also selects `created_by`/`updated_by` and a `separated` CTE requires the approver to be neither — applied both in the INSERT and in the reported outcome, so a denial reports as a denial. A pure tightening: a single-owner account already could not approve, because the submitter check has always been absolute. Proven against real Postgres: both authorship columns denied, the ordinary two-person path still succeeds, no decision row written on denial. **Recorded limitation:** an explicit single-owner policy is deliberately not implemented; it needs a column on an append-only table so a solo sign-off is never presented as two-person review. |
| **AC-09** | The exact approved version is exported, with actor, time and result retained | **PASS** | Completed in this session. Export already refused an unapproved version; migration 045 now records an append-only receipt keeping **both** hashes separately — `content_hash` (the approved payload) and `artifact_hash` (the rendered canonical envelope) — with `format`, `renderer_version`, the downloading actor and the time. A composite FK binds the version *and* its payload hash, so a receipt cannot name a version whose content differs from what left. The receipt is written **before** the bytes are released and a failure fails the export (409 on zero rows, 503 on error). The receipt records the **downloader**, not the submitter. |
| **AC-10** | Recheck uses the same scope and method; incompatible means no improvement claim | **PASS (for the technical layer)** | The adapter is built *and wired*. `compareOutcome` (`lib/outcomes/evaluate.ts`) attaches a `comparison` to every window: `status` ∈ comparable / partially_comparable / not_comparable / insufficient_evidence, `outcome` ∈ improved / unchanged / regressed / not_yet_observed / cannot_determine, plus both verdicts. `evidenceState` reaches `available` for the first time. Admissibility is decided by method, target and configuration; **content is never compared**, since a page's content is expected to differ between a baseline and a recheck. A different method or subject refuses outright; an untrustworthy side is `insufficient_evidence` — "never" and "not yet" render differently. Pulse gets no adapter deliberately, because `success`/`incomplete` describe whether the observation completed, not whether it went well. `parseOutcomeResponse` re-derives and compares the field, so a client cannot forge `improved` over fail→fail nor upgrade `partially_comparable` to `comparable`; both forgeries are tested. 67 tests across `__tests__/outcomes/compare-outcome.test.ts`, `evaluate.test.ts` and `dto.test.ts`. **Remaining limitation, by design:** a scan-check baseline is a single frozen check rather than a whole envelope, so it carries `final-path-identity-withheld` and lands on `partially_comparable`; reaching `comparable` needs the snapshot to record its target identity, which is a separate change to a frozen contract. Nothing re-runs a scan automatically yet. |
| **AC-11** | Technical, search/AI and business outcomes stay separate | **PARTIAL** | `lib/outcomes` is clean: a technical verdict cannot populate a business one, because no business concept exists in that module — and none was added here either. The layer-mixing this row named lived in `lib/localTrust/roi.ts`, and it took two passes. **Pass one — labelling, zero behaviour change:** proof language retired from seven keys in **both** catalogues (`roi_timeline` became "Enquiry value scenario" / 「查詢價值情境」), a basis line and a limitation line rendered in the **same block** as the number so it cannot be screenshotted apart from what qualifies it, and the CSV — which had emitted a bare `Estimated Value Low,1600` with no currency and no basis — made to carry both. **Pass two, this session: the fabricated baseline is gone.** `previousScore ?? Math.max(0, score - 5)` was the defect underneath the framing — no caller ever supplied the left side, so the delta was always 5 and the enquiry range was `[1, 2]` for *every* score from 1 to 100; a client scoring 3 and one scoring 97 saw the identical amount. `previous` is now a **required, nullable** field on both `EstimateRoiInput` and `LocalTrustInput`, so omitting it is a type error rather than a plausible-looking number. `getPreviousLocalTrustBaseline` reads the newest `local_trust_snapshots` row strictly before the month being written, scoped by `client_id` **and** `account_id` (migration 036 left no database-level tenancy backstop), and coerces `local_trust_score` — a `numeric` column the driver returns as a **string**, where `50 - '45.00'` would have gone on producing a plausible figure with only `assumptions.previousScore` carrying the tell. **The consequences were accepted, not worked around:** a first month, and a month whose score held still or fell, now correctly show no figure — and each of the three refusals reaches a *different* sentence in both languages. Printing "Add average lead value and close rate" at an owner who had entered both was the lie the single null used to tell. `roi_estimate` is a column and the reason it is absent is not, so `localTrustRoiScenario` produces both from one function and a test pins that the stored figure and the explanation cannot disagree; likewise the snapshot month must be resolved before the baseline can be looked up, so `resolveSnapshotMonth` is shared by the lookup and the draft rather than derived twice, with their agreement asserted. Covered by `__tests__/lib/roi-scenario.test.ts` (rewritten — the old file deliberately pinned the `[1, 2]` constant so that removing it could not be silent), `__tests__/lib/local-trust-baseline.test.ts` (new, including the string-coercion and tenancy cases), and extended component and export suites. **Still PARTIAL, and this is the part testing cannot close:** the money now genuinely tracks the technical score, which is a *stronger* coupling than the constant it replaced, not a weaker one. Nothing here measures how many trust points produce an enquiry — the `/10` and `/4` conversion is an invention, and every consumer of `local_trust_snapshots` is inside `lib/localTrust`. What changed is that the invention is now named in `assumptions`, printed to the owner beside the figure ("Turning points into enquiries … is an assumption AISO has not measured"), carried into the CSV as its own rows, and pinned by test so tuning it is a visible edit. **That is disclosure, not separation.** The row reaches PASS when a business outcome is observed rather than modelled; until then a labelled scenario is the honest ceiling, and calling it separation because it is well labelled would be the same error in a new place. |
| **AC-12** | No cross-account read, mutation, inference or export | **PARTIAL** | Proven against **real Postgres**, not SQL text: the five owner-loop suites exercise the composite-FK tenancy chain, the append-only GRANT posture, and the app role's inability to UPDATE or DELETE version, decision and delivery history. **Changed this session:** they now run **in the release gate**. `scripts/ci/run-exact-target-suites.mjs` provisions one disposable branch through the single audited path, derives every `C9*` value from that branch and from nothing else, runs all five configs, and deletes the branch in a `finally`. The existing `integration` job invokes it inside its own step, before the summary is written — a later step would have let `write-job-summary` record success before the wrapper had run. Measured, not estimated: **5/5 suites, 117 tests, exit 0, 105s** including branch create, all 46 migrations and teardown, against that job's 30-minute budget. Eleven assertions in `__tests__/ci/exact-target-suites.test.ts` stop it drifting back out (§5), and `scripts/ci/count-vitest-reports.mjs` replaces the hardcoded `--executed 1 --skipped 0` the summary used to publish. `__tests__/api/route-gate-inventory.test.ts` separately fails when a handler ships with no gate. **Still partial:** the cross-account proofs cover the owner-loop tables, not every table, and nothing yet proves the negative for the older feature stores. |
| **AC-13** | A disconnected or failing provider recovers honestly | **PASS (for what exists)** | `lib/delivery/service.ts` maps dependency failure to 503 and never a silent 200; `db()` throws, so a failed write cannot return 2xx; checks degrade to domain-specific messages with a `collection` diagnostic rather than a zero. Covered across `__tests__/delivery/**` and `__tests__/checks/**`. No external provider connector exists to disconnect. |
| **AC-14** | Mobile review, approve and request-changes | **PARTIAL** | **No longer BLOCKED: the journey ran, on 2026-09-11, and all three tests pass.** `tests/e2e/authenticated/owner-review.spec.ts` executed against a real Neon database, real route handlers and a session a human captured once — not fixture HTML — under the `authenticated-mobile` Pixel-5 project: `3 passed (19.5s)`. That is the first time anything behind `requireAuth` has been exercised by this suite. **Four things had to be fixed before it could run at all, none of them found by CI:** (1) `profiles` was empty, so `getProfile()` returned null for a user who had signed in perfectly well and every gated page bounced back to `/auth/login` — Neon Auth delivers `user.created` to a public URL and cannot reach localhost, so the row was provisioned by replaying the payload to `webhooks/neon` rather than by hand. (2) The account resolved to `free` despite `plan='basic'`: `resolveCommercialEntitlement` requires a subscription or a live trial, so `POST /api/scan` answered `403 AUTHENTICATED_SCAN_UPGRADE_REQUIRED` — **worth knowing on its own, because it means a freshly provisioned owner cannot scan until onboarding starts their trial.** (3) Playwright walked into a sibling worktree and loaded a second `@playwright/test` (fixed in #38). (4) The touch-target sweep failed on a 32px control that turned out to be Next.js's own dev-tools button, which exists on every run this journey can have and on none that CI performs (fixed in #39). **What the green run proves, precisely:** Home renders priorities; the approved-facts surface states its gate and every control clears 40px on a phone; a submitted version is reachable, its detail region opens, and the page says what this owner may do. **What it does not prove, and this is the reason the row is PARTIAL rather than PASS:** the two verbs in AC-14's own name were not exercised. The captured owner submitted the version under review, and `can_decide` requires the approver to be neither the submitter nor a non-approver (AC-08), so the spec correctly took its **denial** branch — verified directly afterwards: `version 1 | canDecide: false`. Approving and requesting changes against a live session needs a second person holding an active `account_approver` grant — and **that is not merely a human step, it is not reachable through the product at all.** Verified 2026-09-11: `can_decide` (`lib/change-sets/store.ts:164-167`) requires the actor to be in the **same account** as the version (`p.account_id = accountId`) and not its submitter. A second member of an existing account cannot be created: `profiles.id` is a foreign key to `neon_auth.user(id)` (migration `022`) and only Neon Auth writes that table, so a profile needs a real sign-in; and `provisionAccountForUser` in `app/api/webhooks/neon/route.ts` **always mints a fresh account** for a new user, so a second person who signs in lands in their own account rather than this one. The entire admin API is two routes — `admin/accounts/[accountId]/approvers` and `admin/clients` — and neither moves a profile between accounts; there is no invite or member-management surface anywhere in `app/api`. **So the product enforces separation of duties while providing no supported way to produce the second party it requires.** Reaching AC-14's two verbs today would take a second human sign-in plus two direct database writes that bypass the product (`profiles.is_admin`, to reach the approvers route at all, and `profiles.account_id`, to move that person into this account) — which is a statement about a missing capability, not a configuration gap. Granting the sole existing profile an approver role changes nothing: it is the submitter, so `can_decide` stays false whatever role it holds. **Also recorded, because both cost a diagnosis:** two runs failed at Playwright's 30s `navigationTimeout` purely as cold Turbopack compiles — measured rather than assumed (authenticated `/en/dashboard` 4.0s warm, the versions page 1.6s warm) and re-run only after a 200 was observed, never retried as a suspected flake. And the versions route answered `404 text/html` while its sibling `[workItemId]` answered 200 JSON: a stale `.next` route manifest, not a permission or path error. Deleting `.next` fixed it; the first explanation offered — that the dev server predated the branch switch — was wrong, and the process start time disproved it. |
| **AC-15** | English and Traditional Chinese are equivalent in meaning, state and action | **PARTIAL** | Asserted directly for the three surfaces built here: the Home priorities and the approved-facts pack render every state in both languages, the catalogues must declare identical keys, and the same state must produce *different* strings, so a missing translation falling back to English fails. The source surface goes further — every error code `lib/sources/service.ts` and `lib/sources/schema.ts` can emit is enumerated **from the source text** and must carry a message in both catalogues, so a new code ships translated or fails the suite. Both languages are also checked for touch-sized controls on every interactive element, since review happens on a phone. The outcomes comparison copy is added to both catalogues with matching keys. CI’s accessibility and public-page E2E pass in both locales. **Repo-wide parity now asserted.** __tests__/lib/message-catalogue-parity.test.ts compares every locale in i18n/routing.ts against en on five axes -- leaf-key set in both directions, value shape, array length, ICU argument names, and emptiness -- with NO allow-list, because there is no drift: 1727 leaves each side, zero differences. Three assertions guard the guard, since every comparison here is catalogue-against-catalogue and would pass vacuously if a locale list emptied; set equality also survives a SYMMETRIC deletion, which the anchored 31-namespace list is the only assertion to catch. Proved by mutation rather than by passing: seven deliberate breakages, each run separately, all seven caught. Three labels sitting untranslated in the Chinese catalogue were fixed (FAQ Schema, Canonical URL, Local Trust ROI). **Still partial:** no bilingual walkthrough of the whole owner journey, and 13 keys remain byte-identical across languages -- 11 legitimately (brand names, an acronym, the language-switcher labels) and two that are a judgement call rather than a defect, nav.platform.action_studio and home.pulse_live, named here rather than decided silently. |

### Tally

| Status | Count | Rows |
|---|---|---|
| PASS | 8 | AC-02, AC-04, AC-05, AC-07, AC-08, AC-09, AC-10, AC-13 |
| PARTIAL | 6 | AC-01, AC-03, AC-11, AC-12, AC-14, AC-15 |
| BLOCKED | 0 | — |
| DEFERRED | 1 | AC-06 |
| FAIL | 0 | — |

No row is BLOCKED as of 2026-09-11. AC-14 was the last one, and it moved to
PARTIAL rather than PASS on purpose: its journey now runs green against a real
session and database, but the captured owner is the submitter of the version
under review, so the spec exercises the separation-of-duties **denial** and not
the approve or request-changes verbs. CI still runs the Pixel-5 project under
`E2E_FIXTURE_MODE`; the green journey above is a developer-machine run, and the
`authenticated-mobile` project exists only where a captured session file does.

**No row is marked PASS on the strength of a build succeeding.** A green build proves
neither runtime, provider nor database readiness.

## 3. What was blocking, and what is left

1. ~~**Migrations 040–043 are not applied** to the persistent AISO development
   database, which keeps AC-04 and AC-14 unrunnable rather than merely unrun.~~
   **Resolved, and the claim was already stale when it was read on 2026-09-11.**
   The owner loop was walked end to end against that database on that date: a draft
   was created in `evidence_work_items` (`201`, migration `041`) and a version in
   `work_item_versions` (`201`, migration `042`), through the product's own route
   handlers. A table that does not exist cannot answer `201`, so those migrations
   are applied. Re-run `npm run migrate -- --verify` rather than trusting this line;
   it has been wrong in both directions.
2. ~~The integration project did not run.~~ **Resolved.** `npm test` provisioned a
   disposable Neon branch, applied all 41 migrations to it, passed 71 integration
   tests and deleted the branch. `neonctl` only prompts interactively when invoked
   without `NEON_API_KEY`; the harness passes it from `.env.local`.

## 4. Minimum agent-safety evaluation — met

`__tests__/agents/safety-eval.test.ts`, 13 assertions:

| Requirement | Status |
|---|---|
| Malicious source cannot change tool authority | **met** — both live concatenation sites are fenced (`lib/checks/factualDensity.ts`, `app/api/fix/route.ts`). The delimiter is stripped from content before wrapping, so a document containing the marker cannot close the fence and speak as the prompt. The suite walks `lib/checks`, `lib/prompts` and `app/api` to find every module that reaches a model, so a new call site that interpolates page text unfenced fails. |
| Forbidden-tool denial | **met, structurally** — no tool surface exists; approval requires an `account_approver` with a live grant; a delivery attestation requires an approved decision. Asserted against the schema, not against a prompt, because a prompt-level control the model can be talked out of is not a control. |
| Cross-tenant reference denied | **met, structurally** — the account is derived from the session, and composite foreign keys reject a cross-account reference. |
| Abstain when evidence is missing | **met** — failing the provider leaves the check reporting `collection: 'partial'` with reason `provider-fallback` rather than presenting its default as observed. |
| Bounded budget | **met** — two controls, because they fail differently. A deployer-configured ceiling clamps every single call inside `callOpenRouter`, so no call site can opt out by forgetting; and a per-task budget caps calls *and* tokens for a unit of work, which is what bounds a fan-out or a retry loop. The fan-out reserves before dispatch, so an over-budget one is never sent. There is no way to obtain an unbounded budget — malformed configuration falls back to a default that is still a bound. Cost is deliberately **not** modelled: token prices differ per model and change without notice, so a monetary cap would look authoritative and be wrong. 19 tests. |

Draft **grounding is now met**, and deliberately without a model.
`lib/sources/grounding.ts` answers a question with the customer's approved text
**quoted verbatim**, citing the source id, version number, content hash and entry
index it came from. A paraphrase of an approved fact is not the approved fact, and
the approved fact is what a human signed off, so nothing is rewritten.

Matching is normalised-exact, never fuzzy. A fuzzy match invents a connection
nobody approved and fails in the worst direction — confidently, on the questions
that matter, with a citation that makes a wrong answer look verified. When nothing
matches it abstains and names the unanswered question, which is itself the useful
product state: *your source pack does not cover this*.

Two behaviours worth stating. It **refuses to choose** between two approved
sources that disagree, returning both for a human, because picking one silently
presents a single customer-approved fact as though it were the only one. And it
**throws** rather than filtering when handed a revoked, unapproved or
non-agent-usable source — the caller is meant to pass `listAgentUsableSources`,
and filtering would hide their bug while a revoked source sat one refactor from a
draft. 22 tests.

## 5. The silent skip in the release gate — closed

The five suites that prove the owner-loop schema are **excluded from
`vitest.integration.config.ts`** and live in their own configs
(`vitest.entity-integration.config.ts` and four siblings), because each demands its
own pre-approved disposable target. For months that meant they were **runnable and
run by nothing**: no npm script named those configs, and no CI job invoked them.

Two separate faults, fixed in two steps.

**The skip.** Run without their `C9*` variables, all five used to report
`Test Files 1 skipped` and **exit 0** — reading as success while asserting nothing,
the exact hazard `scripts/run-tests.mjs` was written to prevent, reproduced where
its banner does not reach. Each suite now carries a guard
(`__tests__/integration/approved-target.ts`) that **fails** when no target is
configured. Invoking one of these configs *is* the explicit request, so doing
nothing must not read as success.

**The reach.** `scripts/ci/run-exact-target-suites.mjs` now provisions one
disposable branch through the single audited path — `createTestBranch` →
`resetPublicSchema` → `scripts/migrate.ts`, the same `provisionBranch()` the default
integration project uses — derives every `C9*` value from that branch, runs all five
configs, and deletes the branch in a `finally`. It is invoked **inside** the existing
`integration` job's step in `.github/workflows/pr-gate.yml`, before
`write-job-summary`, so one status covers both halves; a separate step would have let
the summary record success before the wrapper had run at all.

**Measured, not estimated:** `5/5 suites, 117 tests`, exit 0, **105 seconds** wall
clock including the branch create, all 46 migrations and teardown — against that
job's 30-minute budget. That number also settles a contradiction this document
carried: 117 is what the reports actually total (3 + 5 + 22 + 19 + 68). The 114 and
109 that appeared elsewhere in these docs were stale and have been removed.

### What changed about safety, stated plainly

Before, the branch and project ids were typed by a human who had separately approved
that target, and each suite compared them against the in-band `neon.project_id` /
`neon.branch_id` GUCs — an independent approval. Now one process both creates the
branch and declares the expectation, so that comparison becomes a self-consistency
check.

What replaces it is structural rather than procedural, and stronger in the direction
that matters: `createTestBranch` proves the target is a fresh, non-default,
non-primary, TTL-expiring child of the AISO project whose connection uri matches one
of its own endpoints; `assertDisposableTestBranch` refuses any branch this process
did not create; and the in-band check still runs inside every suite and still fails
closed.

The load-bearing condition is that the wrapper **never reads a `C9*` value from the
environment** — not as a default, not as a local-convenience fallback. Those
variables name the database five suites write fixtures into and delete rows from, so
one `?? process.env.C9D_TEST_DATABASE_URL` would turn a provisioning script into a
way to aim destructive writes at any database an operator can reach.
`__tests__/ci/exact-target-suites.test.ts` asserts that against the source rather
than trusting the comment.

### What stops it regressing

`__tests__/ci/exact-target-suites.test.ts` (11 tests):

- every `vitest.*-integration.config.ts` **discovered by glob** is in the wrapper's
  list, so a sixth config cannot be added without being wired in;
- every path in `vitest.integration.config.ts`'s `exclude` array is covered by
  exactly one of those configs — if the two lists drift, a suite is excluded from the
  default project and run by nothing, the original failure exactly;
- `pr-gate.yml` invokes the wrapper;
- all five suites still contain `assertApprovedTarget(` — the guard the wrapper
  quietly retires, since with the `C9*` variables always supplied it is permanently
  green and its deletion would be invisible;
- the wrapper does nothing when imported rather than run. Found the expensive way:
  the test file imports one constant from it, and an unguarded `main()` at module
  scope provisioned three real Neon branches before the guard existed;
- `__tests__/integration/setup.ts` loads under **plain node**. Also not hypothetical —
  it imported `'../helpers/neon-branch'` with no extension, which Vitest resolves and
  node does not, so the wrapper died `ERR_MODULE_NOT_FOUND` before provisioning
  anything, with no test named in the failure.

The job summary no longer hardcodes `--executed 1 --skipped 0`.
`scripts/ci/count-vitest-reports.mjs` measures both from the six JSON reports, and an
unreadable report fails rather than counting zero — `aggregate-gate.mjs` blocks on
`skipped > 0`, so a hardcoded zero was itself a mechanism by which a skipped suite
could read as a passing one.

To run them locally: `node --env-file=.env.local scripts/ci/run-exact-target-suites.mjs`.
It needs `neonctl` on PATH and `NEON_API_KEY`; it takes no other configuration, by
design.

## 6. What a real runtime probe showed

The app was booted against the **real development database** (`npm run dev`, real
`DATABASE_URL`, migrations through `045`) and probed directly — something neither
CI nor the unit suite does, because CI runs E2E under `E2E_FIXTURE_MODE` against a
fixture DSN.

**Public surfaces work against real data.** `/en`, `/zh-HK`, `/en/scan` and
`/llms.txt` all return 200; an unknown result id returns 404, not a fixture.

**Authenticated surfaces cannot be exercised**, and the reason is environmental
rather than a code fault. Four secrets are declared in `.env.local` and are all
**empty** — only `DATABASE_URL` has a value:

| Variable | Consequence while empty |
|---|---|
| `NEON_AUTH_COOKIE_SECRET` | Neon Auth cannot be constructed, so `getProfile()` throws on every request |
| `NEON_AUTH_BASE_URL` | same |
| `PUBLIC_SCAN_RATE_LIMIT_SECRET` | every anonymous scan returns 503 |
| `REPORT_SHARE_SECRET` | share links and the scan-claim cookie cannot be signed |

So the owner-loop routes answered **503**, not 401 — which is the *correct*
answer: a dependency that is genuinely down is not the same as an anonymous
caller, and the services already keep those apart. The product degraded honestly
under a real fault, which is AC-13 evidence obtained the hard way.

**One rough edge found and fixed.** `/api/scans/[id]/claim` returned a bare **500
with an empty body** when auth was unavailable, because `getProfile()` throws and
nothing caught it. A missing session and a missing auth service are different
facts; the route now answers `503 {"error":"Claim unavailable"}`, verified against
the running server and covered by a unit test. Nothing but a real stack would have
shown this — every unit test mocks `getProfile` to *return* null rather than throw.

### Correcting the ask: a password cannot unblock this

An earlier version of this section asked for `PLAYWRIGHT_TEST_EMAIL` and
`PLAYWRIGHT_TEST_PASSWORD`. **That request was wrong**, and CLAUDE.md:497 is wrong
for the same reason: this product has **no password sign-in at all**.
`components/auth/LoginForm.tsx` offers exactly two paths —
`authClient.signIn.magicLink({ email })` and
`signIn.social({ provider: 'google' })`. There is no password to supply.

`tests/fixtures/auth.ts` was where that misreading came from. It filled
`input[type="password"]` on a login page that has no such field, and when the
password was empty — always — it silently yielded a plain anonymous `page` under
the name `authenticatedPage`. Nothing imported it, so nothing was broken, but a
test that had used it would have run logged out while reading as logged in. It now
throws instead, naming the real path, because a fixture that yields an anonymous
page turns "we never tested this" into "we tested it and it passed".

**What would actually unblock AC-14**, in order:

1. **Populate the four empty secrets in `.env.local`** — set them in the file
   directly; they must never be pasted into a chat or a commit. Until then
   `getProfile()` throws and every authenticated route answers 503.
2. **Capture a session once, by hand.** For a magic-link/OAuth product the
   standard approach is Playwright `storageState`: sign in, save the session to a
   gitignored file, and point a Playwright project at it with
   `use: { storageState }`. One human login covers every subsequent run.
3. **Then write the journey spec** — scan → claim → priorities → draft → submit →
   approve → export → recheck, at 375/390/430px for AC-14.

Steps 1 and 2 need a person: creating an account, receiving a magic link and
entering credentials are not things this session will do.
