# Conversation Studio Stage 2 implementation plan

> Execute locally with superpowers:executing-plans. The user forbids agents, cloud execution and PR-diff review; the supplied approved brief replaces further design approval.

**Goal:** Build the approved home IA and separate home/discussion states on the existing Studio route.

**Architecture:** Retain the Stage 1 scoped CSS and page-local threads. Map six home tasks onto unchanged B1 reply composition and unchanged B2 transport. Read existing account-scoped GSC binding metadata only after ownership; disclose unavailable reads honestly.

**Tech stack:** Next.js 16, React, next-intl, Vitest, Playwright.

**Spec:** `/workspace/aiso-brief-studio-design-stage-2.md`, concept `TOKENS/VIEWS/STRINGS/README.md`, gap plan Stage 2 and §3.4. Base `2c1ce2999a3f00170ee8d4d7831e4484f7f39e66`.

## Constraints and decisions

- Existing branch/workspace and dependencies; no duplicate checkout or install.
- No env writes, Stage 6, Layout B shell, secondary routes, persistence, attachments, new vendor calls/spend, merge, ready action or PR review.
- Minimum 12px text and 44px targets; system TC fonts; scoped tokens only.
- Concept titles/descriptions/outcomes; replace product-specific mock prompts with current-brand prompts. Explicit task limitations accompany aspirational outcome chains.
- Six home tasks are distinct from the four B1 capabilities. Improve uses only the loaded owned scan; opportunity links to existing opportunities; report links to reports.
- GSC unavailable/disabled/failed reads must never render as unbound; no metrics/query/sync calls.

## Review focus / acceptance cases

Empty evidence; failed/disabled GSC; editing a template clears its intent; home/new-thread/old-thread draft isolation; live cap zero, partial failures and one-question transport. Exercise these through the existing unit/browser harness, with intercepted HTTP only.

## Tasks

- [x] 1. Add failing SSR/page/browser expectations for home layout, six cards/five filters, template focus, state transition, resume/reset and GSC states. Run focused tests and retain red evidence.
- [x] 2. Implement task metadata, gated GSC binding projection, home/discussion state and shared composer footer; extend scoped CSS and both catalogs. Run focused unit/browser checks to green.
- [x] 3. Verify lint, typecheck, full CI-guarded unit suite (two workers), build, existing fixture preparation and Studio E2E (one worker). Inspect integration harness without provisioning; run local aggregator and report missing CI inputs honestly. Capture 1440/900/390 home/discussion light/dark en/zh-HK, axe/reflow/targets and dashboard isolation.
- [ ] 4. Add Stage 2 evidence/approval/holds doc and exact deployment-disable entry; commit, push, open draft PR using body file. Read CI briefly, return URL/tip/stat/check table and stop.

## Progress

- Preflight: branch and origin/main match base; clean workspace, Node 24.22.1; node_modules reused. Single executor; no PR review.

- Task 1/2: red home/page assertions confirmed (5 failures); focused 84/84 passed after implementation. Initial browser red confirmed missing home view.
- Ruling: preserve the brief’s exact source-bar label using a locale/key/text-specific text-audit allowlist entry; regression proves alternate values and other keys remain flagged.
- Initial lint failure was generated Playwright trace JS from the intentional red run; removed only generated report/trace artifacts and reran. Initial build caught missing filter catalog keys; completed both catalogs.

- Task 3: final lint/typecheck/build pass; full CI-guarded unit 531 files / 7,101 tests pass; Studio E2E 40/40; screenshots 24 Studio + 4 dashboard, axe 0 and dashboard pixel isolation pass. Hosted integration blocked (provisions Neon); local aggregator exit 1 (six CI inputs absent).
- Delivery remaining: commit/push/draft PR, brief CI read only, then stop. No PR review.
