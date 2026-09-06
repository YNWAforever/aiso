# C9e Delivery Attestations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export exact approved review packages and record, withdraw and read manual delivery attestations without claiming verified publication.

**Architecture:** A separate delivery service consumes immutable C9d versions/decisions. Read-only export serialization and append-only delivery events remain separate, with writes sharing the existing profile/item lock protocol. New routes and bilingual components use a separate delivery DTO and leave existing draft/review APIs unchanged.

**Tech Stack:** Node 24, Next.js 16.2.4 App Router, TypeScript, next-intl, Neon tagged SQL via db(), Vitest and Playwright; installed dependencies only.

## Global Constraints

- Approved specification: docs/superpowers/specs/2026-09-07-c9e-delivery-attestations-design.md. Written-spec approval received 2026-09-07.
- C9d baseline 12ec30d23654d9c8206d80935a1b7173647fd1d8; C9e spec commit 6fcd684. Preserve codex/c9d-change-set-implementation, PR #18 and the original checkout's untracked continuation plan.
- Work in C:/Users/laich/Documents/Aiso/.worktrees/c9b-c9c. At execution create codex/c9e-delivery-implementation from this approved design/plan checkpoint, retaining the design branch. No rebase, bulk merge, new worktree or changes to PR #18.
- Any current member of the owning account can export, attest or withdraw with an audited reason. Platform-admin status alone grants no cross-account delivery access.
- New attestations require the latest submitted version to be approved. Historical approved versions remain downloadable. At most one active attestation per version; correction uses append-only withdrawal then eligible replacement.
- Each mutation has a 16 KiB actual byte limit. Destination is 1-500 Unicode code points; note/reason 1-2000. Trim/NFC-normalize text. Destination is non-clickable plain text, never fetched.
- Require approval.decidedAt <= deliveredAt <= database current time. Preserve distinct declared delivery time and server recorded time. Do not change C9d timestamp precision to implement this.
- Exact owned retry replays the historical event; no retry can reactivate withdrawn history. Actor/account/approval identities and recorded timestamps are server-derived.
- Preserve existing C9c/C9d APIs, source allowlists, origin-only URL policy, commercial gates and independent approval rules. No synthetic observations in live DTOs.
- No UPDATE/DELETE privilege for application history, with explicit revocation of inherited default grants as in 042. Retain SELECT/INSERT only; no cascading parent deletion that erases audit records and no profile FK that deletes snapshots.
- No database/provider/environment/credential mutation, real email, paid scan, deployment, merge, push or customer write. Migration and dedicated real-SQL tests are authored only; target UNKNOWN.
- Stop at C9e local verified/reviewed handoff. C9f, C10 live obligations and C11 cutover remain separate slices/gates.
- Read AGENTS.md and CLAUDE.md; prefer codebase-memory-mcp discovery. The index aiso-c9bc was refreshed at C9d but omitted new change-set symbols; exact referenced files are the verified fallback. Refresh for implementation when needed.
- Before framework code read installed node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md, 15-route-handlers.md in that directory, and 03-api-reference/03-file-conventions/route.md under 01-app. Keep proxy.ts and independent route authentication.

## Execution and verification conventions

Use the existing ignored local-run.cjs dummy-environment runner; never load .env files for local proofs. Commands below are relative to the isolated checkout. Invoke actual Node entrypoints on Windows. The sandbox helper can fail with apply deny-read ACLs; use a scoped require_escalated shell request, not ACL changes.

Focused test command: `node .superpowers/sdd/local-run.cjs node_modules/vitest/vitest.mjs run <explicit test paths> --maxWorkers=2`. Expected RED must name the behavioral assertion or genuinely missing new module; setup crashes are not a product RED. GREEN means zero failed. Each task records commands, actual counts, exit status and source SHA in .superpowers/sdd/c9e-taskN-report.md, explicitly stages its files, commits, then receives spec and quality review. Do not count authored/unrun DB tests as passing tests.

Run unit/build/fixture/browser commands sequentially: they share .next. Retain uniquely named browser JSON immediately; the reporter overwrites its default. The prior C9d suite passed 2682 unit tests and 48 final C9d browser cases; those are baseline evidence, never C9e results.

## File map

| Responsibility | Create or modify |
| --- | --- |
| Delivery contracts/normalization | lib/delivery/types.ts, input.ts, dto.ts; __tests__/delivery/fixtures.ts, input.test.ts and dto.test.ts |
| Deterministic package | lib/delivery/export.ts; __tests__/delivery/export.test.ts |
| Immutable audit persistence | supabase/migrations/043_delivery_attestations.sql; lib/delivery/store.ts; __tests__/delivery/{migration,store}.test.ts |
| Auth/HTTP orchestration | lib/delivery/service.ts; __tests__/delivery/service.test.ts; three route files specified in Task 5 |
| Isolated DB proof | __tests__/integration/delivery-attestations.test.ts; vitest.delivery-integration.config.ts; __tests__/config/delivery-integration.test.ts; generic exclusion |
| Delivery UI | components/delivery/{DeliveryWorkspace,DeliveryForm,DeliveryHistory}.tsx; existing components/change-sets/VersionWorkspace.tsx; messages/en.json and zh-HK.json |
| Hydrated acceptance | __tests__/components/{c9e-fixtures.ts,delivery-render.test.tsx}; tests/e2e/c9e-delivery.spec.ts; fixture writer/generator/CI inventory |
| Contracts/handoff | docs/contracts/{routes,fields,features}.md; docs/superpowers/plans/2026-09-07-c9e-handoff.md |

## Task 1: Strict inputs, DTO validation and deterministic exports

**Files:** Create lib/delivery/{types,input,dto,export}.ts; __tests__/delivery/{fixtures.ts,input.test.ts,dto.test.ts,export.test.ts}. Read lib/change-sets/{types,validation,store}.ts, lib/opportunities/fingerprint.ts and lib/approvals/request.ts. Do not edit C9d behavior.

**Interfaces:** Export these exact shared types/functions for later tasks:

```ts
import type { ActorSnapshot, VersionDetail, StoreResult } from '@/lib/change-sets/types'
export type DeliveryScope = {accountId:string;clientId:string;itemId:string;versionId:string;actorId:string}
export type AttestInput = {contentHash:string;destination:string;deliveredAt:string;note:string;requestId:string}
export type WithdrawInput = {reason:string;requestId:string}
export type EventBase = {schemaVersion:1;eventId:string;versionId:string;contentHash:string;actor:ActorSnapshot;recordedAt:string}
export type DeliveryEvent = (EventBase & {kind:'attest';destination:string;deliveredAt:string;note:string}) | (EventBase & {kind:'withdraw';targetAttestationId:string;reason:string})
export type DisabledReason = 'not_approved'|'superseded'|'active_attestation'|'no_active_attestation'|null
export type DeliveryPage = {events:DeliveryEvent[];activeAttestationId:string|null;capabilities:{canExport:boolean;canAttest:boolean;canWithdraw:boolean;attestReason:DisabledReason;withdrawReason:DisabledReason};nextCursor:string|null}
export type DeliveryQuery = {limit:number;cursor:{recordedAt:string;id:string}|null}
export type DeliveryResult<T> = StoreResult<T>
export type ExportArtifact = {body:string;exportHash:string;contentType:string;filename:string}
// input.ts: parseAttest(value:unknown):AttestInput; parseWithdraw(value:unknown):WithdrawInput;
// parseDeliveryQuery(params:URLSearchParams):DeliveryQuery; parseExportFormat(params:URLSearchParams):'json'|'text'
// dto.ts: deliveryEventDTO(row:Record<string,unknown>):DeliveryEvent
// export.ts: createDeliveryExport(version:VersionDetail,format:'json'|'text'):ExportArtifact
```

- [ ] Write failing normalization/limit/time/export tests. Build fixtures from the real C9c draft and freezeReview, then construct an approved VersionDetail with valid actor snapshots; do not use the existing UI fixture's fake aaaa hash for exporter validation. Explicitly test no decision, changes_requested, a malformed hash, unknown evidence and nullable actor name.

```ts
it('normalizes offset-equivalent delivery requests without changing their identity', () => {
  const requestId='11111111-1111-4111-8111-111111111111'
  const raw={contentHash:'a'.repeat(64),destination:' Site ',deliveredAt:'2026-09-07T08:00:00+08:00',note:' e\u0301 ',requestId}
  expect(parseAttest(raw)).toEqual({...raw,destination:'Site',deliveredAt:'2026-09-07T00:00:00.000Z',note:'é'})
  expect(()=>parseAttest({...raw,deliveredAt:'2026-02-30T00:00:00Z'})).toThrow('INVALID_DELIVERY_INPUT')
})
it('exports stable bytes without capabilities or a download timestamp', () => {
  const first=createDeliveryExport(approvedVersion,'json')
  expect(createDeliveryExport({...approvedVersion,capabilities:{canDecide:false}},'json')).toEqual(first)
  expect(first.body).not.toContain('canDecide')
  expect(first.body).not.toContain('downloadedAt')
})
```

- [ ] Run the four explicit delivery test files and retain RED. Add exact destination500/501 and note2000/2001 code-point cases, CRLF normalization, forbidden controls, malformed UTF-8 tested later in service, unknown/repeated queries, safe-integer limits and tampered cursor values.
- [ ] Implement strict normalization and real Gregorian date validation before Date conversion. Accept RFC3339 seconds with optional 1-3 fractional digits and Z or numeric offset; reject unqualified local dates, leap-second rollover and invalid month/day/offset. Normalize to millisecond UTC for request identity; preserve six-digit DB precision for recorded-time cursors. Destination disallows line breaks; note/reason allow LF, normalize CRLF to LF. Do not test database-relative time in this pure parser.
- [ ] Implement a detached explicit export envelope containing schemaVersion:'delivery-export.v1', the approved frozen review content/validation, id/versionNumber/contentHash/submittedBy/submittedAt and decision. Revalidate frozen content/hash and minimal actors rather than spreading VersionDetail. Recursively sort object keys and retain array order, then JSON.stringify for stable UTF-8 bytes. Compute SHA256 on these JSON bytes; keep exportHash outside the hashed JSON (artifact property and response header) to avoid a self-referential hash. Plain text includes that hash plus labelled review metadata and indented canonical JSON for complete evidence/validation parity. Use fixed versioned limitation text; no current-time/locale-UI values enter the envelope. Reject malformed retained packages with DELIVERY_VALIDATION_FAILED; unapproved valid packages with DELIVERY_NOT_APPROVED.
- [ ] Implement kind-specific row validation without exposing raw rows. Require exact role account_member for new delivery actor snapshots, matching actor_id, normalized text, valid times/hash/IDs and mutually exclusive fields. Historical nullable names stay null.
- [ ] Run focused GREEN, full tsc and scoped lint. Commit `feat(delivery): define strict inputs and approved exports` with only Task 1 files. Review before Task 2.

## Task 2: Append-only delivery schema and isolated test configuration

**Files:** Create supabase/migrations/043_delivery_attestations.sql, __tests__/delivery/migration.test.ts, __tests__/config/delivery-integration.test.ts, vitest.delivery-integration.config.ts and __tests__/integration/delivery-attestations.test.ts. Modify vitest.integration.config.ts and __tests__/scripts/migrate-baseline-guard.test.ts only for the new migration inventory.

**Interfaces:** Table public.work_item_delivery_events column names match approved spec and Task 1 DTO mapping. Additional binding columns approval_decision='approved' and target_kind='attest' make exact composite FKs enforce semantics rather than relying on comments. IDs default gen_random_uuid(), schema_version=1, recorded_at default clock_timestamp(). No new mutable state table.

- [ ] Write failing migration/config tests: table present, ownership/version/hash/approval/self-reference bindings, withdrawal target uniqueness, account/actor/request uniqueness, explicit SELECT/INSERT with UPDATE/DELETE revocation, no cascading deletes/profile FK, dedicated suite excluded from generic setup. Example behavioral config assertion:

```ts
it('never discovers delivery proofs through generic integration setup', () => {
  const generic=readFileSync('vitest.integration.config.ts','utf8')
  expect(generic.split('exclude:')[1]?.split('globalSetup:')[0]).toContain('__tests__/integration/delivery-attestations.test.ts')
  const dedicated=readFileSync('vitest.delivery-integration.config.ts','utf8')
  expect(dedicated).not.toMatch(/\b(?:setupFiles|globalSetup)\s*:/)
})
```

- [ ] Run the explicit migration/config/baseline tests and retain RED. Confirm 043 is unused on this exact checkout. Do not fetch/merge or rewrite historical migrations merely to select a number.
- [ ] Author table columns and kind-specific CHECKs using `(predicate) IS TRUE`. Require null fields for the opposite kind. Add exact composite unique index on work_item_decisions `(account_id,client_id,work_item_id,version_id,content_hash,id,decision)`, and bind event approval identity through it. Bind version tuple to existing work_item_versions unique key. Add self-reference unique key `(account_id,client_id,work_item_id,version_id,content_hash,id,kind)` and same-scope withdrawal FK with target_kind fixed attest. Add unique target_attestation_id for withdrawals and unique account_id/actor_id/request_id. Audit actor JSON must match actor_id and contain recorded account_member role. Require delivered_at <= recorded_at for attest rows; approval lower-bound/latest/active checks run in the store. Explicit REVOKE ALL then GRANT SELECT, INSERT to aeo_app for the new table.
- [ ] Author isolated config with include:['__tests__/integration/delivery-attestations.test.ts'], node environment, no provisioning hooks, fileParallelism:false, testTimeout30000/hookTimeout60000 and @ alias. Add generic exclusion and baseline inventory entry without claiming 043 is applied.
- [ ] Author guarded real-SQL constraint tests now: require C9E_DISPOSABLE_PROJECT_ID, C9E_DISPOSABLE_BRANCH_ID, C9E_TEST_DATABASE_URL and C9E_TEST_APP_DATABASE_URL together; reject known protected parent/default/production targets; verify both in-band project/branch/database identities, owner ownership of delivery table and app role aeo_app before any fixture write. Copy the C9d guard protocol locally with C9E names, no production/environment loading or cleanup. Verify exact FK failures, NULL bypasses, text limits, duplicate requests/withdrawals, append-only privileges and retained actor deletion snapshots. This file remains UNRUN; Task 3 adds actual-store cases.
- [ ] Run only the offline migration/config/baseline tests, tsc and scoped lint. Commit `feat(delivery): add immutable attestation schema`. Record schema/DB proofs AUTHORED/UNRUN. Review before Task 3.

## Task 3: Owned reads, attestation/withdrawal transactions and actual-store proofs

**Files:** Create lib/delivery/store.ts and __tests__/delivery/store.test.ts; modify __tests__/integration/delivery-attestations.test.ts to add actual-store cases. Read versionLocks/retryWrite/versionDTO in lib/change-sets/store.ts and decision-store.ts. Reuse exports without modifying existing behavior.

**Interfaces:** `readDeliveryVersion(scope:DeliveryScope):Promise<DeliveryResult<VersionDetail>>`; `readDelivery(scope:DeliveryScope,query:DeliveryQuery):Promise<DeliveryResult<DeliveryPage>>`; `attestDelivery(scope:DeliveryScope,input:AttestInput):Promise<DeliveryResult<DeliveryEvent>>`; `withdrawDelivery(scope:DeliveryScope,attestationId:string,input:WithdrawInput):Promise<DeliveryResult<DeliveryEvent>>`. Read success uses kind:'replayed' internally; HTTP GET is200. No store receives an arbitrary SQL string or trusts client actor/account identity.

- [ ] Write failing tagged-query mocked-store tests for owned/not-found/denied reads, sorted history cursor with same-time IDs, active state outside current page, profile disappearance/reassignment, exact approved decision binding, stale hash/latest, existing active attestation, before-approval/future time and malformed retained package. Assert table/params/lock ordering as well as returned DTO, not just fabricated return objects.
- [ ] Add replay cases in both operations: same actor/request/canonical payload200-style result, changed target/kind/hash/time/text conflict, revoked old approver does not block approved delivery, moved current actor denied, superseded or withdrawn historical retry remains replayed without INSERT. Pending/changes-requested version creates nothing.
- [ ] Run focused store RED. Implement reads scoped by account/client/item/version plus current profile. Implement readDeliveryVersion as an owned tagged SELECT of immutable version plus exact decision row, reusing versionDTO only for validation/mapping. Catch validation failure only around that mapping and return validation_failed; let SQL/auth infrastructure exceptions remain unavailable. This preserves C9d behavior while making the new 422/503 distinction explicit. Read success uses replayed. Do not reread mutable drafts or Pulse/scan sources. Compute full-history active/latest capability outside page window in the same read statement. Cursor uses exact DB recorded_at text at microsecond precision plus UUID, ordered descending; return limit+1 then bounded DTO.
- [ ] Implement each mutation as lazy tagged sql.transaction([...versionLocks(...), finalStatement], {isolationLevel:'ReadCommitted'}) wrapped by retryWrite. The final statement must prove acquired actor/item witness IDs and current account ownership; fetch exact version and approved decision; search existing same-account/actor/request before eligibility. A mismatched prior operation conflicts even when it targets another owned item. Only identical path/kind/payload replays.
- [ ] For a new attestation, INSERT SELECT only if the version/hash match the validated package, exact decision is approved, version_number equals scoped max, no unwithdrawn attest exists and DB time bounds pass. New withdrawal inserts only for an owned same-version attest with no withdrawal; it need not be latest. Derive actor snapshot from locked current profile. Return one row with kind and chosen event; safely map failures using current ownership before revealing eligible/conflict details. Capture clock_timestamp() once in a MATERIALIZED clock CTE after locks; use that value for the new recorded_at and deliveredAt upper bound. Compare deliveredAt at DB precision, never approval truncated to seconds. Active writes serialize with C9d submitVersion on the item lock. No pre-read failure may accidentally turn into permission success.
- [ ] Add dedicated actual-store scenarios using verified real app SQL injected only through db(): simultaneous create one winner, new-version/create both orderings, withdrawal/create correction, simultaneous withdraw, moved/deleted actor after pre-read, exact retry after supersession/withdrawal, tampered tenant/hash/decision, bounded injected40001/40P01 retries followed by actual persistence. Record orchestration-injected retry as such; do not claim a real deadlock. Keep the suite UNRUN.
- [ ] Run focused store+input+DTO+export tests, tsc, lint. Commit `feat(delivery): persist scoped delivery audit events`. Independent transaction review must explicitly check replay precedence, lock protocol, time precision, profile authority and FK semantics before Task 4.

## Task 4: Authenticated services, streams and download headers

**Files:** Create lib/delivery/service.ts and __tests__/delivery/service.test.ts. Consume getProfile, readLimitedJson(request,16384), Task1 parsers/exporter and Task3 readDeliveryVersion/stores.

**Interfaces:** Every function returns Promise<Response>: `exportAuthenticatedDelivery(clientId,itemId,versionId,params)`; `listAuthenticatedDelivery(clientId,itemId,versionId,params)`; `attestAuthenticatedDelivery(clientId,itemId,versionId,request)`; `withdrawAuthenticatedDelivery(clientId,itemId,versionId,attestationId,request)`. String IDs; params URLSearchParams; request Request.

- [ ] Write RED tests using real service/parser/stream with mocked auth/stores:401 absent auth,503 dependency outage,400 invalid IDs/body/query,404 unowned,403 denied,409 conflict,413 actual oversize,422 time/package validation,201 new/200 replay. All no-store. Use a multibyte streamed body crossing16384 while Content-Length lies; verify cancel and invalid UTF8 rejection.

```ts
it('returns an attachment without creating a delivery event', async () => {
  const response=await exportAuthenticatedDelivery(clientId,itemId,versionId,new URLSearchParams('format=json'))
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  expect(response.headers.get('content-disposition')).toBe(`attachment; filename="aiso-review-${versionId}.json"`)
  expect(attestDelivery).not.toHaveBeenCalled()
})
```

- [ ] Run focused RED. Implement auth+strict paths before scoped store access; derive scope from profile, never request account IDs. Map raw parser/stream errors to DELIVERY_* (not APPROVAL_*). Use safe503 for dependencies. GET list unwraps `{events,activeAttestationId,capabilities,nextCursor}`; writes unwrap `{event}`; status201 only created. Export uses only owned readDeliveryVersion and the deterministic exporter; unapproved returns409 DELIVERY_NOT_APPROVED, malformed package422. Return x-aiso-export-sha256, attachment, no-store/nosniff. Do not add provider fetches, storage writes or browser download-success claims.
- [ ] Run GREEN plus store/export regressions, tsc and scoped lint. Commit `feat(delivery): expose authenticated export and audit services`. Review response/error compatibility before Task 5.

## Task 5: Thin Next routes and public contract documentation

**Files:** Create app/api/clients/[clientId]/work-items/[workItemId]/versions/[versionId]/export/route.ts, same prefix delivery/route.ts, and delivery/[attestationId]/withdraw/route.ts; __tests__/api/delivery.test.ts. Modify docs/contracts/{routes,fields,features}.md.

**Interfaces:** Route handlers delegate to Task4 service Responses unchanged; await Next16 params. The withdrawal params include attestationId.

- [ ] Read installed Next16 guides named in Global Constraints. Write API tests invoking actual route exports with Promise.resolve params and real services/mock auth/stores. Assert delegated path IDs, status/headers/body, both formats, no export write and no auth bypass. Run RED.
- [ ] Implement thin handlers using this complete export pattern; delivery GET/POST and withdrawal POST use the corresponding defined service and arguments without duplicating validation:

```ts
import { exportAuthenticatedDelivery } from '@/lib/delivery/service'
type Context={params:Promise<{clientId:string;workItemId:string;versionId:string}>}
export async function GET(request:Request,{params}:Context) {
  const {clientId,workItemId,versionId}=await params
  return exportAuthenticatedDelivery(clientId,workItemId,versionId,new URL(request.url).searchParams)
}
```

- [ ] Add route/field/feature contracts: strict inputs, DTOs, status/error codes, recorded vs declared time, manual provenance, withdrawal semantics, historical export, no public sharing, no automatic C9f outcomes. Mark migration043/DB proof unrun.
- [ ] Run API+service tests, Next typegen, full tsc and scoped lint. Commit `feat(delivery): add version delivery endpoints`. Independent route/contract review before Task 6.

## Task 6: Bilingual version delivery workspace and regression fixtures

**Files:** Create components/delivery/{DeliveryWorkspace,DeliveryForm,DeliveryHistory}.tsx; __tests__/components/c9e-fixtures.ts and delivery-render.test.tsx; tests/e2e/c9e-delivery.spec.ts. Modify components/change-sets/VersionWorkspace.tsx, messages/{en,zh-HK}.json, __tests__/components/c9c-fixture-writer.ts, scripts/ci/prepare-component-fixtures.mjs, .github/workflows/pr-gate.yml, __tests__/ci/{component-fixtures,pr-gate-workflow}.test.ts. Add C9E to ignored local runner only for local execution.

**Interfaces:** DeliveryWorkspace props `{clientId:string;version:VersionDetail;onDirtyChange:(dirty:boolean)=>void}`. DeliveryForm receives the exact version/hash, server capability, busy flag and an onSubmit callback of AttestInput without requestId; the workspace owns logical-operation request identity. DeliveryHistory receives DeliveryEvent[], active ID, bounded pagination callback and withdrawal selection callback. Delivery namespace is `delivery` in both message files.

- [ ] Write render/fixture RED tests: required bilingual labels, timezone, manual limitation, retained unknown actor, historical/current version distinction, and no approval/download-derived delivery status. Build fixture approvedVersion using real frozen hash. Add C9E to existing writer namespace/slice unions and generator/workflow environment inventories; never place fixture branches in live service code.
- [ ] Read Next16 component guide. Implement a separate delivery read state tied to version.id and contentHash. Use request generations and a current dirty ref: selection/unmount/reload cannot drop entered form/withdrawal reason; stale reads cannot overwrite confirmed mutation. Integrate delivery dirty state into the existing version navigation guard alongside decision dirty state without replacing its checks. Explicit401/403 disables protected controls;503/network/JSON preserves input but does not keep mutation authority. No failed lookup appears as an empty history.
- [ ] Use UTC date/time input with seconds and visible UTC label as the initial explicit timezone choice; convert only validated input to ISO Z, never implicitly browser-local time. Show declared and recorded times distinctly. Client validation assists; server remains authoritative. Store normalized operation payload and requestId in a ref; unchanged normalization retries retain identity. New operation changes identity. Confirm withdrawal with required reason; do not edit the attestation in place.
- [ ] Download through authenticated GET, check response before creating a blob URL and revoke it after triggering the attachment. Error retains current input and displays localized status. Do not POST after download or call it CMS publication. Use plain text for destination/notes and accessible labels/focus/status messages.
- [ ] Add browser RED/GREEN with actual intercepted binary/text download and mutation assertions. Representative assertion:

```ts
const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:copy.exportJson,exact:true}).click()])
expect(download.suggestedFilename()).toBe(`aiso-review-${version.id}.json`)
expect(deliveryPostBodies).toHaveLength(0)
```

- [ ] Run both locales Chromium/mobile cases for export/attest/withdraw/correction, active record beyond page, pending/superseded, invalid/future/beforeapproval time, destination text injection, stale hash409, retry lost-response identity,503/network/malformedJSON fail-closed/recovery,401/403, delayed reads after mutation and typing while a version load is pending. Check keyboard/focus/contrast using existing UI patterns. Retain raw JSON for every RED/GREEN run.
- [ ] Run render+CI inventory tests, scoped lint/full tsc, fresh build then all fixture generation then complete C9e and C9d browser files sequentially. Commit `feat(delivery): add bilingual manual delivery workspace`. Independent UI/spec review, resolve all actionable findings before Task 7.

## Task 7: Final verification, independent review and local handoff

**Files:** Create docs/superpowers/plans/2026-09-07-c9e-handoff.md; update this plan/spec status with actual evidence only. Keep ignored .superpowers/sdd/c9e-* raw outputs.

- [ ] Run fresh full unit: `node .superpowers/sdd/unit-run.cjs`. Verify all integration excluded and temporary playwright ignore restored. Expected zero failed; record actual file/test counts.
- [ ] Run full source lint with Node ESLint entrypoint and exact package ignore patterns `.claude/`, `.superpowers/`, `.codebase-memory/**`, `coverage/`, `cloudflare/**`, `.playwright-ci-server/**`. Run `node .superpowers/sdd/local-run.cjs node_modules/next/dist/bin/next typegen`, then TypeScript `node_modules/typescript/bin/tsc --noEmit`, then Next `node_modules/next/dist/bin/next build` through the same runner. Expected exit0.
- [ ] Run `node .superpowers/sdd/local-run.cjs scripts/ci/prepare-component-fixtures.mjs`, then `node .superpowers/sdd/local-run.cjs node_modules/playwright/cli.js test tests/e2e/c9e-delivery.spec.ts tests/e2e/c9d-change-sets.spec.ts tests/e2e/c9c-opportunities.spec.ts tests/e2e/auth.spec.ts --config .superpowers/sdd/playwright.local.config.cjs --project=chromium --project=mobile`. Expected zero failures/skips/flaky; retain unique raw JSON immediately.
- [ ] Verify dedicated delivery SQL suite isolation with offline config test, not by invoking its config. Both prior C9d suites and new C9e suite remain AUTHORED/UNRUN;043 and prerequisites remain unapplied here. No database-validated race or privilege claim.
- [ ] Request final whole-C9e independent review from baseline12ec30d through tested HEAD (not just the last commit). Review spec coverage, hash provenance, exact FK/NULL semantics, profile/item lock/replay ordering, one-active predicate, correction/time boundaries and UI races. Fix findings with observed RED/GREEN and rerun affected checks; do not simply lower assertions.
- [ ] Verify `git diff --check 12ec30d..HEAD`, clean status, unchanged published C9d branch and original user-plan SHA256 `6B1C42059CA7BB01422C90B07F6AFCDF05102A426A9DDF9E41958C38581812B3`. Stage explicit handoff/spec/plan paths and commit `docs: record C9e verification and local handoff`.
- [ ] Report changed behavior, exact source/docs SHA, commands/counts, reproduced failures and setup blockers, independent review and remaining external evidence. Source rollback removes only C9e; any activated audit rows are retained. Stop before publication or C9f. Do not offer a live action against guessed targets.

## Plan self-review coverage

Input/export/unknown provenance:Task1; immutable FK/privileges and guarded SQL suite:Task2; authorization/races/retry/declared-time semantics:Task3; streamed limits/errors/read-only attachment:Task4; exact API/docs:Task5; bilingual accessibility/input preservation/download separation:Task6; actual source verification/review/rollback/external boundaries:Task7. No implementation result is asserted by this plan.