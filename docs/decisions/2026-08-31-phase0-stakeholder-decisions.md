# Phase 0 stakeholder decisions

**Approver:** Product Owner
**Date:** 2026-08-31
**Governs:** plan §24, all 13 decisions

`aiso` is a public repository, so this record identifies the approver by role rather than
personal contact information.

| # | Decision | Recorded |
|---|---|---|
| 1 | Canonical repo | `aiso` — Approved |
| 2 | Neon project/region/topology/owner | `fimmick-aiso-v2-prod` + non-prod; AWS region (exact region selected at implementation time, item 1.1); budget owner = Product Owner |
| 3 | Bootstrap strategy | Option A, clean greenfield |
| 4 | Identity migration | Fresh identities, no migration |
| 5 | Production data copy | None — Approved |
| 6 | RLS vs explicit scoping | Keep explicit scoping; defer RLS |
| 7 | Scoring/pillars | Approved; adopt coverage-gate semantics |
| 8 | Route classification | Per plan §9 matrix as written |
| 9 | n8n/cron ownership | Retire n8n Pulse; Cloudflare owns scheduling |
| 10 | Stripe catalogue | Unchanged — Approved |
| 11 | Locale/redirect/rollback policy | Keep `en` default; 308/307 split as specified; internal dark-launch |
| 12 | Cutover posture | Separate v2 now; cutover approved separately later |
| 13 | Non-prod topology/RPO/RTO | Sterile-parent non-prod project; RPO/RTO per plan §16.3; budget owner = Product Owner |

## Session authorization

```
APPROVED DECISIONS (plan §24):     1-13, per table above
APPROVED PHASE:                    Phase 0 (all items)
APPROVED WORK ITEMS THIS SESSION:  0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.10, 0.11, 0.12
                                    (0.1, 0.2 already complete)
NEON RESOURCE CREATION:            NOT AUTHORIZED
DONOR CHECKOUT AVAILABLE AT:       not available
```

Neon resource creation stays unauthorized regardless of the decisions above being recorded —
that authorization is its own separate line and needs its own explicit go-ahead when Phase 1
actually starts.
