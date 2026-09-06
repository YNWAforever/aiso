# C9d: immutable change-set versions, validation and audited decisions

Date: 2026-09-06. Status updated 2026-09-07: specification approved on 2026-09-06; Tasks 1-6 implemented and independently approved, local Task 7 verification/handoff complete, final whole-branch review approved including the final permission-outage repair at `95b8566ec2d7aaf074e26755335c1fabd178efb3`. No live activation: PostgreSQL suites are authored/UNRUN and migration 042 remains unapplied here with target UNKNOWN. Exact tested source and evidence: [local handoff](../plans/2026-09-07-c9d-handoff.md).

Baseline: `195282e70084fb270a4bd7df3e91527869bd4d31`, origin/codex/c8c-g-workspace after PR #17. Its tree equals the tested C9b/C9c source/documentation checkpoint a1f004e. Design branch: codex/c9d-change-set-design. Existing implementation and original user checkout are preserved.

## Approved scope and approach

Add immutable review versions alongside editable C9c drafts. Each change set belongs to exactly one existing work item; there is no multi-item bundle in this slice. Preserve the existing work-item API, draft-only status, editing, evidence snapshots, source exclusions and commercial/security gates.

Alternatives considered: changing the mutable draft into the approval state machine would disrupt C9c compatibility; a general workflow engine would introduce roles and lifecycle beyond this slice. Separate version and decision records provide an explicit review boundary with a smaller change.

Users approved designated account approvers, managed by existing platform administrators, with audited grants/revocations. Submitters cannot approve their own versions. Approval is a recorded review decision, not delivery, publication, factual correctness, regulatory compliance or measured impact.

## User flow

An authenticated account member opens a saved draft, saves pending edits, and explicitly selects Submit version for review. Unsaved browser text is never silently submitted: submission names an expected persisted draft revision. The server validates and freezes the exact saved title, action, notes, locale and original evidence snapshot. An older revision conflicts rather than capturing newer text without consent.

Version history displays version number, source draft revision, submission time, submitter identity, content, evidence, validation policy/results and decision history. Draft editing continues through the existing API. It does not modify submitted versions, and approved-version text is never presented as approval of later draft edits.

An eligible approver reviews the exact version and selects Approve or Request changes with a required reason. Both are terminal decisions. The latest submitted version alone is actionable; earlier pending versions are shown as superseded, derived from version order without rewriting history. Prior terminal decisions remain visible on their exact versions. Corrections require editing the draft and submitting a new revision/version.

A separate administrator surface manages approver access for a selected account. It lists only that account's members, active grants and grant/revocation history. There is no invitation, account reassignment, new platform-admin assignment or general team-role matrix.

All new client UI and errors support en and zh-HK, plain-text rendering, keyboard access, focus restoration and accessible status announcements. Failed actions preserve input; explicit reload never silently discards edits. Permission unavailability fails closed with a retry state. An empty approver list is visibly different from a failed lookup.

## Authorization and identity

Client reads/submissions require authenticated account membership plus account/client/work-item ownership on every endpoint and query. Review decisions additionally require an active grant for the current profile in that account. Platform administrator status does not bypass client ownership or confer review authority. A platform administrator can approve only as a separately designated member of the target account and cannot approve their own submission.

Grant/revoke endpoints independently authenticate and recheck the existing database-backed is_admin flag. Cross-account administration is limited to an explicitly named target account, with the target profile verified as belonging to it. The administrator actor can belong to a different account; do not incorrectly require an actor/target-account composite FK for this administrator audit. Every target query is scoped to the explicit account. No inherited admin page layout is treated as API authorization.

Store actor profile UUID, display-name snapshot, actor role at the event, and database timestamp. Expose these only through the authorized review/admin DTO that needs them; do not add emails, auth subjects, tokens or actor fields to C9c DTOs. A missing display name is shown as an unnamed member with an audit identifier, not an invented person. Historical actor snapshots survive profile deletion; current grants cease to authorize a missing or reassigned profile.

## Version validation contract

Use a deterministic server-only policy named change-set-review.v1. Checks cover the existing normalized title/action/notes limits, supported locale, original allowlisted evidence snapshot structure and size, supported Pulse/scan source, account/client binding and the requested saved revision. Reuse C9c validators without broadening recommendation eligibility or reintroducing raw source answers.

Freeze content with a schema version and canonical SHA-256 content hash. Record validation policy version, stable check codes and results with the version in the same transaction. A failed structural check prevents submission; return stable field/check errors. Ownership failures remain authorization/not-found errors rather than revealing another tenant's validation details.

The validation describes the saved evidence and review package only. It performs no live scan, provider call, URL fetch or freshness certification. Preserve recorded limitations and unknown provenance. Source disappearance after C9c save does not invalidate its historical snapshot. Future validation policies must not rewrite historical results.

## API contract

Existing C9c endpoints and DTOs remain unchanged. Proposed new endpoints:

| Endpoint | Contract |
| --- | --- |
| GET /api/clients/[clientId]/work-items/[workItemId]/versions | Owned version summaries, latest version id, review capability and keyset nextCursor; default 20/max 50 |
| POST same /versions | Only {expectedRevision}; freezes server-loaded draft and validation; 201 new, 200 replay for the same saved revision |
| GET .../versions/[versionId] | Owned immutable content/evidence, validation, submitter and exact decision; actionable capability is computed from current authorization |
| POST .../versions/[versionId]/decision | Only {decision: approved or changes_requested, reason, requestId}; 201 new, 200 identical retry |
| GET /api/admin/accounts/[accountId]/approvers | Admin-only paginated account members, current grants and bounded audit history |
| POST same /approvers | Only {profileId, action: grant or revoke, reason, expectedRevision, requestId}; 201 event, 200 identical retry |

UUIDs are validated, revision values are positive safe integers (grant expectedRevision permits 0 for no existing state), list queries reject unknown keys, and all responses use Cache-Control: no-store. Reasons are trimmed/NFC-normalized, 1-2000 code points. Actual streamed body limits: 4 KiB submission, 16 KiB decision/access mutation. Do not trust Content-Length. Request IDs are UUIDs scoped to the target operation and actor; reuse with a different payload is a conflict.

The version DTO includes schemaVersion, id, versionNumber, workItemId, draftRevision, title/action/notes/locale, evidenceSnapshot, contentHash, validation, submittedBy, submittedAt, decision and capabilities. Lists omit full evidence/content. No caller supplies account, actor, role, hash, validation results or timestamps. The version detail content is bounded using existing C9c text limits plus its 64 KiB evidence limit; enforce a conservative 128 KiB total JSONB bound independently in application and SQL.

Errors: 400 invalid input; 401 unauthenticated; 403 admin/approver denied or self-decision; 404 missing/foreign client, item or version; 409 stale draft/access revision, superseded version, conflicting decision or request-id reuse; 422 validation failure; 503 storage/authorization lookup unavailable. Stable codes are localized; no SQL error or failed-write success leaks.

## Persistence, immutability and concurrency

Author one additive migration after confirming numbering against the implementation baseline (042 is the candidate, not permission to replace an existing migration). Logical records:

- Work-item versions: account/client/item identifiers, monotonic per-item number, draft revision, schema/content/hash, frozen validation, submitter snapshot and database time. Unique account/client/item/draftRevision and per-item version number. The work item is the single-item change-set identity.
- Review decisions: one terminal row per version, exact version/hash reference, decision/reason, actor/role snapshot, active grant reference, request identity and time.
- Account approver state: unique target account/profile, active boolean, monotonically increasing revision and last event reference. Retain revoked state for concurrency; do not delete it on revoke.
- Approver audit events: append-only grant/revoke, target account/profile, administrator snapshot, prior/new state revision, reason/request identity and time.

New version/decision/audit tables give the application role SELECT/INSERT only, with explicit UPDATE/DELETE revocation and no cascading parent deletion that could erase history. Tenant/version relationships use composite constraints. Historical identity values are immutable snapshots; do not use SET NULL on immutable actor fields. Account/client removal is blocked where required to retain audit history, rather than silently cascading these records. Any later retention/deletion policy is a separate slice. Approver state allows the narrowly required updates; history creation and state change must commit together.

Use db() tagged queries and supported transactions, preserving its binding guard. Acquire row locks and enforce a consistent lock order. Submission and decision serialize on the owned work-item row; submission validates the exact persisted revision/content before conditional insertion. SQL predicates bind every snapshotted source value if application validation happened before acquiring the lock. Concurrent same-revision submissions return one retained version. A fresh transaction statement reads the winner after a unique conflict.

Decisions also lock the applicable approver-state row, recheck current membership and active grant in the write transaction, and atomically insert the decision. Revocation uses the same grant-state lock: if it commits first, the later decision is refused; if the decision commits first, its historical grant evidence remains valid. Serialize profile membership/admin checks against concurrent relevant profile updates. New submissions and decisions share parent locking so only the latest submitted version can receive a new decision.

Identical decision retries may read their original owned record after grant revocation, but cannot create another decision; return a replay marker and current capabilities. Conflicting payloads never replay as success. Grant/revoke requests use expectedRevision and atomic state-plus-event persistence; retry with the same request id returns the original event. Serialization/deadlock failures receive bounded retries or a safe retryable error, not false success. The implementation plan must map the exact SQL statement/lock order before writing these stores.

## Files and verification plan

Keep work-item editing in lib/work-items. Add focused lib/change-sets and lib/approvals schema/validation/store/service modules, thin new route handlers, version/review components adjacent to the draft editor, a guarded admin page, and bilingual messages. Update docs/contracts/{routes,fields,features}.md. Read installed Next.js 16 guides before framework implementation. Do not build empty future delivery/outcome modules.

Regression tests must cover valid/invalid submission, stale and concurrent edits, duplicate submission/replay, exact snapshot immutability, version numbering, new-version supersession, failed validation, tenant isolation, missing profile, admin-target membership, self-decision denial, revoked grant, grant/revoke idempotency and revision conflict, decision/revocation concurrency, terminal-decision uniqueness, actor deletion/history retention and transactional audit rollback.

Use focused unit/store/API tests and bilingual desktop/mobile browser fixtures for submit, review, history, permissions and failure recovery. Run full local unit, lint, full TypeScript, production build and selected previous C9b/C9c browser regressions on sanitized dummy configuration. Do not run database-provisioning global setup. Author isolated PostgreSQL constraint/grant/concurrency tests with exact disposable-target guards; report them unrun until separately authorized.

## External boundary and rollback

This design authorizes local implementation planning after written-spec review. It does not authorize live grants, customer writes, migration application, database/provider/environment/credential mutation, paid scans, email, deployment, push or merge. C9c migration041 and the C9d migration need target-specific verification before activation; PR CI success alone does not establish live C9d readiness.

Local source rollback removes C9d routes/components while preserving C9c. If later activated, retain additive versions, decisions and audit records; no destructive rollback is proposed. Prepare exact environment identity, migration diff, application SHA, grants/concurrency validation and rollback for separate approval before external activation. Delivery/exports, outcome windows, general roles, recommendation-derived work and C10/C11 operations remain out of scope.

## Self-review and design progress

Completed: baseline/context exploration, material policy questions, alternative comparison, conversational design approval, written design and consistency review. No visual companion was needed for these data/authorization decisions. Written-spec review approved. Implementation plan prepared using writing-plans; execution workflow selection follows.

Self-review checked C9c compatibility, actor snapshots versus deletion, cross-account administrator versus account approver authority, revocation/decision race, terminal version decisions, immutable validation, retry semantics and external boundaries. Tests above are planned, not executed. No application code, schema or environment changed in this design step.
## Final implementation evidence (2026-09-07)

The permission-unavailability requirement now has RED/GREEN browser evidence for503, network and malformed-JSON refresh failures, preserved form/retry state and successful recovery. Source `95b8566ec2d7aaf074e26755335c1fabd178efb3` passed2682 unit tests,48 complete C9d browser cases,47 fixture tests, scoped lint, full TypeScript and fresh production build. Independent final re-review confirmed P2 resolved and no new findings. See the handoff closure addendum for raw artifacts and exact commands. PostgreSQL suites remain UNRUN and migration042 UNAPPLIED here, target UNKNOWN; no external activation occurred.
