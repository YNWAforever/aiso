# AI-assisted activation and platform administration

Baseline: main `7879a39d8ec76b6b213f4e9502dfd05b20b71fcb`; production alias resolves to READY deployment `dpl_ArD9Q1PgzqUCWLrvCBoeYPeNkD31` at this SHA. PR 86 already implements F38–F50; preserve its remediation and operational exclusions.

The user requests implementation, not another plan. Extend the existing onboarding service and platform-admin guard without replacing auth, billing, tenant ownership, or the run ledger.

## Design and acceptance

1. A URL-first assistant on the existing onboarding page fetches one public homepage using the existing DNS-pinned, redirect-validating fetcher. An explicit click sends bounded public page text to the existing OpenRouter integration. One structured model call produces editable brand name, description and industry; language and market must be chosen by the user. No competitor guesses, autonomous browsing, automatic brand writes or provider monitoring runs. Rate limit by authenticated account; fail closed. Manual setup remains usable during fetch/AI failures. Confirmed drafts enter the existing idempotent creation/recovery flow.
2. A platform directory at `/admin` provides searchable, paginated users, accounts, brands, scans, questions, observations and monitoring runs. Existing `is_admin` is the super-admin role. APIs gate before reading; every account drilldown filters by an exact validated account ID. Cross-account listing is an explicit platform-only capability. Select business fields, never auth sessions, credentials or payment identifiers. Preserve plan override UI at `/admin/billing`. Fix the sidebar's incorrect localized admin URL.
3. Both locales, accessible labels, visible pending/error/empty states, responsive tables and an explicit read-only admin data surface. A failed optional dataset is unavailable, never zero. Test auth denial, filters/pagination, API failure recovery, invalid/unsafe input, rate caps, AI output validation and bilingual rendering.

## Live findings (new IDs)

| ID | Priority | Evidence | Status |
|---|---|---|---|
| F51 | P1 | Signed-in portfolio and brand home render visibility, activation and monitoring read errors. The AISO database matching the browser brand has migration ledger through 062 only; 063–070 are absent, including `pulse_runs.purpose` referenced by the deployed queries. | reproduced_live; production activation blocked |
| F52 | P2 | Live onboarding starts with empty brand-name field, 4 pages; source contains no website-assisted draft. | reproduced_live |
| F53 | P1 | `/admin` only lists accounts/plan overrides; API unpaginated; no user directory or operational data navigation. | reproduced_code |
| F54 | P2 | Sidebar links `/{lang}/admin`, while platform admin is `/admin`. | reproduced_code |

Current browser account is a tenant Pro user, not platform admin: `/admin` redirects to `/en/dashboard` as expected. No role grant performed. Authenticated platform-admin live acceptance is unavailable with this session. No production mutation, migration, paid model run or Worker publication is authorized by these observations alone.

Read-only database evidence: project `weathered-wave-50814522`, branch `br-square-mountain-az6f82vi`, database `neondb`. Known browser brand matched; `pulse_metrics.run_item_id` exists, `pulse_runs.purpose`, `onboarding_progress.request_hash` / `request_aliases` and `pulse_metrics.search_evidence` do not. No Vercel secret was read; matching data is strong corroboration, not an independently verified production connection-string binding. Confirm that binding before applying the existing release runbook.

## Implementation sequence

- [x] Guarded, bounded assistant API and tests.
- [x] URL-first UI with editable review and existing recovery.
- [x] Platform directory API, filters, pagination and tests.
- [x] Admin UI, billing preservation, correct navigation and bilingual verification.
- [x] Typecheck/lint/build, targeted synthetic tests and diff review.
- [x] Create reviewable draft PR #87 and record the first remote CI results.
- [ ] Fresh browser/gate verification after the two test-fixture corrections; latest status is in the PR description.
- [x] Record measured coverage, operational blockers and exact deployment status.
