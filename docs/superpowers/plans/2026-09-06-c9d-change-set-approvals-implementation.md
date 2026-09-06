# C9d Change-set Versions and Approvals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Submit immutable versions of C9c drafts, validate their review package, and record terminal decisions by designated account approvers with audited administrator-managed access.

**Architecture:** Keep C9c draft routes and DTOs intact. Add version/validation persistence under lib/change-sets and access/decision persistence under lib/approvals, with server-authenticated thin routes and bilingual UI. Atomic transactions serialize submissions, decisions and access changes; retained snapshots are the evidence boundary.

**Tech Stack:** Existing Next.js 16.2.4, TypeScript, next-intl, Neon tagged SQL through db(), Vitest and Playwright. No dependency or SDK upgrades.

## Global Constraints

- Approved specification: docs/superpowers/specs/2026-09-06-c9d-change-set-approvals-design.md, written-spec approval received on 2026-09-06.
- Baseline: 195282e70084fb270a4bd7df3e91527869bd4d31. Design commit ff27b30. Preserve the original root checkout and its untracked continuation plan.
- One existing work item per change set. Preserve the existing work-item API, draft-only status, editing, evidence snapshots, source exclusions and commercial/security gates.
- Submitters cannot approve their own versions. Apply the same denial to Request changes to keep all terminal review decisions independent.
- Platform administrator status does not bypass client ownership or confer review authority.
- Reasons are trimmed/NFC-normalized, 1-2000 code points.
- Actual streamed body limits: 4 KiB submission, 16 KiB decision/access mutation.
- New version/decision/audit tables give the application role SELECT/INSERT only, with explicit UPDATE/DELETE revocation and no cascading parent deletion that could erase history.
- No migration application, live grants, customer writes, database/provider/environment/credential mutation, paid scans, email, deployment, push or merge.
- Stop after authorized local implementation, verification and review. Live PostgreSQL proofs remain an explicitly reported external gate.

## Execution and evidence setup

Work in the existing isolated checkout C:/Users/laich/Documents/Aiso/.worktrees/c9b-c9c. At execution create codex/c9d-change-set-implementation from the committed plan without resetting either previous branch. Follow using-git-worktrees for any additional checkout; do not create one merely to move the same work. Before edits read AGENTS.md and CLAUDE.md. Refresh the aiso-c9bc graph for this checkout, then prefer graph discovery; the old index predates C9c stores.

Read installed guides before Task 5/6 framework code:
- node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md
- node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md
- node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md

Existing ignored harnesses: .superpowers/sdd/local-run.cjs, unit-run.cjs and playwright.local.config.cjs. Inspect them before use; they are local evidence helpers, not tracked CI dependencies. They provide dummy configuration and exclude integration. Do not load .env files or run generic integration globalSetup. Use real local node_modules, not a junction. Windows commands below run from the isolated checkout.

Define the focused runner command prefix as the following literal command, followed by the task's test files:

```powershell
node .superpowers/sdd/local-run.cjs node_modules/vitest/vitest.mjs run --maxWorkers=2
```

Each task records the actual red failure, green result, commit and unresolved limits in .superpowers/sdd/c9d-progress.md. Stage explicit paths only. Perform task review before dependent work; do not broaden into unrelated fixes.

## File ownership and dependency order

| Task | Files and responsibility | Dependencies |
| --- | --- | --- |
| 1 | lib/change-sets/types.ts, input.ts, validation.ts; lib/approvals/input.ts: types, strict input and frozen content policy | C9c |
| 2 | supabase/migrations/042_change_set_approvals.sql; dedicated integration config/tests: additive constraints and grants | 1 |
| 3 | lib/approvals/access-store.ts, access-service.ts, request.ts: administrator access state and audit | 1,2 |
| 4 | lib/change-sets/store.ts, service.ts; lib/approvals/decision-store.ts: versions and decisions | 1,2,3 |
| 5 | new API routes; route contract tests | 3,4 |
| 6 | components/change-sets and admin UI; localized pages/messages/fixtures | 5 |
| 7 | full regression evidence, independent review, contracts and handoff | 1-6 |

## Task 1: Strict inputs and frozen review content

**Create:** lib/change-sets/{types,input,validation}.ts; lib/approvals/input.ts; __tests__/change-sets/{input,validation}.test.ts; __tests__/approvals/input.test.ts.
**Consume:** WorkItem from lib/work-items/schema.ts, parseDraftEdit from lib/work-items/edit-input.ts, serializeDraftSnapshot from lib/opportunities/fingerprint.ts. Do not import the Node-dependent validator into a client component.
**Produce:** the following shared interfaces and functions; input modules remain browser-safe, validation.ts is server-only.

```ts
export type ActorSnapshot = {
  profileId: string; displayName: string | null;
  role: 'account_member' | 'account_approver' | 'platform_admin';
}
export type ReviewDecisionInput = {
  decision: 'approved' | 'changes_requested'; reason: string; requestId: string;
}
export type ApproverAccessInput = {
  profileId: string; action: 'grant' | 'revoke'; reason: string;
  expectedRevision: number; requestId: string;
}
export type ReviewContent = {
  schemaVersion: 1; workItemId: string; draftRevision: number;
  title: string; action: string; notes: string; locale: 'en' | 'zh-HK';
  evidenceSnapshot: WorkItem['evidenceSnapshot'];
}
export type ValidationResult = {
  policyVersion: 'change-set-review.v1';
  checks: Array<{code: 'text' | 'locale' | 'evidence' | 'content_size'; status: 'pass'}>;
}
export type FrozenReview = {
  content: ReviewContent; contentHash: string; validation: ValidationResult;
}
```

Functions: parseSubmission(unknown):{expectedRevision:number}; parseReviewDecision(unknown):ReviewDecisionInput; parseApproverAccess(unknown):ApproverAccessInput; parseVersionQuery(URLSearchParams):{limit:number,cursor:string|null}; freezeReview(WorkItem):FrozenReview. Define VersionSummary/VersionDetail and DecisionDTO as explicit allowlists in types.ts using the specification's fields. Store actor snapshots in new DTOs only. Reject unsupported locales even if a TypeScript caller has asserted a WorkItem type.

- [x] Write failing tests for extra/missing keys, arrays/null, Unicode reason boundaries, negative/fractional/unsafe revisions, malformed UUID, unknown query keys, supported source restrictions and nested evidence corruption.

```ts
expect(() => parseSubmission({expectedRevision: 1, accountId: 'forged'})).toThrow()
expect(() => parseReviewDecision({decision:'approved',reason:' ',requestId:crypto.randomUUID()})).toThrow()
expect(() => parseApproverAccess({profileId:crypto.randomUUID(),action:'grant',reason:'Review duty',expectedRevision:-1,requestId:crypto.randomUUID()})).toThrow()
```

- [x] Run the three Task 1 test files with the focused prefix; expect missing implementation or assertion failures, not configuration errors.
- [x] Implement exact-key parsing using Object.hasOwn and Object.keys, NFC/trim, Array.from length and TextEncoder byte counts. Reuse existing UUID policy. Submission revision must be positive; grant revision may be zero. Do not silently coerce strings to numbers.
- [x] Implement freezeReview by validating stored text with parseDraftEdit, requiring normalized values to equal the stored values, round-tripping serializeDraftSnapshot, and building only ReviewContent fields. Restrict evidence to C9c's two released rules. SHA-256 hash a recursively key-sorted representation preserving arrays; reuse an existing exported canonical serializer if suitable, otherwise a narrowly scoped validated-content serializer. Enforce <=131072 bytes using a conservative formatted JSON size and retain SQL JSONB-size backstop.

```ts
const edit = parseDraftEdit({title:item.title,action:item.action,notes:item.notes,expectedRevision:item.revision})
if (edit.title !== item.title || edit.action !== item.action || edit.notes !== item.notes) throw new Error('REVIEW_VALIDATION_FAILED')
const evidenceSnapshot = JSON.parse(serializeDraftSnapshot(item.evidenceSnapshot))
```

- [x] Add immutability tests: changing the input after freezing cannot mutate output; changing title/revision changes hash; key order does not; raw-answer-shaped evidence is rejected; 64 KiB evidence and 128 KiB package limits are independently tested. Validation failures return stable codes without raw content.
- [x] Rerun Task 1 tests; expect all pass. Review browser imports for Node dependencies and commit explicit Task 1 files with message `feat(change-sets): define frozen review content and inputs`.

## Task 2: Additive persistence and database proof isolation

**Create:** supabase/migrations/042_change_set_approvals.sql; __tests__/change-sets/migration.test.ts; __tests__/integration/change-set-approvals.test.ts; vitest.change-sets-integration.config.ts; __tests__/config/change-set-integration.test.ts.
**Modify:** vitest.integration.config.ts to exclude the dedicated suite; __tests__/scripts/migrate-baseline-guard.test.ts synthetic current relation inventory, with an explicit missing-042 rejection.
**Produce:** tables work_item_versions, work_item_decisions, account_approver_state and account_approver_events. Recheck numbering before creation; no historical migration editing.

- [x] Write failing static assertions for table constraints, grants, no cascading history deletion and dedicated config isolation. Assert the baseline guard rejects a relation inventory missing the new tables.
- [x] Run those focused tests and record the failures.
- [x] Add a composite unique index on evidence_work_items(account_id,client_id,id) for a matching version FK. Versions store id/account_id/client_id/work_item_id, version_number, draft_revision, content JSONB, content_hash, validation JSONB, submitter JSONB and submitted_at. Add positive integer/check constraints, 128 KiB content/64 KiB evidence checks, hash format, supported policy/schema and explicit object checks. Unique (account_id,client_id,work_item_id,draft_revision), (account_id,client_id,work_item_id,version_number) and composite version identity for decision FK. FK deletion is RESTRICT/NO ACTION.
- [x] Decisions store exact account/client/item/version identity and content hash, constrained decision, bounded reason, actor snapshot, grant revision/event id, request_id and decided_at. Unique version identity and unique actor/request identity within that version. Composite FK binds the exact version/hash. Frozen actor identifiers have no profile-deletion cascade or SET NULL.
- [x] Access state has (account_id,profile_id) primary key, active, positive revision, last_event_id and updated_at. Events store immutable target identifiers, action, previous/new revision, administrator snapshot, reason, request_id and created_at; unique target/new_revision and actor/request identity within account. The event-to-state history link must not prevent recording the initial event: insert event and state in one transaction/CTE, with a deferrable state last-event FK if needed. Do not seed inactive state from a decision read.
- [x] Explicitly narrow privileges; example required pattern:

```sql
revoke all on public.work_item_versions from public;
do $$ begin
  if to_regrole('aeo_app') is not null then
    revoke all on public.work_item_versions from aeo_app;
    grant select, insert on public.work_item_versions to aeo_app;
  end if;
end $$;
```

Apply that privilege pattern to decisions/events; state receives SELECT/INSERT/UPDATE only. History retention restricts relevant parent deletion. This is intentional and must have integration coverage.
- [x] Author guarded disposable-database tests for wrong-tenant FKs, package-size checks, immutable role grants, atomic access audit rollback, profile deletion preserving identity and concurrent decisions/revocation. Dedicated config includes only this file, no setupFiles/globalSetup, fileParallelism false. Require explicit C9D_DISPOSABLE_PROJECT_ID, C9D_DISPOSABLE_BRANCH_ID and C9D_TEST_DATABASE_URL; inspect connection identity and reject protected targets before test writes. Do not execute it under this task.
- [x] Run static/config/baseline tests only, review SQL, and commit explicit files with `feat(change-sets): add immutable review and access audit schema`.

## Transaction protocol shared by Tasks 3 and 4

Use supported sql.transaction([...], {isolationLevel:'ReadCommitted'}) with tagged queries, never a callback API unsupported by the installed HTTP driver. Lazy promises must not be awaited before entering the transaction. Pre-read for validation is allowed only when the subsequent mutation compares exact persisted fields.

Global lock order: relevant profiles in UUID order with FOR SHARE; existing owned work-item row FOR UPDATE for client mutations; account_approver_state row FOR UPDATE for decisions/access mutations. Access mutations serialize first-time state creation by locking the target profile FOR UPDATE in the ordered profile lock statement (administrator is FOR SHARE; if actor equals target take the stronger lock). This conflicts with decision profile FOR SHARE and prevents a grant/revoke race even without a state row. Never acquire a work-item lock from an access mutation.

Read authorization again in statements following lock acquisition; FOR SHARE prevents concurrent profile role/account changes until commit. A missing locked actor/target must make every write predicate false. Do not assume a stale pre-lock getProfile result remains authoritative. Account/client ownership must be checked in writes, not merely the initial lookup.

All write operations return a discriminated store result rather than throwing raw SQL details. Define StoreResult<T> in types.ts: {kind:'created'|'replayed',value:T} or {kind:'not_found'|'denied'|'conflict'|'validation_failed'}. Unexpected exceptions are translated by the service to 503. Retry database serialization/deadlock errors at most twice; no retry for input/permission/conflict results.

## Task 3: Audited administrator access management

**Create:** lib/approvals/{access-store,access-service,request}.ts; __tests__/approvals/{access-store,access-service}.test.ts.
**Consume:** ApproverAccessInput, ActorSnapshot and StoreResult from Task 1; requireApiAdmin from lib/admin-guard.ts for API boundary conventions; db() for fresh actor checks.
**Produce:** listApproverAccess(actorId,accountId,query) and mutateApproverAccess(actorId,accountId,input), returning allowlisted paginated DTO/store results; authenticated service wrappers getApproverAccess(accountId,params) and changeApproverAccess(accountId,request). request.ts exports readLimitedJson(request,limit) and approvalErrorResponse(error).

- [x] Write tests for non-admin denial before target queries/body, cross-account target member rejection, removed admin flag, absent state expectedRevision 0, stale access revision, request-id payload mismatch and audit rollback.

```ts
expect(result.kind).toBe('conflict')
expect(writes).toEqual([]) // stale revision must not append an audit event
```

Capture tagged SQL calls and the transaction options with mocks; do not pretend mock call ordering proves PostgreSQL concurrency.
- [x] Run tests red. Implement the actual streamed reader with reader.cancel() on byte overflow and fatal UTF-8 decoding, finally releasing the lock. Require stable safe input/error codes.
- [x] Implement ordered profile locks, then replay lookup scoped to administrator/target/request. Replay still requires current platform-admin authority. Compare normalized payload including expectedRevision. No existing state plus revoke is a conflict; already-active grant/already-inactive revoke without identical request replay is a conflict. Do not fabricate duplicate access-change events.
- [x] Implement state CAS and event insert atomically. Require current administrator is_admin and target profile.account_id equals target account in mutation predicates. Use returned event ID as state.last_event_id. Event preserves actor snapshot and prior/new revision. Empty write results must resolve to denied/not_found/conflict without committing a partial event.
- [x] Implement independent member and event keyset pagination in the same GET contract using memberCursor/eventCursor and common limit default20/max50. Reject unknown keys. Stable order profiles.id for members; events.created_at,id descending for history. Do not expose email/auth subjects. Add tests for two independent cursors and empty-vs-unavailable responses.
- [x] Run green tests and commit `feat(approvals): manage account approvers with atomic audit events`.

## Task 4: Version submission, history and terminal decisions

**Create:** lib/change-sets/{store,service}.ts; lib/approvals/decision-store.ts; __tests__/change-sets/{store,service}.test.ts; __tests__/approvals/decision-store.test.ts.
**Consume:** freezeReview, FrozenReview, parsed inputs and StoreResult. Reuse C9c readOwnedDraft for validation pre-read, preserving the two-source restriction.
**Produce:** submitVersion(accountId,clientId,itemId,actorId,expectedRevision,frozen):Promise<StoreResult<VersionDetail>>; listVersions/readVersion with owned identifiers; decideVersion(accountId,clientId,itemId,versionId,actorId,input):Promise<StoreResult<VersionDetail>>. Service functions submitAuthenticatedVersion, listAuthenticatedVersions, readAuthenticatedVersion and decideAuthenticatedVersion authenticate independently and return response bodies/status.

- [x] Write red tests for same-revision replay after subsequent draft edits, stale unsubmitted revision, future revision, caller-supplied content rejection, malformed saved snapshot, tenant mismatch and failed insert.
- [x] Implement submission profile/item locks, then existing same-revision lookup. Replay requires ownership but does not revalidate newer draft content. Otherwise validate the pre-read revision, acquire locks, compare title/action/notes/locale/evidence JSONB and exact revision in INSERT SELECT. Version number is max+1 under the parent lock; unique constraints are the backstop. Insert frozen validation and actor snapshot together. Never overwrite the original draft.
- [x] Add tests for lost-response replay, failed exact comparison, valid unknown provenance and missing original source rows. Read/list validates persisted version DTOs and omits full content from summaries. Pagination is per-item version_number descending, opaque validated cursor, limit20/max50. Latest version is computed independently of the page.
- [x] Write decision tests: no grant, self-decision, superseded version, existing terminal decision, same request/same payload replay, different payload conflict, deleted/moved actor, revoked state, and new submission racing decision.
- [x] Implement profile/item/grant locks. First permit an identical owned prior decision replay by the original actor, even after revocation, with current capabilities false. New decision requires current member, active state, actor != submitter, latest version, no decision and matching stored version/hash. Insert the active grant revision and last event reference, immutable actor role and database time in the same write.

```ts
// Capability projection is informative; the transaction enforces the same rules.
const canDecide = activeGrant && currentMember && !ownSubmission && latest && decision === null
```

- [x] Return 409 on competing terminal decision/supersession, 403 on role/self denial, 404 on owned-object miss. Preserve 422 validation errors distinct from unavailable storage. Add mock failures showing no success over failed persistence; green test all Task 4 files and commit `feat(change-sets): freeze draft versions and record guarded decisions`.

## Task 5: Independent API authorization and contracts

**Create:** app/api/clients/[clientId]/work-items/[workItemId]/versions/route.ts; versions/[versionId]/route.ts; versions/[versionId]/decision/route.ts; app/api/admin/accounts/[accountId]/approvers/route.ts; __tests__/api/change-set-versions.test.ts; __tests__/api/approver-access.test.ts.
**Modify:** docs/contracts/routes.md, fields.md, features.md with exact new DTO/error/scope boundaries.
**Consume:** Task 3/4 authenticated services and response helper. Route params are promises under installed Next 16 docs.

- [x] Read the three installed guides, then write red route tests for methods, parameters, independent auth, no-store headers, 201/200 distinction, streamed byte limits and stable failure mapping.
- [x] Implement thin routes following this shape, with actual imports from Task 4:

```ts
export async function POST(request: Request, context: {params: Promise<{clientId:string;workItemId:string}>}) {
  try {
    const {clientId, workItemId} = await context.params
    const result = await submitAuthenticatedVersion(clientId, workItemId, request)
    return Response.json(result.body, {status:result.status,headers:{'Cache-Control':'no-store'}})
  } catch (error) { return approvalErrorResponse(error) }
}
```

- [x] Provide GET/POST only where specified; no PATCH/DELETE for immutable records. All services authenticate before object disclosure or body parsing. Verify admin role revocation cannot be bypassed through the route or request body.
- [x] Run Task 5 tests plus __tests__/api/work-items.test.ts and __tests__/api/opportunities.test.ts. Commit explicit route/test/contracts files with `feat(api): expose scoped review and approver endpoints`.

## Task 6: Bilingual submission, review and administrator UI

**Create:** components/change-sets/{VersionWorkspace,VersionDetails,DecisionForm}.tsx; components/approvals/ApproverAccessWorkspace.tsx; app/[lang]/dashboard/[clientId]/work-items/[workItemId]/versions/page.tsx; app/admin/accounts/[accountId]/approvers/page.tsx; __tests__/components/{change-set-render,approver-access-render}.test.tsx; tests/e2e/c9d-change-sets.spec.ts.
**Modify:** components/work-items/DraftEditor.tsx with a saved-item version-history link only; messages/en.json and zh-HK.json; scripts/ci/prepare-component-fixtures.mjs and fixture env allowlist/tests in .github/workflows/pr-gate.yml as required by the existing fixture pattern.
**Consume:** version/access API DTOs only, browser-safe types; server pages use existing authentication guards. Admin page uses existing /admin guard and supplies locale copy through the established admin convention, with both locale dictionaries covered.

- [x] Write red render tests for saved revision submission, no unsaved draft submission, version content versus current draft, self/revoked/non-approver denial, superseded status and zero-approver versus unavailable states.
- [x] Implement VersionWorkspace with explicit loading/error/loaded states and a persisted revision read. Submit uses only {expectedRevision}; on 409 retain displayed text and offer explicit reload. Keep decision reason/requestId after failed write; change the requestId only when payload changes or after confirmed completion. Successful replay must not append duplicate UI history.
- [x] Implement terminal decisions using a required reason with an associated label, status announcements and preserved focus. Render source text as text nodes; reuse EvidenceDetails for immutable evidence. Show validation as review-package checks and preserve original provenance limitations.
- [x] Implement admin member selection, grant/revoke reason and current expectedRevision. Preserve both independent list cursors. Hide mutation controls without verified authority but rely on server enforcement. A failed permission lookup must not render an empty-success roster.
- [x] Extend the credential-free fixture harness with hydrated client fixtures for both surfaces and UTF-8 metadata. Add Playwright cases in both locales/Chromium/mobile for submission, new revision history, approval, request changes, revoked access, conflict retry, outage, escaped text, focus and keyboard interactions.

```ts
await page.getByRole('button', {name: copy.submitVersion}).click()
await expect(page.getByRole('status')).toContainText(copy.versionSubmitted)
await expect(page.getByText(copy.notDelivery)).toBeVisible()
```

The browser fixture must assert the posted body/revision/request identity through its mocked API handler, not only visible success copy. Add no live fixture bypass to production authentication.
- [x] Run component tests, sanitized production build, fixture generation and focused browser test. Commit explicit UI/fixture paths with `feat(review): add bilingual version and approver workspaces`.

## Task 7: Full verification, review and local handoff

**Created:** docs/superpowers/plans/2026-09-07-c9d-handoff.md (actual local verification date).
**Modify:** approved spec/plan progress and contracts only to reflect final implementation/evidence, not planned claims.

- [x] Run full unit suite using `node .superpowers/sdd/unit-run.cjs`; expect zero failed. Confirm integration was excluded and any temporary config edit restored.
- [x] Run package-scope lint via the existing local runner and actual node ESLint entrypoint. Run `node .superpowers/sdd/local-run.cjs node_modules/next/dist/bin/next typegen`, then `node .superpowers/sdd/local-run.cjs node_modules/typescript/bin/tsc --noEmit` and `node .superpowers/sdd/local-run.cjs node_modules/next/dist/bin/next build`. Record actual counts/status, not inherited C9c results.
- [x] Generate all component fixtures using the repository script after build. Run the local Playwright configuration with tests/e2e/c9d-change-sets.spec.ts, c9c-opportunities.spec.ts, c9b-observations.spec.ts and auth.spec.ts. Expect zero failures/skips/flaky; separately explain any environmental blockers.
- [ ] Review transaction lock order, actual SQL null/composite binding, privilege constraints, append-only history, audit actor deletion, admin demotion, revocation race, latest-version decision and retry behavior. Request independent code review using the selected execution workflow; fix findings with red/green regression evidence.
- [x] Re-run only affected checks after fixes, then verify exact tested source SHA, clean status and `git diff --check 195282e..HEAD`. Preserve original user plan hash and checkout. Export a review patch under .superpowers/sdd if useful.
- [x] Write handoff with behavior, tested SHA/commands/results, reproduced failures and repairs, unrun dedicated DB tests and unapplied migration target UNKNOWN. Record source rollback and future exact-target activation checklist. No push/merge/deploy or next slice. Commit explicit docs with `docs: record C9d verification and local handoff`.

## Plan self-review

Coverage: version/validation/DTO inputs Task 1; append-only schema and isolated DB evidence Task 2; administrator grants and audit Task 3; transactional submissions/decisions and retention Task 4; independent route auth/errors Task 5; bilingual UX and recovery Task 6; actual verification/independent review/rollback Task 7. Shared interfaces are defined before consumers. C9c remains draft-only; no delivery or provider collection was added. Expected test outcomes are instructions, not completed evidence.

Execution used subagent-driven development. Tasks 1-6 are implemented and independently approved. Task 7 local verification/handoff is complete at tested source 904f5c24ba25c26775341bf3cd339f632fcf1462: 248 unit files / 2682 passed, 134 browser cases passed, package lint/typegen/full tsc/build/47 fixture tests passed. Final whole-branch review is awaiting controller dispatch and remains unchecked above. Both dedicated PostgreSQL suites are authored and UNRUN; migration 042 remains unapplied here with target UNKNOWN. See [dated handoff](2026-09-07-c9d-handoff.md) for exact evidence, reproduced test-harness repair and activation gates. Checked prior task steps reflect the independently approved task reports, not live activation.