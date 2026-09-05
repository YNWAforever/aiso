# Scan versioning contract

Amended under the approved [C4–C6 design](../superpowers/specs/2026-09-05-c4-c6-public-pages-evidence-design.md), 2026-09-05. C6 selects bounded additive JSON in `scans.results.evidence`; it does not introduce evidence tables, migrations or historical backfills.

| Identifier | Source | Stored by the scan writer |
|---|---|---|
| Evidence schema `1` | `lib/scan-evidence.ts` | `results.evidence.schemaVersion` |
| Scanner `2026-09-05.v1` | `lib/types.ts` | `results.evidence.scannerVersion` |
| Every check c1–c20 | `CHECK_VERSIONS`, `lib/scan-evidence.ts` | `results.evidence.checks[key].version` |
| Headline `aiso-100.v1` | `lib/scan-evidence.ts` | unchanged existing 100-point weights, warn half-credit, cap and grade thresholds |
| Pillars `2026-08-26.v1` | `PILLAR_SCORE_VERSION`, `lib/pillar-scores.ts` | existing `results.pillarScores.methodologyVersion` and evidence method identity |
| URL policy `origin-only.v1` | `lib/scan-evidence.ts` | comparison context; no arbitrary path, query, fragment, userinfo or secret-bearing hash |

Bump scanner and affected check versions whenever detection can change a verdict for the same input. C6 versions the robots policy repair as c1 `2026-09-05.v1`; other checks retain `2026-08-31.v1`. Diagnostics distinguish internal fallbacks without changing benchmark verdicts. Bump the pillar methodology only for pillar weights or coverage formula changes. Bump the headline identity only if headline scoring changes. Scanner/check/pillar identifiers use `YYYY-MM-DD.vN`.

The SHA-256 comparison signature hashes only the normalized, allowlisted comparison context: scope, evaluated/final origins, industry/region, caller-versus-fetched sitemap provenance, URL policy, scanner/check versions, headline and pillar methods. Timestamps and verdicts are excluded. Equal signatures establish compatible methods only. Unknown or malformed historical envelopes, incomplete collection, and withheld final-path identity prohibit comparable-improvement claims; evidence v1 therefore never authorizes an improvement comparison.

Historical scans retain their original check outputs and pillar snapshots. `readScanEvidence()` returns null for missing, unsupported or malformed envelopes instead of upgrading them or inventing evidence. No history is rewritten. Retention follows the existing scan lifecycle, with no promised TTL or cleanup job.
