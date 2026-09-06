# C9c partial local implementation handoff

> **Superseded final status:** This historical partial handoff is superseded by [the final C9c handoff](2026-09-06-c9c-handoff.md). The user explicitly resolved the former recommendation-policy question by finishing C9c with Pulse and scan-check evidence only. Recommendations are deferred and are not a pending C9c decision. Historical evidence below is retained as recorded.

Date: 2026-09-06. Source checkpoint: `d2994489e39f56589ba6a7a5f0f04e340157e65f` on `codex/c9b-c9c-implementation`, in `.worktrees/c9b-c9c`.

## Completed and independently reviewed

C9b is complete at source commit `adbd317f511765b566e2a0e863fbc64da0bb3f47`, with its verification and limitations recorded in [the C9b handoff](2026-09-06-c9b-handoff.md).

C9c Task 1 is complete only for common types, canonical fingerprints, safe snapshot validation, and the Pulse/scan-check rules. It derives suggestions deterministically, excludes incomplete evidence, retains unknown provenance and validated scan methods, and excludes raw answers from public suggestions and snapshots. Snapshot validation binds rule arguments to eligible evidence, rejects unexpected nested values, and enforces the 65,536-byte serialized limit. Canonical hashing preserves own special property names. Recommendation derivation remains deferred.

C9c Task 3 supplies strict create/edit inputs, browser-compatible UTF-8 limits, separate server cursor helpers, and the authored additive `supabase/migrations/041_evidence_work_items.sql`. The SQL defines tenant ownership, retained immutable evidence storage, draft status, revision/length/size constraints, unique opportunity identity and narrowed application grants. These are source contracts, not verified database behavior. No migration has been applied.

Both implemented portions passed independent spec and quality review after fixes. No opportunities or work-items endpoint, save/edit store, or user interface has been activated.

## Verification actually run

- C9c rules/fingerprints: 67 focused tests passed after the final consistency fix.
- Draft schema, migration contracts and test-configuration isolation: 38 focused tests passed after the final review fixes.
- Next type generation and full TypeScript passed for the rule checkpoint; full TypeScript also passed after the schema/configuration fixes.
- The earlier complete C9b checkpoint passed 2,351 unit tests and 106 browser cases. Its later platform-control fix passed 18 page/renderer tests, 26 fixture tests, 20 browser cases, lint, full TypeScript and build. These are separate runs, not a claimed full C9c suite.
- Scoped lint over all new C9c modules, tests and integration configurations passed at the handoff checkpoint.
- Four disposable-database integration cases were authored but not executed: cross-account FK rejection, actor/source deletion retention, concurrent uniqueness and application grants.

The new database suite is excluded from `vitest.integration.config.ts`, whose provisioning setup would otherwise run before suite guards. Its dedicated `vitest.work-items-integration.config.ts` has no setup hooks. Future execution requires explicit approval and the suite's exact disposable project/branch/owner/connection identity guards; no target was selected or provisioned here.

## Material decision still needed

Existing recommendation reads use `features.agent_recs` and `platform_access` in `lib/workspace/load-owned-workspace.ts`. The approved draft design did not settle how those paid-read restrictions apply to recommendation evidence retained in saved drafts after downgrade.

The pending choice is to defer recommendation-derived drafts and finish Pulse/scan-check drafts first, or include recommendations while preserving existing plan/platform gates, including the policy for access to saved evidence after downgrade. No default has been assumed.

## Remaining implementation

- Finish recommendation rules only if included by that decision.
- Task 2: owned bounded source readers, source availability/window semantics, saved-draft mapping and the authenticated suggestions endpoint.
- Task 4: streamed request caps, final JSONB-size preflight, server-derived conditional save, duplicate replay, revisioned edits and owned read/list APIs.
- Tasks 5-6: bilingual suggestion/save/edit UI, fixtures, complete flow verification, contracts and final whole-slice review.

C9c is not complete or ready for activation. No next product slice is started by this handoff.

## Preservation and rollback

The original checkout remains on `codex/c9b-c9c-design`; its user-owned continuation plan is preserved. No push, merge, deployment, live migration, database/provider/environment/credential mutation, customer write, real email or paid scan was performed.

Before activation, rollback is source-only removal or reversion of the new C9c modules, schema file and dedicated test configuration; C9b can remain. If the migration is later applied under separate approval, retain the additive table and saved drafts rather than dropping customer data. Any future external action needs an exact target, SQL/application diff, validation and rollback proposal first.
