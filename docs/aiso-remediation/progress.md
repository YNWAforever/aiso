# SDD ledger — plan: docs/superpowers/plans/2026-10-03-aiso-full-remediation.md

Spec: supplied audit report, F01-F19, UC01-UC19 and OP01-OP63. Audit baseline and fetched main f49e1bd. User authorized isolation, implementation, tests, commits, reviewable preview and draft PR; production migrations/deployments, live spend/email, privilege elevation and merge remain separately gated.

Pre-flight: T04 supplies exact version approval to T12; T01 scanner/check versions and access evidence feed T03/T19; T06 eligibility pages feed T07; T10 progress feeds T11; T05 manifests/coverage/leases feed T07/T08/T09; T07/T09/T12 feed T15; all feed T16/T17. No conflicting shared interface found. Original probe passes represent defects.

B0: baseline lint/typecheck exit 0; unit 343 files / 5022 tests exit 0, no skips. Input archive hash verified. Original checkout preserved. Operational unknowns listed in runtime runbook; T00 live acceptance remains 受阻.

T04: RED — source_v1_same_content_can_be_approved fails because approvedAt remains null; artifacts/aiso/T04/before/unit.log. Implementation pending.

Ruling: source locking and dependent CTE writes will use the guarded driver's noninteractive transaction array. This preserves one atomic transaction and gives the dependent statement a fresh snapshot after the lock; an insert/update CTE cannot safely update the same source row twice. No interactive callback or raw BEGIN is used. Cost if wrong: isolated concurrency/rollback integration gate fails; writer cannot be accepted.
