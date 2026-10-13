# T30/T36 candidate release evidence

Status: candidate prepared; production release and hosted/real-Auth acceptance remain NO_GO. No finding is verified_live in this execution. Source input files are historical records, including source-manifest.json and the initial execution-evidence.json; current results are additive in acceptance-results.csv, finding-results.csv, task-results.csv and release-evidence.json.

Local main initially a7ab604e. Origin main advanced to117c0e854c51d95f77ca6f07b5f685ff5209568f and PR92 merged from6e074aee; incorporated locally atfc5b3119. PR90 remains open/draft ee9a457a; PR91 merged a7ab604e. Historical audit SHA is not a checkout command. Local test source8de66695b8db92e1ae6079aa2daf4514d3121e22, treef5e39cfa855eee1611ea174406e0ed066890fd10; later changes only add UC75 test fixtures and release documents. The final PR/CI receipt binds the publication head and tree separately, without pretending this document can contain its own commit hash.

| Evidence | Executed result | Environment/limit |
|---|---|---|
| Full local unit coverage |6139/6139 pass,0fail/skip|8de source; synthetic mocks, CI network guard|
| Final affected browser |128/128 pass,0skip/flaky|8de source; Chromium/mobile, EN/zh-HK; actual compiled components|
| UC75 composite |4/4 pass,0skip/flaky|f944473f test treeaaa1f099; real components/synthetic HTTP|
| App-role persistence |30/30 pass,0skip|8de; loopback PostgreSQL aeo_app; mock session|
| Worker |11/11 local tests/typecheck; paused dry-run exit0|unchanged Worker source; no upload/invocation|
| Static/build |lint/typecheck exit0 (one ignored generated-bundle lint warning); Next16.3.8 build completed18/18 static pages|sanitized fixtures, no formal credentials|
| Earlier browser baseline |1332 pass,6skip,0fail/flaky|fc5b source; not final same-head evidence|
| Completed CI178 |6139 unit/419 SQL/1366 browser/11 Worker;0fail/skip/flaky|source9b16d704; tested merge37f5d23c; identical treeadd6d7ec; see ci-178-receipt.json|
| Hosted candidate acceptance |0 executed; blocked|prior protected-login auto-review rejection; no bypass|
| Real Auth / Admin |0 actual sessions/grants|identity not provisioned; synthetic guard evidence separate|
| Real provider / humans |0paid;0/10quality;0/5humans|budgets, keys and people missing|

The six older browser skips were only obsolete email-gate Supabase credential preconditions. They remain historical skip; mandatory synthetic fixture mode plus all original assertions now execute locally. This is not real magic-link or mail proof. Original40 result history22pass/7fail/9blocked/2not-tested and two RED reproductions stay unchanged. New20 initial not-tested rows also stay unchanged; their current narrower results are separate. Never sum overlapping targeted suites or copy historical live passes to this candidate.

Fresh read-only formal metadata points aiso-kappa.vercel.app to dpl_BH5bE72VqSoiiwWRWgRsRq619kto, READY, source117c0e854c51d95f77ca6f07b5f685ff5209568f. This PR92 publication was by another publisher, not this candidate. READY proves deployment state only. Owned runtime GET and current provider chain were not newly observed.

Exact formal Neon read: ledger69,063–070 normalized source checksums8/8 match; no migration rerun. Current Worker aiso-cron-worker versiona3f46e65-aa0f-4d62-9a7c-a007e1abde64 at100%, only weekly alerts47 7 * * 1; Pulse daily trigger absent. The source default config instead names fimmick-aeo-cron-worker and three crons: never publish that default as this release. Paused dry-run uses the archived exact target/one-cron config with validated absolute local main.

Cleanup: latest app-role readback16 test-owned account IDs; accounts/brands/runs/onboarding/batches all0. Existing local fixture container retained; no blanket reset. Browser contexts disposed and synthetic fixture teardown has no external effect. No formal Auth/account creation, role grant, migration, provider request, Worker publish or production merge/deploy by this execution.

Completed CI178 is published in ci-178-receipt.json; its source SHA/tree are frozen historical evidence. Current task/case results now include UC46 and UC79 passing that snapshot. A subsequent documentation commit has a different tree and requires its own exact-head CI receipt before claiming current-head CI completion. Earlier pending-CI records are preserved in snapshots/. Preview READY without approved access remains blocked. Release operations and compatible rollback are in release-operations.md.

Continuation on2026-10-13: PR93 still open/draft, mergeable, no review submissions or threads; CI178 remains successful. Formal alias metadata still source117c0e85 / dpl_BH5bE72VqSoiiwWRWgRsRq619kto. No protected-preview fetch, production POST, provider call, migration or grant was attempted.

T36 legacy recovery supplement:47/47 focused unit,6143/6143 full unit coverage,36/36 app-role PostgreSQL,0skip; lint/typecheck/build exit0. See legacy-recovery-evidence.md and legacy-recovery-local-receipt.json. These are local guarded source-content receipts; the new commit still needs its own CI/preview identity before current-head completion. Historical CI178/179 and original audit results remain separate. Pulse/Worker/provider were not invoked or enabled; no formal mutation occurred.
