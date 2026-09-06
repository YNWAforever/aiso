# C9e: approved-version exports and manual delivery attestations

Date: 2026-09-07. Status: approved specification implemented and freshly verified locally at application source `92f69dd85ca029fc6c199b4cd8a0776e4a008274`. Independent whole-branch source review approved; final evidence/handoff inspection approved. C9e is locally complete. Full units 2945/257 files, fixtures 52/11 files and Chromium/mobile C9e+C9d+C9c+auth matrix 182/182 passed; lint/typegen/tsc/build exited 0. See [C9e local handoff](../plans/2026-09-07-c9e-handoff.md). Migration 043 is UNAPPLIED and real-SQL proofs AUTHORED/UNRUN; no external execution or live availability is claimed.

Baseline: `12ec30d23654d9c8206d80935a1b7173647fd1d8` (C9d documentation checkpoint; tested application fix `95b8566`). PR #18 is open against `codex/c8c-g-workspace` at inspection. Design branch: `codex/c9e-delivery-design`, using the existing isolated `.worktrees/c9b-c9c` checkout. Preserve the published C9d branch, the original root checkout and its untracked continuation plan. Do not merge PR #18 as part of design work.

## Scope and alternatives

The user approved downloadable exports plus an audited manual delivery record containing the approved version, destination, delivery time and actor. Build this as C9e, followed separately by C9f comparable rechecks/outcomes, remaining C10 readiness work and C11 release preparation.

Chosen approach: export the exact retained approved package and record a member's explicit delivery attestation. An export-only approach cannot provide the recorded delivery anchor required by C9f. A CMS connector could verify publication but adds provider ownership, scopes, credentials and remote-write requirements outside this scope. The manual model remains explicitly self-reported, never verified publication or measured impact.

C9e includes approved-version JSON/plain-text downloads, account-scoped attestation history, withdrawal of an incorrect record, and bilingual UI/regressions. It excludes CMS calls, uploads, email, paid scans, scheduled rechecks, attribution formulas, new roles, public sharing and provider integrations. Do not broaden existing opportunity eligibility or modify C9c/C9d APIs or their draft/review state machines.

## Product behavior

From an owned saved version, members can download its approved package. The package contains the frozen version content, evidence limitations, validation results, content hash, version identity and approval snapshot. Pending or changes-requested versions cannot be exported through this delivery surface. Historical approved versions remain downloadable as explicitly versioned historical review packages; they do not authorize delivery of later draft edits.

Downloading is read-only and does not create an attestation or claim that the browser saved a file. A separate explicit Record manual delivery form names the exact version/hash, destination label, delivery time and required note. The UI states that this is the member's attestation and has not been verified against a CMS or provider. The actor and recorded time come from the server; they cannot be supplied by the client.

New attestations require the latest submitted version to be approved. A newer pending or rejected version blocks a new attestation against an older approval. Existing historical attestations remain readable after later versions are submitted; they stay bound to the original version. Editing the mutable draft alone does not rewrite a submitted version or its delivery history.

There is at most one active attestation per version. Correction is explicit: withdraw the incorrect attestation with a required reason, then record a replacement if that version remains eligible. Withdrawals are append-only events, not edits/deletions. A superseded version's erroneous attestation may still be withdrawn, but cannot receive a replacement until a new eligible version is reviewed. No withdrawal can silently become evidence that delivery never happened.

C9f may later use the active record's declared delivery time as a self-reported anchor, retaining its attestation ID and provenance. C9e does not start D7/D28/D56 jobs or certify an actual delivery date. Withdrawal must be visible to future consumers; it is not a new anchor at the withdrawal time.

## Authorization and trust boundaries

Reuse current authenticated account membership and account/client/work-item ownership on every service and SQL read/write. Any current member of the owning account can export, attest or withdraw with an audited reason; this follows the existing work-item authoring boundary and creates no delivery-specific role. The original submitter may attest delivery: C9d's independent-review requirement still applies to the approval itself, not to the person reporting delivery.

Platform-admin status alone grants no cross-account delivery access. An active approver grant is not required to report delivery, and later grant revocation does not retroactively erase a retained approval. The existing immutable decision must be approved and bound to the exact version/hash; do not infer approval from a UI flag or a client-supplied decision.

Recheck current actor membership, item ownership, exact approval, latest version and absence of an active attestation inside the write transaction. Reuse the reviewed profile-then-work-item lock order and transaction-local acquired-row witnesses, without weakening C9d. Withdrawal takes the same ownership locks and binds the exact attestation. New-version submission and delivery creation must serialize on the same parent item. Profile deletion/reassignment while a request is pending must fail closed.

Exact same-actor/same-request/same-normalized-payload retries replay the historical event after current ownership is established, even if the version later becomes superseded or the event is withdrawn. Reused request IDs with a different operation, target or payload conflict. Replay is not a new attestation and cannot reactivate withdrawn history.

## Inputs, validation and export format

Use strict allowlisted object keys, normalized UUIDs and fatal UTF-8 streamed body parsing. Each mutation has a 16 KiB actual byte limit. Do not rely only on Content-Length. Trim/NFC-normalize text; reject disallowed control characters while allowing line breaks in notes/reasons.

Attestation input: `{contentHash, destination, deliveredAt, note, requestId}`. contentHash must be the exact 64-character lowercase SHA-256 of the path's version. Destination is 1-500 Unicode code points of plain descriptive text, not an active URL or a fetch target. Note is 1-2000 code points. Do not render destination as a link or change the existing origin-only scan URL policy. Do not request credentials, tokens or secret-bearing URLs in this field.

The UI exposes and labels the chosen timezone explicitly; the request carries an unambiguous ISO timestamp with offset, normalized to UTC. The server validates a real calendar instant and requires approval.decidedAt <= deliveredAt <= database current time. It never silently clamps an invalid or future time. Store both declared deliveredAt and server recordedAt; these have different meanings. Timestamp precision and normalization must be deterministic for retries.

Withdrawal input: `{reason, requestId}`; reason is 1-2000 normalized code points. Client actor/account/approval IDs and timestamps are not accepted as audit authority.

Exports use a versioned `delivery-export.v1` envelope and deterministic UTF-8 bytes. JSON contains only the validated retained review content, validation, version ID/number, contentHash, submission/approval timestamps and existing minimal actor snapshots (profile ID, nullable display name, recorded role). Exclude emails, auth subjects, provider secrets, raw source answers and unrelated account data. Plain text renders the same information and limitations without executable HTML. Missing names/provenance remain unknown; do not invent values.

The original contentHash continues to identify only the C9d frozen review content. A separate SHA-256 exportHash identifies the deterministic JSON export envelope, not delivery or publication. The text representation includes that envelope hash and is explicitly a rendering of it, not bytes claimed to have that same hash. No per-download timestamp, random value or current capability is included in the hashed envelope. Stable filename uses only a server-validated version UUID and format. Return Content-Disposition attachment, the correct UTF-8 content type, no-store and nosniff. No public URL, cache, storage bucket or export audit write is introduced.

## Additive API contract

Prefix: `/api/clients/[clientId]/work-items/[workItemId]/versions/[versionId]`.

| Route | Request and response |
| --- | --- |
| GET /export?format=json or text | Authenticated approved package download. Omitted format defaults to json; unknown/repeated query keys rejected. Read-only, no attestation write. |
| GET /delivery | `{events, activeAttestationId, capabilities, nextCursor}` for this exact owned version. Default limit 20, maximum 50; validated keyset cursor `(recordedAt,id)`. Active ID/capabilities derive from full history, not the current page. |
| POST /delivery | Strict attestation input; `{event}` with 201 new / 200 exact replay. |
| POST /delivery/[attestationId]/withdraw | Strict withdrawal input; `{event}` with 201 new / 200 exact replay. |

Read DTO events contain schemaVersion, eventId, kind, versionId, contentHash, minimal actor snapshot and recordedAt. Attestation events additionally contain destination, deliveredAt and note; withdrawal events contain targetAttestationId and reason. History is bounded and plain text. Capabilities express current canExport/canAttest/canWithdraw plus stable disabled reason codes without exposing other tenants.

All responses, including errors, are no-store. Authentication 401; malformed IDs/query/input 400; known own-account forbidden action 403; missing or unowned resource 404; stale hash/version, active attestation or mismatched replay 409; oversized body 413; invalid delivery-time relation or malformed retained package 422; unavailable database/auth dependencies 503. Use stable DELIVERY_* error codes and safe localized messages, not raw SQL/provider errors. Authentication infrastructure failure must not masquerade as no saved history.

## Storage and transaction contract

Proposed migration: `supabase/migrations/043_delivery_attestations.sql`, authored only. Confirm migration number against the implementation base before writing it; never renumber or rewrite an already applied migration.

Proposed append-only `work_item_delivery_events` contains id, schema_version, account_id, client_id, work_item_id, version_id, content_hash, approval_decision_id, kind, actor_id, actor snapshot, request_id, recorded_at and kind-specific fields. Attestations contain destination/delivered_at/note; withdrawals reference target_attestation_id and contain reason. Kind-specific nullability/limits fail closed with SQL CHECK predicates that cannot pass as NULL.

Bind version/account/client/item/hash through an exact composite FK to immutable work_item_versions. Bind the exact approved decision through a composite key including approval decision ID, version/hash/tenant identity and approved decision value; add only required additive unique indexes to support that FK. Withdrawal must reference an attestation of the same tenant/item/version and kind via an exact self-reference, never an arbitrary event. Allow only one withdrawal per target. Unique `(account_id,actor_id,request_id)` enforces operation-wide request identity; active-attestation uniqueness is enforced under the common parent-item lock with an INSERT SELECT predicate.

No mutable delivery state table is needed: active means attestation with no matching withdrawal. No UPDATE/DELETE privilege for application history, with explicit revocation of inherited default grants as in 042. Retain SELECT/INSERT only; no cascading parent deletion that erases audit records and no profile FK that deletes snapshots. Immutable actor IDs and snapshots survive profile removal, while live membership checks remain authoritative for new requests.

Use only db() tagged queries and the existing bounded transient-retry policy. Return the recorded event from the successful transaction. No pre-read alone authorizes a write. Do not claim mocked SQL tests establish live constraints, locking or privileges.

## Implementation seams and user interface

Add focused lib/delivery types/input/export/store/service modules, thin awaited-params route handlers and adjacent delivery components in the existing version workspace. Integrate through a separate delivery DTO/read rather than adding fields or changing behavior in the current C9c/C9d API. No empty future outcomes or connector modules.

Read relevant installed Next.js 16 guides before framework code. Keep proxy.ts, server-only DB access, per-route auth and established account guards. Update docs/contracts/routes.md, fields.md and features.md with implemented contracts and evidence only.

Both en and zh-HK show export format actions, an approved-version delivery form, active attestation, immutable history and explicit withdrawal confirmation with reason. Keyboard labels/status announcements, focus return, loading/empty/error distinctions and mobile layouts are required. Date input timezone must be visible. Disable mutation on unresolved permission refresh; preserve input through temporary errors and conflicts. Explicit navigation/reload must not discard unsaved input without confirmation. Suppress stale asynchronous reads after a confirmed mutation. Preserve request IDs while retrying identical normalized input; rotate only for a new logical operation. No delivery badge is inferred from approval or successful download.

## Verification and acceptance

1. Pure/export tests: stable JSON bytes/exportHash, text parity and Unicode; frozen hash unchanged; safe filenames/headers; excluded private/raw fields; unknown provenance retained; approved/pending/rejected/history cases; no mutable-draft or source fetch.
2. Input tests: exact keys, malformed UUID/hash, normalized idempotency, code-point boundaries, actual streamed byte boundaries/abort/invalid UTF-8, real UTC dates/timezones, before-approval and future times.
3. Store/service tests: cross-account denial; missing/deleted/reassigned profile; platform admin without ownership; exact approval/hash binding; latest-version race; two simultaneous attestations; withdrawal/correction; wrong target or repeated withdrawal; exact replay after supersession/withdrawal; changed-payload conflict; rollback and transient retry.
4. Authored dedicated PostgreSQL suite: real stores/constraints/SELECT-INSERT grants, immutable history, same-version concurrent create, submission/create ordering, withdrawal races, profile changes and exact request uniqueness. Exclude it from generic setup; require separately approved disposable identities and role proof before any fixture write. Until executed, label AUTHORED/UNRUN.
5. Bilingual hydrated browser cases on desktop/mobile: download content and no delivery side effect; retained forms through 401/403/503/network and malformed responses; recovery and retry identity; latest/pending blocks; active history/withdrawal/correction; declared versus recorded time; no synthetic live DTOs; stale-response races and keyboard accessibility.
6. Run full local unit tests, lint/type generation/TypeScript/build and affected fixture/browser suites sequentially where they share .next. Obtain independent review, fix reproduced findings and retain exact source SHA and command results. Existing C9d evidence is baseline history, not C9e verification.

## Rollout, rollback and subsequent slices

No migration is applied, no provider/CMS/email call is made and no deployment, merge, paid scan or customer write is authorized by this spec. Target environment remains UNKNOWN. Before any future external action, prepare the exact project/branch/database/role or provider target, reviewed SQL/source diff, validation/abort criteria and retention-aware rollback for separate approval.

Local source rollback removes the new delivery routes/components without changing C9c/C9d. If activated later, retain all delivery events and disable new delivery access instead of dropping audit data. Database proof must cover migrations through the implementation head, including unapplied prerequisites; C1 equivalence and sterile nonproduction topology remain separate release gates.

C9f follows under its own comparable-recheck/outcome contract, explicitly distinguishing self-reported delivery, observed changes and causal attribution. C10 continues only selected outstanding provider/commercial checks, preserving prior completed repairs. C11 remains a release-evidence and exact-target authorization process; it is not automatic cutover after C9e. Stop C9e at a verified local handoff unless later publication is explicitly requested.
