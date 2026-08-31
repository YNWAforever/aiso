# ADR-002 — Routing and locale

- **Status:** Accepted — §24 decision 11 approved 2026-08-31 (docs/decisions/2026-08-31-phase0-stakeholder-decisions.md)
- **Date:** 2026-08-30
- **Source:** base plan §7 ADR-2

## Decision

Map the donor information architecture into real `app/[lang]/**` segments. Keep `proxy.ts`
as the only request-routing file. Do **not** adopt a catch-all route as the production route
architecture.

## Rationale

The donor catch-all (`app/[...segments]/page.tsx`) exists because a review build needs 120
URLs without 120 files. In production it would defeat static analysis, per-route metadata,
per-route `maxDuration`, per-route caching, and Server Component boundaries, and would force
everything into one `'use client'` tree.

## Unresolved conflict requiring a decision

`i18n/routing.ts` sets `defaultLocale: 'en'`; the donor defaults unprefixed paths to `zh-HK`
(`app/page.tsx` renders `initialPath="/zh-HK"`, and all 30 `exactLegacyRedirects` target
`/zh-HK/…`). These are incompatible.

**Recommended default: keep `en`** as `defaultLocale` to preserve existing deep links and the
two `next.config.ts` redirects, and treat the donor's zh-HK-first behaviour as a review-build
choice. If the business wants zh-HK first in production, that is a separate, explicitly
approved change with its own redirect and canonical/hreflang plan.

## Approval gate

Plan §24 decision 11.
