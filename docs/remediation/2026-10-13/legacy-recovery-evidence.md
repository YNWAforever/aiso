# T36 continuation — legacy collection and producer inventory

The legacy `/api/pulse/run` compatibility writer requested provider answers before checking retained raw evidence. With the run-ledger flag off, retrying an already accepted answer could therefore pay and recollect it. Its duplicate guard also included same-week retest metrics, suppressing a missing canonical answer.

The minimal correction reads owned, prompt/platform/week-scoped nonblank canonical or legacy evidence before dispatch, collects only missing allowed platforms, and fails closed with HTTP503 if this read fails. Classification-unknown raw stays authoritative and is not recollected or reclassified. The insertion guard excludes retest data; blank cleanup only replaces legacy rows and never deletes run-linked evidence. A real PostgreSQL regression then demonstrated that the old `btrim` predicate left tab/newline-only rows behind; cleanup now uses the same whitespace predicate as retention.

Traceability: T36 producer safety and T34 tenant/unknown boundary supplement UC66 recovery and UC78 ownership. These tests do not close their outstanding actual Auth/hosted/provider portions. Original audit rows and initial case history remain unchanged.

## Executed evidence

- Behavioral RED: three unit failures and two app-role SQL failures before implementation. Initial server-only/date fixture setup failures are retained separately.
- Additional whitespace RED: four SQL cases passed, whitespace replacement failed (3 rows instead of2). The earlier nonexistent test projection column was corrected without a schema change.
- Focused GREEN:47/47 unit (4 new recovery cases plus43 existing),0skip.
- Real app-role PostgreSQL GREEN:36/36 across all four local-persistence files,0skip. All new SQL5/5 cases verify retained unknown raw/citations, canonical ledger reuse, retest exclusion, whitespace cleanup, and foreign/prior-week preservation. Transport is exact loopback PostgreSQL, provider is synthetic, Auth evidence is mock/cron fixture only.
- Full current unit coverage6143/6143 passed,0skip; lint/typecheck/Next build exit0. One historical generated Worker-bundle lint warning is retained. See legacy-recovery-local-receipt.json for source-content and report hashes. Exact-head CI remains pending until the new source commit is published and validated; CI178/179 are earlier snapshots.

## Producer scope and limits

Source inventory finds the scheduled Pulse GET, legacy/internal POST, dashboard run creation, work-item retest wake and run-ledger consumer. The Vercel config has no scheduled entries. The archived n8n workflow has a webhook and paid AI-summary HTTP producer plus PostgreSQL/Slack nodes; its exported `active` field is absent. That export does not prove live n8n state or a complete producer inventory.

The feature flag routes ledger versus compatibility collection; it is not a global pause switch. This correction protects sequential retries of accepted raw. Concurrent initial legacy collection and unknown paid outcomes still require the existing run-ledger path before activation. No cron/producer was invoked or enabled, and no provider request was made.

Worker target remains the existing paused `aiso-cron-worker` version; default three-cron and dedicated two-cron configs would enable Pulse and must not be published. Keep the exact reviewed one-cron paused configuration.

Until live n8n/other producer inventory closes, a proposed zero-dollar external package is restricted to isolated Auth/account/profile controls. Brand completion, AI suggestions/seeding, prompt apply, monitoring/run/retest creation and paid classifiers are excluded. Any zero-paid test overlay must be independently verified before broader business-flow acceptance. Previous protected-preview access rejection remains blocked; no protection bypass or alternate account is permitted.
