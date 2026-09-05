# Scan versioning contract

Amended under the approved [C4–C6 design](../superpowers/specs/2026-09-05-c4-c6-public-pages-evidence-design.md), 2026-09-05. C6 selects bounded additive JSON in `scans.results.evidence`; it does not introduce evidence tables, migrations or historical backfills.

| Identifier | Source | Stored by the scan writer |
|---|---|---|
| Evidence schema `1` | `lib/scan-evidence.ts` | `results.evidence.schemaVersion` |
| Scanner `2026-09-05.v1` | `lib/types.ts` | `results.evidence.scannerVersion` |
| Every check c1–c20 | `CHECK_VERSIONS`, `lib/scan-evidence.ts` | `results.evidence.checks[key].version` |
| Headline `aiso-100.v1` | `lib/scan-evidence.ts` | unchanged existing 100-point weights, warn half-credit, cap and grade thresholds |
| Pillars `2026-09-05.v2` | `PILLAR_SCORE_VERSION`, `lib/pillar-scores.ts` | existing `results.pillarScores.methodologyVersion` and evidence method identity |
| URL policy `origin-only.v1` | `lib/scan-evidence.ts` | comparison context; no arbitrary path, query, fragment, userinfo or secret-bearing hash |

Bump scanner and affected check versions whenever detection can change a verdict for the same input. C6 versions the robots policy repair as c1 `2026-09-05.v1`; other checks retain `2026-08-31.v1`. Diagnostics distinguish internal fallbacks without changing benchmark verdicts. Bump the pillar methodology only for pillar weights or coverage formula changes. Bump the headline identity only if headline scoring changes. Scanner/check/pillar identifiers use `YYYY-MM-DD.vN`.

The SHA-256 comparison signature hashes only the normalized, allowlisted comparison context: scope, evaluated/final origins, industry/region, caller-versus-fetched sitemap provenance, URL policy, scanner/check versions, headline and pillar methods. Timestamps and verdicts are excluded. Equal signatures establish compatible methods only. Unknown or malformed historical envelopes, incomplete collection, and withheld final-path identity prohibit comparable-improvement claims; evidence v1 therefore never authorizes an improvement comparison.

Historical scans retain their original check outputs and pillar snapshots. `readScanEvidence()` returns null for missing, unsupported or malformed envelopes instead of upgrading them or inventing evidence. No history is rewritten. Retention follows the existing scan lifecycle, with no promised TTL or cleanup job.

## C7 diagnostic coverage amendment

New snapshots use `2026-09-05.v2`. Weighted coverage is complete, applicable, verifiable observation weight divided by applicable weight, without rounding before gating. Explicit not-applicable removes weight from both parts; missing checks, failed or partial collection and unverifiable assessments contribute no observed weight. Assessment and stored check status must agree. Below 0.67 the state is `insufficient_evidence` and `score` is null; [0.67, 0.85) is `provisional`; at least 0.85 is `scored`. Zero applicable weight is insufficient. Numeric scores retain the prior half-credit rule over observed weight, and all headline weights/grade remain unchanged.

Stored historical pillar snapshots remain unchanged under their original method. Historical scans without a snapshot can recalculate the current diagnostic only with validated evidence inputs; absent evidence yields no numeric diagnostic. The pure scorer accepts a minimal applicability/collection/assessment map; server readers obtain it using `pillarInputsFromEvidence`. The evidence schema stays 1: the reader explicitly recognizes original pillar method `2026-08-26.v1` and current `2026-09-05.v2`, validating each envelope and its signature against its own registered method. Unknown methods fail closed. No rewrite or backfill occurs.
