# AISO audit remediation 2026-10-11

Audit: 783e54e3fa99f8c14e4cab84a67b42b0b1513c3c. Branch base: 27dd057fa6d5ecaae5bbd342e25cc8579e529d3a (fresh origin/main). PR #85 adds DNS readiness, preserved. Original checkout and untracked user documents untouched.

All seven content hashes match. checksums.json alone has its known stale self-reference; original ZIP preserved.

| Finding | Task | UC | Triage | Status | Evidence |
|---|---|---|---|---|---|
| F38 | T03 | UC01;UC02 | still_present pending reproduction | untriaged | audit inputs |
| F39 | T05 | UC01;UC03;UC04 | still_present pending reproduction | untriaged | audit inputs |
| F40 | T02 | UC03 | still_present pending reproduction | untriaged | audit inputs |
| F41 | T04 | UC04 | still_present pending reproduction | untriaged | audit inputs |
| F42 | T06 | UC06 | still_present pending reproduction | untriaged | audit inputs |
| F43 | T01 | UC05 | reproduced | verified_local | 108/108 synthetic tests; failed raw score preserved, display null; preview pending |
| F44 | T07 | UC07 | still_present pending reproduction | untriaged | audit inputs |
| F45 | T08 | UC08 | still_present pending reproduction | untriaged | audit inputs |
| F46 | T09 | UC09 | still_present pending reproduction | untriaged | audit inputs |
| F47 | T10 | UC10 | still_present pending reproduction | untriaged | audit inputs |
| F48 | T11 | UC11 | still_present pending reproduction | untriaged | audit inputs |
| F49 | T12 | UC12 | still_present pending reproduction | untriaged | audit inputs |
| F50 | T03 | UC13 | still_present pending reproduction | untriaged | audit inputs |

Task order: P00 → T01 → T02 → T06 → T08 → T03 → T04 → T05 → T09 → T12 → T07 → T10 → T11 → R01.

Environment: Node 24.18.0, Next 16.3.8. Locked dependencies installed offline without lifecycle scripts. CI network guard retained. Focused pure/component/API unit tests only after reading fixtures/mocks. Preview Auth/Neon isolation, application-role integration, deployed Worker receipts and production flags are unverified. No live repair claim.

Safe test form: PowerShell CI=1; node node_modules/vitest/vitest.mjs run <read synthetic paths> --reporter=default. Integration provisioning/role authorization must be checked separately before invocation.

Production alias readback 2026-10-11: READY, SHA 27dd057fa6d5ecaae5bbd342e25cc8579e529d3a, target production. This is the unchanged baseline, not the repair branch. Open PR #69 targets a different remediation branch at 216d0cb; do not merge/rebase it as part of this task.
