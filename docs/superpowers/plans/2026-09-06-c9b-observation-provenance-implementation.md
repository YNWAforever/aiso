# C9b Observation Provenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give owned clients a read-only, bilingual view of retained Pulse observations with honest provenance and denominators.

**Architecture:** A pure query/parser and projection layer feeds one account-scoped SQL snapshot. Independently authenticated API and page adapters consume the same service. Existing Pulse producers, summaries and prompt writes remain unchanged.

**Tech Stack:** Node24, Next16.2 App Router, TypeScript5.9, next-intl4, tagged Neon SQL, Vitest4, Playwright1.60.

## Global Constraints

Approved specification: ../specs/2026-09-06-c9b-observation-provenance-design.md. All its limits and DTO fields are normative.
- No new collection, provider calls, scheduler changes, prompt editing behavior, historical backfill or public verification is included.
- No C9a entity row is required to read an already owned client's observations.
- Exact collection time, model and market are Unknown for legacy Pulse rows.
- Existing Pulse KPI completeness logic stays unchanged.
- Raw answers are not exposed in this first DTO; return hasAnswer and the stored classification.
- GET makes no writes. Use tagged queries via db(), bounded parameters and generic logged error codes.
- limit default50/max100; platform1-80 characters; latest40 retained weeks; questions bounded by MAX_PROMPTS plus one probe row; questionsTruncated explicitly returned.
- Read AGENTS.md, CLAUDE.md and installed node_modules/next/dist/docs/01-app/01-getting-started/{03-layouts-and-pages,05-server-and-client-components,15-route-handlers}.md before framework code. Keep proxy.ts; no Supabase imports.
- Local verification only; no live DB, migration, provider, environment, credential, deployment, merge or customer write. This plan does not authorize a push.

## Baseline and verification setup

- [ ] Record git status, HEAD, remote main and PR16 merge ancestry. Fetch read-only remote refs, choose a new codex/ implementation branch from the reconciled main baseline. Preserve the user's untracked continuation plan. Do not reset, bulk-merge old branches or assume the prior feature branch equals main.
- [ ] Index the active checkout with codebase-memory-mcp if absent/stale. Route discovery through graph tools; reconcile snippets with current files. Read lib/entities/{service,store}.ts, lib/workspace/load-owned-pulse.ts and lib/pulse/observed-summary.ts.
- [ ] Use the existing isolated local validation pattern without copying .env files. Set only dummy process-local values from the PR workflow. Never execute npm run migrate, bootstrap:project, schema:equivalence or test:integration under this scope.
- [ ] Record baseline command exits. A test failure must be reproduced before repair; unrelated failures stay outside this diff.

## File responsibilities

Create lib/observations/types.ts (DTOs), query.ts (filters/cursor), schema.ts (raw-row projection), store.ts (one scoped snapshot), service.ts (auth/errors), app/api/clients/[clientId]/observations/route.ts, app/[lang]/dashboard/[clientId]/observations/page.tsx, components/observations/ObservationWorkspace.tsx. Modify components/dashboard/DashboardSidebar.tsx and messages/{en,zh-HK}.json. Tests live under __tests__/observations/, __tests__/api/observations.test.ts, __tests__/components/observation-render.test.tsx and tests/e2e/c9b-observations.spec.ts.

### Task 1: Query and evidence projection contracts

**Interfaces:** Export Question, Observation and ObservationResponse exactly as specified. Export ObservationQuery={promptId:string|null,platform:string|null,week:string|null,result:'success'|'incomplete'|null,limit:number,cursor:{recordedAt:string|null,id:string}|null}; parseObservationQuery(params:URLSearchParams):ObservationQuery; encodeObservationCursor(value:NonNullable<ObservationQuery['cursor']>):string; projectObservation(row:PulseSourceRow,currentPrompt:Question|null):Observation. PulseSourceRow names the stored SQL fields in the spec; raw_answer is accepted internally but never spread into output.

- [ ] Create __tests__/observations/query.test.ts and projection.test.ts with red cases: invalid calendar dates, repeated/unknown query keys, invalid UUIDs, noninteger limits, oversize cursors, null timestamps, blank answers, nullable classification, and edited/missing prompt links. Use this concrete regression seed:

```ts
expect(parseObservationQuery(new URLSearchParams('limit=0'))).toThrow()
expect(parseObservationQuery(new URLSearchParams('week=2026-02-30'))).toThrow()
const row = {id:'00000000-0000-4000-8000-000000000001',prompt_id:null,
 question:'Recorded question',platform:'chatgpt',scan_week:'2026-09-01',
 created_at:null,raw_answer:'  ',brand_mentioned:false}
const dto = projectObservation(row, null)
expect(dto).toMatchObject({question:'Recorded question',result:'incomplete',
 collectedAt:null,recordedAt:null,model:null,market:null,currentPrompt:null})
expect(dto).not.toHaveProperty('raw_answer')
```

- [ ] Run `node node_modules/vitest/vitest.mjs run __tests__/observations/query.test.ts __tests__/observations/projection.test.ts`; confirm missing exports/behavior fail before implementing.
- [ ] Implement strict query parsing, base64url JSON cursor (max512 encoded characters), canonical ISO calendar validation, lowercased UUID values and fixed output fields. Reject a cursor without an explicit week to prevent paging into a moving default window. Use null as the wire sentinel for unknown time; never parse an invented collection timestamp.

```ts
const hasAnswer = typeof row.raw_answer === 'string' && /\S/.test(row.raw_answer)
const classified = typeof row.brand_mentioned === 'boolean'
const result = hasAnswer && classified ? 'success' : 'incomplete'
const limitations = ['model-unrecorded','market-unrecorded','collection-time-unrecorded']
if (!hasAnswer) limitations.push('answer-unavailable')
if (!classified) limitations.push('classification-unavailable')
```

Use a tested common whitespace policy matching PostgreSQL's nonblank predicate; include tab/newline/nonbreaking-space fixtures to identify runtime differences instead of silently diverging. Count malformed legacy dates as unavailable evidence, not current time. Expose isActive:boolean|null for nullable legacy prompt flags.
- [ ] Rerun the two test files and full `npm.cmd run typecheck`; then commit only these source/tests with `feat(observations): define query and provenance contracts`.

### Task 2: Consistent account-scoped source read

**Files:** Create lib/observations/store.ts and __tests__/observations/store.test.ts. Consume ObservationQuery/projection from Task1. Export loadObservationSnapshot(accountId:string,clientId:string,query:ObservationQuery):Promise<ObservationResponse|null>. Null means no owned client; database failures throw.

- [ ] Write a tagged-SQL mock that captures template text and parameters. Assert every source is reachable only through an owned clients CTE, linked prompts require both client IDs, and only one SQL statement produces items/counts/weeks/questions. Assert result filtering cannot change denominators.

```ts
expect(result?.counts).toEqual({recordedRows:3,successfulRows:1,incompleteRows:2})
expect(result?.items.every(item => item.result === 'success')).toBe(true)
expect(sqlMock).toHaveBeenCalledTimes(1)
expect(result?.items[0]).not.toHaveProperty('account_id')
```

- [ ] Run `node node_modules/vitest/vitest.mjs run __tests__/observations/store.test.ts`; confirm failure.
- [ ] Implement a tagged statement with owned, retained_weeks, selected_week, filtered, counts, page_rows and current_questions CTEs. The SQL structure is:

```sql
with owned as (select id,account_id from clients where id=$client and account_id=$account),
retained_weeks as (select distinct m.scan_week from pulse_metrics m join owned c on c.id=m.client_id order by m.scan_week desc limit 40),
selected_week as (select coalesce($requested_week::date,max(scan_week)) as week from retained_weeks),
filtered as (select m.* from pulse_metrics m join owned c on c.id=m.client_id cross join selected_week w
 where m.scan_week=w.week and ($prompt::uuid is null or m.prompt_id=$prompt)
 and ($platform::text is null or m.platform=$platform)),
counts as (select count(*) as recorded_rows,
 count(*) filter(where brand_mentioned is not null and raw_answer ~ '[^[:space:]]') as successful_rows from filtered)
```

Translate symbolic parameters to tagged-template interpolations; never concatenate SQL. Add page_rows status predicate after counts, use descending timestamp/id keyset with explicit null branch, and fetch limit+1. Use a LEFT JOIN for currentPrompt scoped to the same client; stored question always wins. Aggregate empty arrays with coalesce and return ownership existence separately. Return no raw answer in JSON aggregates; compute hasAnswer/classified in SQL. Normalize dates through iso-date without truncating cursor timestamp precision: cursor values must retain the database's exact sort key, not a millisecond-rounded JS Date. Use a text timestamp key or lossless microsecond string consistently.
- [ ] Run store/query/projection tests including last known timestamp to first null timestamp, repeated timestamps, final-page cursor, empty DB and no matching filter. Preserve existing Pulse KPI tests.
- [ ] Commit only Task2 files with `feat(observations): load owned evidence in one snapshot`.

### Task 3: Authenticated API and page boundary

**Files:** Create lib/observations/service.ts, API route and page above; __tests__/observations/service.test.ts and __tests__/api/observations.test.ts. Consume loadObservationSnapshot. Export loadAuthenticatedObservations(clientId:string,params:URLSearchParams):Promise<ObservationResponse>; ObservationServiceError with code/status; observationErrorResponse(error:unknown):Response.

- [ ] Write red tests for unauthenticated (no SQL), invalid client/query, foreign/missing owner404, DB exception503 and successful no-store JSON. Independently call the API adapter; layout authorization is insufficient.

```ts
expect(response.status).toBe(401)
expect(storeMock).not.toHaveBeenCalled()
expect(response.headers.get('Cache-Control')).toBe('no-store')
```

- [ ] Run `node node_modules/vitest/vitest.mjs run __tests__/observations/service.test.ts __tests__/api/observations.test.ts`.
- [ ] Implement getProfile before source reads; map exactly INVALID_OBSERVATION_QUERY400, UNAUTHENTICATED401, CLIENT_NOT_FOUND404, OBSERVATIONS_UNAVAILABLE503. Log only allowlisted diagnostic fields using sanitizeDatabaseError. API awaits params and parses request.nextUrl.searchParams. Page awaits params/searchParams, retains existing requireAuth behavior, then calls the same authenticated service. Neither module instantiates db/auth at module scope.

```ts
export async function GET(request: NextRequest,
 {params}: {params:Promise<{clientId:string}>}) {
 try {
  return Response.json(await loadAuthenticatedObservations(
   (await params).clientId,request.nextUrl.searchParams),
   {headers:{'Cache-Control':'no-store'}})
 } catch(error) { return observationErrorResponse(error) }
}
```

- [ ] Rerun API/service tests, existing entity denial tests and full typecheck. Commit `feat(observations): expose guarded read-only routes`.

### Task 4: Bilingual workspace and hydrated regression

**Files:** Create ObservationWorkspace.tsx, observation-render.test.tsx, c9b-observations.spec.ts; modify DashboardSidebar.tsx, messages files, scripts/ci/prepare-component-fixtures.mjs, __tests__/ci/component-fixtures.test.ts and .github/workflows/pr-gate.yml.

**Interface:** ObservationWorkspace({clientId,initial}: {clientId:string,initial:ObservationResponse}). Fetch only the new API on filter/page changes. Use the existing workspace navigation conventions and explicit retry state.

- [ ] Add renderer tests for real dated rows, unknown provenance, empty/errors, historical/current prompt distinction, truncation, nullable flags and malicious text. Add browser tests using generated component HTML plus production CSS, intercepted API responses and actual hydration. Assert user actions, not just string presence:

```ts
await page.getByLabel('Result').selectOption('success')
await expect(page.getByText('3 recorded rows')).toBeVisible()
await expect(page.getByText('1 successful row')).toBeVisible()
await expect(page.getByText('Unknown model')).toBeVisible()
```

Pin final wording in both message catalogs; assert locale-specific text in each locale's test. Fixtures contain no real credentials/customer data.
- [ ] Run new renderer/browser tests to see the unimplemented flow fail. Build local production only with dummy process configuration, never real .env files.
- [ ] Implement labelled question/platform/week/result controls, reset paging on filter changes, and pin selectedWeek on subsequent requests. Abort or ignore stale responses so an earlier request cannot overwrite later filters. Include live loading/error announcements, focus retention and an explicit retry. Preserve denominator display before status filtering. Link questions to the verified existing prompt-management route found through graph discovery; do not invent a route.
- [ ] Add both locale messages with equal key sets. Add the observation sidebar link with aria-current, minimum target size and existing styles. No new design tokens or shell recreation.
- [ ] Extend fixture generator with observation-render and C9B env paths; workflow supplies C9B_HTML_DIR and C9B_CSS_PATH for every shard. Update explicit fixture-count assertions from5 to6. Preserve all old fixture cases and zero-skip aggregate semantics; no timeout increases.
- [ ] Run `node node_modules/vitest/vitest.mjs run __tests__/components/observation-render.test.tsx __tests__/ci` and `node node_modules/@playwright/test/cli.js test tests/e2e/c9b-observations.spec.ts --workers=1` in the isolated harness. Check en/zh-HK, keyboard, mobile reflow, data failures and pagination. Commit `feat(observations): add bilingual evidence workspace`.

### Task 5: Integrated acceptance and C9c handoff

**Files:** Modify docs/contracts/{routes,fields,features}.md; create docs/superpowers/plans/2026-09-06-c9b-handoff.md. No C9c code in this commit.

- [ ] Amend contracts with exact DTO, null provenance, counts and read policy; record implemented files and source comparison SHA.
- [ ] Run `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd run test:unit`, and `npm.cmd run build` in sanitized isolated source. Run new browser tests plus existing Pulse/entity/access-control suites; record exact totals and exits, not assumed success. Full typecheck includes all test files.
- [ ] Review source-query scope, result-count consistency, route guards and snapshots independently of coding. Resolve actionable findings and rerun affected tests. If independent review uses a subagent, follow the execution method selected by the user.
- [ ] Run `git diff --check`; verify the original untracked plan hash and unrelated changes are preserved. Commit docs explicitly. Record source-only rollback and unrun external tests. Stop at reviewable C9b checkpoint; C9c can then consume its named interfaces under the selected execution scope.

## Plan review

Coverage: provenance/query Task1; ownership/snapshot/counts Task2; independent guards/errors Task3; user flow/locale/browser fixtures Task4; regression/rollback Task5. All tests above are future commands, not recorded passes. The SQL and interface blocks are implementation constraints; their concrete tagged form and complete source files are produced during each red/green step and reviewed before its commit.
