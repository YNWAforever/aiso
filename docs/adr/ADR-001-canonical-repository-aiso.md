# ADR-001 — Canonical repository: `aiso`

- **Status:** Accepted — §24 decision 1 approved 2026-08-31 (docs/decisions/2026-08-31-phase0-stakeholder-decisions.md)
- **Date:** 2026-08-30
- **Source:** base plan §7 ADR-1 (`docs/superpowers/plans/2026-08-30-aisogpt-aiso-new-neon-integration.md`)

## Decision

`aiso` is the canonical production repository. `aisogpt` is a **read-only design donor**.

## Quantified alternative

Making `aisogpt` canonical would require porting, at minimum: 48 API route handlers, 35 SQL
migrations across 34 tables, the SSRF fetch layer, two rate-limit/quota subsystems, Stripe
checkout/portal/webhook plus entitlement resolution, Neon Auth integration including the
`proxy.ts` verifier/challenge subtlety, the reports service and HMAC share-link signing,
163 test files, a four-job CI gate, and a Vercel deployment — into a repository that today
has **zero** API routes, an **empty** database schema (`db/schema.ts` is three comment lines
and `export {}`), a `null` D1 binding, and a Vite/Vinext/Wrangler/ChatGPT-Sites build. Every
security control would be re-derived rather than preserved.

## Consequences

- Donor code is decomposed, not imported.
- Donor stack choices (Cloudflare D1, Drizzle, Vinext, ChatGPT-host auth via
  `app/chatgpt-auth.ts`) are excluded.
- The 61-primitive donor UI library is adopted selectively (see ADR-003).

## Approval gate

Plan §24 decision 1. Trade-off if reversed: re-implementing 48 handlers, 34 tables, and
every security control in a repo with none.
