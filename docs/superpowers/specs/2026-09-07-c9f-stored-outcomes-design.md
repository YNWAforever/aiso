# C9f stored-evidence outcome windows

Date: 2026-09-07. Design baseline: d350d9c, extending tested C9e source 92f69dd. Status: proposed written specification for user review. The user approved the stored-evidence approach; the precise policy below is presented for review before implementation planning.

## Scope and architecture

Add a read-only outcome view beside delivery in the existing version workspace. A server-only owned reader supplies a pure, versioned outcome evaluator; a thin authenticated GET service and bilingual component render its result. No migration, persisted outcome rows, background job, provider request or mutation is required. Keep all current C9c/C9d/C9e APIs and security behavior unchanged. Do not reinterpret old scores or repair C1/C10 in this diff.

Use policy identifier stored-outcomes.v1. Return evaluation time, version ID/content hash, attestation ID, declared delivery time and server-recorded attestation time. These are a point-in-time read result, not a newly persisted or immutable measurement. Later source edits, deletion, late ingestion or withdrawal can change subsequent reads; display that limitation explicitly.

## Delivery anchor and baseline

The selected version's active, unwithdrawn C9e attestation is the only anchor. Its declared delivery time T is self-reported, distinct from the server-recorded event time. Approval, download, an unapproved version and another version's delivery are not anchors. A retained older version with an active attestation remains inspectable; latest-version restrictions on new delivery writes stay unchanged.

The baseline is the evidence snapshot frozen into the selected immutable version. Never substitute a newer observation or the mutable draft. Identify its source, snapshot provenance and original timestamp semantics. A source whose actual collection time is unknown cannot establish a timed baseline; one collected after T is ineligible. Missing or malformed baseline data is explicit, never zero. Retained snapshots remain viewable after source deletion, but their retention does not authorize a new live source read or make unknown provenance known.

Withdrawal returns anchor-withdrawn and disables evaluation under that attestation. A replacement produces a distinct anchor identity and newly derived windows; observations keep their original source IDs and timestamps. Do not carry a previous anchor's selected observations forward as measurements for the replacement. The view does not promise an archived outcome evaluation for withdrawn anchors.

## Window policy

Use UTC elapsed days of exactly 86400 seconds, preserving stored timestamp precision for boundary comparisons. For D7, D28 and D56, target = T plus N days and the eligible interval is [target, target plus 7 days). These intervals do not overlap. No observation before target or exactly at the interval end belongs to that window.

Before target show not-due. From target until end, absent eligible evidence means awaiting-evidence. At or after end, absent eligible evidence means missing-evidence. A qualifying observation can be shown while the interval is open, with a provisional-selection label. Late-ingested records may qualify by their actual collection time on a later read; recorded/ingested time must not masquerade as collection time. No collection timestamp means timing-unknown and exclusion from interval selection, with an explicit explanation.

Within the same source kind and relevant subject, select the earliest collection timestamp inside the interval, breaking exact ties by canonical source ID ascending. Select before checking comparative success: a failed, incomplete or incompatible first observation must not be skipped for a later favorable result. For scan work items use the original check key; for Pulse use exact retained question and platform, with prompt identity where retained. Current prompt-bank content must not be used to reconstruct historical context. Unsupported source kinds are explicit and do not trigger a fallback.

## Provenance and compatibility

Selection and comparability are separate. A selected observation can remain not-comparable. Require a supported adapter with positive proof of matching subject/scope, method versions, collection completeness and trustworthy collection times on both sides. Missing context never equals matching context. Return stable reason codes and safe source references; never manufacture a signature from current settings to fill old gaps.

Scan adapter delegates to the existing readScanEvidence/compareScanEvidence contracts and preserves all reasons. Evidence schema 1 with withheld final-path identity never yields a comparable delta. Do not invoke the generic report status comparator to bypass this restriction.

Existing Pulse rows retain question, platform, prompt ID, scan week, recorded time and answer state, but do not establish the full historical collection time, model/method, market and coverage contract. They can be displayed as retained observations, with recorded time labeled accurately; they cannot currently yield a timed comparable outcome. No cross-platform averages, inferred model identity, mention-rate uplift, ROI, causality or statistical confidence is permitted. Do not add a speculative future comparison adapter in this slice.

Accordingly, current legacy fixtures may legitimately produce no comparable outcomes at all. That is an acceptance case, not a reason to weaken validation. The first slice supplies honest windows and evidence limitations; positive comparable deltas require a separately approved evidence-contract upgrade.

## Owned reader, API and failure behavior

Add GET /api/clients/[clientId]/work-items/[workItemId]/versions/[versionId]/outcomes. No request body or caller-supplied clock, source IDs or anchor is accepted. Authenticate server-side, validate identifiers, derive account membership freshly and bind client/item/version/attestation/source reads to that account. Platform administration alone grants no client ownership. Missing or out-of-scope objects return 404; unauthenticated returns 401; a failed read returns 503, never an empty successful outcome. Responses use private no-store caching and expose no raw answers, credentials or unrestricted destination links.

Read anchor, version and candidate evidence in a coherent database snapshot so concurrent withdrawal cannot mix an old anchor with a new source set. Return snapshot evaluation time and anchor identity. The result is valid as of that read, not a promise that withdrawal cannot occur after the response. Use db() tagged-template queries only, with account-scoped joins. Read the installed Next.js 16 route/caching guides before implementing the route.

Bound candidate reads to 200 records plus one overflow witness per source kind per evaluation, restricting by owned client and relevant subject and the total window range where trustworthy timing exists. Candidate overflow returns evidence-limited, suppresses comparison/selection certainty and is never reported as no evidence. A bounded diagnostic read of untimed legacy rows must also disclose truncation; do not scan all historical answers or send raw answer bodies to the browser. Ownership or primary snapshot failure fails the whole request; source parsing failures are explicit unavailable evidence, not skipped rows silently improving a result.

## UI and response contract

Render three labeled window cards and the frozen baseline, anchor identity, self-reported delivery time, evaluated-at time, time-zone label, source references and localized limitation text. Keep anchor states (no-delivery, withdrawn, active), time states (not-due, awaiting-evidence, missing-evidence, observation-available), and evidence states (available, timing-unknown, invalid-baseline, not-comparable, evidence-limited, unavailable) separate so one does not hide another.

Use en and zh-HK copy with exact-key guards. No green success treatment for missing or incomparable evidence. Provide a read-only refresh action; opening, refreshing or navigating this view never runs scans, calls providers or writes delivery events. Reuse existing workspace accessibility conventions, labeled controls, status announcements, keyboard focus and responsive layout.

Key every response by client/item/version and anchor identity; abort or ignore stale requests after selection changes, delivery creation/withdrawal or unmount. Invalidate the outcome view after confirmed delivery mutations and refresh from the server. Preserve existing dirty-form navigation protection and never reset delivery input as a side effect of an outcome response. Loading/error/retry states remain distinct from no delivery.

## Acceptance and verification

Pure tests cover all UTC interval boundaries, timestamp precision, baseline-after-delivery, unknown collection time, tie-breaking, earliest failed evidence, late ingestion, withdrawal/replacement, source kind isolation and overflow. Existing scan-v1 rejection and Pulse provenance gaps must be regression cases; no positive delta may be fabricated from them.

Reader/service tests cover missing and cross-account scope at every relationship, membership changes, coherent snapshot behavior, unknown versions, malformed evidence, source errors, 401/404/503 and no-store. Assert no provider or write path is invoked. Real PostgreSQL concurrency/role evidence, if authored, stays explicitly unrun until an exact disposable target and fixture writes are authorized; migration 043 being reported applied is not that authorization.

Hydrated en/zh-HK desktop/mobile browser cases cover no delivery, all window states, unsupported evidence, fetch errors and recovery, anchor withdrawal/replacement, stale responses, dirty delivery input retention, keyboard focus, accessible names and narrow-screen overflow. Fixture tests validate wire shapes and rejection of malformed responses.

After implementation, run focused tests then full local unit, lint, type generation, TypeScript, build and selected fixture/browser regression suites, sequentially where .next is shared. Obtain independent review, resolve findings and record exact source SHA, commands, results and setup blockers. Do not relabel earlier C9e runs as C9f evidence.

## Release boundary and rollback

This specification authorizes no external action. Migration 043 is user-reported applied; exact target and live proof remain unverified. C10 operational ownership/provider checks and C11 cutover gates remain in the remaining-work inventory. No connector is selected here.

Source rollback removes the additive outcomes route/component/modules and restores the prior version workspace integration; it preserves all work items, versions, approvals and delivery events. No schema rollback is required. Stop at the verified local implementation handoff unless publication is separately authorized.
