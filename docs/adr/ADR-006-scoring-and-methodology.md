# ADR-006 — Scoring and methodology

- **Status:** Proposed — pending §24 decision 7
- **Date:** 2026-08-30
- **Source:** base plan §7 ADR-6; see also plan §13

## Decision

Preserve the 100-point headline score and `assignGrade` thresholds unchanged. Version the
diagnostic pillars, persist a snapshot per scan, and never sum SEO/AEO/GEO.

## Two competing pillar models must be reconciled

- `lib/pillar-scores.ts` defines `seo`/`aeo`/`geo` as re-weightings of the same 20 checks,
  with **no coverage gate**.
- Donor `app/product-truth.ts` defines `site_health`/`answer_readiness`/`citation_readiness`
  over 16 new metrics, **with** a coverage gate.

**Recommended:** keep the target's `seo`/`aeo`/`geo` pillars and check basis (they are
computable from real data today) and **adopt the donor's coverage-gate semantics** into them,
so missing evidence lowers coverage rather than scoring as fail. The donor's pillar *names*
become UI labels only if the business prefers them; that is cosmetic and separable.

## Consequence

`calculatePillar()` currently coerces a missing result to `{ status: 'fail' }` via
`asCheckResult()`. That is exactly the "missing data becomes zero" failure the donor model
rejects. Fixing it changes pillar numbers for scans with incomplete results and must ship
behind the version bump (work items 0.4 and 0.5).

## Approval gate

Plan §24 decision 7. Trade-off if reversed: changing the headline invalidates every
historical benchmark.
