# C7 Scan and Credible Results Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for bounded implementation and independent review. Continue authorized local tasks without routine approval questions.

**Goal:** Deliver localized scan/methodology routes and honest, versioned result diagnostics while preserving access and claim behavior.
**Architecture:** Existing scan API and access boundary remain authoritative. A pure evidence-to-pillar input seam and versioned snapshots separate measured coverage from benchmark scoring. Public pages reuse the shell; sensitive result pages retain their own layout.
**Tech Stack:** Next.js 16.2.4, React 19, next-intl, Tailwind 4, Vitest and Playwright; mocked database/Auth for local tests.

## Global constraints

- Approved design: docs/superpowers/specs/2026-09-05-c7-c11-design.md. Base: 1f96315 (C4-C6 plus pricing badge fix). Branch codex/c7-scan-results.
- No external mutation, provider calls, real email, paid scan, migrations applied, deployment, publication or merge. Preserve original user continuation plan.
- Preserve headline score/grade, weights, URL policy, metadata API, tenant guards, signed claims and old stored snapshots.
- Gate unrounded weighted coverage: <0.67 insufficient_evidence, [0.67,0.85) provisional, >=0.85 scored. Explicit not-applicable removes weight; missing/failed/unknown/ambiguous partial evidence does not count as complete observation. Zero denominator is insufficient.
- No raw evidence/excerpts or private details in public DTOs. No migration or backfill.

## Task 1 — Pure diagnostic contract and snapshot writer

Files: lib/pillar-scores.ts; minimal pure evidence type seam if needed; lib/scan-evidence.ts; app/api/scan/route.ts; __tests__/lib/pillar-scores.test.ts; evidence and scan flow tests; docs/contracts/versioning.md and fields.md.
- [x] Write failing threshold/exact-boundary, zero/N-A/missing/failed/partial and legacy snapshot tests.
- [x] Implement new discriminated pillar state with suppressed numeric score for insufficient evidence, unchanged stored v1 compatibility, and new methodology version. Separate old envelope version recognition from current producer constants so a version bump does not invalidate C6 evidence.
- [x] Build validated evidence before calculating the new snapshot in the existing insert; avoid cyclic imports and new network/database operations.
- [x] Run focused regression tests and independent contract review.

## Task 2 — Scan page, errors and methodology

Files: app/[lang]/(marketing)/scan/page.tsx and methodology/page.tsx; components/home/ScanForm.tsx; lib/navigation.ts; messages/en.json and zh-HK.json; focused SEO/form tests; tests/e2e/c7-public.spec.ts.
- [x] Add failing tests for distinct metadata/routes and exact sitemap coverage 48 URLs (24 routes).
- [x] Reuse ScanForm at /scan. Map safe API error codes/status to localized rate-limit, quota, auth outage, persistence/general retry messages without exposing raw errors. Retain pending/accessibility behavior and response navigation.
- [x] Add substantive method/coverage/version/legacy/comparison limitations copy in both locales, backed by implemented contract; activate only scan/methodology NAV entries.
- [x] Verify URL validation, pending/complete/partial response routing, 429/quota/auth/persistence/network failures with mocked API plus public a11y/navigation tests.

## Task 3 — Result presentation and compatibility

Files: components/PillarScoreCards.tsx; components/result/ResultClient.tsx and bounded evidence component/DTO as needed; lib/result-access.ts only if safe DTO extension is necessary; renderer/access/claim tests.
- [x] Test score suppression, provisional/scored labels, weighted coverage, historical stored/recalculated labels, absent evidence and method version.
- [x] Present sanitized collection limitations and current comparison ineligibility only within owned detail. Keep public teaser contract and benchmark headline unchanged; label estimated impact.
- [x] Exercise actual result access, claim-intent/claim/AuthComplete, owner mismatch, expired/invalid intent, persistence/provider/auth failures and revoked-report behavior using existing fixture/contract tests.
- [x] Review result privacy and backwards compatibility independently.

## Task 4 — Combined validation and local handoff

- [x] Run full unit suite excluding live integrations and isolated source copies; source lint, route typegen/typecheck, production build in sanitized isolated fixture.
- [x] Run C7 bilingual mobile/desktop browser cases and affected existing accessibility/auth/claim/pricing regressions; do not raise baselines.
- [x] Independent whole-diff review and fix findings; export C7 patch excluding the original user plan.
- [x] Record exact checks/failures, setup gaps and rollback. Real staging Auth/provider acceptance remains gated. Prepare concrete C8a adapter design next; C9 decisions and C11 external actions remain unresolved.