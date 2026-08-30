# ADR-009 — Neon Auth and identity

- **Status:** Proposed — pending §24 decision 4
- **Date:** 2026-08-30
- **Source:** base plan §7 ADR-9; see also plan §17.1–§17.2

## Decision

The new project starts with **fresh identities**. No user migration in this plan.

## Generation check

`@neondatabase/auth` is pinned at `0.4.2-beta`. The application reads `neon_auth."user"`
(`app/api/webhooks/neon/route.ts:122`) and `profiles.id` FKs to `neon_auth.user` (migration
`022`), which is the **Better Auth** table shape, not the legacy Stack Auth
`neon_auth.users_sync` shape. Conclusion: `aiso` is already on the current Neon Auth
generation, so no legacy-to-managed migration applies. **Verify this against the installed
`node_modules/@neondatabase/auth` and current Neon docs at implementation time before relying
on it.**

## Region constraint

Neon Auth is documented as AWS-regions-only. The new project's region choice is therefore
constrained (plan §16.1).

## Ordering consequence

Because Auth provisions `neon_auth` and the baseline FKs into it, **Auth must be enabled on
the new production branch before the baseline runs**. Because Auth state branches with the
database, staging/preview branches inherit an Auth configuration and need their own
issuer/cookie/callback isolation (plan §17).

## Approval gate

Plan §24 decision 4. Trade-off if reversed: identity migration adds PII, consent, residency,
Stripe reconciliation, and rehearsal scope.
