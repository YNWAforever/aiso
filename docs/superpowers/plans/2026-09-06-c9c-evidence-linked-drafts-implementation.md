# C9c Evidence-Linked Drafts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Derive honest suggestions from stored evidence and let users explicitly save and edit private drafts with immutable evidence snapshots.

**Architecture:** Pure versioned rules project owned source records into suggestions. Source readers preserve raw comparison tokens privately; one conditional SQL insertion validates that the exact evidence is still current. Revisioned draft writes follow the existing entity-service concurrency pattern. C9b remains independently useful.

**Tech Stack:** Node24, Next16.2, TypeScript5.9, next-intl4, Neon tagged SQL/transactions, Vitest4, Playwright1.60.

## Global Constraints

Approved specification: ../specs/2026-09-06-c9c-evidence-linked-drafts-design.md. Depends on the tested C9b checkpoint and its Observation projection.
- Derive suggestions automatically from retained evidence, then persist only when the user selects Save as draft.
- Use deterministic versioned rules, not a new LLM call.
- No approval, assignee/role system, delivery, publication, dismissal/archive, outcomes or impact attribution is introduced.
- Existing account members can save/edit these private organizational drafts; current paid generation, prompt-write and producer gates are untouched.
- Viewing suggestions creates no records. Snapshot evidence is never silently rewritten.
- Pulse source bound200 latest-week rows; newest owned scan; recommendations bound100. Fetch one extra for truncation, not unbounded scans.
- Snapshot64KiB; create body4KiB; edit body32KiB; title1-160/action1-4000/notes0-8000 normalized characters; locale en|zh-HK; list default50/max100.
- No migration application, database/provider/environment/credential mutation, customer writes, email, paid scan, deployment or merge. No push is authorized by this plan.
- Read AGENTS.md/CLAUDE.md and installed Next16 guides before framework code; proxy.ts remains; no new Supabase imports. SQL is tagged and account/client-scoped.

## Preflight and file boundaries

- [ ] Confirm C9b interfaces and tests against its final committed checkpoint; create a codex/ C9c branch preserving ancestry and the user's untracked plan. Graph-index this active checkout for source discovery. Do not reconstruct completed C9a/C8 work.
- [ ] Verify 041 remains unused in the reconciled baseline; if occupied allocate the next unused filename and update this plan/spec together before writing SQL. No historical migration changes.
- [ ] Read lib/entities/{service,store,schema}.ts, lib/scan-evidence.ts, lib/reports/store.ts, lib/observations/{schema,store,types}.ts, scripts/ci/prepare-component-fixtures.mjs, and the existing integration helper. Reports discard recommendation IDs; build a new scoped reader rather than copying their DTO.

Create lib/opportunities/{types,rules,fingerprint,store,service}.ts and lib/work-items/{schema,store,service}.ts. UI: components/opportunities/OpportunityWorkspace.tsx, components/work-items/DraftEditor.tsx. Routes: app/api/clients/[clientId]/opportunities/route.ts, app/api/clients/[clientId]/work-items/route.ts, app/api/clients/[clientId]/work-items/[workItemId]/route.ts and app/[lang]/dashboard/[clientId]/opportunities/page.tsx. Modify DashboardSidebar.tsx, messages/{en,zh-HK}.json, existing fixture generator/workflow and contracts. New schema: supabase/migrations/041_evidence_work_items.sql.

### Task 1: Versioned suggestion rules and canonical fingerprints

**Files:** opportunities/types.ts, rules.ts, fingerprint.ts; __tests__/opportunities/rules.test.ts and fingerprint.test.ts.

**Interfaces:** SourceRef={kind:'pulse-metric'|'scan-check'|'agent-recommendation',id:string,checkKey?:EvidenceCheckKey}. SourceEvidence is a discriminated union: Pulse contains Observation plus internal answerDigest; Scan contains scanId,recordedAt and validated envelope; Recommendation contains recommendationId,scanId,recordedAt,platform,category,priority,text and optional validated supporting check. Export Suggestion as specified; deriveSuggestions(source:SourceEvidence):Suggestion[]; opportunityKey(ruleVersion:string,source:SourceRef):string; fingerprintEvidence(value:unknown):string. Export DraftSnapshotV1={schemaVersion:1,source,ruleVersion,evidence,limitations,titleKey,actionKey,args,locale,initialTitle,initialAction} with explicit safe evidence union.

- [ ] Write red tests for every eligible rule and incomplete/unknown/no-answer exclusions, invalid scan envelopes, missing supporting checks, source-ID distinction and stable property-order hashing. Use real valid evidence builders in tests, not invented envelopes.

```ts
expect(fingerprintEvidence({a:1,b:2})).toBe(fingerprintEvidence({b:2,a:1}))
expect(fingerprintEvidence({a:1})).not.toBe(fingerprintEvidence({a:2}))
expect(opportunityKey('pulse-brand-absent.v1',
 {kind:'pulse-metric',id:'00000000-0000-4000-8000-000000000001'}))
 .toBe('pulse-brand-absent.v1:pulse-metric:00000000-0000-4000-8000-000000000001:')
```

- [ ] Run `node node_modules/vitest/vitest.mjs run __tests__/opportunities/rules.test.ts __tests__/opportunities/fingerprint.test.ts` and confirm red.
- [ ] Implement pure fixed rules: Pulse success+false yields review-question-coverage; validated complete applicable warn/fail checks yield review-check; valid stored recommendation yields review-recommendation. Version strings exactly match the spec. Normalize allowlisted values; canonical serialization sorts object keys, preserves arrays and rejects undefined/nonfinite/unsupported values before SHA256. Never include raw answers in public suggestions or saved snapshots; compute answerDigest internally. Serialize snapshot to UTF8 and enforce65536-byte cap.

```ts
export function opportunityKey(ruleVersion:string,source:SourceRef):string {
 return `${ruleVersion}:${source.kind}:${source.id}:${source.checkKey ?? ''}`
}
```

- [ ] Rerun both tests and full typecheck. Commit `feat(opportunities): derive versioned evidence suggestions`.

### Task 2: Owned bounded source readers and suggestions endpoint

**Files:** opportunities/store.ts, service.ts, API route; __tests__/opportunities/store.test.ts, service.test.ts and __tests__/api/opportunities.test.ts.

**Interfaces:** loadOwnedOpportunitySources(accountId:string,clientId:string):Promise<SourceWindow|null>; SourceWindow={window,sourceStates,sources:SourceEvidence[]}; sourceStates keys pulse|scan|recommendations use ok|empty|unavailable. loadAuthenticatedOpportunities(clientId:string):Promise<OpportunityResponse>. OpportunityResponse uses the spec DTO and savedDraftId mapping scoped to account/client/key. Source window and truncation are returned explicitly. Define internal EvidenceVersionToken as an allowlisted record of exact persisted input values used by a rule; never return it to the client.

- [ ] Write failing tests for foreign-client denial, recommendations through owned scan join, latest-week/newest-scan limits, recommendation cap and deterministic sort, partial failures, all-source failures503 and savedDraftId leakage. The empty and failed cases must differ:

```ts
expect(partial.sourceStates).toMatchObject({pulse:'unavailable',scan:'ok'})
expect(partial.suggestions.length).toBeGreaterThan(0)
await expect(loadAuthenticatedOpportunities(clientId)).rejects.toMatchObject({code:'OPPORTUNITIES_UNAVAILABLE',status:503})
```

Test setup explicitly sets the mocked source outcomes for each assertion.
- [ ] Run `node node_modules/vitest/vitest.mjs run __tests__/opportunities/store.test.ts __tests__/opportunities/service.test.ts __tests__/api/opportunities.test.ts` and confirm red.
- [ ] Implement tagged SQL joining every source to clients.id/account_id. Pulse selects201 rows from latest week ordered created_at desc nulls last,id desc; recommendations selects101 for the newest owned scan ordered id. Preserve check envelope redaction via readScanEvidence. Do not fall back to older data when a selected source is invalid. No DB-error-as-empty catches. An error loading saved-draft mapping is also visible as unavailable saved state; do not falsely mark saved items unsaved.
- [ ] Authenticate before SQL; API returns no-store. Derive suggestions only for healthy sources and report source unavailability. Include generic secret-safe diagnostics. A healthy empty source with other unavailable sources returns an explicit partial state, not a misleading wholly empty-success message.
- [ ] Rerun selected tests and typecheck; commit `feat(opportunities): expose scoped stored-evidence suggestions`.

### Task 3: Additive draft schema and input contracts

**Files:** migration041, work-items/schema.ts, __tests__/work-items/schema.test.ts, __tests__/work-items/migration.test.ts, __tests__/integration/evidence-work-items.test.ts (authored only).

**Interfaces:** parseCreateDraft(input:unknown):CreateDraftInput (SourceRef,ruleVersion,fingerprint,locale); parseDraftEdit(input:unknown):DraftEditInput (title,action,notes,expectedRevision); WorkItem exact spec DTO. Fingerprint must be64 lowercase hex; rule/source combinations are allowlisted; checkKey accepted only for scan-check. Revisions are positive safe integers.

- [ ] Write red validation tests: unexpected keys, malformed source/fingerprint/locale, UTF8 byte limits, Unicode normalization, whitespace-only title/action, notes bound, revision0/future handling. Assert immutable fields rejected:

```ts
expect(()=>parseDraftEdit({title:'Review',action:'Check evidence',notes:'',
 expectedRevision:1,evidenceSnapshot:{}})).toThrow()
```

- [ ] Implement strict normalization shared by service and UI validation. Stream/cap request bytes in services using the existing entity pattern; do not trust Content-Length. JSON validity and semantic length checks are separate.
- [ ] Write migration with owned-client composite FK, nullable actor composite FKs using ON DELETE SET NULL(actor_column), draft-only status, source/locale/length/revision/JSON-size checks and unique(account_id,client_id,opportunity_key). Use `octet_length(evidence_snapshot::text)<=65536` as a DB backstop and the same bound when constructing insert input. Whitespace differences between JSON text forms must not cause late surprise: preflight the final JSONB size in the conditional insert or classify constraint failure as invalid evidence. Revoke inherited DELETE privileges exactly as migration040 does. No source-row FK; snapshot outlives source replacement. Use index(account_id,client_id,created_at desc,id desc) for listing.
- [ ] Author disposable DB tests for wrong-account FK, actor deletion retaining data, source replacement retaining snapshot, grants and concurrent uniqueness. Follow existing sterile-target guards; do not run this suite or create/delete a database.
- [ ] Run `node node_modules/vitest/vitest.mjs run __tests__/work-items/schema.test.ts __tests__/work-items/migration.test.ts` and full typecheck. Confirm no production SQL was executed. Commit `feat(work-items): define private draft schema and inputs`.

### Task 4: Conditional save, duplicate replay and revisioned editing

**Files:** work-items/store.ts, service.ts, the two work-items API routes; __tests__/work-items/store.test.ts, service.test.ts; __tests__/api/work-items.test.ts.

**Interfaces:** findOwnedDraft(accountId,clientId,key):Promise<WorkItem|null>; createDraftIfEvidenceCurrent(accountId,clientId,actorId,input,snapshot,versionToken):Promise<{item:WorkItem,created:boolean}|null>; updateOwnedDraft(accountId,clientId,itemId,actorId,input:DraftEditInput):Promise<WorkItem|null>; listOwnedDrafts(accountId,clientId,query):Promise<{items:WorkItem[],nextCursor:string|null}>; readOwnedDraft(accountId,clientId,itemId):Promise<WorkItem|null>. All positional IDs are strings, actorId:string|null; create input and snapshot are Task1/3 types. Export saveAuthenticatedDraft(clientId,request), editAuthenticatedDraft(clientId,itemId,request), listAuthenticatedDrafts(clientId,params), readAuthenticatedDraft(clientId,itemId). Services own HTTP error codes and no-store responses.

- [ ] Write red tests for owner/auth/input order, source changed between read and insert, source disappearance, duplicate concurrent save, replay after deletion, forged fingerprint, stale/future edit, missing table503 and DB failures. Verify PATCH SQL cannot update evidence fields.

```ts
expect(replayed.item.id).toBe(first.item.id)
expect(replayed.created).toBe(false)
expect(edited.evidenceSnapshot).toEqual(first.item.evidenceSnapshot)
await expect(saveChangedSource()).rejects.toMatchObject({code:'EVIDENCE_CHANGED',status:409})
```

Here first/replayed/edited come from independently configured mocked statement results; saveChangedSource is the local test helper calling saveAuthenticatedDraft with a matching initial read but empty conditional insert and no replay row.
- [ ] Run `node node_modules/vitest/vitest.mjs run __tests__/work-items/store.test.ts __tests__/work-items/service.test.ts __tests__/api/work-items.test.ts` and confirm failure.
- [ ] Implement owned replay before source resolution. Otherwise reload the exact owned source, derive rule, compare fingerprint and generate initial locale text server-side. Keep exact persisted input values in the private versionToken. Insert with an INSERT...SELECT that joins the source and owner and uses null-safe equality against every relevant token field; for JSON compare JSONB equality, and for source text compare exact strings. Thus code can derive in TypeScript while the write proves that those values still exist in its SQL snapshot. Never trust a hash supplied by the browser as the SQL authorization predicate.

```sql
insert into evidence_work_items (account_id,client_id,opportunity_key,source_kind,source_id,rule_version,check_key,evidence_fingerprint,evidence_snapshot,status,title,action,notes,locale,revision,created_by,updated_by)
select c.account_id,c.id,$key,'pulse-metric',m.id,'pulse-brand-absent.v1',null,$fingerprint,$snapshot::jsonb,'draft',$title,$action,'',$locale,1,$actor,$actor
from clients c join pulse_metrics m on m.client_id=c.id
where c.account_id=$account and c.id=$client and m.id=$source
 and m.question is not distinct from $recorded_question
 and m.raw_answer is not distinct from $recorded_answer
 and m.brand_mentioned is not distinct from $recorded_classification
 and m.platform is not distinct from $recorded_platform
 and m.prompt_id is not distinct from $recorded_prompt_id
 and m.scan_week is not distinct from $recorded_week
 and m.created_at is not distinct from $recorded_created_at
on conflict (account_id,client_id,opportunity_key) do nothing
returning id,client_id,status,title,action,notes,locale,revision,created_at,updated_at,evidence_snapshot
```

This is the concurrency shape, not executable SQL: list every table column explicitly in the implementation and compare all fields contributing to the fingerprint, including dates/platform/prompt IDs and scan envelope/recommendation fields for their variants. All values use tagged interpolation. Ownership/source values and write are checked in one statement; source-window changes alone need not invalidate an exact still-owned source selected earlier.
- [ ] Use a subsequent READ COMMITTED replay SELECT in `sql.transaction([conditionalInsert,ownedReplay])`, following lib/entities/store.ts. A same-statement CTE fallback can miss a concurrent winner. If neither returns an item, recheck owner before choosing404 versus409. Failed SQL maps503. Created201 versus existing200 comes from which statement returned the item, not a guessed timestamp.
- [ ] Implement edit via owned revision CAS, then owned identical-payload replay only when stored revision>expectedRevision. Positive future revisions always conflict. Update only title/action/notes, actor, revision and updated_at. Read/list DTOs allowlist fields and use lossless created_at/id cursors. Missing/foreign IDs share404.
- [ ] Rerun the three tests, all opportunities/work-items unit tests and full typecheck. Commit `feat(work-items): save evidence snapshots with conflict-safe retries`.

### Task 5: Bilingual suggestion-save-edit flow and CI fixtures

**Files:** OpportunityWorkspace.tsx, DraftEditor.tsx, opportunities page, DashboardSidebar.tsx, message catalogs; __tests__/components/opportunity-render.test.tsx, draft-render.test.tsx; tests/e2e/c9c-opportunities.spec.ts. Modify fixture generator, its CI tests and workflow.

**Interfaces:** OpportunityWorkspace({clientId,initial}: {clientId:string,initial:OpportunityResponse}); DraftEditor({clientId,item,onSaved}: {clientId:string,item:WorkItem,onSaved:(item:WorkItem)=>void}). Page authenticates independently and uses existing error/redirect patterns.

- [ ] Write renderer/browser red cases for suggestion provenance, partial errors, selected save, duplicate clicks, stale evidence409, failed write, draft edit409 and retry. Test both locales with actual hydrated controls:

```ts
await page.getByRole('button',{name:'Save as draft'}).first().click()
await expect(page.getByRole('heading',{name:'Saved draft'})).toBeVisible()
await page.getByLabel('Notes').fill('Keep this draft')
await page.getByRole('button',{name:'Save changes'}).click()
await expect(page.getByLabel('Notes')).toHaveValue('Keep this draft')
```

Intercept API failures and assert edited inputs survive; reloading conflicting drafts requires an explicit click. Match final catalog wording in fixtures. No raw HTML insertion for recommendations/questions.
- [ ] Implement Suggestions/Saved drafts views, source dates/limitations/truncation and independent loading/error states. Save sends only the strict reference/version/fingerprint/locale payload; disable duplicate in-flight requests but retain server replay protection. Saved drafts remain editable after source disappearance. Do not silently regenerate titles/actions after locale switch or overwrite saved evidence.
- [ ] Add bilingual rule messages and control/errors, accessible tabs or links, labelled fields, live status, focus after save, mobile reflow and aria-current sidebar navigation. Use existing tokens/components. Keep source text in its recorded language and initial draft locale fixed.
- [ ] Add opportunity-render and draft-render to fixture generation with C9C/C9C_DRAFT HTML/CSS variables and workflow env. Preserve all6 fixtures after C9b; total becomes8. Update exact generator-contract assertions. No browser skips or artificial timeouts.
- [ ] Run `node node_modules/vitest/vitest.mjs run __tests__/components/opportunity-render.test.tsx __tests__/components/draft-render.test.tsx __tests__/ci`; then the isolated production browser harness with `node node_modules/@playwright/test/cli.js test tests/e2e/c9c-opportunities.spec.ts --workers=1`. Confirm test fixtures cannot call providers. Commit `feat(work-items): add bilingual suggestion and draft workspace`.

### Task 6: Whole-slice verification and release handoff

**Files:** docs/contracts/{routes,fields,features}.md; docs/superpowers/plans/2026-09-06-c9c-handoff.md.

- [ ] Record exact rule versions, owned API contract, source windows, draft-only status, immutable snapshot and future migration gate in contracts.
- [ ] Run sanitized isolated `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd run test:unit`, `npm.cmd run build`, and C9b/C9c browser suites plus existing entity/access-control regressions. Record real counts/exits. Test declarations are included in full tsc. Do not substitute Vitest success for typecheck.
- [ ] Independently review the completed diff for fingerprint/write race, concurrent replay visibility, tenant scope, JSON size backstop, source mutation, partial failures, and locale/UI evidence claims. Resolve findings with focused red/green tests. No live integration test is needed to finish authorized local work; list it as an external evidence gap.
- [ ] Export separate C9b and C9c diffs against their checkpoints, verify whitespace and user-plan preservation, and record local rollback. Prepare migration target/SQL/app-role validation/rollback as a proposal; unknown target remains an explicitly unresolved external gate, not an executable command.
- [ ] Commit only reviewed source/docs. Stop at the reviewable local handoff; no implicit C9d, operational cutover, merge or publication.

## Plan review

Spec mapping: derivation/provenance Task1; scopes/windows/partial failures Task2; additive schema/limits Task3; evidence CAS/replay/immutable edits Task4; bilingual user flow/CI wiring Task5; verification and rollback Task6. Shared interfaces are declared at task boundaries. All commands and test counts are planned until executed. The conditional SQL example is deliberately a shape to translate into explicit tagged statements using actual source columns; implementation review must reject omitted comparison fields.

## Approved scope amendment — 2026-09-06

The user explicitly requested: "complete and finish C9c with Pulse and scan-check evidence". This supersedes recommendation-related implementation requirements in the earlier design and plan.

This release implements only `pulse-brand-absent.v1` and `scan-check-gap.v1`. It does not query agent recommendations or expose recommendation suggestions, source availability, snapshots or create inputs. Public source states cover `pulse` and `scan` only. Recommendation-derived drafts and their paid-access/downgrade policy are deferred, not an unresolved blocker for this release. Existing paid recommendation generation/read/platform gates remain unchanged. Reserved source types or additive SQL allowances may remain inert; the create API must reject recommendation inputs.

All other evidence, ownership, source-window, byte-limit, immutable snapshot, conditional-save/replay, edit conflict, localization, verification and external-action limits still apply. Finish Tasks 2, 4, 5 and 6 on the reviewed Task 1 and Task 3 foundations. No production or database activation is authorized.
