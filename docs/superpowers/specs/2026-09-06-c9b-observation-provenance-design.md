# C9b: monitored questions and observation provenance

Date: 2026-09-06. Status: scope and interaction approved in conversation; written specification awaiting user review. This document specifies proposed behavior, not implementation evidence or external authorization.

## Context and delivery boundary

C9a private entities are implemented. C9b precedes [C9c](2026-09-06-c9c-evidence-linked-drafts-design.md) as a separately reviewable slice. Existing sources are prompt_bank, pulse_metrics, pulse_weekly_summary, lib/workspace/load-owned-pulse.ts and lib/pulse/observed-summary.ts. Historical migration 002 records question, prompt_id, platform, raw_answer, nullable brand_mentioned, scan_week and created_at. It does not record the historical model, market or exact collection timestamp. Current prompt labels are not historical observation metadata.

The user selected automatically suggested opportunities with explicit saving. Alternatives considered were manual opportunity creation (more effort, less consistent coverage) and automatic persisted drafts (more noise and stronger lifecycle requirements). C9b provides a read-only source contract; C9c owns derivation and persistence.

No new collection, provider calls, scheduler changes, prompt editing behavior, historical backfill or public verification is included. No C9a entity row is required to read an already owned client's observations. Preserve current Pulse summaries and entitlement behavior. The producer can replace historical rows; this interface describes currently retained records, not a complete immutable attempt ledger.

## Screens and source semantics

Add /[lang]/dashboard/[clientId]/observations using the existing client navigation and en/zh-HK primitives. Show monitored questions separately from recorded observations, with links to existing prompt management. Filters are question ID, platform, scan week and result status. Default to the latest retained observation week, with an explicit week selector. No observation is fabricated for an active prompt without data.

Observation detail shows stored question text, platform, week, record creation time and result. Exact collection time, model and market are Unknown for legacy Pulse rows. A linked prompt can supply current category/language in a separately labelled currentPrompt object; it must not rewrite the observation question or imply collection-time provenance. Missing/deleted/mismatched prompt relationships leave that object null without dropping the observation.

Result is success only for a nonblank stored answer and boolean brand_mentioned, matching the existing Pulse evidence predicate. Other rows are unknown/incomplete; do not label a blank answer as a proven provider failure or brand absence. No-answer, missing classification and unrecorded provenance have distinct explanatory labels. Raw answers are not exposed in this first DTO; return hasAnswer and the stored classification. Question content is rendered as text, never HTML.

Show recordedRows, successfulRows and incompleteRows for the selected question/platform/week before status filtering and pagination. These counts describe stored rows, not all provider attempts. Do not calculate a new visibility KPI or relabel these as total scheduled attempts. Existing Pulse KPI completeness logic stays unchanged. No data, database unavailable and no filter matches have distinct states. Historical dates remain visible; there is no invented freshness threshold.

## API and module contract

Proposed GET /api/clients/[clientId]/observations accepts optional promptId UUID, platform (1-80 characters), week (valid ISO date), result=success|incomplete, limit (1-100, default 50) and a validated cursor. Cursor encodes created_at plus id, in descending order; null timestamps sort last using a stable explicit sentinel. Filters apply identically on every page; cursor is a position, never authorization. An omitted week is resolved server-side to the latest retained week and returned as selectedWeek so subsequent requests pin the same window. Bound week options to the latest 40 distinct retained weeks and label that boundary.

Response: {schemaVersion:1, clientId, selectedWeek:string|null, weeks:string[], questionsTruncated:boolean, questions:Question[], items:Observation[], counts:{recordedRows,successfulRows,incompleteRows}, nextCursor:string|null}. Questions use the existing MAX_PROMPTS bound, fetching one extra row to set questionsTruncated. For nullable legacy is_active values, expose isActive as boolean|null rather than invent a current state. Question = {id,question,category:string|null,language:string|null,isActive:boolean|null}. Observation = {id,sourceKind:'pulse-metric',promptId:string|null,question,platform,scanWeek,recordedAt:string|null,collectedAt:null,model:null,market:null,result:'success'|'incomplete',hasAnswer:boolean,brandMentioned:boolean|null,currentPrompt:Question|null,limitations:string[]}. Null provenance has stable limitation codes for translation. Counts and items must use one database statement/snapshot to avoid internally contradictory results during producer writes.

Authentication and owned-client lookup precede reads. Every source query joins the owned clients row and filters account_id; prompt joins also constrain client_id. No account/actor identifiers, secrets or raw database diagnostics enter DTOs. Existing account members can read this private stored-evidence view, as with owned Pulse reads; existing prompt-write and producer entitlements remain unchanged.

Errors: 400 INVALID_OBSERVATION_QUERY; 401 UNAUTHENTICATED; 404 CLIENT_NOT_FOUND (missing and foreign client indistinguishable); 503 OBSERVATIONS_UNAVAILABLE. A failed query never returns a successful empty array. GET makes no writes. Use tagged queries via db(), bounded parameters and generic logged error codes.

Proposed files: lib/observations/{types,query,schema,store,service}.ts; app/api/clients/[clientId]/observations/route.ts; app/[lang]/dashboard/[clientId]/observations/page.tsx; components/observations/ObservationWorkspace.tsx; existing client navigation and messages/{en,zh-HK}.json. Update docs/contracts/{routes,fields,features}.md during implementation. Keep adapters separate from the existing Pulse producer and summary calculation. No C9b schema migration is needed.

## Acceptance and handoff

Tests must cover owned/foreign/missing clients, invalid UUID/filter/cursor and limits; current prompt edits versus historical question text; null timestamps and provenance; absent prompt links; blank answers and null classifications; correct denominators across filters/pages; unknown versus empty versus failed reads; retained-week limits; and unchanged existing KPI projection. Verify en/zh-HK copy parity, keyboard filters, loading/error announcements, focus and mobile reflow with mocked browser fixtures.

Run unit/contract tests, next typegen plus full tsc, lint, production build with dummy configuration and focused browser acceptance. Read installed Next.js 16 guides before framework edits. No live database/provider execution is implied. Before implementation, reconcile current remote main and merged stack ancestry into a clean working branch while preserving the user's untracked continuation plan; do not bulk-merge old branches.

Rollback removes the new observation routes/navigation and adapters without touching source records or existing Pulse behavior. C9c depends on this contract; if C9b is reverted after C9c activation, disable only the dependent new routes together. No database rollback is needed for C9b. This written spec must be reviewed before implementation planning.
