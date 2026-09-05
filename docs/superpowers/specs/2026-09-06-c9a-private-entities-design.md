# C9a private entity records — approved design, 2026-09-06

Status: approved by user 2026-09-06; local implementation authorized. User requested C9–C11 continuation. This is the first C9 vertical, alongside independent C10 source audit and C11 readiness preparation. C8c–g was preserved and locally checkpointed at 5aabacd16d338afc15fbaa3d5db62641d7b5c628 on codex/c8c-g-workspace. C9a proceeds on codex/c9a-private-entities.

## Decision and alternatives

Recommend private, explicitly unverified entity records attached to owned clients. Alternatives: public verification first requires ownership/dispute/moderation policy; implementing the whole discovery-to-proof lifecycle first requires approval roles and delivery semantics. Both delay a useful bounded first vertical.

One canonical brand record per existing client keeps this first slice within the current client quota and avoids introducing a second product/brand allowance. Alias labels are organizational input, not evidence of trademark, domain control or legal identity. Product/sub-entity modelling remains a later explicit extension. No public discovery/profile route or verified badge becomes available.

## User flow and source boundaries

Add /[lang]/dashboard/[clientId]/entities as an owned page with en/zh-HK labels, existing dashboard navigation and UI primitives. Read authorization follows getProfile and clients.id/account_id ownership. Existing account membership permits editing, matching current client/prompt management; no new role or cross-account admin bypass.

An unsaved entity shows the client brand as a suggested value, visibly unsaved; GET does not insert a row. A user can save a display name and aliases, see stored values, and receive conflict/retry/error feedback. All records remain private/unverified. No automatic migration of client data, provider lookup, crawl or public profile.

## Concrete persistence and HTTP contract

Proposed additive migration: supabase/migrations/040_client_entities.sql. Preserve all historical SQL and immutable baseline. Add account-bound client_entities: client_id UUID primary key, account_id UUID, display_name text, aliases JSONB array, revision positive integer, updated_by nullable UUID, created_at and updated_at timestamps. Constrain display name to 1–120 characters, aliases to at most 20 strings of 1–120 characters; aliases are trimmed, NFC-normalized and case-insensitively deduplicated, excluding the display name. Use the existing profiles(id,account_id) composite key for the actor foreign key; deletion sets updated_by null without deleting the entity record. Composite owned-client foreign key uses clients(id,account_id), with an additive unique index if needed. No RLS architecture change. Explicit least-privilege grants cover only SELECT/INSERT/UPDATE for the existing app role; no DELETE endpoint.

GET /api/clients/[clientId]/entity returns {entity:null} when no stored record exists, otherwise {entity:{clientId,displayName,aliases,revision,verification:'unverified',updatedAt}}. It must not expose account ids or actor ids. Auth/ownership is checked before entity queries; wrong-owner and missing client both return 404.

PUT on the same path accepts only {displayName,aliases,expectedRevision}. expectedRevision=0 creates; positive revision updates via account/client/revision-scoped compare-and-swap. Mutation plus revision increment is one atomic statement; use INSERT ... SELECT from the owned client for creation. Same normalized payload with an older expectedRevision after a lost response returns the stored representation without incrementing again; a differing stale payload or future revision returns 409 ENTITY_CONFLICT. Validate size (16 KiB body), field types, array bounds and UUID before writes. Do not accept caller-supplied account, actor or verification fields. Ownership remains rechecked in SQL, even after a prior guard.

Errors: 401 UNAUTHENTICATED; 400 INVALID_ENTITY_INPUT; 404 CLIENT_NOT_FOUND; 409 ENTITY_CONFLICT; generic 500 ENTITY_UNAVAILABLE with secret-safe diagnostics. No successful response over a failed write. No body/SQL error or credentials in client output.

## Planned files and verification

- lib/entities/{schema,store,service}.ts: normalized narrow DTO, owned tagged SQL, authenticated service.
- app/api/clients/[clientId]/entity/route.ts and app/[lang]/dashboard/[clientId]/entities/page.tsx: thin guarded adapters.
- components/entities/EntityEditor.tsx; existing client navigation; messages/{en,zh-HK}.json.
- Focused entity schema/service/API/migration/page/editor tests; locale parity and browser fixture coverage; contract amendments in docs/contracts.

Read installed Next16 guides before framework edits. Red/green tests cover missing/foreign owner and invalid UUID (no forbidden query), empty versus failed read, failed write, atomic creation race, revision conflicts, lost-response retry, input bounds and bilingual keyboard/error states. Mocked SQL tests do not establish migration execution. Add an integration test for exact disposable target execution, but do not run it or apply the migration without separate authorization. Verify local units/lint/types/build and independently review the final diff.

## Rollback and next C9 contracts

Export a distinct C9a patch against a preserved C8 checkpoint. Local rollback reverses only C9a source. Because no migration is applied in this task, there is no database rollback operation. A future release must approve exact migration target, SQL diff, app-role checks and rollback with retained records before activation.

C9b then maps prompt/Pulse observation provenance; C9c derives evidence-linked opportunities; C9d needs named approver/immutable-version rules; C9e needs explicit delivery attestation; C9f needs comparable delivery-anchored outcome windows. These remain separate subplans, not implied completed modules. Approval is not delivery; export is not publication; observed change is not attributed impact.
