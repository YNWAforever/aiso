# 04 — Acceptance matrix

AC-01 … AC-15 from the implementation plan, against this branch on **2026-09-10**.

`PASS / FAIL / PARTIAL / BLOCKED / DEFERRED` describes what was **executed**. It is a
different axis from `Verified / Inferred / Blocked`, which describes how strong the
evidence is. The two are not mixed.

Nothing here claims a capability that was not exercised. A `BLOCKED` row is blocked
because a dependency is genuinely missing, and §3 names each one.

## 1. Commands this matrix rests on

Run in the worktree at commit `b9f0bc9`:

| Command | Exit | Totals |
|---|---|---|
| `npm run typecheck` | 0 | — |
| `npm run lint` | 0 | 0 errors, 0 warnings |
| `npm run test:unit` | 0 | **293 files / 3987 tests passed, 0 skipped** |
| `npm test` | 0 | unit as above, **plus the integration project: 11 files / 85 tests passed** against a disposable Neon branch, which was provisioned, migrated through all 41 files and deleted. No skip banner was printed, so integration genuinely ran. |
| the five owner-loop configs (see §5) | 0 | **5 files / 117 tests passed** against a separately provisioned disposable branch |
| CI `PR gate` on pull request #21 | success | all 10 jobs green: `static`, `unit-contract`, `integration`, `e2e-accessibility` ×4 shards, `build`, `cloudflare-worker`, and the aggregating `pr-gate` |

Baseline for comparison, at `5bb2dcc`: 284 files / 3714 tests.

**Read the E2E result narrowly.** The `e2e-accessibility` job runs `npm run e2e`
unfiltered, so every Playwright project including Pixel-5 `mobile` does execute — but
it runs with `E2E_FIXTURE_MODE: 1` and a fixture DSN
(`postgresql://fixture:fixture@127.0.0.1:5432/fixture`). Under that flag
`getProfile()` returns `null`, so every authenticated route denies. What is green is
the public surface and the rendered component fixtures, **not** an authenticated
owner journey against a database. AC-14 stays BLOCKED for that reason.

## 2. The matrix

| AC | Behaviour that must be proven | Status | Evidence / limitation |
|---|---|---|---|
| **AC-01** | New owner gets a real baseline and understands three priorities | **PARTIAL** | Scan → result → claim is real and unit-tested. Home now leads with **at most three priorities and one named next action** (`lib/view-models/owner-priorities.ts`, rendered by `components/dashboard/WorkspaceHome.tsx`), ranked by points still at stake and derived from the evidence envelope so an unobservable check never becomes work to do; 30 tests across `__tests__/lib/owner-priorities.test.ts` and `__tests__/components/workspace-home-priorities.test.tsx`. **Still partial:** onboarding is orphaned (nothing links to `/[lang]/onboarding`), so the end-to-end first-run journey is not yet reachable, and it has not been exercised against a database. |
| **AC-02** | An unknown URL never receives another company's demo findings | **PASS** | `app/api/scan/route.ts` never imports `lib/e2e-fixtures.ts`; both fixture consumers are double-gated on `E2E_FIXTURE_MODE === '1'` **and** an exact scan id. Covered by `__tests__/api/scan-security.test.ts` (17 tests). Data mode is carried per check by `lib/scan-evidence.ts` `CollectionState`. |
| **AC-03** | Identity / claim / ownership is controlled | **PARTIAL** | **Fixed this session:** an absent intent cookie bypassed verification entirely on `/api/scans/[id]/claim`, and `/api/onboarding/complete` never checked it at all. Both now deny. Negative tests: anonymous, absent cookie, tampered, expired, mismatched return path, retargeted token, and both onboarding cases — `__tests__/api/scan-claim.test.ts` (14), `__tests__/api/onboarding-flow.test.ts` (27). **Still missing:** single-use replay consumption (`attemptId` is signed but never persisted) and domain-ownership verification — no `unverified` asset state exists outside a literal in `lib/entities/schema.ts`. |
| **AC-04** | Import / connect, coverage, sync and revoke are real | **PARTIAL** | Built in this session. Migration 044 adds `client_sources` (mutable identity and policy) and append-only `client_source_versions`, with composite-FK tenancy, provenance (`import_method`, `origin_ref`, `imported_by/at`), approval (`approved_by/at`), a SHA-256 content hash, derived freshness, and revocation as a state rather than a delete so a draft that cited a source stays explainable. `agent_use_allowed` defaults to **false**, and `listAgentUsableSources` is the single server-side gate — allowed, not revoked, and actually approved. CSV and paste ingest treat content as data: formula injection is defused by preserving the value behind an apostrophe, and content is NFC-normalised before hashing. 29 unit tests plus 14 integration tests against real Postgres, in the DEFAULT config so CI runs them. **Still partial:** no UI surface yet, and import is not a live connection — the distinction the brief insists on is not yet shown to an owner. |
| **AC-05** | Evidence retains source, time, scope, method and state | **PASS** | `lib/scan-evidence.ts` stores `collection`, `applicability`, `assessment`, per-check `CHECK_VERSIONS`, `collectedAt`, `comparison` + `comparisonSignature`, and an explicit `limitations` array. An immutable snapshot is copied onto the work version (`evidence_snapshot` + `evidence_fingerprint`, migration 041). Covered by `__tests__/lib/scan-evidence.test.ts`. |
| **AC-06** | A website finding and a question opportunity reach the same asset and task | **DEFERRED** | Phase 3 per the plan. `lib/opportunities/fingerprint.ts` already dedupes by canonical target, so the seam exists. Not exercised. |
| **AC-07** | An agent may draft but may not approve or publish | **PASS (for the minimum evaluation)** | The minimum agent-safety evaluation now exists — see §4. Two live prompt-injection sites were fenced, and the four required properties are asserted against the real code: injection resistance including the fence-escape attempt, forbidden-tool denial, cross-tenant denial and abstention. **Bounded budget remains absent** and is asserted as absent, so the gap fails loudly the day it changes. |
| **AC-08** | Where separation is required, an editor cannot approve their own version | **PASS** | Fixed in this session. The guard compared only `v.submitter->>'profileId'`, so a second editor who wrote the item but did not submit that version could approve it. The `owned` CTE now also selects `created_by`/`updated_by` and a `separated` CTE requires the approver to be neither — applied both in the INSERT and in the reported outcome, so a denial reports as a denial. A pure tightening: a single-owner account already could not approve, because the submitter check has always been absolute. Proven against real Postgres: both authorship columns denied, the ordinary two-person path still succeeds, no decision row written on denial. **Recorded limitation:** an explicit single-owner policy is deliberately not implemented; it needs a column on an append-only table so a solo sign-off is never presented as two-person review. |
| **AC-09** | The exact approved version is exported, with actor, time and result retained | **PASS** | Completed in this session. Export already refused an unapproved version; migration 045 now records an append-only receipt keeping **both** hashes separately — `content_hash` (the approved payload) and `artifact_hash` (the rendered canonical envelope) — with `format`, `renderer_version`, the downloading actor and the time. A composite FK binds the version *and* its payload hash, so a receipt cannot name a version whose content differs from what left. The receipt is written **before** the bytes are released and a failure fails the export (409 on zero rows, 503 on error). The receipt records the **downloader**, not the submitter. |
| **AC-10** | Recheck uses the same scope and method; incompatible means no improvement claim | **PASS (for the technical layer)** | The adapter is built *and wired*. `compareOutcome` (`lib/outcomes/evaluate.ts`) attaches a `comparison` to every window: `status` ∈ comparable / partially_comparable / not_comparable / insufficient_evidence, `outcome` ∈ improved / unchanged / regressed / not_yet_observed / cannot_determine, plus both verdicts. `evidenceState` reaches `available` for the first time. Admissibility is decided by method, target and configuration; **content is never compared**, since a page's content is expected to differ between a baseline and a recheck. A different method or subject refuses outright; an untrustworthy side is `insufficient_evidence` — "never" and "not yet" render differently. Pulse gets no adapter deliberately, because `success`/`incomplete` describe whether the observation completed, not whether it went well. `parseOutcomeResponse` re-derives and compares the field, so a client cannot forge `improved` over fail→fail nor upgrade `partially_comparable` to `comparable`; both forgeries are tested. 67 tests across `__tests__/outcomes/compare-outcome.test.ts`, `evaluate.test.ts` and `dto.test.ts`. **Remaining limitation, by design:** a scan-check baseline is a single frozen check rather than a whole envelope, so it carries `final-path-identity-withheld` and lands on `partially_comparable`; reaching `comparable` needs the snapshot to record its target identity, which is a separate change to a frozen contract. Nothing re-runs a scan automatically yet. |
| **AC-11** | Technical, search/AI and business outcomes stay separate | **PARTIAL** | Separate inside `lib/outcomes` — a technical verdict cannot populate a business one, because no verdict exists at all. Outside it, `lib/localTrust/roi.ts` presents a computed ROI baseline to owners; that is the layer-mixing risk to close before any commercial claim. |
| **AC-12** | No cross-account read, mutation, inference or export | **PARTIAL** | Now proven against **real Postgres**, not SQL text: the five owner-loop suites ran on a disposable branch with 040–043 applied and passed 109 tests, exercising the composite-FK tenancy chain, the append-only GRANT posture, and the app role's inability to UPDATE or DELETE version, decision and delivery history. **Still partial:** those suites are unreachable from `npm test` and from CI (§5), and there is still no route-inventory test that fails when a new handler ships with no gate. |
| **AC-13** | A disconnected or failing provider recovers honestly | **PASS (for what exists)** | `lib/delivery/service.ts` maps dependency failure to 503 and never a silent 200; `db()` throws, so a failed write cannot return 2xx; checks degrade to domain-specific messages with a `collection` diagnostic rather than a zero. Covered across `__tests__/delivery/**` and `__tests__/checks/**`. No external provider connector exists to disconnect. |
| **AC-14** | Mobile review, approve and request-changes | **BLOCKED** | Two separate blockers, now both identified precisely. (a) The Pixel-5 project runs in CI and passes, but the c9d/c9e specs render **pre-built static HTML fixtures** and abort all network — they test component markup at viewports, not a live journey. (b) An authenticated journey cannot be run here at all: `.env.local` declares `NEON_AUTH_COOKIE_SECRET`, `NEON_AUTH_BASE_URL`, `REPORT_SHARE_SECRET` and `PUBLIC_SCAN_RATE_LIMIT_SECRET` but every one is **empty**, and no `PLAYWRIGHT_TEST_EMAIL`/`PASSWORD` exists. See §6. |
| **AC-15** | English and Traditional Chinese are equivalent in meaning, state and action | **PARTIAL** | Asserted directly for the two surfaces built here: the Home priorities render every state in both languages, the catalogues must declare identical keys, and the same state must produce *different* strings, so a missing translation falling back to English fails. The outcomes comparison copy is added to both catalogues with matching keys. CI's accessibility and public-page E2E pass in both locales. **Still partial:** no bilingual walkthrough of the whole owner journey, and no repo-wide key-parity assertion. |

### Tally

| Status | Count | Rows |
|---|---|---|
| PASS | 7 | AC-02, AC-05, AC-07, AC-08, AC-09, AC-10, AC-13 |
| PARTIAL | 6 | AC-01, AC-03, AC-04, AC-11, AC-12, AC-15 |
| BLOCKED | 1 | AC-14 |
| DEFERRED | 1 | AC-06 |
| FAIL | 0 | — |

AC-14 is the only remaining BLOCKED row, and only for the authenticated half:
the Pixel-5 project runs in CI but under `E2E_FIXTURE_MODE` against a fixture
DSN, so mobile *review and approve* cannot be exercised until the suite runs
against a real session and database.

**No row is marked PASS on the strength of a build succeeding.** A green build proves
neither runtime, provider nor database readiness.

## 3. Why the BLOCKED rows are blocked

1. **Migrations 040–043 are not applied** to the *persistent* AISO development
   database. `npm run migrate -- --verify` reports `MISSING` for all seven tables of
   the owner loop. Applying them is a single additive `npm run migrate`; it was
   attempted and **denied by the permission classifier**, so it needs the user's
   approval. Their content is no longer unproven — they applied cleanly to two
   disposable branches this session, and their constraints pass 109 tests — but
   until they land on the persistent database no owner journey can be walked end to
   end, which is what keeps AC-04 and AC-14 unrunnable rather than merely unrun.
2. ~~The integration project did not run.~~ **Resolved.** `npm test` provisioned a
   disposable Neon branch, applied all 41 migrations to it, passed 71 integration
   tests and deleted the branch. `neonctl` only prompts interactively when invoked
   without `NEON_API_KEY`; the harness passes it from `.env.local`.

## 4. Minimum agent-safety evaluation — now met, except budgets

`__tests__/agents/safety-eval.test.ts`, 13 assertions:

| Requirement | Status |
|---|---|
| Malicious source cannot change tool authority | **met** — both live concatenation sites are fenced (`lib/checks/factualDensity.ts`, `app/api/fix/route.ts`). The delimiter is stripped from content before wrapping, so a document containing the marker cannot close the fence and speak as the prompt. The suite walks `lib/checks`, `lib/prompts` and `app/api` to find every module that reaches a model, so a new call site that interpolates page text unfenced fails. |
| Forbidden-tool denial | **met, structurally** — no tool surface exists; approval requires an `account_approver` with a live grant; a delivery attestation requires an approved decision. Asserted against the schema, not against a prompt, because a prompt-level control the model can be talked out of is not a control. |
| Cross-tenant reference denied | **met, structurally** — the account is derived from the session, and composite foreign keys reject a cross-account reference. |
| Abstain when evidence is missing | **met** — failing the provider leaves the check reporting `collection: 'partial'` with reason `provider-fallback` rather than presenting its default as observed. |
| Bounded budget | **NOT met**, and asserted as absent on the `callOpenRouter` signature and every call site. Nothing identifies who is spending, so no per-account or per-task cap can exist above it; `maxTokens` bounds one call, not a task. The test fails the day a budget lands, which is the point of writing it that way. |

Draft *grounding* — every claim tied to a permitted source version — is not yet
met either: no LLM path consumes `listAgentUsableSources`, because the drafting
path is deterministic today. The enforcement point exists and is tested; the
consumer does not.

## 5. A silent skip in the release gate

The five suites that prove the owner-loop schema are **excluded from
`vitest.integration.config.ts`** and live in their own configs
(`vitest.entity-integration.config.ts` and four siblings). Those configs are wired
into no npm script and into no CI job.

**Fixed.** Run directly without their `C9*` variables, all five used to report
`Test Files 1 skipped` and **exit 0** — 109 tests reading as success while
asserting nothing, the exact hazard `scripts/run-tests.mjs` was written to prevent,
reproduced where its banner does not reach.

Each suite now carries one guard (`__tests__/integration/approved-target.ts`) that
**fails** when no target is configured. Invoking one of these configs *is* the
explicit request, so doing nothing must not read as success. Verified both ways:
unconfigured runs now fail loudly, and a provisioned run passes all 114 tests
(109 original plus the five guards).

The remaining gap is reach: these configs are still invoked by no npm script and no
CI job, so the release gate does not run them. Wiring them into `npm test` needs a
provisioning step per suite and is its own change.

To run them, provision a disposable branch, apply the migrations, and export the
target for each suite:

    C9_ENTITY_DISPOSABLE_BRANCH_ID / _PROJECT_ID / _OWNER_ROLE
    C9C_WORK_ITEMS_DISPOSABLE_BRANCH_ID / _PROJECT_ID / _OWNER_ROLE
    C9D_DISPOSABLE_BRANCH_ID / _DISPOSABLE_PROJECT_ID / _TEST_DATABASE_URL / _TEST_APP_DATABASE_URL
    C9E_DISPOSABLE_BRANCH_ID / _DISPOSABLE_PROJECT_ID / _PARENT_BRANCH_ID / _TEST_DATABASE_URL / _TEST_APP_DATABASE_URL

The C9D and C9E suites need **two** URLs — an owner one and an `aeo_app` one —
because what they prove is that the application role cannot UPDATE or DELETE
version, decision or delivery history.

Making these reachable from `npm test`, or at minimum making an unconfigured run
fail rather than skip, is the highest-value follow-up in the acceptance area.

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
