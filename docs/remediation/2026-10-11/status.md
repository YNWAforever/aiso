# AISO audit remediation — current R01 status

Audit SHA: 783e54e3fa99f8c14e4cab84a67b42b0b1513c3c. Fresh main base: 27dd057fa6d5ecaae5bbd342e25cc8579e529d3a. PR: https://github.com/YNWAforever/aiso/pull/86 . Code candidate: b949145e5cae37d30276e3218403808448fde71e. Original checkout and user documents remain untouched. DNS readiness from PR85 preserved.

T01–T12 implemented. R01 local remediation and independent review complete; exact-head CI and external acceptance status is recorded in verification-summary.json. Release: NO_GO until those gates are green. None of F38–F50 is verified_live.

| Finding | Task | UC | Status | Result | Evidence under evidence/ |
|---|---|---|---|---|---|
| F38 | T03 | UC01;UC02 | verified_local | Recoverable shared onboarding; one brand per durable intent | T03-final.log;R01-persistence-context-green.log;R01-audit-browser-final.log |
| F39 | T05 | UC01;UC03;UC04 | verified_local | First monitoring, recoverable run and bounded classifier-only repair | T05-persistence.log;R01-persistence-context-green.log;R01-audit-browser-final.log |
| F40 | T02 | UC03 | verified_local | Unknown denominators and partial classifications remain distinct | T02-green.log;R01-persistence-context-green.log |
| F41 | T04 | UC04 | verified_local | Frozen attempts/raw and fenced repair; retests outside canonical weeks | R01-persistence-context-green.log;R01-worker-final.log |
| F42 | T06 | UC06 | verified_local | Requested search never implies confirmed execution | T06-green.log;R01-unit-success-fixture.log |
| F43 | T01 | UC05 | verified_local | Failed/unknown collection withholds scores across surfaces and exports | T01-final.log;R01-success-fixture-green.log |
| F44 | T07 | UC07 | verified_local | Complete bounded source scope, source51, evidence paging and full CSV | T07-focused.log;R01-performance.json;R01-audit-browser-final.log |
| F45 | T08 | UC08 | verified_local | Missing competitor domains are unconfigured comparison | T08-green.log;R01-audit-browser-final.log |
| F46 | T09 | UC09 | verified_local | Owned brand selection and primary next step respect plan/setup state | T09-focused.log;R01-e2e-final-full.log |
| F47 | T10 | UC10 | verified_local | Atomic versioned24/50 question batches and durable retries | T10-focused.log;R01-persistence-context-green.log;R01-audit-browser-final.log |
| F48 | T11 | UC11 | verified_local | Five evidence refs → one existing versioned work item; manual done/retest separate | T11-focused.log;R01-persistence-context-green.log;R01-audit-browser-final.log |
| F49 | T12 | UC12 | verified_local | Private PSL tenants, WWW and IDN identities remain separate | T12-focused.log;R01-unit-success-fixture.log |
| F50 | T03 | UC13 | verified_local | Canonical industry and safe URL/context validation; unknown outcome reconciliation | T03-final.log;R01-persistence-context-green.log;R01-audit-browser-final.log |

Order executed: P00 → T01 → T02 → T06 → T08 → T03 → T04 → T05 → T09 → T12 → T07 → T10 → T11 → R01.

Historical task-stage statuses are retained in status-before-R01.md; input audit and RED logs remain unchanged. The audit64/64 is historical and excluded from this run.

Evidence boundaries: PostgreSQL16 loopback fixture uses real SQL, account binding and aeo_app checks; it does not prove Neon Auth. The protected isolated static preview serves actual components/CSS with synthetic data;117 asset hashes and48 presentation checks do not prove hosted transactions or providers. UC12 has no applicable static tenant-enforcement test. Authenticated owner/mobile journey remains a manual gate. All skipped/excluded live/manual cases remain outside the automated-pass claim.

Production Vercel readback still points at baseline27dd057, independent of preview. Latest read-only Worker version receipt7f252113-0809-45bd-a5e6-c99432ee2cd8 has no Git source binding; no candidate Worker deployment or scheduled execution is claimed. Production flags and migrations are unverified. Existing repository disposable-role authorization is enabled; CI uses its unchanged guard, not an override.


CI fixture recovery at b949145: preceding exact-head CI38147437065 is FAILURE, not a timeout: core231/241 plus exact-target170/178 =401 passed /18 failed /0 skipped; four E2E shards938/938 passed. Five fixture repairs supply confirmed market/region for valid contexts, create the canonical citation manifest before inserting the retained legacy row, expect missing onboarding context to remain pending, and assert the immutable stored SOV question after editing the prompt bank. No application/guard code changed. Actual local PostgreSQL reproduced10 failures/7 passes then17/17 passed; the new strict config covers four core files, not alerts exact-target or the whole Neon suite. Original RED remains evidence/R01-ci-a33c0ef-red.json and R01-ci-fixture-red.log. Fresh full six-class CI remains required.
