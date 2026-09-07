# C9f-C11 remaining-work inventory

Date: 2026-09-07. Baseline: a7bcea3c7c306c44d83e567598909f9594183b79; tested C9e application 92f69dd. The original proposal below is retained as historical context; the current C9f implementation and local verification status are recorded in the update below. This is not live acceptance.

## Migration report

The user reports that migration 043 has been applied. Record this as USER-REPORTED APPLIED; it supersedes the current-status assumption that no external operator has applied it, but does not rewrite the historical C9e local-run evidence. No migration was run by this task.

Exact Neon project, branch, database, owner/application role, applied checksum and prerequisite ledger have not been verified. The requested target identifiers are pending. Do not reapply 043 or run fixture-writing integration suites on an unidentified target. C9d/C9e SQL suites remain AUTHORED/UNRUN by this agent. An applied migration alone is not proof of application-role privileges, constraints or concurrency behavior.

## Completed work to retain

C9a-e source is present. C9e local checks at92f69dd:2945 unit tests,182 selected browser cases,52 fixtures,lint/typegen/tsc/build passed and independent review approved. Browser calls were intercepted fixtures. C9d and C9e draft/review/delivery APIs, immutable snapshots and audited corrections remain unchanged.

The C10 inventory already records bounded local cron-ledger/error and preview-cleanup guard repairs; do not repeat those as new work. Its deployed scheduler, provider, cleanup and credential evidence was not established by those mocked checks. C11 has a readiness dossier, not a completed cutover.

## C9f proposed first slice

Recommend stored-evidence outcome windows before automatic collection: D7/D28/D56 are derived from the active C9e attestation's declared delivery timestamp, explicitly self-reported. Withdrawal invalidates that anchor; replacement does not relabel old observations as newly measured. Show due, awaiting evidence, not comparable and observed-change states distinctly. Do not convert absence into a zero result or claim causal impact.

Select observations only from the owned client's retained supported sources. Pin source IDs, actual collection timestamps and method/platform/prompt/market/coverage context. A subsequent specification must define baseline eligibility, each window's observation interval/tie-break rule, late/missing data, withdrawal/replacement behavior and response freshness before implementation. Existing run/provider controls remain separate; opening an outcome screen must not trigger a paid scan, real email or provider request.

Three approaches:
1. Stored-evidence windows and strict compatibility gates (recommended): local product progress with no new provider authority; unavailable comparisons stay explicit.
2. Introduce new comparison-capable scan evidence first: enables a stronger future scan comparison but expands the collector/versioning contract and requires separate validation; never reinterpret old evidence.
3. Automatic rechecks/connectors now: requires selected providers, budget/idempotency/scheduler ownership and exact external authorization, so it is not an implicit continuation.

Current blocker to generic scan deltas: docs/contracts/versioning.md and lib/scan-evidence.ts compareScanEvidence explicitly reject evidence v1 improvement comparisons because final-path identity is withheld. Matching signatures alone do not establish comparability. lib/reports/comparison.ts's report-change classification is not a substitute for that scope/method gate and must not be reused alone to claim delivery impact. Preserve historical scores and evidence under their original policies.

## Remaining acceptance map

| Work | Next concrete deliverable | Evidence/authorization boundary |
| --- | --- | --- |
| C9e database closure | Inspect exact applied ledger/checksum and schema/application-role identity; prepare dedicated disposable proof target and commands | Target identifiers pending; fixture writes/provisioning require exact scope approval, not an assumption based on 043 applied |
| C9f | Implementation complete at a7cae4fd; local verification and independent whole-diff source/evidence review APPROVED; local documentation handoff complete | No paid or automatic collection; compatibility is not causal attribution; live SQL remains unverified |
| C10 scheduler/cleanup | Reconcile actual deployed origin, one producer per job, logs/ledger outcomes, TTL/orphan cleanup and sterile parent | Read-only evidence first; no workflow retirement, branch deletion, secret rotation or settings mutation inferred |
| C10 Auth/billing/AI/email | Exact isolated verification plan, current owner/account mapping and failure/replay/cost boundaries | No real email, charge, paid scan, credential/provider mutation or customer write without scope-specific approval |
| C10 connector | Select first connector and approve scopes/account mapping/revocation/provenance contract | No connector selected; GSC remains a candidate |
| C11 | Refresh exact-release readiness dossier, C1 equivalence through required schema, named owners, sterile topology, write fences and measured recovery evidence | No production cutover, deployment, migration, merge or customer write inferred |

C11 operational target identities remain unverified. Historical topology values are not live bindings. Preserve recorded recovery targets until an explicit material change is agreed; targets are not measured guarantees. Every proposed external action needs exact target, reviewed diff, expected validation/abort conditions and retention-aware rollback before approval.

## This continuation's evidence

Read current branch/status, C9e handoff/spec, C10/C11 inventory and scan versioning contract. Refreshed aiso-c9bc graph and inspected compareScanEvidence and compareReportEvidence via graph snippets. No application code or tests changed; no new unit/browser or live SQL result is claimed. At the original inventory point C9f policy was proposed; it was subsequently approved, implemented and independently reviewed through Tasks 1-4. Original C9e implementation branch is retained unchanged.
## C9f implementation update — 2026-09-07

Approved stored-outcomes.v1 is implemented at a7cae4fd9005e56991b5a067b38dc980d622d4f9. Full unit 3083/265, component 317/41, fixture generation 76/12, lint/typegen/TypeScript/build passed at that SHA. Final browser matrix passed 266/266 (133 per project, zero skipped/unexpected/flaky, errors=[]); independent whole-diff source/evidence review is APPROVED. See [C9f local handoff](2026-09-07-c9f-handoff.md) for precise commands, timings, artifacts and limitations. This supersedes the historical proposed-first-slice status above. Migration 043 remains user-reported applied with exact target/live evidence unverified; all C10/C11 boundaries remain open.

## C9d/C9e PostgreSQL proof update - 2026-09-07

The user confirmed synthetic-only parent history and approved a disposable test branch plus migrations040-043 and the three dedicated SQL suites. Created child br-hidden-hill-az61ux9z in AISO project weathered-wave-50814522, applied and checksum-verified040-043 only there, and executed approvals21/21, actual stores15/15 and delivery67/67:103 passing PostgreSQL tests. Five DELETE SQLSTATE expectations were corrected after reproduced failures; no application/schema behavior changed. Independent bounded review approved. See [exact-target proof](2026-09-07-c9-postgres-proof.md).

This supersedes AUTHORED/UNRUN for those three suites only. The AISO parent still has no040-043 ledger entries and no version/delivery tables. Application migration/release, C1 equivalence, generic entity/work-item integration and C10/C11 operational evidence remain separate. Test branch retained; no automatic cleanup, release or Worker activation.
