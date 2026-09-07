# C8c–g implementation plan

> Use superpowers:subagent-driven-development for bounded implementation and independent review; writing-plans and verification-before-completion apply.

Goal: complete the approved existing-workspace adaptations while preserving service/security boundaries. Architecture: narrow owned read models and truthful localized presentation on existing routes. Stack: installed Next16.2.4, React19, Neon tagged queries, Vitest/Playwright.

## Global constraints

Approved design: ../specs/2026-09-06-c8c-g-workspace-design.md. Preserve C8b checkpoint and original user plan. No external/database/provider/customer mutation, migration, credential operation, actual email/scan/billing call, deployment/push/merge. Tests use isolated dummy settings and mocked writes. No C9 role/approval/delivery inventions. Read installed Next guides before framework changes.

## C8c — Demand / Pulse

- [x] Map prompt guard/editor, MonitorStep, fenced Pulse page and shared observed-summary projection to exact owned fields.
- [x] Write red tests for restored page auth/ownership/error; per-week observed validity/chart gaps; preserve prompt read/write gates/categories/quota and failed client fetch states.
- [x] Add bounded owned Pulse loader/DTO as necessary, restore authenticated read-only Pulse page, align MonitorStep with valid evidence and unknown/no-data states. Keep URLs and existing mutations; no raw-answer exposure or provider invocation.
- [x] Focused tests/lint and independent review.

## C8d — Generated work

- [x] Trace reachable Fix Pack/content/agent presentation; preserve orphan/fenced components.
- [x] Reproduce reachable generation/persistence/copy error or misleading-state defects. Fix only those, label generated work as drafts, preserve API DTO/ownership/entitlements/platform gates.
- [x] Focused interaction/contract tests and bilingual browser/renderer evidence; independent review.

## C8e — Reports / sample

- [x] Verify existing report lifecycle/public DTO/comparison/revocation contracts; avoid replacing them.
- [x] Add pure explicitly synthetic sample-report presentation and localized route metadata/NAV/sitemap; activate frozen temporary /r/demo redirect only with destination. No DB/view-count/provider calls.
- [x] Sample and lifecycle regression tests, browser/SEO/redirect checks; independent review.

## C8f — Local Trust / alerts

- [x] Trace existing explicit ROI read/write boundary, guards, alert/notification state and deduplication tests.
- [x] Reproduce demonstrated no-data/error/interactive accessibility gaps; repair bounded presentation without changing feature gates, metrics, dedup or scheduler. No new implicit snapshot creation on read-only views.
- [x] Guard/denied-query/failed-write and UI tests; independent review.

## C8g — Settings / billing / agency

- [x] Localize remaining settings copy, missing status as unknown, preserve catalogue/resolver/Stripe endpoint and report branding boundaries.
- [x] Verify onboarding/agency navigation already completed; fix only demonstrated remaining status/accessibility defects, no new roles or prices.
- [x] Page/entitlement/renderer tests and browser acceptance; independent review. Real Auth/billing coverage stays separately gated.

## Final handoff

- [x] Per-slice field-contract amendments and exact source diff; independent whole-batch review.
- [x] Complete units, source lint, isolated default production build, standalone typegen/tsc and configured bilingual browser acceptance. Explicit mock/offline versus live limits.
- [x] Export exact local patch/manifest with reverse check, preserve user file and real index. Record failures/blockers and C9–C11 material decisions; no implicit external actions.

Verification caveat: final-build browser run had one intermittent existing C7 retry timeout; immediate rerun and 10 repeated cases passed. See handoff for exact totals and evidence limits.
