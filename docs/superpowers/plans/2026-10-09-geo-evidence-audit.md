# GEO evidence audit implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Repair observed scan failure handling and lost GEO evidence without changing commercial/provider scope.

**Architecture:** Validate scan input and initial page collection before any scoring. Normalize OpenRouter citation annotations at the provider boundary, persist them with accepted attempts, and project explicitly labelled evidence in observation detail.

**Tech Stack:** Node 24, Next 16.2.4, TypeScript, Neon/Postgres, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-09-geo-evidence-audit.md`

## Global Constraints

- Node 24, Next 16.2.4, no new runtime dependency.
- User-facing copy in both en and zh-HK.
- Additive migration only; no historical evidence fabrication or destructive backfill.
- No new paid models, search plugins, production flags, external schedules, or account/security changes.

## Review Focus

- A failed page read must not save a score or run checks; Task 1 tests cover network/HTTP/empty/non-document cases.
- Direct API callers must receive the same invalid-host protection as the form; Task 1 tests check before auth/quota.
- Citation payloads can be malformed, unsafe, duplicated or huge; Task 2 tests enforce bounded public links and keep absence unknown.
- Legacy records must not acquire fabricated provider citations; Task 2 projection tests distinguish null from empty arrays.
- Truncated/empty Pulse output and invalid usage must not become valid observations; Task 2 provider tests cover these.

### Task 1: Refuse unscannable origins

**Files:** `lib/scan-input.ts`, `components/home/ScanForm.tsx`, `app/api/scan/route.ts`, `messages/{en,zh-HK}.json`, `__tests__/components/scan-form.test.ts`, `__tests__/api/scan-flow.test.ts`, `__tests__/api/scan-security.test.ts`.

**Interfaces:** `normalizeScanUrl(value: string): string` normalizes HTTP(S) input with a public hostname; server DNS/redirect protections remain authoritative. API errors use `SCAN_PAGE_UNAVAILABLE` with status 502.

- [x] Add regressions for single-label host rejection, no checks/insert after failed reads, and safe localized retry errors.
- [x] Run the three targeted files; new tests failed against the original implementation.
- [x] Implement shared validation and fail before scoring when the initial page cannot be read.
- [x] Run the same files; 70 tests passed, then committed. Historical result/UI/metadata follow-up also passed.

### Task 2: Preserve provider citation evidence

**Files:** `lib/pulse/provider-citations.ts`, `lib/openrouter.ts`, `lib/pulse/runs/{schema,store}.ts`, `lib/observations/{types,schema,store}.ts`, `components/observations/{copy,ObservationDetail}.tsx/ts`, `messages/{en,zh-HK}.json`, `supabase/migrations/060_provider_citations.sql`, provider/detail/render tests.

**Interfaces:** `ProviderCitation = {url: string; title: string|null}`; `ProviderEvidence.providerCitations?: ProviderCitation[]|null`; stored null = unrecorded, array = received and filtered annotations. `providerFinishReason?: string|null` is recorded with evidence. Observation links label provenance; duplicate text/provider URLs prefer provider provenance.

- [x] Add provider regression tests for annotations, empty/truncated Pulse output, invalid usage, and legacy/detail evidence states.
- [x] Run targeted tests; new behavior assertions failed.
- [x] Add bounded URL normalization, additive schema columns and atomic persistence, scoped detail projection, and bilingual UI disclosure.
- [x] Provider/detail/render/store tests passed. Guarded integration coverage added; real Neon execution remains open. Local PostgreSQL ACL regression passed.

### Task 3: Honest product promise and verification

**Files:** `messages/{en,zh-HK}.json`, `docs/remediation/2026-10-09/*`.

**Interfaces:** Existing translation keys and product entry points; no new user flow.

- [x] Correct homepage copy to separate readiness checks from sampled AI answers.
- [x] Run unit suite, lint, typecheck and build; 5,383 tests passed, static/build exit0. Unavailable gates recorded.
- [x] Obtain independent whole-branch review, repair both material findings with RED→GREEN tests, and commit.
- [ ] Push isolated branch, create reviewable draft PR stacked on #68, and deliver findings/reference comparison with verified and blocked coverage.
