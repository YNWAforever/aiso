# C8a Workspace Outcome Home Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for bounded tasks and independent whole-diff review.

**Goal:** A default owned-client outcome home using actual data, honest availability and server-enforced existing entitlements.
**Architecture:** A shared read-only owned loader supports home and overview API. A pure narrow DTO projection drives the server-rendered home. Explicit legacy step links and guards remain intact.
**Tech Stack:** Next.js16.2.4/React19, next-intl, existing Neon tagged queries, Vitest and Playwright fixtures.

## Global constraints

- Approved spec docs/superpowers/specs/2026-09-06-c8a-workspace-home-design.md. Base d72ca72; branch codex/c8a-workspace-home. No external actions, provider/database writes, applied migrations, deployment, publication or merge.
- Keep clientId/account ownership, existing catalogue/entitlement resolver and all explicit scan/results/improve/monitor/roi links.
- No stale threshold invention; timestamps and unknown freshness. Missing/failed collection or absent successful denominator is unavailable, not zero. No outcome attribution, published-draft or verified-entity claims.
- Home must never invoke writing Local Trust/ROI services. Keep source C7 and original continuation plan preserved.

## Task1 — Owned loader, DTO and overview boundary

Files: new lib/workspace/load-owned-workspace.ts and lib/view-models/workspace-home.ts; app/api/clients/[clientId]/overview/route.ts; tests __tests__/lib/workspace-home.test.ts and __tests__/api/clients-overview.test.ts; docs/contracts/fields.md mapping.
- [x] Map exact input/DTO fields and exports for UI before implementation. Return distinct ready/empty/error/locked section states and owned client absence.
- [x] Write failing tests for real query-bound account/client parameters, invalid scanId isolation, no writes, optional-section failures, new latest Pulse window beyond40 rows, absent/zero-success denominators and existing role/trial/override entitlements.
- [x] Implement owned client lookup before further reads. Join/account-filter dependent queries; select the true newest available Pulse week, requiring its same-week aggregate for a KPI, plus its platform data, retaining a recent chronological history for compatible API fields. Resolve current entitlements; omit paid queries/data when forbidden, including recommendation platform filtering.
- [x] Pure DTO emits selected persisted scan diagnostics, dates, permitted generated work and real latest observed KPI only. Partial home sections can fail independently; API retains401/404/500 semantics rather than disguising errors as empty200.
- [x] Focused tests/lint and independent data/security review.

## Task2 — Default home and guarded navigation

Files: app/[lang]/dashboard/[clientId]/page.tsx; new components/dashboard/WorkspaceHome.tsx; DashboardSidebar.tsx; messages/en.json andzh-HK.json; relevant page/sidebar/renderer tests; tests/e2e/c8a-workspace-home.spec.ts (fixture-only where real Auth unavailable).
- [x] Add failing default-home/legacy step-link/no-ROI-write tests and bilingual home state rendering tests.
- [x] Default omitted step to home, keep explicit legacy steps and scanId handling. Page uses requireAuth independently from layout; new loader errors preserve missing-vs-load-failure distinction.
- [x] Render brand, persisted site health, latest observed visibility, generated recommendations, history/tool links with meaningful empty/locked/error states and clear observation dates. Reuse C7 stored diagnostics where appropriate.
- [x] Add Home navigation and keep all existing steps; adapt small-screen navigation without hiding it or overflowing375px. Preserve subroute active behavior.
- [x] Run focused tests and independent UI/access review.

## Task3 — Notification unknown state and final verification

Files: app/[lang]/dashboard/layout.tsx; components/dashboard/NotificationBell.tsx; bounded notification tests; handoff docs.
- [x] Reproduce initial notification-query error currently rendered as0; pass/display unknown state while retaining load/retry behavior and account filter. No new endpoint or raw errors.
- [x] Test final source with complete local units, source lint, standalone typecheck, isolated production build, focused bilingual mobile/desktop component/browser fixtures and existing affected page/guard regressions. Report mocked Auth versus real-service limits.
- [x] Independent whole-C8a review; resolve findings. Export reviewed diff against d72ca72, preserve user files, handoff with exact results and rollback. C8b-g/C9-C11 remain later approved contracts/operations.

Final evidence: see 2026-09-06-c8a-handoff.md. Independent review accepted; live service and hydrated shell acceptance remain explicitly outside local fixture evidence.
