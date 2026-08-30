# Scan versioning contract

Frozen from base plan §13.4/§13.6 and item 0.6, 2026-08-31. Changes to this contract require
a plan amendment (§7 of the execution prompt), not a silent edit.

## Version identifiers

| Identifier | Source | Stored today | Consumers |
|---|---|---|---|
| `methodologyVersion` | `lib/pillar-scores.ts`'s `PILLAR_SCORE_VERSION` | **Yes** — `scans.results.pillarScores.methodologyVersion`, written by every scan since plan item 0.4 | `resolvePillarScores()`, `PillarScoreCards` |
| `scannerVersion` | `lib/types.ts`'s `SCANNER_VERSION` | **No** — contract defined (item 0.6), storage deferred to item 3.3 | none yet |
| `checkVersion` (per check, c1–c20) | not yet defined | **No** — deferred to item 3.3 | none yet |

## Bump discipline

- `methodologyVersion` bumps whenever `PILLAR_WEIGHTS` or the pillar coverage-gate formula
  changes (`lib/pillar-scores.ts`).
- `scannerVersion` bumps whenever a check module under `lib/checks/**` changes its detection
  logic in a way that could change a `pass`/`warn`/`fail` verdict for the same input.
- Both use the `YYYY-MM-DD.vN` format, `N` incrementing within a day if more than one bump
  ships.

## Why scannerVersion is not yet stored

Storing it usefully requires the rest of the evidence envelope (plan §13.4): evaluated URL,
final redirected URL, fetch timestamp, HTTP status, per-check evidence excerpts. Storing
`scannerVersion` alone, without the check-level evidence it is meant to version, would add a
field nothing can act on yet. It lands as one slice of plan item 3.3 (an explicitly-flagged
epic), not before.

## Reproducibility

A stored scan reproduces its headline score and diagnostic pillars from: the immutable
normalised check outputs already in `scans.results`, the stored `pillarScores` snapshot, and
the versioned configuration those version identifiers address (`PILLAR_WEIGHTS` for the
methodology version; the check modules themselves for the scanner version, once stored).
