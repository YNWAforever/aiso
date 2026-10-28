# Conversation Studio Stage B1 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this approved brief inline. Track tasks with checkboxes.

**Goal:** Replace the Stage A demo with honest, cited summaries of already saved brand evidence, through a draft PR and CI only.

**Architecture:** The existing authenticated brand page preloads a small account-scoped evidence DTO using the observation readers and owned scan projection. Send composes deterministic extracts locally; no message endpoint, model, outbound source lookup, or thread store is needed. Every reply carries coverage and saved-source provenance. Freeform questions and competitor comparisons remain explicitly insufficient for a verified answer; relevant saved extracts can still be shown.

**Tech Stack:** Next.js 16.3.8, React, next-intl, Neon tagged templates, Vitest, PGlite, Playwright.

**Spec:** User-supplied Willy-approved Stage B1 brief (Rio t66s443); `/workspace/aiso-brief-conversation-studio-stage-a.md`; `docs/conversation-studio-stage-a.md`. Prototype URL is inaccessible here; use the brief's expandable steps/sources IA without claiming visual fidelity.

## Global Constraints

- Base `origin/main` = `f91cc63eb41466250a281d7a062cd21d939c8899`; branch `codex/conversation-studio-stage-b`.
- `FEATURE_CONVERSATION_STUDIO === '1'` only. Production OFF; no environment writes, deploys or merge.
- No OpenRouter, DataForSEO, Firecrawl, Google API calls or CI provider spend. No migrations or durable messages.
- Keep WorkspaceHome, tools, onboarding, billing, entitlements, cron and MCP unchanged.
- New copy in en and zh-HK; public source links pass the existing safety validator and are never fetched.

## Review Focus

- Foreign brand and mismatched scan account: reads must not leak records.
- Failed evidence reads must show unavailable, never pretend evidence is absent.
- Incomplete classifications, missing citations and unknown grounding cannot become confident claims.
- Freeform questions, comparator requests and text-links cannot become verified factual answers.
- Template drafts, IME, thread switching, reload reset, long text and mobile widths must remain usable.

### Task 1: Saved evidence and deterministic replies

**Files:** `lib/conversation-studio/{types,reply,evidence}.ts`; `__tests__/conversation-studio/{reply,evidence}.test.ts`; `__tests__/helpers/studio-evidence.ts`.

**Interfaces:** `loadStudioEvidence(accountId, clientId): Promise<StudioEvidence | null>`; `composeSavedReply(prompt, template, evidence): StudioReply`. DTO contains latest-week observations (at most eight), excerpts (at most 900 code points each), up to five safe links each, and the latest saved scan's existing owner projection. No provider receipt or raw result envelope enters the browser.

- [x] Write failing unit tests for empty/supported/unsupported replies, source integrity and safe bounded projection.
- [x] Run tests and observe missing implementation failures.
- [x] Implement account-scoped reads with existing snapshot/detail helpers and scan projection; compose a bounded saved-record summary, not inferred prose.
- [x] Prove tenancy with real local PGlite SQL fixtures and blocked outbound fetches.

### Task 2: Page and bilingual evidence UI

**Files:** existing studio page/component; new `components/dashboard/StudioReply.tsx`; `messages/{en,zh-HK}.json`; existing page/component tests and browser spec.

**Interfaces:** `ConversationStudio({brandName,evidence})`; temporary threads contain prompt and computed reply. Templates retain their kind only while unedited.

- [x] Extend page tests for flag/auth/UUID/ownership and evidence read failures before implementation.
- [x] Replace fixed demo with local composition and four saved-data templates.
- [x] Add reply excerpts and expandable coverage/steps/sources with dates, observation IDs, explicit missing/unsupported states and historical-data caveats in both locales.
- [x] Extend browser fixtures to cover saved and empty data, template/freeform/competitor replies, source links, no outbound requests, accessibility, IME, draft isolation and reload reset.

### Task 3: Verification and draft PR

**Files:** `vercel.json`; `docs/conversation-studio-stage-b.md`; Stage A documentation link.

- [x] Disable Vercel Git deployment on the exact branch; test that setting.
- [x] Run focused tests, lint, typecheck, full unit suite, build and browser checks; inspect CI's zero-provider safeguards.
- [x] Review complete diff, resolve material findings, commit and push.
- [ ] Create draft PR with base SHA, changed routes/files, bounded-source limitations and explicit NO_GO scope; monitor CI and fix PR-diff issues.
- [ ] Return draft PR URL, exact tip SHA and CI status. Do not merge.
