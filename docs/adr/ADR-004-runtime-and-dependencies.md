# ADR-004 — Runtime and dependencies

- **Status:** Proposed
- **Date:** 2026-08-30
- **Source:** base plan §7 ADR-4

## Decision

Node 24.x, Next 16.3.8, npm, Vercel, `@neondatabase/serverless` as the only DB driver,
`lib/db.ts` as the only client. No Drizzle. No D1. No Vite/Vinext/Wrangler for the
application. No framework upgrade inside a UI-port PR.

The 2026-10-09 security remediation updates the original Next 16.2.4 pin to
16.3.8, together with `eslint-config-next`. This is the first fixed 16.x release
covering the audited framework advisories; it is a dependency-security change.

## Note

`cloudflare/cron-worker/` keeps its own toolchain — it is already excluded from the root
`tsconfig.json`, `vitest.config.ts`, and lint.
