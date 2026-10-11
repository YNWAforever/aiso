# AISO audit remediation 2026-10-11

Audit: 783e54e3fa99f8c14e4cab84a67b42b0b1513c3c. Branch base: 27dd057fa6d5ecaae5bbd342e25cc8579e529d3a (fresh origin/main). PR #85 adds DNS readiness, preserved. Original checkout and untracked user documents untouched.

All seven content hashes match. checksums.json alone has its known stale self-reference; original ZIP preserved.

| Finding | Task | UC | Triage | Status | Evidence |
|---|---|---|---|---|---|
| F38 | T03 | UC01;UC02 | reproduced | verified_local | T03 69/69 focused; concurrent same-intent brand persistence; Auth/seed browser pending |
| F39 | T05 | UC01;UC03;UC04 | reproduced | verified_local | T05 26/26 focused; 26/26 real local SQL; 8/8 functional browser fixtures; preview persistence pending |
| F40 | T02 | UC03 | reproduced | verified_local | T02 72/72 synthetic tests; partial classified denominator and null gaps; preview pending |
| F41 | T04 | UC04 | reproduced | verified_local | T04 23/23 focused; real SQL fencing and immutable raw/citation repair; canonical/retest isolated |
| F42 | T06 | UC06 | reproduced | verified_local | T06 27/27 provider-response fixtures; request versus execution evidence; live provider untested |
| F43 | T01 | UC05 | reproduced | verified_local | 108/108 synthetic tests; failed raw score preserved, display null; preview pending |
| F44 | T07 | UC07 | still_present pending reproduction | untriaged | audit inputs |
| F45 | T08 | UC08 | reproduced | verified_local | T08 52/52 prerequisites fixtures; competitor configuration CTA corrected in T09 |
| F46 | T09 | UC09 | reproduced | verified_local | 58/58 focused; real routes, setup outage distinct; CSS/accessibility preview matrix pending |
| F47 | T10 | UC10 | still_present pending reproduction | untriaged | audit inputs |
| F48 | T11 | UC11 | still_present pending reproduction | untriaged | audit inputs |
| F49 | T12 | UC12 | reproduced | verified_local | 45/45 PSL and citation fixtures; private suffixes, IDN, stable kinds; read-only dry-run spec |
| F50 | T03 | UC13 | reproduced | verified_local | T03 canonical industry and safe URL syntax; legacy missing context stays pending |

Task order: P00 → T01 → T02 → T06 → T08 → T03 → T04 → T05 → T09 → T12 → T07 → T10 → T11 → R01.

Environment: Node 24.18.0, Next 16.3.8. Locked dependencies installed offline without lifecycle scripts. CI network guard retained. Focused pure/component/API unit tests only after reading fixtures/mocks. Preview Auth/Neon isolation, application-role integration, deployed Worker receipts and production flags are unverified. No live repair claim.

Safe test form: PowerShell CI=1; node node_modules/vitest/vitest.mjs run <read synthetic paths> --reporter=default. Integration provisioning/role authorization must be checked separately before invocation.

Production alias readback 2026-10-11: READY, SHA 27dd057fa6d5ecaae5bbd342e25cc8579e529d3a, target production. This is the unchanged baseline, not the repair branch. Open PR #69 targets a different remediation branch at 216d0cb; do not merge/rebase it as part of this task.

T05 browser fixture note: first mobile configuration inherited an oversized selection and was interrupted. That log is retained as T05-browser-misconfigured.log and is not acceptance evidence. A corrected --list showed exactly 8 intended cases; all 8 passed. These functional fixtures initially used no production CSS; the final CSS matrix remains pending.
Local PostgreSQL: task-owned labeled cached container on 127.0.0.1:55439; external HTTP denied; real db binding and aeo_app enforced. Migrations 063-067 are local-only. No protected remote role or production mutation.
