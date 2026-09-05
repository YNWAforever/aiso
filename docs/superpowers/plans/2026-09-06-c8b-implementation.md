# C8b portfolio implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development for bounded implementation and independent review.

**Goal:** A tenant-scoped portfolio with truthful visibility/history and creation capacity matching the existing API.
**Architecture:** A batched owned portfolio loader plus pure presentation DTO; share C8a Pulse projection without fetching full workspace agents per client.
**Tech stack:** Installed Next16.2.4, React19, Neon tagged queries, Vitest/Playwright.

## Constraints

Approved design: ../specs/2026-09-06-c8b-portfolio-design.md. Preserve C8a checkpoint and original user continuation plan. No provider, database, environment, credential or customer mutations, deployment, merge or publication. Keep brand creation API, catalogue, entitlement rules and result guards. Active-client display and all-owned-client capacity are deliberately different. Do not infer improvement, comparable trends or provider success. No fresh/stale TTL is invented.

## Task 1: Batched owned loader and pure projection

Own lib/workspace/load-owned-portfolio.ts, lib/view-models/portfolio.ts, extracted lib/pulse/observed-summary.ts and minimal C8a loader import; __tests__/lib/portfolio.test.ts; docs/contracts/fields.md.
- [x] Define stable DTO interface for the UI: owned narrow clients with per-client visibility state/data/observedAt/freshness, history read state/data, capacity known/unknown count/limit; loader accepts authenticated profile with account_id/accounts.
- [x] Add failing tests: account query parameters, authoritative client failure, separate history/Pulse/count failures, no mutation, inactive count, deterministic newest ten history, numeric/date normalization, newest raw-only week, missing/invalid observation denominator, and batched query count independent of client count.
- [x] Extract unchanged pure C8a Pulse validity projection and retain its existing test contract. Implement bounded per-client latest-week SQL across owned clients; never expose raw answers. Derive quota from all owned clients and existing resolver.
- [x] Run new tests plus C8a workspace/API tests and scoped lint. Independent data review.

## Task 2: Portfolio UI and history

Own app/[lang]/dashboard/page.tsx, components/dashboard/BrandCard.tsx, RecentScans.tsx, optional pure PortfolioView.tsx, messages/en.json and zh-HK.json; new page/renderer tests and browser fixture files.
- [x] Read installed Next server/client guides before framework edits. Add failing authenticated page/no-data/failure/capacity tests and real component tests for existing result links and locale dates.
- [x] Consume the shared DTO; keep per-page requireAuth. Show localized unavailable/error/unknown date states; safe all-client cap; separate optional history/Pulse failures. Preserve creation POST and existing guarded result destinations.
- [x] Reuse C8a offline HTML fixture technique for bilingual 375/1440 light/dark ready/empty/error/unknown acceptance; avoid imported TSX in Playwright and make optional fixture requirements explicit. No live authentication bypass or new production fixture route.
- [x] Verify focused tests/lint; independent UI/accessibility review.

## Task 3: Final local verification and handoff

Root owns isolated runners, review artifact and handoff plan.
- [x] Read-only independent review of final C8b diff; address concrete findings without expanding product scope.
- [x] Run complete local units, source lint, isolated default production build, standalone typegen/tsc and configured browser acceptance. Report SQL/Auth mocks and unexecuted live checks separately.
- [x] Export exact C8b diff against C8a checkpoint, reverse applicability check, preserve user file and real index; write handoff with observed results, failures/setup limits and source rollback. Do not implicitly begin C8c–g/C9–C11.


Final local evidence: 2026-09-06-c8b-handoff.md. Base870905a; independent review accepted. Live DB/Auth and hydrated creation acceptance are explicitly unverified.
