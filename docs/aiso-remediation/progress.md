# SDD ledger — plan: docs/superpowers/plans/2026-10-03-aiso-full-remediation.md

Spec: supplied audit report, F01-F19, UC01-UC19 and OP01-OP63. Audit baseline and fetched main f49e1bd. User authorized isolation, implementation, tests, commits, reviewable preview and draft PR; production migrations/deployments, live spend/email, privilege elevation and merge remain separately gated.

Pre-flight: T04 supplies exact version approval to T12; T01 scanner/check versions and access evidence feed T03/T19; T06 eligibility pages feed T07; T10 progress feeds T11; T05 manifests/coverage/leases feed T07/T08/T09; T07/T09/T12 feed T15; all feed T16/T17. No conflicting shared interface found. Original probe passes represent defects.

B0: baseline lint/typecheck exit 0; unit 343 files / 5022 tests exit 0, no skips. Input archive hash verified. Original checkout preserved. Operational unknowns listed in runtime runbook; T00 live acceptance remains 受阻.

T04: RED — source_v1_same_content_can_be_approved fails because approvedAt remains null; artifacts/aiso/T04/before/unit.log.

Ruling: source locking and dependent CTE writes will use the guarded driver's noninteractive transaction array. This preserves one atomic transaction and gives the dependent statement a fresh snapshot after the lock; an insert/update CTE cannot safely update the same source row twice. No interactive callback or raw BEGIN is used. Cost if wrong: isolated concurrency/rollback integration gate fails; writer cannot be accepted.

T04: integration RED — 1 expected failure / 21 existing passes; child br-withered-silence-azg6h2d5 deleted. Baseline schema replay succeeded.

T04: application-role acceptance pending explicit approval. Automatic review rejected an ALTER ROLE password fixture, then rejected reading the existing child's application-role credential. The mutation fixture was removed. No role/password change executed. Only this acceptance is blocked; other implementation and tests continue.

B0 readback: production alias still resolves to dpl_3u2uYmVaoLGqGCTSWraVfUZXjzJ2 / f49e1bd. Seven-day cron aggregation timed out, so outcome remains unknown. Existing local runtime answers aeo_app / neondb with 52 ledger entries; this is not production job/schema acceptance.

T04: implemented exact-version review/approval and identical-content import approval with persistent first actor/time and independent agent permission. Guarded noninteractive batch locking plus dependent CTE provides atomic writes. Migration 055 grants only approval-column UPDATE to aeo_app; old migrations unchanged. GREEN: focused unit 55 tests / 3 files, integration 26 tests / 1 file with all 53 migrations replayed, typecheck and changed-file lint exit 0. Child br-wandering-darkness-azyt07si deleted. Logs: artifacts/aiso/T04/{unit,integration,typecheck,lint}.log. Status 待驗收: actual aeo_app role proof and hydrated browser acceptance remain outstanding; no production migration applied. Rollback: revert task commit; isolated schema can be discarded, production rollback must revoke only the new column grant after checking other dependencies.

T01: RED — 3 failures in llms-content-quality.test.ts reproduce Markdown links ignored and crawler access incorrectly presented as consumer visibility. Original result log: artifacts/aiso/T01/before/unit.log. Implementation in progress.
