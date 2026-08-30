# ADR-008 — Tenant isolation and RLS

- **Status:** Proposed — pending §24 decision 6
- **Date:** 2026-08-30
- **Source:** base plan §7 ADR-8; see also plan §17.3

## Decision

Phase 1 preserves the current model: least-privilege `aeo_app` + explicit `account_id`
filtering + contract tests. RLS redesign is deferred to a separate, separately approved
security workstream.

## Rationale

Migration `036` removed 30 policies precisely because they were inert and silently hazardous
(`auth.uid()` returns NULL under Neon because nothing sets the GUC). Re-introducing RLS
requires a session-identity mechanism that does not exist yet, plus removing `aeo_app`'s
`BYPASSRLS`, plus policies on all 34 tables, plus performance testing. Combining that with a
UI port would make both unreviewable.

## Non-negotiable

`__tests__/migrations/rls-policy-freeze.test.mjs` must continue to fail if a migration after
`035` creates a policy. The greenfield baseline must reproduce this posture exactly,
including the seven RLS-enabled/zero-policy tables
(`public_scan_rate_limits`, `stripe_subscription_processing_leases`,
`stripe_webhook_events`, `authenticated_scan_monthly_usage`, `account_report_branding`,
`client_reports`, `client_report_versions`).

## Approval gate

Plan §24 decision 6. Trade-off if reversed: RLS now would mean removing `BYPASSRLS`,
policies on 34 tables, and a session-identity mechanism that does not exist.
