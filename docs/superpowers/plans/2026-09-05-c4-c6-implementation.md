# C4–C6 Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Execute the approved local design without additional routine approval checkpoints.

**Goal:** Deliver bounded public page families and trustworthy additive scan evidence.

**Architecture:** Explicit Server Component routes use the current shell and catalog metadata. Mobile interaction stays in the header. A pure evidence normalizer consumes request-local safe fetch observations and optional check diagnostics, storing alongside immutable checks and pillars.

**Tech Stack:** Node 24, Next.js 16.2.4, next-intl, Tailwind 4, Vitest and Playwright; existing Neon tagged-template interface with mocked local database tests.

## Global constraints

- Approved design: `docs/superpowers/specs/2026-09-05-c4-c6-public-pages-evidence-design.md`.
- Base c123ac254d44a179b7d2f19a19d400ff1cd657b3; new local branch codex/c4-c6-public-pages-evidence.
- No provider/database/environment mutation, paid scan, email, deployment, push or merge. Preserve the original continuation plan.
- Keep existing metadata API, URL policy, score weights, grades, quotas, SSRF protections and tenant guards.
- Evidence caps: 32 KiB envelope, 1 KiB per check, 40 observations, 512 bytes per signal, zero free-text excerpt bytes. URL descriptors contain origins only with redaction flags.
- C5 legal text is documentation drafts only. Discovery/governed agents are Planned. C7–C9 routes remain unavailable.
- Reviewable patches per public family and per C6 step; only the coordinator stages/commits.

## Task 1 — C4 routes and navigation foundation

Files: create `components/marketing/PublicInformationPage.tsx`, explicit platform and site-health page files, `tests/e2e/public-platform.spec.ts`; edit `SiteHeader.tsx`, navigation, locale catalogs and focused SEO/navigation tests.

- [x] Write regression cases asserting two new available route files, unique locale metadata and exact 8 sitemap URLs; demonstrate failure before enabling routes.
- [x] Implement server-rendered summary/action/limitation sections with existing tokens; inspect pinned donor reference without importing its runtime.
- [x] Implement mobile disclosure with aria-expanded/controls, Escape returning trigger focus, close on route selection, locale path preservation and exact active links. Test desktop details behavior too.
- [x] Run focused Vitest plus fixture browser tests in both locales, themes and four widths; capture C4-only patch and review.

## Task 2 — C5a–e page families

Files: explicit page files listed in approved design, public presentation/catalog content, navigation and SEO tests, `tests/e2e/public-pages.spec.ts`.

- [x] Implement a–e sequentially with route/metadata/NAV tests failing first; exact cumulative localized sitemap counts 14, 22, 32, 38, 44.
- [x] Add audience/capability-specific content, source-grounded claims, supported destinations and explicit limitations. No placeholder page or invented contact backend.
- [x] Assert planned capability labels and all CTA destinations resolve. Verify all pages, mobile navigation and localization in fixture browser tests.
- [x] Preserve each family delta for review; compare same-server production transferred JS/CSS and Lighthouse measurements, report unavailable tooling rather than fabricate measurements.

## Task 3 — C5f legal drafts and C5g aliases

Files: `docs/legal/privacy-draft.en.md`, `.zh-HK.md`, `terms-draft.en.md`, `.zh-HK.md`; `next.config.ts`, `tests/e2e/public-redirects.spec.ts`, focused config test.

- [x] Write complete review drafts with legal-review questions separate from public copy. No legal page routes or availability flags.
- [x] Verify frozen public aliases; test bare/localized destinations and status 308. Preserve existing pricing/login and signed report behavior.
- [x] Implement only existing-target aliases; test response location, locale and no advertised 404; review delta.

## Task 4 — C6 pure evidence contract

Files: `lib/scan-evidence.ts`, focused supporting modules if needed, `lib/types.ts`, `__tests__/lib/scan-evidence.test.ts`, contract docs.

- [x] Write normalizer, budget, redaction, historical-read and comparison test cases before code. Assert `Buffer.byteLength(JSON.stringify(envelope)) <= 32768`, 20 retained check identities, no raw secret substring and no top-level status.
- [x] Implement schema/version registry, origin-only descriptors, allowlisted parsed signals and failure/applicability states separate from unchanged scoring inputs.
- [x] Implement fail-closed tolerant reader and comparison eligibility: same methods alone do not establish comparable collection; redacted final paths prohibit comparisons.
- [x] Amend frozen fields/versioning docs as approved; focused tests and review.

## Task 5 — C6 request-local capture and writer

Files: `lib/security/public-url.ts`, `app/api/scan/route.ts`, optional diagnostics in `lib/checks/**`, `__tests__/api/scan-evidence.test.ts`, security/check tests.

- [x] Test capture for redirect, timeout, denied hop, provider fallback, rejected/missing check and concurrent requests. Existing blocked input still returns 400 and inserts no row.
- [x] Capture metadata at the safe boundary with no additional requests and unchanged fetch interface/limits; instrument internal catch/fallback behavior without changing verdicts.
- [x] Store evidence and pillar snapshot in the same insert; assert database failure remains non-2xx and outbound webhooks/public summaries omit evidence.
- [x] Exercise actual ownership guards with mocked database; wrong-owner semantics unchanged; read-back historical data remains tolerant.
- [x] Review instrumentation independently from pure contract.

## Task 6 — C6 robots rules and scanner version

Files: robots parser/check files identified by graph, corresponding check tests, scanner/check version constants and documentation.

- [x] Consult official current crawler documentation and RFC 9309; write wildcard, longest-match, allow-tie, grouped-agent and crawler-role fixtures before logic changes.
- [x] Correct only selected robots semantics; preserve SSRF fetches and weights/grade formula. Version scanner and affected checks for detection changes.
- [x] Test current default/generic and explicit bot behavior plus fallback/failure diagnostics; review independently.

## Task 7 — Combined verification and handoff

- [x] Run complete local unit suite, source lint, typecheck, default production build and fixture E2E including C2/C3 regressions.
- [x] Check meaningful performance/a11y deltas with unchanged fixture settings and exact final source snapshot.
- [x] Independent combined review; resolve actionable findings, preserving family ownership and user changes.
- [x] Write handoff with behavior, exact checks, failures/setup blockers, legal/external gates, performance evidence and rollback. Stop before publication or next slice.

## Completion evidence

Completed locally on 2026-09-05. See the C4-C6 handoff for exact results: 1,975 unit tests and 280 browser tests passed; six legacy email-gate cases skipped. Lighthouse unavailable, live integration/environment equivalence unverified, and legal publication remains gated. No publication or next slice started.
