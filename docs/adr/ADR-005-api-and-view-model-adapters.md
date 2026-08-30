# ADR-005 — API and view-model adapters

- **Status:** Proposed
- **Date:** 2026-08-30
- **Source:** base plan §7 ADR-5

## Decision

Introduce a `lib/view/` layer of **server-side** DTO adapters that convert `aiso` domain
models into the donor's view contracts. Components receive DTOs, never raw rows.

## Rationale

The donor's contracts (entity/observation/opportunity/change-set/outcome) are, in its own
words, "fixture-compatible view contracts, not a new system of record". An adapter layer
lets the new UI land against real data without a schema rewrite, and gives one place to
enforce redaction.

## Vocabulary rule

The donor says `brandId`; the database says `client_id`. **Resolve at the DTO boundary
only.** No database identifier is renamed. Where a URL segment must be chosen, keep
`[clientId]` to preserve deep links, and let the UI label it "brand".
