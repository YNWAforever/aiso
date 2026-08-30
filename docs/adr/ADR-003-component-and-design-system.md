# ADR-003 — Component and design system

- **Status:** Proposed
- **Date:** 2026-08-30
- **Source:** base plan §7 ADR-3

## Decision

Extract donor **tokens** into `app/globals.css` under Tailwind 4's `@theme`. Reuse `aiso`'s
existing 6 primitives first. Add a donor primitive only when a named work item needs it, one
PR at a time, with a bundle-budget check.

## Rationale

`aiso` has 6 primitives; `aisogpt` has 61 plus 13 new runtime dependencies. Wholesale
adoption is roughly a 10× increase in primitive surface for a UI port, and would introduce a
second overlapping primitive system (`@base-ui/react` + the `radix-ui` umbrella alongside
`@radix-ui/react-slot`).

## Consequences

Some donor screens need a primitive built or adopted before they can be ported; that
dependency is explicit in each work item.
