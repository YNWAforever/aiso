# Phase 0 Close-out Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish every remaining Phase 0 item (0.3–0.12) of the base plan
[`docs/superpowers/plans/2026-08-30-aisogpt-aiso-new-neon-integration.md`](2026-08-30-aisogpt-aiso-new-neon-integration.md),
record the 13 stakeholder decisions and unblock Phase 1, and land the two trust-critical
scan/scoring fixes (pillar snapshot persistence, coverage-gate semantics) that the plan rates
as a hard gate.

**Architecture:** Ten independent-but-ordered work items land as ten stacked commits on
branches continuing the `claude/neon-integration-phase0` → `claude/plan-0.2-doc-drift` chain,
in the dependency order fixed by the approved design
([`docs/superpowers/specs/2026-08-31-phase0-closeout-design.md`](../specs/2026-08-31-phase0-closeout-design.md)):
decisions/ADRs first, then `0.4 → 0.5 → 0.6 → 0.12 → 0.10 → 0.3 → 0.7 → 0.8 → 0.11 → 0.9`.
Each task is scoped to the files the base plan names for that item, with any unavoidable
extra touch explicitly called out and justified.

**Tech Stack:** Next.js 16 / TypeScript 5.9 / Vitest 4 / Neon Postgres — no new dependencies.

---

## Task 0: Decision record, ADR acceptance, plan changelog, README fix

**Files:**
- Create: `docs/decisions/2026-08-31-phase0-stakeholder-decisions.md`
- Modify: `docs/adr/ADR-001-canonical-repository-aiso.md`
- Modify: `docs/adr/ADR-002-routing-and-locale.md`
- Modify: `docs/adr/ADR-006-scoring-and-methodology.md`
- Modify: `docs/adr/ADR-007-greenfield-neon-bootstrap.md`
- Modify: `docs/adr/ADR-008-tenant-isolation-and-rls.md`
- Modify: `docs/adr/ADR-009-neon-auth-and-identity.md`
- Modify: `docs/adr/ADR-010-async-jobs-and-automation.md`
- Modify: `docs/adr/ADR-011-cutover.md`
- Modify: `docs/adr/README.md`
- Modify: `docs/superpowers/plans/2026-08-30-aisogpt-aiso-new-neon-integration.md` (append changelog)
- Modify: `README.md` (D14 fix)

- [ ] **Step 1: Write the decision record**

Create `docs/decisions/2026-08-31-phase0-stakeholder-decisions.md`:

```markdown
# Phase 0 stakeholder decisions

**Approver:** Product Owner
**Date:** 2026-08-31
**Governs:** plan §24, all 13 decisions

`aiso` is a public repository, so this record identifies the approver by role rather than
personal contact information.

| # | Decision | Recorded |
|---|---|---|
| 1 | Canonical repo | `aiso` — Approved |
| 2 | Neon project/region/topology/owner | `fimmick-aiso-v2-prod` + non-prod; AWS region (exact region selected at implementation time, item 1.1); budget owner = Product Owner |
| 3 | Bootstrap strategy | Option A, clean greenfield |
| 4 | Identity migration | Fresh identities, no migration |
| 5 | Production data copy | None — Approved |
| 6 | RLS vs explicit scoping | Keep explicit scoping; defer RLS |
| 7 | Scoring/pillars | Approved; adopt coverage-gate semantics |
| 8 | Route classification | Per plan §9 matrix as written |
| 9 | n8n/cron ownership | Retire n8n Pulse; Cloudflare owns scheduling |
| 10 | Stripe catalogue | Unchanged — Approved |
| 11 | Locale/redirect/rollback policy | Keep `en` default; 308/307 split as specified; internal dark-launch |
| 12 | Cutover posture | Separate v2 now; cutover approved separately later |
| 13 | Non-prod topology/RPO/RTO | Sterile-parent non-prod project; RPO/RTO per plan §16.3; budget owner = Product Owner |

## Session authorization

```
APPROVED DECISIONS (plan §24):     1-13, per table above
APPROVED PHASE:                    Phase 0 (all items)
APPROVED WORK ITEMS THIS SESSION:  0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.10, 0.11, 0.12
                                    (0.1, 0.2 already complete)
NEON RESOURCE CREATION:            NOT AUTHORIZED
DONOR CHECKOUT AVAILABLE AT:       not available
```

Neon resource creation stays unauthorized regardless of the decisions above being recorded —
that authorization is its own separate line and needs its own explicit go-ahead when Phase 1
actually starts.
```

- [ ] **Step 2: Flip the 8 gated ADRs to Accepted**

In each of `ADR-001`, `ADR-002`, `ADR-006`, `ADR-007`, `ADR-008`, `ADR-009`, `ADR-010`,
`ADR-011`, change the status line. Example for `ADR-001-canonical-repository-aiso.md`:

```diff
- **Status:** Proposed — pending §24 decision 1
+ **Status:** Accepted — §24 decision 1 approved 2026-08-31 (docs/decisions/2026-08-31-phase0-stakeholder-decisions.md)
```

Apply the same substitution pattern to the other seven files, each referencing its own
decision number(s) (002→11, 006→7, 007→3, 008→6, 009→4, 010→9, 011→"11 and 12").

- [ ] **Step 3: Update the ADR index**

In `docs/adr/README.md`, add a `Status` column reflecting the flip:

```diff
-| ADR | Title | Plan approval gate (§24) |
-|---|---|---|
-| [ADR-001](ADR-001-canonical-repository-aiso.md) | Canonical repository: `aiso` | decision 1 |
+| ADR | Title | Plan approval gate (§24) | Status |
+|---|---|---|---|
+| [ADR-001](ADR-001-canonical-repository-aiso.md) | Canonical repository: `aiso` | decision 1 | Accepted |
```

Apply the same `Status` column to every row (Accepted for the 8 gated ADRs, "n/a — no gate"
for ADR-003/004/005).

- [ ] **Step 4: Append the plan changelog entry for D14**

At the end of `docs/superpowers/plans/2026-08-30-aisogpt-aiso-new-neon-integration.md`, after
the Appendix A table, add:

```markdown

---

## Changelog

### 2026-08-31 — D14 (stale, resolved)

`README.md` claimed "There is no CI" and "The app connects as `neondb_owner`", both
contradicted by `.github/workflows/pr-gate.yml` (a real four-job merge gate) and migration
`037` (the app connects as `aeo_app`). Found during item 0.2's execution; not one of the
original D1–D13 rows. Classified `stale`. Fix: `README.md`'s "Project status" section
corrected in the same commit as this changelog entry.
```

- [ ] **Step 5: Fix the README claims**

In `README.md`, find and replace the stale CI/role claims (in the "Project status" section):

```diff
-Two live caveats worth knowing before you touch the database:
+Two live caveats worth knowing before you touch the database — and note that this repository
+does have CI (`.github/workflows/pr-gate.yml`, a four-job merge gate) and the app connects as
+the least-privilege `aeo_app` role, not `neondb_owner` (migration `037`):
```

Then locate the specific "There is no CI" sentence (in the Commands section) and the
"neondb_owner" sentence (in the caveats bullet) and correct them in place, matching the
corrected facts already present in `CLAUDE.md`'s equivalent sections.

- [ ] **Step 6: Verify and commit**

Run:
```bash
npm run lint && npm run typecheck
```
Expected: both clean (no test changes in this task).

```bash
git checkout -b claude/plan-0.4-pillar-snapshot
git add docs/decisions docs/adr docs/superpowers/plans/2026-08-30-aisogpt-aiso-new-neon-integration.md README.md
git commit -m "docs(phase0): record stakeholder decisions, accept adrs, fix d14"
```

(Branch name anticipates Task 1 — this task's commit lands on it before Task 1's commit.)

---

## Task 1: Persist pillar snapshot (item 0.4)

**Restated from plan §19:** Goal: new scans store a versioned pillar snapshot; old scans show
"recalculated". Deps: 0.1 (done). Schema/API: `scans.results.pillarScores` (no migration).
Security: none. Acceptance: "new scan stores snapshot; old scans show 'recalculated'".

**Files:**
- Modify: `lib/pillar-scores.ts`
- Modify: `app/api/scan/route.ts`
- Modify: `components/PillarScoreCards.tsx` — **scope note:** not in the plan's file list for
  0.4, but the acceptance criterion literally requires historical scans to visibly show
  "recalculated" and this component is the only live renderer of pillar scores
  (`components/result/ResultClient.tsx`, `components/dashboard/ScanSummary.tsx` both import
  it). Without this one-line addition the acceptance criterion is false. Classified as a
  `gap` in the item's file list, not scope creep — flagged here rather than applied silently.
- Test: `__tests__/lib/pillar-scores.test.ts`
- Test: `__tests__/api/scan-flow.test.ts`

- [ ] **Step 1: Write the failing unit test for provenance**

In `__tests__/lib/pillar-scores.test.ts`, add to the `resolvePillarScores` describe block:

```ts
  it('reports whether the snapshot came from storage or was recalculated', () => {
    const results = resultsWithStatus('pass')
    const stored = calculatePillarScores(results)

    expect(isPillarScoreStored({ pillarScores: stored })).toBe(true)
    expect(isPillarScoreStored(results)).toBe(false)
    expect(isPillarScoreStored({ pillarScores: { methodologyVersion: 'broken' } })).toBe(false)
  })
```

Add the import: `isPillarScoreStored` to the existing `from '@/lib/pillar-scores'` import list.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run __tests__/lib/pillar-scores.test.ts`
Expected: FAIL — `isPillarScoreStored is not exported`.

- [ ] **Step 3: Add `isPillarScoreStored` to `lib/pillar-scores.ts`**

At the end of the file, after `resolvePillarScores`:

```ts
/**
 * True when `results.pillarScores` is a valid stored snapshot — i.e. the value
 * `resolvePillarScores` will return unmodified rather than recalculate.
 */
export function isPillarScoreStored(results: Record<string, unknown>): boolean {
  return isPillarScoreSnapshot(results.pillarScores)
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run __tests__/lib/pillar-scores.test.ts`
Expected: PASS (all tests in the file, including the new one).

- [ ] **Step 5: Write the failing API test for the writer**

In `__tests__/api/scan-flow.test.ts`, add a new `it` inside the `describe` block, after
`'persists full scan details even though the response is gated'`:

```ts
  it('persists a versioned pillar snapshot alongside the check results', async () => {
    const { POST } = await import('@/app/api/scan/route')
    const req = new NextRequest('http://localhost/api/scan', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com' }),
      headers: { 'Content-Type': 'application/json' },
    })

    await POST(req)

    const persistedResults = JSON.parse(dbState.insertValues[3] as string)
    expect(persistedResults.pillarScores).toBeDefined()
    expect(persistedResults.pillarScores.methodologyVersion).toBe('2026-08-26.v1')
    expect(persistedResults.pillarScores.seo.score).toBeGreaterThanOrEqual(0)
    expect(persistedResults.pillarScores.aeo.score).toBeGreaterThanOrEqual(0)
    expect(persistedResults.pillarScores.geo.score).toBeGreaterThanOrEqual(0)
  })
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run __tests__/api/scan-flow.test.ts`
Expected: FAIL — `persistedResults.pillarScores` is `undefined`.

- [ ] **Step 7: Wire the writer into the scan route**

In `app/api/scan/route.ts`, add the import (after the existing `lib/scoring` import):

```diff
 import { GEO_PTS, assignGrade, calculateScore, calculateGeoScore } from '@/lib/scoring'
+import { calculatePillarScores } from '@/lib/pillar-scores'
 import type { ScanResults, IndustryCode, RegionCode } from '@/lib/types'
```

Then change the insert to include the snapshot:

```diff
   let scanId: string
   try {
+    const combinedResults = { ...results, ...geoDetails }
+    const pillarScores = calculatePillarScores(combinedResults)
     const rows = await sql`
       insert into scans (url, domain, score, results, industry, region, grade, account_id, agent_status, client_id)
       values (${baseUrl}, ${domain}, ${totalScore},
-              ${JSON.stringify({ ...results, ...geoDetails })}::jsonb,
+              ${JSON.stringify({ ...combinedResults, pillarScores })}::jsonb,
               ${geoIndustry}, ${geoRegion}, ${grade}, ${account_id},
               ${isDashboardScan ? 'pending' : null}, ${clientId ?? null})
       returning id
     `
```

Note the two later usages of `{ ...results, ...geoDetails }` (the agent webhook body and the
n8n webhook body, lines ~345 and ~364) are left unchanged — those are external payloads to
other systems, not the stored record, and the plan's acceptance criterion concerns storage
and display, not webhook payloads.

- [ ] **Step 8: Run it to verify it passes**

Run: `npx vitest run __tests__/api/scan-flow.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 9: Show the recalculated state in the UI**

In `components/PillarScoreCards.tsx`, add the import and a small note:

```diff
-import { resolvePillarScores, type PillarKey } from '@/lib/pillar-scores'
+import { resolvePillarScores, isPillarScoreStored, type PillarKey } from '@/lib/pillar-scores'
```

```diff
   const snapshot = resolvePillarScores(results)
+  const stored = isPillarScoreStored(results)
   const dashboard = tone === 'dashboard'
```

```diff
     <section
       aria-label={copy.aria}
       data-testid="pillar-score-cards"
       data-methodology-version={snapshot.methodologyVersion}
+      data-recalculated={!stored}
     >
```

And after the closing `</div>` of the pillar grid, before the existing `<p>{copy.note}</p>`:

```diff
+      {!stored && (
+        <p className={`mt-2 text-[10px] font-semibold ${mutedClass}`}>
+          {language === 'zh-HK'
+            ? '此分數已按目前方法重新計算，並非原始掃描結果。'
+            : 'Recalculated with current methodology — not the original scan result.'}
+        </p>
+      )}
       <p className={`mt-3 text-[10px] leading-relaxed ${mutedClass}`}>
         {copy.note}
       </p>
```

- [ ] **Step 10: Run the full unit suite and typecheck**

Run: `npm run lint && npm run typecheck && npx vitest run __tests__/lib/pillar-scores.test.ts __tests__/api/scan-flow.test.ts __tests__/api/scan-security.test.ts`
Expected: all clean/PASS. `scan-security.test.ts` is included because it pins the check-wiring
assertion this change must not disturb.

- [ ] **Step 11: Commit**

```bash
git add lib/pillar-scores.ts app/api/scan/route.ts components/PillarScoreCards.tsx __tests__/lib/pillar-scores.test.ts __tests__/api/scan-flow.test.ts
git commit -m "feat(scan): persist versioned pillar snapshot on every new scan"
```

---

## Task 2: Fix `asCheckResult` missing→fail (item 0.5, S4)

**Restated from plan §19:** Goal: coverage-gate semantics — missing evidence lowers coverage,
never scores as a fail. Deps: 0.4 (Task 1, done). Acceptance: "missing lowers coverage, not
score".

**Files:**
- Modify: `lib/pillar-scores.ts`
- Test: `__tests__/lib/pillar-scores.test.ts`

- [ ] **Step 1: Write the failing test for the new coverage semantics**

In `__tests__/lib/pillar-scores.test.ts`, replace the existing
`'treats missing or malformed check results as failures'` test (inside the
`calculatePillarScores` describe block) with:

```ts
  it('excludes missing or malformed check results from coverage rather than scoring them as failures', () => {
    const scores = calculatePillarScores({
      c1_robots: { status: 'pass', message: 'ok' },
      c2_llms_txt: { status: 'unknown', message: 'invalid' },
    })

    expect(scores.seo.score).toBe(100)
    expect(scores.seo.passing).toBe(1)
    expect(scores.seo.failing).toBe(0)
    expect(scores.seo.covered).toBe(1)
    expect(scores.seo.checks).toBe(11)
    expect(scores.seo.coverage).toBeCloseTo(12 / 50, 2)
    expect(scores.aeo.score).toBe(0)
    expect(scores.aeo.covered).toBe(0)
    expect(scores.geo.score).toBe(0)
    expect(scores.geo.covered).toBe(0)
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run __tests__/lib/pillar-scores.test.ts`
Expected: FAIL — old behavior scores `seo.score` as `24`, and `covered`/`coverage` are
`undefined`.

- [ ] **Step 3: Change `asCheckResult` to return `null` for missing/malformed data**

In `lib/pillar-scores.ts`:

```diff
-function asCheckResult(value: unknown): CheckResult {
+function asCheckResult(value: unknown): CheckResult | null {
   if (
     value &&
     typeof value === 'object' &&
     'status' in value &&
     CHECK_STATUSES.includes((value as { status: CheckStatus }).status)
   ) {
     const result = value as { status: CheckStatus; message?: unknown }
     return {
       status: result.status,
       message: typeof result.message === 'string' ? result.message : '',
     }
   }

-  return { status: 'fail', message: 'missing_check_result' }
+  return null
 }
```

- [ ] **Step 4: Rewrite `calculatePillar` to exclude missing checks from coverage**

```diff
 function calculatePillar(
   results: Record<string, unknown>,
   weights: Readonly<Record<string, number>>,
 ): PillarScore {
   let earned = 0
+  let coveredWeight = 0
+  let covered = 0
   let passing = 0
   let warnings = 0
   let failing = 0

   for (const [key, weight] of Object.entries(weights)) {
     const result = asCheckResult(results[key])
+    if (result === null) continue

+    coveredWeight += weight
+    covered += 1
     earned += scorePts(result, weight)

     if (result.status === 'pass') passing += 1
     else if (result.status === 'warn') warnings += 1
     else failing += 1
   }

   const maximum = Object.values(weights).reduce((total, weight) => total + weight, 0)

   return {
-    score: maximum > 0 ? Math.round((earned / maximum) * 100) : 0,
+    score: coveredWeight > 0 ? Math.round((earned / coveredWeight) * 100) : 0,
     earned: Number(earned.toFixed(1)),
     maximum,
+    coverage: maximum > 0 ? Number((coveredWeight / maximum).toFixed(2)) : 0,
     checks: Object.keys(weights).length,
+    covered,
     passing,
     warnings,
     failing,
   }
 }
```

- [ ] **Step 5: Extend `PillarScore` and the validators**

```diff
 export interface PillarScore {
   score: number
   earned: number
   maximum: number
+  coverage: number
   checks: number
+  covered: number
   passing: number
   warnings: number
   failing: number
 }
```

```diff
   return (
     isFiniteNumber(score.score) &&
     isFiniteNumber(score.earned) &&
     isFiniteNumber(score.maximum) &&
+    isFiniteNumber(score.coverage) &&
     isFiniteNumber(score.checks) &&
+    isFiniteNumber(score.covered) &&
     isFiniteNumber(score.passing) &&
     isFiniteNumber(score.warnings) &&
     isFiniteNumber(score.failing)
   )
```

- [ ] **Step 6: Run it to verify it passes**

Run: `npx vitest run __tests__/lib/pillar-scores.test.ts`
Expected: PASS (all tests, including the two untouched ones — full-coverage inputs compute
identically since `coveredWeight === maximum` when nothing is missing).

- [ ] **Step 7: Run the wider suite touching this module**

Run: `npm run lint && npm run typecheck && npx vitest run __tests__/lib/pillar-scores.test.ts __tests__/api/scan-flow.test.ts`
Expected: all clean/PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/pillar-scores.ts __tests__/lib/pillar-scores.test.ts
git commit -m "fix(scan): missing pillar evidence lowers coverage, not score"
```

---

## Task 3: Scanner/methodology/evidence version plan (item 0.6)

**Restated from plan §19:** Goal: every new scan carries version identifiers. Deps: 0.4
(Task 1, done). Schema/API: contract only. Tests: type tests. Acceptance: "every new scan
carries versions".

**Scope decision, stated explicitly:** the plan's own file list for 0.6 is `lib/types.ts` and
`docs/contracts/versioning.md` only — it does not name `app/api/scan/route.ts`. Read
literally, "every new scan carries versions" is already true after Task 1: every new scan's
stored `results.pillarScores.methodologyVersion` is populated. This item's job is to define
the companion `scannerVersion` contract and document the full versioning scheme, without a
second touch of the route (which stays exclusively Task 1's diff). Wiring `scannerVersion`
into storage is deferred to the evidence envelope epic (plan item 3.3), where the rest of the
per-check evidence fields land together.

**Files:**
- Modify: `lib/types.ts`
- Create: `docs/contracts/versioning.md`
- Create: `__tests__/lib/types.test.ts`

- [ ] **Step 1: Write the failing type test**

Create `__tests__/lib/types.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { SCANNER_VERSION, type ScanVersionInfo } from '@/lib/types'

describe('versioning contract', () => {
  it('exposes a dated scanner version', () => {
    expect(SCANNER_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.v\d+$/)
  })

  it('shapes ScanVersionInfo with both identifiers', () => {
    const info: ScanVersionInfo = {
      scannerVersion: SCANNER_VERSION,
      methodologyVersion: '2026-08-26.v1',
    }
    expect(info.scannerVersion).toBe(SCANNER_VERSION)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run __tests__/lib/types.test.ts`
Expected: FAIL — `SCANNER_VERSION` is not exported from `@/lib/types`.

- [ ] **Step 3: Add the constant and type to `lib/types.ts`**

At the end of the file, after the `LocalTrustAction` interface:

```ts

// ── Versioning contract (docs/contracts/versioning.md) ─────────────
/**
 * Bumped whenever check-engine detection logic changes for any of c1-c20.
 * Not yet stored per scan — lands with the evidence envelope (plan item 3.3).
 */
export const SCANNER_VERSION = '2026-08-31.v1'

export interface ScanVersionInfo {
  scannerVersion: string
  methodologyVersion: string
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run __tests__/lib/types.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the versioning contract doc**

Create `docs/contracts/versioning.md`:

```markdown
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
```

- [ ] **Step 6: Run the full check**

Run: `npm run lint && npm run typecheck && npx vitest run __tests__/lib/types.test.ts`
Expected: all clean/PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/types.ts docs/contracts/versioning.md __tests__/lib/types.test.ts
git commit -m "docs(scan): define scanner/methodology versioning contract"
```

---

## Task 4: Centralise score cap (item 0.12, S3)

**Restated from plan §19:** Goal: one cap, two callers. Deps: none. Acceptance: "one cap, two
callers".

**Files:**
- Modify: `lib/scoring.ts`
- Modify: `app/api/scan/route.ts`
- Modify: `lib/impact.ts`
- Test: `__tests__/lib/scoring.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/scoring.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { capScore } from '@/lib/scoring'

describe('capScore', () => {
  it('passes values at or below 100 through unchanged', () => {
    expect(capScore(0)).toBe(0)
    expect(capScore(87.5)).toBe(87.5)
    expect(capScore(100)).toBe(100)
  })

  it('caps values above 100 at exactly 100', () => {
    expect(capScore(100.1)).toBe(100)
    expect(capScore(140)).toBe(100)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run __tests__/lib/scoring.test.ts`
Expected: FAIL — `capScore is not exported`.

- [ ] **Step 3: Add `capScore` to `lib/scoring.ts`**

```diff
 export function assignGrade(score: number): string {
   if (score >= 90) return 'A+'
   if (score >= 80) return 'A'
   if (score >= 70) return 'B'
   if (score >= 60) return 'C'
   if (score >= 50) return 'D'
   return 'F'
 }

+export function capScore(value: number): number {
+  return Math.min(100, value)
+}
+
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run __tests__/lib/scoring.test.ts`
Expected: PASS.

- [ ] **Step 5: Use it in the scan route**

```diff
-import { GEO_PTS, assignGrade, calculateScore, calculateGeoScore } from '@/lib/scoring'
+import { GEO_PTS, assignGrade, calculateScore, calculateGeoScore, capScore } from '@/lib/scoring'
```

```diff
-  const totalScore = Math.min(100, score + geoScore)
+  const totalScore = capScore(score + geoScore)
```

- [ ] **Step 6: Use it in the impact engine**

```diff
-import { CORE_PTS, EXT_PTS, GEO_PTS, assignGrade } from '@/lib/scoring'
+import { CORE_PTS, EXT_PTS, GEO_PTS, assignGrade, capScore } from '@/lib/scoring'
```

```diff
-  const projectedScore = Math.min(100, Math.round((score + uplift) * 10) / 10)
+  const projectedScore = capScore(Math.round((score + uplift) * 10) / 10)
```

- [ ] **Step 7: Run the full check**

Run: `npm run lint && npm run typecheck && npx vitest run __tests__/lib/scoring.test.ts __tests__/api/scan-flow.test.ts __tests__/api/scan.test.ts`
Expected: all clean/PASS. (No test currently exercises `computeImpact`'s cap directly, so no
existing test needs updating — the behavior is unchanged, only the implementation moved.)

- [ ] **Step 8: Commit**

```bash
git add lib/scoring.ts app/api/scan/route.ts lib/impact.ts __tests__/lib/scoring.test.ts
git commit -m "refactor(scoring): centralise the 100-point score cap"
```

---

## Task 5: Typecheck tests (item 0.10, S5)

**Restated from plan §19:** Goal: `tsc --noEmit` covers `__tests__`/`tests`. Deps: none.
Acceptance: "`tsc --noEmit` covers `__tests__`".

**Plan-drift disclosure (per §7, classification `gap`):** the plan estimates this item at 1
engineering day. Removing the exclude surfaces 74 real, pre-existing type errors across 21
files — verified by running `tsc --noEmit` locally with the excludes removed. Because the
excludes are a single boolean flip (either `__tests__`/`tests` are covered by `npm run
typecheck` or they are not), there is no way to land "part" of this fix without leaving CI's
`static` job red for every subsequent PR. All 21 files are fixed together in this one task;
each fix below was individually diagnosed against the real compiler output, not guessed.

**Files:**
- Modify: `tsconfig.json`
- Modify: `__tests__/api/client-report-preview-assets.test.ts`
- Modify: `__tests__/api/cron/trial-emails.test.ts`
- Modify: `__tests__/api/onboarding-flow.test.ts`
- Modify: `__tests__/api/onboarding.test.ts`
- Modify: `__tests__/checks/citationDensity.test.ts`
- Modify: `__tests__/checks/mcpCard.test.ts`
- Modify: `scripts/ci/write-job-summary.mjs`
- Modify: `scripts/ci/validate-test-manifest.mjs`
- Modify: `__tests__/components/report-builder.test.tsx`
- Modify: `__tests__/db/brand-limit-entitlement.test.ts`
- Modify: `__tests__/integration/least-privilege-role.test.ts`
- Modify: `__tests__/lib/agents.test.ts`
- Modify: `__tests__/lib/axe-report.test.ts`
- Modify: `__tests__/lib/funnel-client.test.ts`
- Modify: `__tests__/lib/report-snapshot.test.ts`
- Modify: `__tests__/lib/result-access.test.ts`
- Modify: `__tests__/lib/trial.test.ts`
- Modify: `__tests__/supabase/033_alert_evaluation_hardening.test.ts`
- Modify: `__tests__/supabase/034_alert_evaluation_snapshot_refinement.test.ts`
- Modify: `__tests__/supabase/035_alert_email_delivery_ledger.test.ts`
- Modify: `__tests__/supabase/migration-contract.test.ts`
- Modify: `tests/e2e/email-gate.spec.ts`
- Modify: `package.json` (typecheck script)

- [ ] **Step 1: Generate Next.js route types**

Next 16's `RouteContext<'...'>` ambient type is codegen'd, not hand-written — it only exists
after `next build`, `next dev`, or `next typegen` has run at least once. Run:

```bash
npx next typegen
```

Expected: `✓ Types generated successfully`, and `.next/types/` now exists. This must run
before `tsc --noEmit` in any fresh checkout — Step 15 wires it into the `typecheck` script
permanently so this manual step is never needed again.

- [ ] **Step 2: Remove the test excludes from `tsconfig.json`**

```diff
   "exclude": [
     "node_modules",
-    "__tests__",
-    "tests",
     "cloudflare"
   ]
```

- [ ] **Step 3: Bump `target` to fix the regex dotAll-flag errors**

Six files use the `/s` (dotAll) regex flag, which needs ES2018+:

```diff
   "compilerOptions": {
-    "target": "ES2017",
+    "target": "ES2018",
```

- [ ] **Step 4: Add vitest's ambient globals**

Two files (`onboarding.test.ts`, `trial.test.ts`) use `describe`/`it`/`expect`/`vi` as bare
globals (relying on `vitest.config.ts`'s `globals: true` runtime injection) without importing
them — `tsc` has no way to know about that runtime injection without an explicit ambient
types reference:

```diff
   "compilerOptions": {
-    "target": "ES2018",
+    "target": "ES2018",
+    "types": ["node", "react", "react-dom", "vitest/globals"],
```

(Placed anywhere in `compilerOptions`; listed here right after `target` for review clarity.
`node`/`react`/`react-dom` are included explicitly because setting `types` at all disables
TypeScript's automatic inclusion of every `@types/*` package — these three are the ones this
project already depends on via `package.json`'s devDependencies.)

- [ ] **Step 5: Verify the mechanical fixes so far**

Run:
```bash
npx tsc --noEmit 2>&1 | grep -c "error TS"
```
Expected: a smaller number than 74 (the ES2018 and vitest/globals classes — roughly 37 error
lines across 8 files — are now gone; the remaining ~13 files still show their own distinct
errors, fixed in the following steps).

- [ ] **Step 6: Fix `client-report-preview-assets.test.ts` — cross-route context cast**

Line 91 casts a `context` value typed for the `logo` route directly to the `contact` route's
`RouteContext` — TypeScript correctly refuses this since the two generated types are nominally
distinct even though structurally identical. Go through `unknown` first, exactly as TS's own
error message suggests:

```diff
   const response = await GET_CONTACT(
     new Request('https://app.example/contact'),
-    context as RouteContext<'/api/client-reports/[reportId]/versions/[versionId]/contact'>,
+    context as unknown as RouteContext<'/api/client-reports/[reportId]/versions/[versionId]/contact'>,
   )
```

- [ ] **Step 7: Fix the six ES2018-adjacent test files**

`trial-emails.test.ts`, `brand-limit-entitlement.test.ts`, `033_alert_evaluation_hardening.test.ts`,
`034_alert_evaluation_snapshot_refinement.test.ts`, `035_alert_email_delivery_ledger.test.ts`,
`migration-contract.test.ts` — no changes needed. Step 3's `target` bump already resolves
these; re-verify in Step 14.

- [ ] **Step 8: Fix `onboarding-flow.test.ts` — mock missing rest params**

The `mockSql` mock only types its first tagged-template parameter, so TypeScript infers its
call signature as a length-1 tuple and rejects indexing interpolated values beyond it:

```diff
-const mockSql = vi.fn((strings: TemplateStringsArray) => {
+const mockSql = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
```

(Find the declaration near the top of the file; the body is unchanged, only the parameter
list widens.)

- [ ] **Step 9: Fix `onboarding.test.ts` and `trial.test.ts` — explicit vitest imports**

Step 4 makes these compile, but for consistency with every other test file in the repo (which
explicitly imports from `vitest` rather than relying on the global injection), add the import
line each file is missing:

`__tests__/api/onboarding.test.ts`:
```diff
+import { beforeEach, describe, expect, it, vi } from 'vitest'
```
(as the first line of the file, before existing imports)

`__tests__/lib/trial.test.ts`:
```diff
+import { describe, expect, it } from 'vitest'
```
(as the first line of the file, before the existing `getTrialStatus` import)

- [ ] **Step 10: Fix `trial.test.ts` — nullable override fields**

`makeAccount()`'s return type is declared `Account`, but spreading `Partial<Account>` after a
base object literal that never sets `override_plan`/`override_expires_at` makes those fields
possibly `undefined` in the inferred literal type, which `Account`'s `string | null` (no
`undefined`) rejects. Fix by initializing them explicitly, matching the file's own existing
pattern for other nullable fields:

```diff
 function makeAccount(overrides: Partial<Account> = {}): Account {
   return {
     id: 'acc-1',
     stripe_customer_id: null,
     stripe_subscription_id: null,
     plan: 'basic',
     status: 'active',
     trial_started_at: null,
     trial_ends_at: null,
     trial_emails_sent: 0,
     created_at: new Date().toISOString(),
+    override_plan: null,
+    override_expires_at: null,
     ...overrides,
   }
 }
```

- [ ] **Step 11: Fix `citationDensity.test.ts` — extraneous mock field**

Both `computeAuthority` mocks include a `domain` property that does not exist on
`AuthorityBreakdown` (verified against `lib/types.ts`) and is not read by anything in the
test:

```diff
 vi.mock('@/lib/authority/aggregator', () => ({
   computeAuthority: vi.fn().mockResolvedValue({
     totalScore: 35, layer1Score: 10, layer2Score: 8, layer3Score: 10, layer4Score: 7,
-    tier: 'tier1', domain: 'example.com',
+    tier: 'tier1',
   }),
 }))
```

```diff
   beforeEach(() => {
     vi.mocked(computeAuthority).mockReset()
     vi.mocked(computeAuthority).mockResolvedValue({
       totalScore: 35, layer1Score: 10, layer2Score: 8, layer3Score: 10, layer4Score: 7,
-      tier: 'tier1', domain: 'example.com', finalScore: 35,
+      tier: 'tier1', finalScore: 35,
     })
   })
```

- [ ] **Step 12: Fix `mcpCard.test.ts` and `agents.test.ts` — untyped mock call signatures**

Both files create `vi.fn()` mocks whose implementation return type gives TypeScript no
information about the arguments the mock is called with, so `.mock.calls[n][m]` indexing
fails. Give each an explicit call-signature generic.

`__tests__/checks/mcpCard.test.ts` — the `notFound` mock stands in for the injected
`PublicUrlFetch` fetcher, called with a URL string as its first argument in three separate
tests:

```diff
-const notFound = () => Promise.resolve(new Response('Not Found', { status: 404 }))
+const notFound: (url: string) => Promise<Response> = () => Promise.resolve(new Response('Not Found', { status: 404 }))
```

```diff
-    const fetcher = vi.fn(notFound)
+    const fetcher = vi.fn<(url: string) => Promise<Response>>(notFound)
```
(apply this same change at both occurrences — line ~18 and line ~43; the occurrence at
line ~34 doesn't index `.mock.calls` so it can stay as-is, but making all three consistent is
one extra line each and avoids the same trap recurring if a future edit adds an assertion
there.)

`__tests__/lib/agents.test.ts`:

```diff
 function makeSql(results: unknown[][]) {
   let i = 0
-  return vi.fn(() => Promise.resolve(results[i++] ?? []))
+  return vi.fn<(strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>>(
+    () => Promise.resolve(results[i++] ?? []),
+  )
 }
```

- [ ] **Step 13: Fix `funnel-client.test.ts` — untyped fetch mock call signature**

Both `it` blocks declare `const fetchMock = vi.fn(() => Promise.resolve(new Response()))` and
later index `fetchMock.mock.calls[n][1].body`. Give the mock `fetch`'s real call signature:

```diff
-    const fetchMock = vi.fn(() => Promise.resolve(new Response()))
+    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
+      () => Promise.resolve(new Response()),
+    )
```
(apply at both declarations in the file — one per `it` block.)

- [ ] **Step 14: Fix `report-snapshot.test.ts` — cast through unknown**

```diff
-    }) as Record<string, unknown>
+    }) as unknown as Record<string, unknown>
```

- [ ] **Step 15: Fix `result-access.test.ts` — fixture missing required check keys**

The `scan.results` fixture only provides `c1_robots`/`c2_llms_txt`, but `ScanResults`
requires `c3_bot_access`, `c4_structured_data`, `c5_extractability` too. None of the test's
assertions depend on these three, so add neutral passing values:

```diff
   results: {
     c1_robots: { status: 'pass', message: 'robots_ai_allowed', details: 'private raw evidence' },
     c2_llms_txt: { status: 'fail', message: 'llms_txt_missing', details: 'private remediation detail' },
+    c3_bot_access: { status: 'pass', message: 'bots_all_accessible' },
+    c4_structured_data: { status: 'pass', message: 'structured_data_found' },
+    c5_extractability: { status: 'pass', message: 'extractability_good' },
   },
```

- [ ] **Step 16: Fix `report-builder.test.tsx` — missing required fixture field**

`ReportPriorityFix` (in `lib/reports/types.ts`) requires a `key: string` field the fixture
omits:

```diff
     priorityFixes: [
       {
+        key: 'crawler-access',
         title: 'Clarify crawler access',
         rationale: 'Make crawler guidance explicit.',
         expectedImpact: 'high',
         nextStep: 'Review robots.txt directives.',
       },
     ],
```

- [ ] **Step 17: Fix `least-privilege-role.test.ts` — pin the Neon driver's row type**

`neon()` called without its two generic type parameters returns a broad union
(`any[][] | Record<string, any>[] | FullQueryResults<boolean>`) that can't be indexed
directly. `lib/db.ts` already pins `NeonQueryFunction<false, false>` for exactly this reason —
match that convention here:

```diff
-import { neon } from '@neondatabase/serverless'
+import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
```

```diff
-const owner = neon(process.env.TEST_DATABASE_URL!)
+const owner: NeonQueryFunction<false, false> = neon<false, false>(process.env.TEST_DATABASE_URL!)
```

```diff
-let app: ReturnType<typeof neon>
+let app: NeonQueryFunction<false, false>
```

```diff
-  app = neon(url.toString())
+  app = neon<false, false>(url.toString())
```

- [ ] **Step 18: Fix `axe-report.test.ts` — extraneous input fields**

`sanitizeAxeResults`'s parameter type (`AxeResult` in `lib/axe-report.ts`) has no `url` or
`timestamp` field, and the test's own `expect(result).toEqual({...})` assertion never checks
either — they are unused leftover fixture data:

```diff
     const result = sanitizeAxeResults({
-      url: 'https://example.test/private?email=person@example.test',
-      timestamp: '2026-08-10T00:00:00.000Z',
       violations: [{
```

- [ ] **Step 19: Fix `test-manifest.test.ts` and `validate-test-manifest.mjs` — narrow the injected lstat type**

The two test mocks for `lstatFile` only implement `isFile()`/`isSymbolicLink()`, but because
the real function's parameter defaults to Node's `lstat` (whose return type is the full
`Stats` interface), TypeScript infers the parameter's required type from that default. The
source function only actually calls `.isFile()`/`.isSymbolicLink()` on the result — document
that real, narrower contract with a JSDoc annotation in `scripts/ci/validate-test-manifest.mjs`:

```diff
+/**
+ * @param {{
+ *   file: string,
+ *   repositoryRoot: string,
+ *   lstatFile?: (path: string) => Promise<{ isFile: () => boolean, isSymbolicLink: () => boolean }>,
+ *   realpathFile?: (path: string) => Promise<string>,
+ * }} params
+ */
 export async function validateManifestFilePath({ file, repositoryRoot, lstatFile = lstat, realpathFile = realpath }) {
```

No change needed in the test file itself — the two mock literals now satisfy the narrower,
accurate parameter type.

- [ ] **Step 20: Fix `gate-scripts.test.ts` — narrow the job-summary array types**

`createJobSummary`'s `priorities = []` and `artifacts = []` default parameters infer as
`never[]` with no other type information, which rejects every real string array the tests
pass. Document the function's real contract in `scripts/ci/write-job-summary.mjs`:

```diff
+/**
+ * @param {{
+ *   job: string,
+ *   status: string,
+ *   executed: number,
+ *   skipped: number,
+ *   priorities?: string[],
+ *   artifacts?: string[],
+ *   commitSha?: string,
+ * }} params
+ */
 export function createJobSummary({ job, status, executed, skipped, priorities = [], artifacts = [], commitSha = '' }) {
```

No change needed in `__tests__/ci/gate-scripts.test.ts` itself.

- [ ] **Step 21: Fix `email-gate.spec.ts` — sidestep the closure-narrowing quirk**

```diff
-    const callback = new URL(String(requestBody?.callbackURL ?? requestBody?.callbackUrl ?? ''))
+    const body: Record<string, unknown> = requestBody ?? {}
+    const callback = new URL(String(body.callbackURL ?? body.callbackUrl ?? ''))
```

(`requestBody` is guaranteed non-null at this point — the preceding
`expect.poll(() => requestBody).not.toBeNull()` already proved it — so the `?? {}` fallback is
unreachable at runtime; it exists only to give the property accesses a concrete, non-nullable
type.)

- [ ] **Step 22: Run the full typecheck**

Run:
```bash
npx tsc --noEmit
```
Expected: **zero errors.**

- [ ] **Step 23: Wire `next typegen` into the typecheck script permanently**

So Step 1's manual command is never needed again — the codegen must run before `tsc` in any
fresh checkout, including CI:

```diff
-    "typecheck": "tsc --noEmit",
+    "typecheck": "next typegen && tsc --noEmit",
```

- [ ] **Step 24: Run the full check**

Run:
```bash
npm run lint && npm run typecheck && npm test
```
Expected: lint clean; typecheck clean; unit suite green (integration still skips loudly
without `neonctl` — expected, unrelated to this task).

- [ ] **Step 25: Commit**

```bash
git add tsconfig.json package.json __tests__ scripts/ci/write-job-summary.mjs scripts/ci/validate-test-manifest.mjs tests/e2e/email-gate.spec.ts
git commit -m "test(typecheck): make tsc --noEmit cover __tests__ and tests (S5)"
```

---

## Task 6: Freeze route/feature/field matrices as contracts (item 0.3)

**Restated from plan §19:** Goal: matrices reconcile to manifests. Deps: 0.1 (done).
Acceptance: "matrices reconcile to manifests".

**Files:**
- Create: `docs/contracts/routes.md`
- Create: `docs/contracts/features.md`
- Create: `docs/contracts/fields.md`

- [ ] **Step 1: Write the route contract**

Create `docs/contracts/routes.md`, transcribing the base plan's §9.1 manifests and §9.2 route
parity matrix verbatim (49 rows: 33 donor public families + 16 workspace families), prefaced
with:

```markdown
# Route contract

Frozen from base plan §9, 2026-08-31. This is the authoritative route parity matrix for
Phase 2+ work — changes require a plan amendment, not a silent edit here.

## Reconciliation

- Manifest A (aiso filesystem routes): 21 pages + `robots.ts`/`sitemap.ts`/`opengraph-image.tsx`/`not-found.tsx`
- Manifest B (aiso API routes): 48 files, 57 method+path combinations (detail: plan §12.1)
- Manifest C (donor virtual routes): 120 canonical URLs (66 public × 2 locales + 54 workspace),
  30 exact legacy redirects, 1 temporary redirect, 8 localised legacy capabilities,
  4 localised route aliases, 4 legacy workspace section families, 2 worker-level 410 responses
- This matrix: 49 rows — 33 donor public families + 16 workspace families. Locale variants
  collapse into one row per family (33×2=66, 16 families→54 concrete URLs, both accounted for
  by the family rows, not double-counted). Redirects live in the "Redirect/compatibility rule"
  column, not as separate rows.
- Intentional exclusions: `/result/demo-scan` (aliased, no independent page),
  `/platform/search-visibility` (alias only), `/handoff` (donor states it is not exposed), the
  5 concrete demo entity ids (fixture data, not routes).

[... full §9.2 table, transcribed verbatim ...]
```

(Copy the exact table content from
`docs/superpowers/plans/2026-08-30-aisogpt-aiso-new-neon-integration.md` §9.2, lines 462–517,
and the "routes with no donor counterpart" paragraph at line 518, and the "undocumented
behaviours" paragraph at line 520.)

- [ ] **Step 2: Write the feature contract**

Create `docs/contracts/features.md`, transcribing base plan §10.1 (feature matrix, 30 rows)
with the same frozen/reconciliation preface pattern.

- [ ] **Step 3: Write the field contract**

Create `docs/contracts/fields.md`, transcribing base plan §10.2 (UI field provenance matrix)
with the same preface pattern, plus the closing paragraph about static marketing claims never
rendering through a data-bound component.

- [ ] **Step 4: Verify row counts reconcile**

Manually count each transcribed table's rows against the source counts named in Step 1's
preface (49 route rows, 30 feature rows, matching the field matrix's row count against
§10.2's table). Confirm no row was dropped or duplicated in transcription.

- [ ] **Step 5: Run the check**

Run: `npm run lint`
Expected: clean (no code touched by this task).

- [ ] **Step 6: Commit**

```bash
git add docs/contracts
git commit -m "docs(contracts): freeze route, feature, and field matrices"
```

---

## Task 7: Greenfield baseline design + rehearsal plan (item 0.7)

**Restated from plan §19:** Goal: Option A reviewed and approved. Deps: 0.1 (done).
Acceptance: "Option A reviewed and approved".

**Files:**
- Create: `docs/plans/2026-08-31-greenfield-neon-baseline.md`

- [ ] **Step 1: Write the rehearsal plan document**

Create `docs/plans/2026-08-31-greenfield-neon-baseline.md`:

```markdown
# Greenfield Neon baseline — design and rehearsal plan

**Status:** Design approved (ADR-007); rehearsal not yet run — blocked on item 1.1 (Neon
resource creation, not authorized)
**Date:** 2026-08-31
**Governs:** base plan §15, ADR-007, plan items 1.3, 1.5, 1.7, 1.11

## What this document adds beyond ADR-007

ADR-007 records the *decision* (Option A). This document is the actionable sequence for
*executing* it, so item 1.3 ("author reviewed schema-only baseline", flagged in the base plan
as an epic needing decomposition) has a concrete starting checklist rather than a blank page.

## Baseline authoring sequence

1. Start from `supabase/migrations/001`–`037` as the source of truth for every
   application-owned object (tables, columns, constraints, indexes, functions, grants).
2. Exclude every object that is Neon-managed or Supabase-transitional and inert:
   - The `auth` schema and its trigger/policies (migration `003`) — dead under Neon,
     `auth.uid()` returns NULL, retained today only for the OLD harness's dependency.
   - The 30 policies migration `036` already dropped — do not recreate them.
   - `neon_auth` itself — provisioned by enabling Neon Auth, never by SQL in this repo.
3. Preserve every object migration `037` and its predecessors established as load-bearing:
   - `aeo_app`'s exact grant set (blanket DML on `public`, `USAGE`/`SELECT` on sequences,
     `SELECT` on `neon_auth."user"`, default privileges for future tables) and its
     `BYPASSRLS` flag.
   - The seven RLS-enabled/zero-policy tables, each keeping the posture its *creating*
     migration gave it (`023`, `024`, `025`, `027` — see `CLAUDE.md`'s Database section for
     the exact four-migration breakdown).
   - `pgcrypto` in `public` (created by `027`).
4. Write the baseline as a single reviewed SQL file, e.g. `000_baseline_2026-08-30.sql`,
   organized in the same dependency order the numbered migrations already establish
   (accounts → clients → scans → ... → grants last).
5. Do **not** obtain the baseline by `pg_dump`-ing the live production database — author it
   from the migration source, reviewed line by line against the equivalence manifest (below).

## Equivalence manifest

A companion document proving legacy-to-head and baseline-to-head converge on the same
application-owned schema. Structure:

| Object class | Legacy-to-head source | Baseline-to-head source | Diff method |
|---|---|---|---|
| Tables + columns | `001`-`037` applied in order | `000_baseline` alone | `information_schema.columns` diff |
| Constraints | same | same | `information_schema.table_constraints` diff |
| Indexes | same | same | `pg_indexes` diff |
| Functions | same | same | `pg_proc` diff, application-owned schemas only |
| Grants (aeo_app) | same | same | `information_schema.role_table_grants` diff, `aeo_app` only |
| RLS posture | same | same | `pg_tables.rowsecurity` + `pg_policies` diff, all 34 tables |

This manifest is authored alongside the baseline SQL in item 1.3, then exercised by the
schema-diff and contract tests in item 1.7.

## Rehearsal procedure (item 1.11 — the fresh-project bootstrap gate)

Run only once Neon resource creation is authorized and item 1.3's baseline + item 1.7's
equivalence tests exist:

1. Create a **disposable** Neon project (not the eventual `fimmick-aiso-v2-prod`).
2. Enable Neon Auth on its default branch — before anything else, per ADR-009's ordering
   requirement (`neon_auth.user` must exist before the baseline's `profiles` FK runs).
3. Run the baseline SQL via `MIGRATE_DATABASE_URL` against the disposable project's owner
   connection.
4. Run the equivalence manifest's diff checks against the disposable project.
5. Run `__tests__/migrations/rls-policy-freeze.test.mjs`-equivalent assertions against it:
   confirm no policy exists anywhere, confirm the seven zero-policy tables carry
   `rowsecurity = true`, confirm `aeo_app` has `rolbypassrls = true`.
6. Run the least-privilege role tests (`__tests__/integration/least-privilege-role.test.ts`'s
   pattern) against the disposable project's `aeo_app` role.
7. Tear down the disposable project.
8. Record the outcome (pass/fail, with the diff output) as the item 1.11 gate evidence —
   plan §19 names this as one of the two hard gates; nothing in Phase 2 onward starts before
   it passes.

## Harness parameterisation (item 0.8 — see its own task in this plan)

`__tests__/helpers/neon-branch.ts`'s `PROJECT_ID`/`PRODUCTION_BRANCH_ID` become
environment-injected rather than hardcoded, so the rehearsal above and the eventual real
project can both use the same harness without a code change between them. Implemented
separately in this plan's Task 8.

## Open items this document does not resolve

- The disposable project's exact AWS region (§24 decision 2 defers the literal region string
  to implementation time — a technical lookup, not a stakeholder decision).
- Whether the rehearsal's disposable project doubles as the eventual non-prod sterile-parent
  project (§24 decision 13) or is torn down and a separate one created — decide at item 1.2.
```

- [ ] **Step 2: Run the check**

Run: `npm run lint`
Expected: clean (no code touched by this task).

- [ ] **Step 3: Commit**

```bash
git add docs/plans/2026-08-31-greenfield-neon-baseline.md
git commit -m "docs(neon): greenfield baseline design and rehearsal plan"
```

---

## Task 8: Parameterise integration harness (item 0.8)

**Restated from plan §19:** Goal: runs against an injected project; guards intact. Deps: 0.7
(Task 7, done). Security: preserve all destructive guards. Acceptance: "runs against an
injected project; guards intact".

**Files:**
- Modify: `__tests__/helpers/neon-branch.ts`
- Test: `__tests__/helpers/neon-branch-config.test.ts` (new — unit-level, no `neonctl` needed)

**Note:** `__tests__/integration/setup.ts` needs no code change — it already imports
`PROJECT_ID` from `neon-branch.ts` rather than hardcoding it, so parameterising the helper
parameterises the harness end-to-end. Verified by reading the file: every reference to the
project id in `setup.ts` goes through the imported constant.

- [ ] **Step 1: Write the failing unit test**

Create `__tests__/helpers/neon-branch-config.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const ENV_KEYS = ['NEON_TEST_PROJECT_ID', 'NEON_TEST_PRODUCTION_BRANCH_ID'] as const
const originalValues: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const key of ENV_KEYS) originalValues[key] = process.env[key]
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalValues[key] === undefined) delete process.env[key]
    else process.env[key] = originalValues[key]
  }
})

describe('neon-branch harness configuration', () => {
  it('defaults to the known project and production branch when unset', async () => {
    delete process.env.NEON_TEST_PROJECT_ID
    delete process.env.NEON_TEST_PRODUCTION_BRANCH_ID
    const mod = await import('../helpers/neon-branch')

    expect(mod.PROJECT_ID).toBe('red-firefly-93523049')
    expect(mod.PRODUCTION_BRANCH_ID).toBe('br-rough-butterfly-aojtgi92')
  })

  it('reads an injected project id when set', async () => {
    process.env.NEON_TEST_PROJECT_ID = 'injected-project-id'
    process.env.NEON_TEST_PRODUCTION_BRANCH_ID = 'br-injected-production'
    const mod = await import('../helpers/neon-branch')

    expect(mod.PROJECT_ID).toBe('injected-project-id')
    expect(mod.PRODUCTION_BRANCH_ID).toBe('br-injected-production')
  })
})
```

- [ ] **Step 2: Run it to verify the first case passes and the second fails**

Run: `npx vitest run __tests__/helpers/neon-branch-config.test.ts`
Expected: first `it` PASSes (current hardcoded values happen to match); second `it` FAILs
(env var has no effect yet). Note: Vitest caches ES module instances per file by default, so
this test relies on `vi.resetModules()`-free dynamic `import()` re-evaluating the module fresh
each time within the same test file — if the two tests interfere (module already cached from
the first import), add `vi.resetModules()` at the top of each `it` before the dynamic import.

- [ ] **Step 3: Verify module caching and adjust if needed**

Run the test file alone again after adding, at the top of each `it`, before the `await
import(...)` line:

```ts
    vi.resetModules()
```

(and add `vi` to the `from 'vitest'` import). Re-run: `npx vitest run __tests__/helpers/neon-branch-config.test.ts`
Expected: first `it` PASS, second `it` still FAIL (this confirms the test harness itself
works — the failure must now come from `neon-branch.ts` not yet reading the env vars).

- [ ] **Step 4: Parameterise `neon-branch.ts`**

```diff
-export const PROJECT_ID = 'red-firefly-93523049'
+export const PROJECT_ID = process.env.NEON_TEST_PROJECT_ID ?? 'red-firefly-93523049'
```

```diff
-export const PRODUCTION_BRANCH_ID = 'br-rough-butterfly-aojtgi92'
+export const PRODUCTION_BRANCH_ID = process.env.NEON_TEST_PRODUCTION_BRANCH_ID ?? 'br-rough-butterfly-aojtgi92'
```

```diff
-const OWNER_ROLE = 'neondb_owner'
+const OWNER_ROLE = process.env.NEON_TEST_OWNER_ROLE ?? 'neondb_owner'
```

Every guard in the file (`assertDisposableTestBranch`, `createTestBranch`'s problem checks,
`productionHosts()`) reads these same three bindings and is otherwise untouched — the guards
stay byte-identical, only their inputs become configurable.

- [ ] **Step 5: Run the unit test to verify it passes**

Run: `npx vitest run __tests__/helpers/neon-branch-config.test.ts`
Expected: both PASS.

- [ ] **Step 6: Run the full unit suite and typecheck**

Run: `npm run lint && npm run typecheck && npm run test:unit`
Expected: all clean/green.

- [ ] **Step 7: Verify the injection path end-to-end against the real project**

This step requires `neonctl` authenticated (confirmed available). Run twice:

```bash
REQUIRE_INTEGRATION_TESTS=1 npm run test:integration
```
Expected: PASS (env vars unset — uses the hardcoded defaults, unchanged behavior).

```bash
NEON_TEST_PROJECT_ID=red-firefly-93523049 NEON_TEST_PRODUCTION_BRANCH_ID=br-rough-butterfly-aojtgi92 REQUIRE_INTEGRATION_TESTS=1 npm run test:integration
```
Expected: PASS (env vars explicitly set to the same values — proves the injection plumbing
works end-to-end, since there is no second real Neon project to point at yet). Label this
evidence **staging verified** (real Neon branches provisioned and torn down), not merely unit
verified.

- [ ] **Step 8: Commit**

```bash
git add __tests__/helpers/neon-branch.ts __tests__/helpers/neon-branch-config.test.ts
git commit -m "refactor(integration): parameterise Neon project/branch/role via env"
```

---

## Task 9: Run integration tests in CI (item 0.11, S6)

**Restated from plan §19:** Goal: `REQUIRE_INTEGRATION_TESTS=1` green in CI. Deps: 0.8
(Task 8, done). Security: `NEON_API_KEY` secret. Acceptance:
"`REQUIRE_INTEGRATION_TESTS=1` green".

**Files:**
- Modify: `.github/workflows/pr-gate.yml`
- Modify: `scripts/ci/aggregate-gate.mjs`
- Modify: `__tests__/ci/pr-gate-workflow.test.ts`
- Modify: `__tests__/ci/gate-scripts.test.ts` (if the new job breaks its own fixture counts —
  verified in Step 5)

**Explicit permission checkpoint:** Step 6 below adds `NEON_API_KEY` as a GitHub Actions
repository secret. That is a standing-configuration change on a shared system
(`aiso` is a public GitHub repository) — stop and get an explicit go-ahead for that specific
action before running it, even though this task itself is pre-approved.

- [ ] **Step 1: Confirm the guard test's own instructions**

`__tests__/ci/pr-gate-workflow.test.ts` asserts *no* job name matches `/integration/i` and
that `jobNames` equals exactly the current six-job list — its own comment says this failure
is deliberate, "the prompt to confirm `NEON_API_KEY` actually exists before relying on the
job, and to add it to the pr-gate `needs` list". Step 6 is that confirmation.

- [ ] **Step 2: Add the `integration` job to the workflow**

In `.github/workflows/pr-gate.yml`, insert a new job after `unit-contract` (before
`e2e-accessibility`), modeled on `unit-contract`'s own shape:

```yaml
  integration:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24.x
          cache: npm
      - run: npm ci
      - name: Install neonctl
        run: npm i -g neonctl
      - name: Run integration suite
        shell: bash
        run: |
          mkdir -p artifacts/integration
          set +e
          REQUIRE_INTEGRATION_TESTS=1 npx vitest run --config vitest.integration.config.ts --reporter=json --reporter=junit --outputFile.json=artifacts/integration/vitest.json --outputFile.junit=artifacts/integration/vitest.junit.xml 2>&1 | tee artifacts/integration/vitest.log
          vitest_exit=${PIPESTATUS[0]}
          set -e
          if [ "$vitest_exit" -eq 0 ]; then status=success; else status=failure; fi
          node scripts/ci/write-job-summary.mjs --job integration --status "$status" --executed 1 --skipped 0 --artifact integration/vitest.log --output artifacts/integration-summary.json
          exit "$vitest_exit"
        env:
          CI: 'true'
          NEON_API_KEY: ${{ secrets.NEON_API_KEY }}
      - name: Upload integration diagnostics
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: integration-diagnostics
          if-no-files-found: warn
          path: |
            artifacts/integration/
            artifacts/integration-summary.json
```

Then add it to `pr-gate`'s dependency and env lists:

```diff
   pr-gate:
     if: ${{ always() }}
-    needs: [static, unit-contract, e2e-accessibility, build, cloudflare-worker]
+    needs: [static, unit-contract, integration, e2e-accessibility, build, cloudflare-worker]
```

```diff
         env:
           STATIC_RESULT: ${{ needs.static.result }}
           UNIT_CONTRACT_RESULT: ${{ needs.unit-contract.result }}
+          INTEGRATION_RESULT: ${{ needs.integration.result }}
           E2E_ACCESSIBILITY_RESULT: ${{ needs.e2e-accessibility.result }}
           BUILD_RESULT: ${{ needs.build.result }}
           CLOUDFLARE_WORKER_RESULT: ${{ needs.cloudflare-worker.result }}
```

- [ ] **Step 3: Write the failing test for the aggregator's new required job**

In `__tests__/ci/gate-scripts.test.ts`, find the test(s) asserting `REQUIRED_RESULTS`/
`REQUIRED_JOBS`/`REQUIRED_SUMMARY_FILES` (or the aggregation behavior driven by them) and add
a case:

```ts
  it('requires the integration job before the gate can pass', () => {
    const result = aggregateGate({
      results: {
        STATIC_RESULT: 'success',
        UNIT_CONTRACT_RESULT: 'success',
        E2E_ACCESSIBILITY_RESULT: 'success',
        BUILD_RESULT: 'success',
        CLOUDFLARE_WORKER_RESULT: 'success',
        // INTEGRATION_RESULT deliberately omitted
      },
      summaries: [],
      commitSha: 'fixture-sha',
    })

    expect(result.exitCode).toBe(1)
    expect(result.summary.status).toBe('failure')
  })
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npx vitest run __tests__/ci/gate-scripts.test.ts -t "requires the integration job"`
Expected: FAIL — the aggregator currently passes without `INTEGRATION_RESULT` since it isn't
in `REQUIRED_RESULTS` yet.

- [ ] **Step 5: Add the integration job to the aggregator's required lists**

In `scripts/ci/aggregate-gate.mjs`:

```diff
-const REQUIRED_RESULTS = ['STATIC_RESULT', 'UNIT_CONTRACT_RESULT', 'E2E_ACCESSIBILITY_RESULT', 'BUILD_RESULT', 'CLOUDFLARE_WORKER_RESULT']
-const REQUIRED_JOBS = ['static', 'unit-contract', 'e2e-accessibility', 'build', 'cloudflare-worker']
+const REQUIRED_RESULTS = ['STATIC_RESULT', 'UNIT_CONTRACT_RESULT', 'INTEGRATION_RESULT', 'E2E_ACCESSIBILITY_RESULT', 'BUILD_RESULT', 'CLOUDFLARE_WORKER_RESULT']
+const REQUIRED_JOBS = ['static', 'unit-contract', 'integration', 'e2e-accessibility', 'build', 'cloudflare-worker']
 const REQUIRED_SUMMARY_FILES = [
   'static-summary.json',
   'unit-contract-summary.json',
+  'integration-summary.json',
   'e2e-accessibility-summary.json',
   'build-summary.json',
   'cloudflare-worker-summary.json',
 ]
```

- [ ] **Step 6: Run it to verify it passes**

Run: `npx vitest run __tests__/ci/gate-scripts.test.ts`
Expected: PASS (all tests in the file, including any pre-existing ones exercising a
"complete, all-success" fixture — check whether any of those fixtures need
`INTEGRATION_RESULT: 'success'` and `integration-summary.json`-equivalent added; if the file
has a shared "all green" fixture builder, add the new job there rather than duplicating it
per-test).

- [ ] **Step 7: Update the pinned workflow-shape test**

In `__tests__/ci/pr-gate-workflow.test.ts`:

```diff
-    expect(jobNames.filter((name) => /integration/i.test(name))).toEqual([])
-    expect(jobNames).toEqual(['static', 'unit-contract', 'e2e-accessibility', 'build', 'cloudflare-worker', 'pr-gate'])
+    expect(jobNames).toEqual(['static', 'unit-contract', 'integration', 'e2e-accessibility', 'build', 'cloudflare-worker', 'pr-gate'])
```

**Known pre-existing bug, fixed in the same edit:** this file's `jobNames` parsing regex is
`/^ {2}([\w-]+):$/gm`, whose `$` anchor never matches a line ending in `\r\n` — so on any
Windows checkout with `core.autocrlf=true` (this machine), `jobNames` parses as `[]`
regardless of this task's changes, and every assertion above fails. Verified independently
against pristine `main` before this plan existed — it is not something this task introduces.
Since this task already touches this exact file, fix it here rather than leaving "run it to
verify it passes" false on Windows:

```diff
-  const jobNames = [...jobsSection.matchAll(/^ {2}([\w-]+):$/gm)].map((match) => match[1])
+  const jobNames = [...jobsSection.matchAll(/^ {2}([\w-]+):\r?$/gm)].map((match) => match[1])
```

Remove or repurpose the surrounding comment block (lines ~66–82) that explained why no
integration job existed — replace it with a short note that the job now exists, is
NEON_API_KEY-gated, and this test's job is now to keep the `needs` list honest rather than to
forbid the job outright:

```diff
-    // ... [old explanatory comment about the harness relying on a manual runbook] ...
+    // The integration job now exists (item 0.11). This test's remaining job is to keep
+    // `pr-gate`'s `needs` list honest — every job other than the aggregator itself must
+    // appear there, or that job can fail while the gate still reports success.
```

- [ ] **Step 8: Run it to verify it passes**

Run: `npx vitest run __tests__/ci/pr-gate-workflow.test.ts`
Expected: PASS.

- [ ] **Step 9: Run the full local check**

Run: `npm run lint && npm run typecheck && npm test`
Expected: all clean/green (local `npm test` still uses the local skip-without-neonctl path
via `scripts/run-tests.mjs` — this task changes CI's workflow file and the aggregator, not the
local test runner).

- [ ] **Step 10: Get explicit go-ahead, then add the GitHub secret**

Stop here and ask the user for explicit confirmation before proceeding — per the checkpoint
noted at the top of this task. Once confirmed, add `NEON_API_KEY` as a repository secret via
the GitHub UI or `gh secret set NEON_API_KEY` (value from the same credential already
authenticated locally via `neonctl auth` or the `NEON_API_KEY` environment variable).

- [ ] **Step 11: Commit the workflow/code changes**

```bash
git add .github/workflows/pr-gate.yml scripts/ci/aggregate-gate.mjs __tests__/ci/pr-gate-workflow.test.ts __tests__/ci/gate-scripts.test.ts
git commit -m "ci(integration): run REQUIRE_INTEGRATION_TESTS=1 as a required gate job (S6)"
```

(The GitHub secret from Step 10 is infrastructure configuration, not part of this git commit
— it has no corresponding file in the repository.)

---

## Task 10: Feature flags + telemetry plan (item 0.9)

**Restated from plan §19:** Goal: flag read server-side, default off. Deps: 0.1 (done).
Acceptance: "flag read server-side, default off".

**Files:**
- Create: `lib/flags.ts`
- Test: `__tests__/lib/flags.test.ts`

**Scope note (YAGNI):** the base plan names exactly one concrete flag need so far — ADR-011's
dark-launch requirement for the eventual UI port ("Dark launch behind server-side flags").
This task defines the flag-reading mechanism and that one named flag; it does not invent
flags for features that don't exist yet.

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/flags.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isFeatureEnabled } from '@/lib/flags'

describe('isFeatureEnabled', () => {
  const envKey = 'FEATURE_DONOR_UI_SHELL'
  let original: string | undefined

  beforeEach(() => {
    original = process.env[envKey]
  })

  afterEach(() => {
    if (original === undefined) delete process.env[envKey]
    else process.env[envKey] = original
  })

  it('defaults to off when the env var is unset', () => {
    delete process.env[envKey]
    expect(isFeatureEnabled('donor_ui_shell')).toBe(false)
  })

  it('defaults to off for any value other than exactly "1"', () => {
    process.env[envKey] = 'true'
    expect(isFeatureEnabled('donor_ui_shell')).toBe(false)
  })

  it('turns on only when the env var is exactly "1"', () => {
    process.env[envKey] = '1'
    expect(isFeatureEnabled('donor_ui_shell')).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run __tests__/lib/flags.test.ts`
Expected: FAIL — `Cannot find module '@/lib/flags'`.

- [ ] **Step 3: Write `lib/flags.ts`**

```ts
/**
 * Server-side feature flags. Every flag defaults off; a flag turns on only
 * when its FEATURE_<NAME> environment variable is exactly '1'. Never read
 * from client components — flags gate server-rendered behavior only, per
 * ADR-011's dark-launch requirement.
 */
export type FeatureFlag = 'donor_ui_shell'

export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return process.env[`FEATURE_${flag.toUpperCase()}`] === '1'
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run __tests__/lib/flags.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full check**

Run: `npm run lint && npm run typecheck && npx vitest run __tests__/lib/flags.test.ts`
Expected: all clean/PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/flags.ts __tests__/lib/flags.test.ts
git commit -m "feat(flags): add server-side feature flag reader, default off"
```

---

## Final verification (all ten tasks)

- [ ] **Step 1: Full local gate**

Run:
```bash
npm run lint && npm run typecheck && npm test
```
Expected: lint clean; typecheck clean (now covering `__tests__`/`tests`); unit suite green.
Integration still skips locally without `neonctl` unless run explicitly per Task 8/9's
verification steps — that is expected and does not block this checklist.

- [ ] **Step 2: Confirm branch history**

Run: `git log --oneline main..HEAD`
Expected: 11 commits (Task 0 through Task 10), each scoped to its own files, in the order
this plan defines.

- [ ] **Step 3: Confirm diff scope**

Run: `git diff main...HEAD --stat`
Expected: every changed file traces to a specific task above. No file appears that isn't
named in some task's **Files** list (the three intentional gap-fills — `PillarScoreCards.tsx`
in Task 1, and the two `.mjs` scripts in Task 5 — are each explicitly justified in their
task's text, not silent additions).
