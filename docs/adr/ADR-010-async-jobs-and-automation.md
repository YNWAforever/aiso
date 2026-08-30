# ADR-010 — Async jobs and automation

- **Status:** Proposed — pending §24 decision 9
- **Date:** 2026-08-30
- **Source:** base plan §7 ADR-10

## Decision

Cloudflare Worker owns scheduling. `pulse/run` stays the in-app producer. **n8n Pulse
workflows are retired**, not migrated.

## Rationale

`ai-pulse-weekly-v2.json` and `pulse/run` both write `pulse_metrics`, a table with **no
unique key**, where `total_queries` in the weekly rollup is a row count. Two writers means
inflated `sov_score` — the headline number of the feature — plus duplicate LLM spend across
four providers. `pulse/run` defends itself by deleting a prompt's rows for the week before
writing, in application code; the n8n workflow has no such discipline.

## Retained decision

`aiso-scan-webhook.json` is fire-and-forget enrichment; retire or re-point it deliberately,
not by omission.

## Approval gate

Plan §24 decision 9. Trade-off if reversed: two writers to an unkeyed table inflate the
feature's headline metric.
