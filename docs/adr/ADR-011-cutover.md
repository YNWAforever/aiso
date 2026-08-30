# ADR-011 — Cutover

- **Status:** Proposed — pending §24 decisions 11 and 12
- **Date:** 2026-08-30
- **Source:** base plan §7 ADR-11; see also plan §21

## Decision

Dark launch behind flags, route-slice rollout, synthetic/internal-only canary, no
dual-write, legacy system **not** retired by this plan.

## Write-fence rule

Before the first real business write: exactly one system of record per tenant and data
class; unplanned dual-write prohibited by default; reconciliation defined; rollback handling
for new writes defined.

## Approval gates

Plan §24 decisions 11 and 12. Trade-offs if reversed: zh-HK-first needs its own redirect and
hreflang plan (11); entering cutover now creates dual-write and reconciliation obligations
with no plan (12).
