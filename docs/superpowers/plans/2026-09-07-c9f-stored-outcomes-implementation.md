# C9f Stored-Evidence Outcomes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show honest read-only D7/D28/D56 evidence windows for manually attested immutable versions without manufacturing comparable outcomes.

**Architecture:** A coherent owned SQL snapshot feeds safe source projections and a pure stored-outcomes.v1 evaluator. A separate authenticated GET route and bilingual component integrate beside delivery; existing mutation APIs remain unchanged.

**Tech Stack:** Node 24, Next.js 16.2.4, React 19, TypeScript, next-intl, Neon db() tagged SQL, Vitest 4 and Playwright 1.60; installed dependencies only.

## Global Constraints

- Approved specification: docs/superpowers/specs/2026-09-07-c9f-stored-outcomes-design.md at d23c672. Written-spec approval received 2026-09-07.
- Worktree C:/Users/laich/Documents/Aiso/.worktrees/c9b-c9c. Preserve C9e implementation branch a7bcea3, C9d branch/PR and root untracked continuation plan. Create codex/c9f-outcomes-implementation from the committed plan at execution, retaining codex/c9f-outcomes-design. No new worktree, rebase, bulk merge or push.
- Use policy identifier stored-outcomes.v1. No migration, persisted outcome rows, background job, provider request or mutation is required.
- For D7, D28 and D56, target = T plus N days and the eligible interval is [target, target plus 7 days). UTC elapsed days are exactly 86400 seconds; preserve timestamp precision.
- The baseline is the evidence snapshot frozen into the selected immutable version. No mutable draft or current prompt-bank reconstruction.
- Existing Pulse collectedAt/model/market fields are null by contract. Evidence schema 1 with withheld final-path identity never yields a comparable delta. No speculative positive-comparison adapter.
- Bound candidates to 200 plus one overflow witness per source kind per evaluation. Overflow suppresses selection certainty. Never turn source failures into empty success.
- No database/provider/environment/credential mutation, real email, paid scan, deployment, merge, push or customer write. Migration 043 is user-reported applied; target and live proof remain unverified.
- Read AGENTS.md/CLAUDE.md; use codebase-memory-mcp first. The aiso-c9bc graph omits some new symbols; verified exact paths below are fallback evidence.
- Read installed Next.js guides before framework code: node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md and 15-route-handlers.md; node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md. Keep proxy.ts and independent authentication.
- Stop at verified local handoff. C10 operational proofs/C11 cutover are separate gates.

## Execution conventions and file map

All paths below are relative to the isolated worktree. Focused runner: `node .superpowers/sdd/local-run.cjs node_modules/vitest/vitest.mjs run <test paths> --maxWorkers=2`. The existing runner strips external configuration; do not load .env files. A setup failure is not behavioral RED. Record command, exit, counts and source SHA in .superpowers/sdd/c9f-taskN-report.md. Explicitly stage only task files, then commit and review. Unit/build/fixture/browser commands sharing .next run sequentially.

| Task | New files | Existing files to read or modify |
| --- | --- | --- |
| 1 policy and wire contract | lib/outcomes/types.ts, time.ts, evaluate.ts, dto.ts; __tests__/outcomes/fixtures.ts, time.test.ts, evaluate.test.ts, dto.test.ts | Read lib/observations/types.ts, lib/opportunities/types.ts, lib/scan-evidence.ts |
| 2 coherent reader/projection | lib/outcomes/store.ts, sources.ts; __tests__/outcomes/store.test.ts, sources.test.ts | Read lib/delivery/store.ts, dto.ts; lib/change-sets/store.ts, types.ts; lib/opportunities/store.ts |
| 3 authenticated endpoint | lib/outcomes/service.ts; __tests__/outcomes/service.test.ts, route.test.ts; app/api/clients/[clientId]/work-items/[workItemId]/versions/[versionId]/outcomes/route.ts | Read lib/delivery/service.ts; modify docs/contracts/routes.md, fields.md, features.md |
| 4 accessible UI | components/outcomes/OutcomeWorkspace.tsx, OutcomeWindows.tsx; __tests__/components/c9f-fixtures.ts, outcomes-render.test.tsx; tests/e2e/c9f-outcomes.spec.ts | Modify components/change-sets/VersionWorkspace.tsx, messages/en.json, zh-HK.json and existing fixture registration discovered from C9e |
| 5 verification/handoff | docs/superpowers/plans/2026-09-07-c9f-handoff.md | Update this plan and remaining-work inventory with actual evidence |

## Task 1: Pure outcome policy and strict wire contract

**Interfaces:** Export the following contracts from lib/outcomes/types.ts. A selected candidate is an observation, not a comparative success. Runtime guards reject unknown keys, malformed dates, inconsistent states and excessive arrays.

```ts
export type OutcomeScope = { accountId:string; actorId:string; clientId:string; itemId:string; versionId:string }
export type EvidenceState = 'available'|'timing-unknown'|'invalid-baseline'|'not-comparable'|'evidence-limited'|'unavailable'
export type SourceRef = { kind:'pulse-metric'|'scan-check'; id:string; checkKey:string|null }
export type SafeEvidence = {
  source:SourceRef; recordedAt:string|null; collectedAt:string|null;
  verdict:string|null; reasons:string[]
}
export type Anchor = { id:string; deliveredAt:string; recordedAt:string }
export type OutcomeInput = {
  clientId:string; itemId:string; versionId:string; contentHash:string; evaluatedAt:string;
  anchorState:'no-delivery'|'withdrawn'|'active'; anchor:Anchor|null;
  baseline:SafeEvidence|null; candidates:SafeEvidence[];
  sourceState:'ok'|'unavailable'; truncated:boolean
}
export type OutcomeWindow = {
  day:7|28|56; startsAt:string; endsAt:string;
  timeState:'not-due'|'awaiting-evidence'|'missing-evidence'|'observation-available';
  evidenceState:EvidenceState; provisional:boolean; selected:SafeEvidence|null; reasons:string[]
}
export type OutcomeResponse = {
  schemaVersion:1; policyVersion:'stored-outcomes.v1'; clientId:string; itemId:string;
  versionId:string; contentHash:string; evaluatedAt:string;
  anchorState:OutcomeInput['anchorState']; anchor:Anchor|null;
  baseline:SafeEvidence|null; windows:OutcomeWindow[];
  diagnostics:SafeEvidence[]; truncated:boolean; reasons:string[]
}
// time.ts
export function utcMicros(value:string):bigint;
export function formatUtcMicros(value:bigint):string;
// evaluate.ts
export function evaluateOutcomes(input:OutcomeInput):OutcomeResponse;
// dto.ts
export function parseOutcomeResponse(value:unknown):OutcomeResponse;
```

- [ ] Write RED tests for microsecond boundaries and exact UTC calendar validation. Accept canonical UTC strings with 0-6 fractional digits, normalize to six; reject offsets, impossible dates, unsupported precision and nonfinite dates. Use BigInt for ordering; do not truncate to Date milliseconds.

```ts
expect(utcMicros('2026-09-14T00:00:00.000001Z')-
  utcMicros('2026-09-14T00:00:00.000000Z')).toBe(1n)
expect(()=>utcMicros('2026-02-30T00:00:00Z')).toThrow()
```

- [ ] Run focused time/evaluate/dto tests; record genuine failures before implementation.
- [ ] Implement strict UTC parsing/formatting and derive boundaries with `BigInt(day) * 86400n * 1000000n`. For each window select the earliest timed candidate in [start,end), then ID ascending, before assessing compatibility. Never select future-collected data beyond evaluatedAt. Unknown timing stays diagnostic. Pre-delivery source baseline eligibility is inclusive of T; no baseline makes evidence invalid, not zero.

```ts
const inWindow = candidates.filter(c => c.collectedAt !== null &&
  utcMicros(c.collectedAt) >= start && utcMicros(c.collectedAt) < end &&
  utcMicros(c.collectedAt) <= now)
inWindow.sort((a,b) => {
  const left=utcMicros(a.collectedAt!), right=utcMicros(b.collectedAt!)
  return left < right ? -1 : left > right ? 1 : a.source.id.localeCompare(b.source.id)
})
```

- [ ] Test anchor absent/withdrawn => no active windows; active => exactly three windows. Test half-open endpoints, open-window provisional selection, late ingestion on fresh read, earlier failed candidate preserved, baseline after T, source unavailable, overflow, mixed kind/key rejection and anchor replacement. Comparison states for all supported current sources remain not-comparable with explicit reasons; no numeric delta field exists.
- [ ] Implement browser-safe wire parsing with exact nested keys and bounded reason strings/source IDs, matching scope and consistency checks (three unique ordered days for active, no windows otherwise). Do not allow contradictory selected/timing states or unvalidated arbitrary reason text. Reason codes are a finite allowlist shared with localization; data strings never become translation keys.
- [ ] Run all four tests GREEN, stage named files, commit `feat: define strict stored outcome windows`, obtain spec/quality review.

## Task 2: Safe source projections and one-statement owned read

**Interfaces:** `readOutcomeInput(scope:OutcomeScope):Promise<{kind:'ok';value:OutcomeInput}|{kind:'not_found'|'denied'|'unavailable'}>` in store.ts. `projectOutcomeSnapshot(value:unknown):OutcomeInput` in sources.ts validates the private SQL envelope. Reuse versionDTO and deliveryEventDTO; never call separate delivery/source loaders to build a purported coherent snapshot.

- [ ] Write RED store tests proving the read uses one tagged SQL statement, binds account/actor/client/item/version, and returns no accessible version for mismatched ownership or stale membership. Mocked SQL assertions prove query intent only.

```ts
expect(await readOutcomeInput(scope)).toEqual({kind:'not_found'})
expect(sql.mock.calls).toHaveLength(1)
expect(sql.mock.calls[0].slice(1)).toContain(scope.accountId)
```

- [ ] Write projection tests for schema-invalid version, malformed event/hash binding, multiple active events, withdrawn-only history, exact microsecond timestamps, source overflow and a missing snapshot. Test Pulse never obtains collectedAt from created_at or scan_week; scan envelopes use their validated collection timestamp only.
- [ ] Implement one SELECT with CTEs: fresh profile membership; account-scoped client/item; exact version and decision; same-version attestations and matching withdrawals; server statement timestamp; bounded candidate rows. Build active state over complete delivery history, not a paginated page. Serialize relevant UTC timestamps as six-digit UTC using existing to_char convention. Missing owned record => not_found, failed membership => denied, SQL/invalid primary snapshot => unavailable.

```sql
WITH member AS MATERIALIZED (
 SELECT id FROM profiles WHERE id = ${actorId}::uuid AND account_id = ${accountId}::uuid
), owned AS MATERIALIZED (
 SELECT d.id FROM evidence_work_items d
 JOIN clients c ON c.id=d.client_id AND c.account_id=d.account_id
 WHERE d.id=${itemId}::uuid AND d.client_id=${clientId}::uuid
   AND d.account_id=${accountId}::uuid AND EXISTS(SELECT 1 FROM member)
)
```

Use the verified lib/delivery/store.ts version/event joins with every composite account/client/item/version/hash condition retained. Extend that single SELECT, not multiple calls. A single PostgreSQL statement snapshot supplies concurrency coherence without write locks or mutation retries.

- [ ] Scan candidates: owned scans matching original check subject; use valid envelope timestamp for range filtering only when safely validated. Never cast arbitrary JSON text to timestamptz without guarding malformed input. If bounded raw reads cannot establish complete candidate coverage, emit evidence-limited; do not claim exhaustive empty evidence. Keep malformed sources explicit. Pulse diagnostic candidates: exact snapshot question/platform and prompt ID when retained, newest recorded rows then ID, limit 201; created_at ordering is diagnostic only. Do not join current prompt text. Compute has-answer in SQL; never send raw answers in the envelope returned to UI.
- [ ] Project at most 200 safe candidates/diagnostics and mark overflow witness. Derive scan rejection reasons through existing readScanEvidence/compareScanEvidence; preserve withheld-path limitations. Mark Pulse missing collection/method context; no new producer or inferred signatures. Return only safe verdict/source/time/reason fields. Historical baseline comes from version.content.evidenceSnapshot semantics (VersionDetail directly exposes evidenceSnapshot), never the work-item draft.
- [ ] Run Task 1/2 tests GREEN, inspect emitted query for every account boundary and no writes, commit `feat: read owned outcome evidence coherently`, obtain spec/quality review. Record real PostgreSQL concurrency/privilege proof as unrun; do not run integration hooks or provision targets.

## Task 3: Authenticated read-only endpoint and contract documentation

**Interfaces:** `getOutcomes(request:Request, params:{clientId:string;workItemId:string;versionId:string}):Promise<Response>` in service.ts consumes readOutcomeInput/evaluateOutcomes. Route awaits params then delegates. No existing endpoint changes.

- [ ] Read installed Next.js guides listed above. Write RED service/route tests: session missing401, malformed ID400, unsupported query400, hidden scope404, denied current membership403, SQL/projection failure503, success200 with private no-store. Reject all query keys; do not accept caller clock or source selection.
- [ ] Implement getProfile authentication, UUID parsing using established deliveryId validation, server-derived account/actor scope, result mapping and JSON serialization. Log only allowlisted error category, not SQL/source data. `Cache-Control: private, no-store` on every response.

```ts
export async function GET(request:Request, context:{params:Promise<{
  clientId:string;workItemId:string;versionId:string
}>}) {
  return getOutcomes(request, await context.params)
}
```

- [ ] Assert no write service, provider, scan runner or delivery mutation is imported/called. Test identical item/version IDs under a different client/account do not bypass ownership. Response parsing must succeed for server-generated DTOs and reject malformed fixtures.
- [ ] Update docs/contracts/routes.md with exact URL/status/cache contract; fields.md with policy/window/time semantics; features.md with current non-comparability and source-retention limits. Do not describe proposed future comparisons as implemented.
- [ ] Run Task 1-3 tests GREEN, commit `feat: expose private version outcome reads`, obtain spec/quality review.

## Task 4: Bilingual outcome UI and mutation invalidation

**Interfaces:** `OutcomeWorkspace({clientId,itemId,versionId,refreshKey}:{clientId:string;itemId:string;versionId:string;refreshKey:number})`; `OutcomeWindows({value}:{value:OutcomeResponse})`. Parent owns a refresh counter bumped after confirmed delivery create/withdraw. Add an optional notification callback to the delivery component only if needed; do not alter existing HTTP contracts or form state. Verify exact existing props before editing.

- [ ] Read Next.js server/client guide. Write render fixtures and RED hydrated tests for no delivery, withdrawn anchor, D7 awaiting, missing windows, scan-v1 not-comparable, Pulse timing unknown, overflow and unavailable. Include en/zh-HK and desktop/mobile. Follow existing C9e fixture registration/generation, adding only the new cases.
- [ ] Implement read-only GET loading with AbortController and monotonically increasing request generation. Validate response via parseOutcomeResponse and expected client/item/version; discard old generations. On refreshKey change clear stale outcome data, cancel old read and fetch fresh. Do not remount or reset delivery forms.

```tsx
useEffect(() => {
  const controller = new AbortController()
  const current = ++generation.current
  // The request result is accepted only while current === generation.current
  // and the parsed response matches all three requested scope identifiers.
  return () => { controller.abort(); generation.current++ }
}, [clientId, itemId, versionId, refreshKey])
```

- [ ] Render anchor and recorded/self-reported times distinctly, UTC window bounds, evaluation time, source references and localizable reason codes. No clickable external destination, raw answer or success-colored impact badge. Show retry for network/503/malformed response; 401/403 must clear protected data and preserve unrelated form input. Refresh is GET only, never a scan CTA.
- [ ] Add exact-key en/zh-HK translation guards. Test keyboard names/focus, announcements, no narrow viewport overflow, source deletion/read errors, out-of-order fetch after version switch/withdrawal/replacement and typed delivery input surviving outcome responses.

```ts
await page.getByRole('button', {name: 'Refresh outcomes', exact:true}).click()
await expect(page.getByText('Collection time unavailable', {exact:true})).toBeVisible()
expect(mutationRequests).toHaveLength(0)
```

- [ ] Run focused render/fixture checks then hydrated C9f and existing C9d/C9e regression cases using stripped-env production harness. Retain raw JSON per run. Fix reproduced failures, commit `feat: show accessible stored outcome windows`, obtain spec/quality review.

## Task 5: Full verification, independent review and local handoff

- [ ] Check git diff --check and final scope against approved specification; inspect all new SQL and DTO boundaries independently. Review must include policy boundary precision, unsupported evidence, coherent snapshot claims, account isolation, source bounding, stale-response protection and no hidden external actions.
- [ ] Execute these commands sequentially, recording exact SHA/UTC times/exit codes. Check the existing harness files first; if missing, recreate the stripped dummy-local environment from its established contract rather than reading .env. Never rerun an unchanged successful suite merely to fill time.

```powershell
node .superpowers/sdd/unit-run.cjs
node .superpowers/sdd/local-run.cjs node_modules/eslint/bin/eslint.js . --ignore-pattern .claude/ --ignore-pattern .superpowers/ --ignore-pattern .codebase-memory/** --ignore-pattern coverage/ --ignore-pattern cloudflare/** --ignore-pattern .playwright-ci-server/**
node .superpowers/sdd/local-run.cjs node_modules/next/dist/bin/next typegen
node .superpowers/sdd/local-run.cjs node_modules/typescript/bin/tsc --noEmit
node .superpowers/sdd/local-run.cjs node_modules/next/dist/bin/next build
node .superpowers/sdd/local-run.cjs node_modules/vitest/vitest.mjs run __tests__/components --maxWorkers=2
node .superpowers/sdd/local-run.cjs node_modules/@playwright/test/cli.js test --config .superpowers/sdd/playwright.local.config.cjs tests/e2e/c9f-outcomes.spec.ts tests/e2e/c9e-delivery.spec.ts
```

- [ ] Add the existing C9d/browser auth specs to the selected regression invocation after verifying their actual filenames in the harness; retain all browser JSON and count locale/project cases. Expected acceptance: zero failing tests, lint/typegen/tsc/build exit0, no unexpected browser errors. Setup failures remain separately reported and block corresponding pass claims.
- [ ] Obtain independent whole-diff source/evidence review. Fix findings with focused RED/GREEN and rerun affected broad checks only when justified by changes. Do not claim mock tests prove real database locking/grants.
- [ ] Write handoff with changed behavior, exact source SHA, commands/counts, review results, failures/setup blockers, migration043 user-report vs unverified target, rollback and C10/C11 remaining gates. Update this plan checkboxes only for completed steps. Preserve original root plan hash and old branch tips.
- [ ] Explicitly stage documentation, commit `docs: record C9f local outcome handoff`, verify clean status. No push, merge, deployment or next product slice.

## Plan self-review

Coverage: anchor/baseline/window/compatibility -> Tasks1-2; coherent ownership/error/bounds -> Tasks2-3; bilingual UI/freshness/input retention -> Task4; regression/independent review/rollback -> Task5. Current sources intentionally cannot produce positive comparative outcomes. All public function/type seams are defined above; proposed new file paths are implementation targets, not claims of existing code. Existing harness integration paths must be verified at execution. The plan does not close unknown live targets or authorize integration fixture writes.
