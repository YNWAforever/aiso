# C9c: evidence-linked opportunities and saved drafts

Date: 2026-09-06. Status: written specification approved by the user on 2026-09-06; implementation planning authorized. Depends on [C9b](2026-09-06-c9b-observation-provenance-design.md). This is proposed local implementation scope, not permission for migration, deployment or customer writes.

## Decision and user flow

Derive suggestions automatically from retained evidence, then persist only when the user selects Save as draft. Manual-only creation and automatic saved drafts were considered; explicit saving gives users control while avoiding an empty board that requires manual research. Use deterministic versioned rules, not a new LLM call.

Add /[lang]/dashboard/[clientId]/opportunities with Suggestions and Saved drafts views. Each suggestion shows title, proposed action, why it was suggested, source date, evidence details, limitations and Save as draft. Successful save opens the saved draft and announces completion. A draft editor permits title, action and notes; status remains draft. No approval, assignee/role system, delivery, publication, dismissal/archive, outcomes or impact attribution is introduced.

Empty suggestions, evidence source unavailable and saved-draft load failure are distinct states. On save failure preserve the visible suggestion; on update failure preserve the user's edits. Conflicts offer an explicit reload action without silently discarding input. No layout mockup is required for this contract; use the existing workspace components and bilingual conventions.

## Initial derivation rules and evidence boundary

1. pulse-brand-absent.v1: a C9b successful stored answer classified brand_mentioned=false yields a suggestion to review coverage for that question. Phrase this as one recorded response, never market-wide invisibility or a promise of improved rankings. Incomplete rows cannot trigger the rule.
2. scan-check-gap.v1: a valid readScanEvidence envelope with an applicable, completely collected check assessed warn or fail yields a review suggestion for that check. Unknown, partial, blocked, unsupported or unverifiable checks are ineligible. Preserve origin-only URL redaction and collection/method versions. No path identity or comparable-impact claim is reconstructed.
3. stored-recommendation.v1: an owned scan's stored agent recommendation with nonblank bounded text and recognized priority yields a review suggestion explicitly labelled as a stored recommendation. Link the exact recommendation and scan; do not promote impact_score to measured impact. Where no valid check evidence supports it, say supporting check evidence is unavailable.

Use retained sources only: the latest retained Pulse week (at most 200 rows, ordered by created_at descending nulls last then id descending) and newest owned scan by created_at/id, including at most 100 recommendations ordered by id, and the validated checks in its evidence envelope. Return the selected source window, truncation flags and source date; default ordering is deterministic by source kind, source date descending and source ID. Do not claim exhaustive discovery. Review suggested actions use translation keys for rule templates; source text remains in its recorded language.

Opportunity identity is {ruleVersion,sourceKind,sourceId,checkKey?}, scoped to account and client. One source finding can produce one saved draft; newer observations with new IDs are separate findings. Stable source IDs with changed content do not overwrite an existing draft. Snapshot both original evidence and generated suggestion at save time. Evidence snapshots contain only allowlisted text, classification, timestamps, provenance/limitations and redacted URL descriptors, not raw answers, fetched HTML, credentials or whole database rows. Cap the serialized snapshot at 64 KiB; oversized/unparseable candidates are unavailable for saving and reported as limited evidence.

Fingerprint is SHA-256 over canonical, versioned normalized evidence plus rule-derived suggestion fields (locale-independent translation keys/arguments). It is a change detector, not authorization. Include a server-computed digest of any answer used in the Pulse success predicate without exposing its raw content. Stored dates are not transformed into collectedAt; do not infer model or market. Snapshots never acquire new evidence retroactively.

## APIs, ownership and concurrency

All new routes independently authenticate and resolve client ownership. Every read and mutation includes account_id and client_id. The saved draft belongs to the existing client, with no separate product/entity quota or public identity claim. Existing account members can save/edit these private organizational drafts; current paid generation, prompt-write and producer gates are untouched.

GET /api/clients/[clientId]/opportunities returns {schemaVersion:1,window,sourceStates,suggestions:Suggestion[]}. Suggestion = {key,ruleVersion,source:{kind,id,checkKey?},fingerprint,titleKey,actionKey,args,evidence,limitations,savedDraftId:string|null}. sourceStates distinguishes ok/empty/unavailable per source. A source failure must not silently become no suggestions; other healthy source groups may render with an explicit partial banner. No writes or providers run during GET.

POST /api/clients/[clientId]/work-items accepts only {source:{kind,id,checkKey?},ruleVersion,fingerprint,locale:'en'|'zh-HK'}. Maximum body 4 KiB. The browser cannot supply evidence, account, actor, status or generated text. First return the existing owned draft for the same opportunity identity, including when its source has since changed or disappeared. Otherwise re-read and revalidate the source, fingerprint and eligibility server-side, derive localized initial title/action, and atomically insert the snapshot and work item. Ownership, source values and insertion must share one SQL statement snapshot (or a transaction on one supported connection); a separate unguarded check followed by insert is insufficient. A unique account/client/opportunity constraint resolves concurrent saves. Return 201 for insertion or 200 for the existing draft. Source changes before save return 409 EVIDENCE_CHANGED; the user refreshes before trying again. No draft is created on conflict or failed write.

GET /api/clients/[clientId]/work-items returns {items:WorkItem[],nextCursor}; limit default 50/max100 with validated created_at/id pagination. GET /api/clients/[clientId]/work-items/[workItemId] returns {item:WorkItem}. WorkItem = {id,clientId,status:'draft',title,action,notes,locale,revision,createdAt,updatedAt,evidenceSnapshot}. Do not expose account or actor IDs. A removed source does not destroy the saved snapshot, but source navigation may be unavailable.

PATCH on the item route accepts only {title,action,notes,expectedRevision}. Trim/NFC-normalize title (1-160 characters), action (1-4000), notes (0-8000); reject over 32 KiB bodies and unexpected fields. Account/client/item/revision compare-and-swap increments revision atomically. An identical normalized payload at an older revision returns the stored item (lost-response retry); a differing stale or future revision returns 409 WORK_ITEM_CONFLICT. Edits cannot change source identity, snapshot, locale or draft status.

Errors: 400 INVALID_WORK_ITEM_INPUT or INVALID_OPPORTUNITY_QUERY; 401 UNAUTHENTICATED; 404 CLIENT_NOT_FOUND or WORK_ITEM_NOT_FOUND (same for foreign ownership); 409 EVIDENCE_CHANGED or WORK_ITEM_CONFLICT; 503 OPPORTUNITIES_UNAVAILABLE or WORK_ITEMS_UNAVAILABLE. Translate stable codes; no SQL diagnostics or success response over failed persistence. If all source reads fail, opportunities returns 503; partial-source success is explicitly represented in the DTO.

## Persistence and implementation seams

Propose a single additive migration, supabase/migrations/041_evidence_work_items.sql, 041 is unused in the inspected checkout. Revalidate numbering against the implementation baseline; never replace historical SQL. Table evidence_work_items: id UUID primary key; account_id/client_id UUID; opportunity_key text; source_kind text; source_id UUID; rule_version text; check_key nullable text; evidence_fingerprint text; evidence_snapshot JSONB; status constrained to draft; title/action/notes; locale; positive revision; created_by/updated_by nullable UUID; created_at/updated_at timestamps. Enforce lengths, snapshot byte bound, locale and source-kind checks (pulse-metric, scan-check, agent-recommendation), and unique(account_id,client_id,opportunity_key). Composite client/account FK follows migration040; actor/account composite FKs retain records while nulling actor on actor deletion. Do not FK a snapshot to replaceable source rows. Grant only SELECT/INSERT/UPDATE to the application role; no DELETE endpoint. Evidence is immutable in the service mutation contract; PATCH SQL updates only editable columns and actor/revision/timestamp.

Proposed modules: lib/opportunities/{types,rules,fingerprint,store,service}.ts; lib/work-items/{schema,store,service}.ts; the API/page paths above; components/opportunities/OpportunityWorkspace.tsx and components/work-items/DraftEditor.tsx; existing client navigation, messages and docs/contracts/{routes,fields,features}.md. Reuse validated scan evidence and C9b projection functions, without exposing report DTOs that discard source IDs or imply expected impact. No new provider or source collection module.

## Acceptance, release and rollback

Tests cover each eligible/ineligible rule; missing provenance; malformed/redacted scan envelopes; overwritten recommendation; account/client isolation; window truncation and stable ordering; forged fingerprints; source mutation/deletion before save; concurrent duplicate saves and lost responses; immutable evidence after source/user edits; revision conflicts; failed reads/writes; field/byte limits; and plain-text rendering of untrusted source content. Verify both locales and browser keyboard, focus, loading, conflict and error paths. Test source readers independently and the full suggestion-save-edit flow with mocked providers/SQL. Run full typecheck including test files, lint, selected regression suite, production build with dummy configuration, and focused browser tests.

Migration integration tests must be authored for a disposable approved database. Do not run them, apply migration041, modify environment variables, deploy, email or invoke a paid scan under this design task. Local mocks prove behavior, not runtime schema readiness. Before activation prepare exact migration target, SQL diff, app-role validation, application SHA and rollback for separate approval.

Rollback removes the new route/navigation code and retains the additive table and saved drafts; do not drop customer data. No migration is executed while preparing the local slice. C9b remains useful independently. Deliver separate C9b and C9c implementation plans and reviewable diffs, with no implicit C9d approval workflow or C10/C11 operations. Written-spec review precedes planning.

## Specification review record

Reviewed against C9b: source identity, null provenance, immutable saved evidence, conditional creation, duplicate retries, draft-only edits and rollback agree. Source-window limits are deliberate initial bounds, not commercial quotas. Tests above are planned, not executed. No application source or schema was changed by this design commit.

## Approved scope amendment — 2026-09-06

The user explicitly requested: "complete and finish C9c with Pulse and scan-check evidence". This supersedes recommendation-related implementation requirements in the earlier design and plan.

This release implements only `pulse-brand-absent.v1` and `scan-check-gap.v1`. It does not query agent recommendations or expose recommendation suggestions, source availability, snapshots or create inputs. Public source states cover `pulse` and `scan` only. Recommendation-derived drafts and their paid-access/downgrade policy are deferred, not an unresolved blocker for this release. Existing paid recommendation generation/read/platform gates remain unchanged. Reserved source types or additive SQL allowances may remain inert; the create API must reject recommendation inputs.

All other evidence, ownership, source-window, byte-limit, immutable snapshot, conditional-save/replay, edit conflict, localization, verification and external-action limits still apply. Finish Tasks 2, 4, 5 and 6 on the reviewed Task 1 and Task 3 foundations. No production or database activation is authorized.
