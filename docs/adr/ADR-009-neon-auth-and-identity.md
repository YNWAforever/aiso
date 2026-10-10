# ADR-009 — Neon Auth and identity

- **Status:** Accepted — §24 decision 4 approved 2026-08-31 (docs/decisions/2026-08-31-phase0-stakeholder-decisions.md)
- **Date:** 2026-08-30
- **Source:** base plan §7 ADR-9; see also plan §17.1–§17.2

## Decision

The new project starts with **fresh identities**. No user migration in this plan.

## Generation check

`@neondatabase/auth` is pinned at `0.5.0-beta` after the 2026-10-09 dependency-security
review (previously `0.4.2-beta`). The application reads `neon_auth."user"`
(`app/api/webhooks/neon/route.ts:122`) and `profiles.id` FKs to `neon_auth.user` (migration
`022`), which is the **Better Auth** table shape, not the legacy Stack Auth
`neon_auth.users_sync` shape. Conclusion: `aiso` is already on the current Neon Auth
generation, so no legacy-to-managed migration applies. **Verify this against the installed
`node_modules/@neondatabase/auth` and current Neon docs at implementation time before relying
on it.**

The 0.5.0-beta SDK retains the application's `next` and `next/server` entrypoints.
Its [publisher dependency pins](https://github.com/neondatabase/neon-js/blob/main/package.json)
use Better Auth/core/passkey/telemetry/api-key 1.6.23, utils 0.4.2,
better-fetch 1.3.1, and better-call 1.3.7. The npm overrides are scoped to this
exact SDK version and reproduce those Auth pins: otherwise the UI package's
broad ranges resolve incompatible 1.7.x peers. The form resolver stays at the
baseline 5.4.0, which satisfies the UI package's `^5.2.2` range and avoids an
incidental new optional AJV peer. Revisit all these overrides on the next SDK upgrade.

The proxy recognizes both `__Secure-neon-auth.session_challenge` and the legacy
`__Secure-neon-auth.session_challange`, matching the SDK's migration behavior.
It still requires a verifier and preserves the separate popup/client exchange.
Local SDK updates do not establish the version or security state of the hosted
Neon Auth backend.

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
