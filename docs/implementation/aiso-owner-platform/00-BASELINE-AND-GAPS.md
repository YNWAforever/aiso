# 00 — Baseline and gaps

Phase 0 preflight for the AISO owner platform. Every claim below came from running a
command or reading a file in this worktree on **2026-09-10**. Where something could
not be verified it is marked **BLOCKED**, not estimated.

Read alongside `IMPLEMENTATION-STATUS.md`, which carries the live state.

## 1. Repository and baseline

| | |
|---|---|
| Remote | `https://github.com/YNWAforever/aiso` (`origin`) |
| Default branch | `main` (`refs/remotes/origin/HEAD`) |
| Working branch | `claude/fimmick-aiso-phase-0-1-3cf312` (isolated worktree) |
| **Baseline SHA** | `5bb2dcce11b63e027591e568786ff6e2c1577051` |
| Baseline tree | **clean** — `git status --porcelain` empty at session start |
| Baseline vs `main` | identical (`git rev-list --left-right --count main...HEAD` → `0 0`) |
| Node / npm | 24.18.0 / 11.16.0 (`engines.node` requires 24.x) |
| Next.js | 16.2.4, App Router, root `proxy.ts` — verified, no `middleware.ts` exists |

Other worktrees share this checkout (`git worktree list`): the main checkout on
`codex/c9b-c9c-design`, and `.worktrees/c9b-c9c` on `codex/release-readiness-design`.
Nothing in this session touched them.

## 2. Verified baseline test state

Commands run in this worktree, exit codes captured:

| Command | Exit | Result |
|---|---|---|
| `npm ci` | 0 | lockfile install, no change to `package-lock.json` |
| `npm run typecheck` | 0 | `next typegen && tsc --noEmit` |
| `npm run lint` | 0 | zero errors, zero warnings |
| `npm run test:unit` | 0 | **284 files / 3714 tests passed** |
| `npm test` (integration project) | — | **BLOCKED**, see §6 |

**CLAUDE.md is materially stale.** It states "136 files / 1510 tests" and describes
migrations only to `037`. The repo has 41 migration files through `043` and, at
baseline, 284 unit test files. Trust the code; §7 lists the contradictions.

## 3. What already exists

The repo is much further along than its architecture document suggests. The whole
`c9a`–`c9f` owner-loop slice is built to a high standard, with design documents in
`docs/superpowers/specs/2026-09-0*`.

| Phase 1 package | Verdict | Evidence |
|---|---|---|
| **A** scanner + trust | **FIX** | 20 checks in `lib/checks/`, weights in `lib/scoring.ts`, evidence vocabulary in `lib/scan-evidence.ts`. Two authorisation holes found and fixed (§5). No compatibility corpus existed — now added. |
| **B** onboarding / claim / Home | **EXTEND** | Claim flow exists. Home renders four co-equal sections (`lib/view-models/workspace-home.ts`), **not** three priorities and one next action. |
| **C** approved source pack | **BUILD** | `client_entities` (migration 040) holds only `display_name` + `aliases`. No provenance, version/hash, freshness, revocation or agent-use columns anywhere. |
| **D** work → version → approval | **KEEP** | Substantially complete and unusually strong — see §4. |
| **E** export → delivery → recheck | **KEEP + BUILD** | Export and delivery attestation complete. **Comparable recheck does not exist**, and is honestly labelled absent — §4.3. |
| **F** bilingual / mobile / telemetry | **EXTEND** | `messages/en.json` and `zh-HK.json` exist; a mobile E2E project exists since 2026-09-03. Activation events beyond `claim` are absent. |

### 3.1 Module map (actual, not proposed)

The implementation plan proposes `src/lib/aiso/*`. **This repo has no `src/`.** Real
locations:

| Proposed logical area | Actual module |
|---|---|
| Scan compatibility | `lib/checks/`, `lib/scoring.ts`, `lib/scan-evidence.ts`, `lib/pillar-scores.ts` |
| Tenant policy | `lib/auth.ts`, `lib/admin-guard.ts`, `lib/localTrust/guard.ts`, `lib/workspace/` |
| Assets and evidence | `lib/entities/`, `lib/observations/`, `lib/opportunities/` |
| Work and versions | `lib/work-items/`, `lib/change-sets/`, `lib/approvals/` |
| Agent tools | `lib/agents.ts`, `lib/openrouter.ts`, `lib/prompts/` |
| Observation | `lib/pulse/`, `lib/observations/` |
| Connectors | `cloudflare/cron-worker/`, `lib/cron/`, `n8n/` |
| Outcomes | `lib/outcomes/`, `lib/delivery/`, `lib/reports/` |

Do not create the proposed directories. Extend these.

## 4. The owner loop as actually built

### 4.1 Tenancy is structural, not conventional

Migrations 040–043 enforce tenancy with **composite foreign keys**, which is stronger
than the `account_id`-on-a-row pattern the brief warns about:

    -- 041_evidence_work_items.sql
    foreign key (client_id, account_id) references public.clients (id, account_id)

A row of account A cannot reference account B's client — the database rejects it. The
chain continues through `work_item_versions` → `work_item_decisions` →
`work_item_delivery_events`, each carrying
`(account_id, client_id, work_item_id, version_id, content_hash)` into the parent's
matching unique index.

There is **no** RLS backstop: migration 036 dropped all 30 Supabase-era policies and
disabled RLS on 21 tables. Application filtering plus these FKs are the whole defence.

### 4.2 Immutability is enforced by GRANT

`042` and `043` grant the app role `select, insert` only — **no UPDATE, no DELETE** —
on `work_item_versions`, `work_item_decisions`, `account_approver_events` and
`work_item_delivery_events`. Version history is append-only at the database level,
not merely by convention.

An approval binds the content hash structurally:

    -- 042: a decision cannot reference a version with a different content hash
    foreign key (account_id, client_id, work_item_id, version_id, content_hash)
      references public.work_item_versions (account_id, client_id, work_item_id, id, content_hash)

and binds the approver's authority to the exact grant revision that authorised it
(`account_approver_events`). `043` extends the shape to delivery: an attestation
requires an `approved` decision on that exact hash, and `delivered_at <= recorded_at`
blocks a future-dated publication claim.

**Known limit:** what is enforced is *submitter cannot approve*
(`lib/approvals/decision-store.ts` compares `submitter->>'profileId'`), which is not
the same as *editor cannot approve*. A second editor who did not submit the version
can approve it. Recorded against AC-08.

### 4.3 Recheck does not exist — and says so

The single largest Phase 1 functional gap, and the code is honest about it.

`lib/scan-evidence.ts` `compareScanEvidence()` **can never return `comparable: true`**.
Its success path is:

    // v1 deliberately withholds final path identity, even for root targets.
    return { comparable: false, reason: 'final-path-identity-withheld' }

The evidence envelope stores only an **origin** (`URL_REDACTION_VERSION =
'origin-only.v1'`), so two scans cannot be proven to have hit the same page.
Downstream, `lib/outcomes/evaluate.ts` therefore always reaches
`reasons.push('no-comparable-adapter')` with `evidenceState` left at
`'not-comparable'`.

Consequences, stated plainly:

- No `improved` / `unchanged` / `regressed` verdict exists anywhere in the product.
- No `comparison_status` vocabulary exists. `EvidenceState` has six members
  (`available`, `timing-unknown`, `invalid-baseline`, `not-comparable`,
  `evidence-limited`, `unavailable`), of which only `not-comparable` overlaps the
  brief's four.
- Nothing re-runs a scan after delivery. `lib/outcomes/store.ts` reads pre-existing
  scans only.

The primitives are all present — `comparisonSignature`, per-check
`collection`/`assessment`, an immutable baseline snapshot on the work version — so
this is a bounded build, not a redesign. It is Phase 1 package E.

## 5. Defects found and fixed this session

Both verified by reading the code, not inferred.

**5.1 Foreign scan claiming (BLOCKER, fixed).** `app/api/scans/[id]/claim/route.ts`
verified the claim intent only inside `if (token) { … }`. Omitting the cookie skipped
verification entirely and claimed the scan. `__tests__/api/scan-claim.test.ts:48`
encoded this as intended behaviour. `app/api/onboarding/complete/route.ts` was a
second, wider path — it claimed whatever `scanId` the JSON body carried, with no
intent check at all.

Fixed by routing both through one predicate, `isAuthorizedScanClaim`, which treats an
absent token as a denial. The legitimate flow is unaffected: the cookie is
`SameSite=Lax; path=/`, so it survives the sign-in redirect, and `AccountUnlockCard`
always mints it before `ClaimScanOnReturn` claims. Negative tests added for absent
cookie, retargeted token, and both onboarding cases.

**5.2 Unguarded outbound fetch (HIGH, fixed).** The `no-restricted-globals` ESLint
rule and its companion test were scoped to `lib/checks/**` only, so two live instances
outside that directory were invisible:

- `app/api/fix/route.ts` fetched `scan.url` — a customer-supplied URL — and fed the
  response body into an LLM prompt, making it an exfiltration path as well as a
  request one.
- `lib/authority/layer2-signals.ts` probed `https://${clean}` three times against a
  caller-supplied hostname, one with `redirect: 'follow'`.

Both now use the guarded fetcher. `__tests__/security/no-unguarded-fetch.test.ts`
replaces the hand-written eight-filename list with a directory walk over
`lib/checks`, `lib/authority` and `app/api`, so a new module is covered the day it
lands; the remaining bare fetches are declared with the reason each is safe.

The `httpsEnforced` signal could not simply move to the guarded fetcher: it read
`res.url`, which that fetcher deliberately leaves empty
(`__tests__/lib/scan-evidence-capture.test.ts:13` asserts this, because the evidence
contract is origin-only redaction). An https-only fetcher proves the same property
more directly — a downgrade redirect is rejected as unsafe, so reaching a response
means the chain stayed on https.

**Not applied:** widening the ESLint rule to match. `eslint.config.mjs` is protected
by a repo hook (`config-protection`) that blocks edits. The test-level guard runs in
the suite that gates a merge, so the invariant is enforced; the lint rule is left for
a maintainer.

### 5.3 One reported finding refuted

An automated pass reported that `E2E_FIXTURE_MODE=1` "disables every auth gate".
Reading `lib/auth.ts:7`, `getProfile()` returns **`null`** under that flag — that is
*unauthenticated*, so every gate **denies**. It fails closed. No action taken.

## 6. Validation blockers

| Blocker | Impact | What unblocks it |
|---|---|---|
| **Migrations 040–043 unapplied** to the AISO dev database. `npm run migrate -- --verify` reports `MISSING` for `client_entities`, `evidence_work_items`, `work_item_versions`, `account_approver_events`, `account_approver_state`, `work_item_decisions`, `work_item_delivery_events`. | The whole c9a–c9f owner loop has no schema in this environment, so no end-to-end owner journey can be exercised. | `npm run migrate` — 4 additive migrations, no destructive statements (verified by grep for `drop`/`truncate`/`delete`). **Attempted and denied by the permission classifier.** Needs the user's approval. |
| **Integration project not run.** `neonctl` 4.13.0 is on PATH and authenticated but prompts interactively for an organisation, which fails non-interactively. | Every DB-level constraint in §4.1 and §4.2 is proven against SQL text only in this session. | Export `NEON_API_KEY`, or run `REQUIRE_INTEGRATION_TESTS=1 npm test` in an interactive shell. |
| **E2E not run.** Needs a dev server and a database. | AC-14 (mobile) and AC-15 (bilingual) unverified this session. | After the migrations land. |

The dev database is `weathered-wave-50814522` ("AISO"), branch
`br-square-mountain-az6f82vi`, connected as **`aeo_app`**, carrying a **synthetic
seed** (1 account, 2 clients, 1 scan) per
`docs/runbooks/bootstrap-greenfield-project.md`. It is *not* the Vercel-connected
production project. Verified with
`node --env-file=.env.local scripts/verify-db-connection.mjs`, reading the `server`
line (`{ role: 'aeo_app', db: 'neondb' }`) — the database answering `current_user`,
rather than a value parsed out of the URL.

## 7. CLAUDE.md contradictions against HEAD

| CLAUDE.md says | HEAD |
|---|---|
| "35 SQL migrations, `001_`–`037_`" | 41 files, `001_`–`043_` |
| "136 files / 1510 tests" | 284 files / 3714 tests at baseline |
| one vitest config | eight, five of them exact-target integration configs |
| "Composition is not fully centralized … change one, check the other" | `capScore()` in `lib/scoring.ts` is now shared by the scan route and `lib/impact.ts` |
| does not mention | `lib/entities/`, `lib/work-items/`, `lib/change-sets/`, `lib/approvals/`, `lib/delivery/`, `lib/outcomes/`, `lib/observations/`, `lib/opportunities/`, `lib/readiness/`, `lib/schema/` |

Updating CLAUDE.md is proposed as a separate change: it is the architecture document
for the repo, and rewriting it inside a feature branch would bury the diff.

## 8. v6 review experience — traceability

Reviewed in an authorised browser on 2026-09-10. **Access was not blocked.**

- The deployed site at `fimmick-aiso-ansvisor-v6.laichiwillyjp.chatgpt.site` labels
  itself *"Revamp review · Demo data"*, *"No production connection"*, `noindex`.
- Source: `github.com/YNWAforever/aisogpt1`, **2 commits, both 2026-09-09** —
  `8abac7c` "Initialize AISO AnsVisor v6 codebase" and `deb52b6` "Import complete
  AISO AnsVisor v6 Site: 219 files with original file modes".
- `V6_FORK_VERIFICATION.md` records it as an independent copy of saved version 6,
  baseline commit `3acd3a008dcdb2b3df2c1fba25a245702a0eb946`, 214 files byte-for-byte
  unchanged. A later version 7 exists upstream and was not used.
- **Licence position: MIT notices are present.** `licenses/ansvisor-MIT.txt` exists,
  `THIRD_PARTY_NOTICES.md` retains the Empler AI copyright, and
  `AISO_ANSVISOR_REUSE_MANIFEST.json` records per-module `donorPath`, `blobSha`,
  `originalRepository` (`https://github.com/ansvisor/ansvisor`), `originalCommit`
  (`f56d4f18f60487b49ec22ddafe6e28ee68a3eb64`), SHA-256 of original and target, and
  the adaptation summary. The GitHub API reports `licenseInfo: null` for the
  repository — that is the absence of a *root* LICENSE for aisogpt1's own code, not
  the absence of the AnsVisor notice.
- **The v6 experience proves no live service.** Its own acceptance report is
  **46 PASS / 4 FAIL / 14 BLOCKED**, and `AISO_SCAN_PRESERVATION_AND_INTEGRATION.md`
  states that no production scanner, AI provider, billing, CMS, database or service
  credential is connected, and that publication evidence is simulated.

Two things the v6 review already gets right, which production must match:

1. **AC-02 behaviour.** *"Only example.com loads the fixed Aster Harbour data; other
   URLs only show not connected."* Arbitrary hosts cannot inherit fixture results.
2. **The honest statement after export.** *"尚未重查；審批及匯出不會解決原有檢查問題"*
   — not yet rechecked; approval and export do not resolve the original finding.

Its 12 demo scenarios (first run, complete, partial, blocked, ambiguous identity,
unconfigured observation, provider failure, awaiting approval, revoked report, quota,
insufficient permission) are the de-facto specification for Phase 1 package F's
honest states.

**No AnsVisor source has been ported into `aiso` in this session**, and no reuse
manifest exists here yet. Porting is Phase 3 per the plan.

## 9. Gate G0

Met. The correct codebase is confirmed, the critical path is traced to real services
and SQL, the two critical trust defects are fixed with tests, and the remaining work
has real locations. The unresolved dependency — applying migrations 040–043 — blocks
*validation of the owner loop*, not unrelated local work.
