# Conversation Studio Stage 6a — attach one approved brand source

**Brief:** `_fleet_docs/brief-6a.md` (authoritative)  
**Design:** `/workspace/docs/superpowers/specs/2026-11-01-aiso-studio-stage-6-full-design.md` §3–4, Wave 2 / 6a  
**Base:** `61b78ebdf0cabf543ed69d2858c2ee667573491e` (`origin/main`, #130 6g tip)  
**Branch:** `codex/conversation-studio-stage-6a` — draft PR only.
**ClickUp:** [z8qgvca4pf](https://app.clickup.com/t/z8qgvca4pf) (Vera). **GM:** continuous-plan t335u.

## Outcome

The composer「選文件」control is enabled when Studio has an owned brand and a loadable candidate list. The operator picks **at most one** approved source version that is also allowed for agent use. A visible「已選用」badge appears on the composer and discussion header, and the selected source can be removed without leaving the discussion.

Candidates come from the same predicates as `listAgentUsableSources`: owned by `account_id` + `client_id`, `agent_use_allowed = true`, `revoked_at is null`, and the current version `approved_at is not null`. The browser receives only `id`, `label`, `versionNumber` and `contentHash`; entry bodies stay in the database until Send.

## LIVE request path

`POST /api/dashboard/clients/[clientId]/studio/answer` accepts one additional body key, `attachedSourceId` (UUID). It does not accept source content, entries, labels or version numbers from the client. `readLimitedJson(…, 4096)` is unchanged.

When present, the id is resolved with tenancy inside the SQL (`account_id`, `client_id`, latest version, agent-use allowed, approved, not revoked). A miss returns `404 { error: "STUDIO_ATTACH_UNAVAILABLE" }` before quota reservation or provider dispatch. No partial guess and no fallback to another brand's row.

Without an attachment the provider messages are exactly today's question + brand name + existing honesty line (no silent inject).

When attached:

- The approved source is fenced as **DATA**, with a marker instructing the model to ignore instruction-shaped text inside it. `<>` is neutralised so customer text cannot close the fence.
- The honesty line becomes explicit that only this attached source is available, and still denies saved-record/conversation-history access.
- The response carries `attachment` metadata (`sourceId`, `label`, `versionId`, `versionNumber`, `contentHash`, entries included/total, `truncated`, characters).

## Inject budget

- `STUDIO_ATTACH_MAX_ENTRIES = 40`
- `STUDIO_ATTACH_MAX_CHARS = 8000`

Truncation is deterministic and entry-ordered: the first entries are kept until either budget is exhausted, and the last entry is clipped at a UTF-16-safe boundary. Metadata and the UI disclose truncation. A full pack (`MAX_ENTRIES × MAX_FIELD`) can be much larger, so this keeps one explicit attachment from turning a single Send into unbounded input-token spend across the platform fan-out.

## Saved / B1 path

`composeSavedReply` is unchanged. The saved card does not gain invented citations. When LIVE is off, the turn shows that the document stays in this discussion and is not sent to a model.

## Spend and quota

LIVE spend still reserves the full answer fan-out with `reserveStudioAnswers` before provider dispatch (6g durable account-week counter). Cap `0`, `STUDIO_QUOTA_EXCEEDED` and the task budget still stop LIVE even when an attachment is present. Attached text increases provider input tokens on every selected platform; en and zh-HK `live.notice`, `live.composerHelp` and `live.usesQuota` disclose this.

## Acceptance checklist (design §4 6a)

- [x] Operator can pick an approved source version owned by the current brand/tenancy, and only if agent use is allowed.
- [x] The attached source is visible in the discussion; LIVE includes it only when explicitly attached.
- [x] Missing / unauthorized / wrong-tenant source → honest error, no content bleed.
- [x] Token/spend impact is disclosed; LIVE quota still short-circuits before providers.
- [x] Docs and focused tests; e2e `chooseDocuments` expectations updated.

## NO_GO / explicitly not in this PR

- No Production/Preview env writes, no `FEATURE_CONVERSATION_STUDIO*` or `_LIVE` toggles, no `STUDIO_LIVE_ANSWERS_PER_WEEK` change.
- No silent attach of all agent-usable sources; no client-supplied source content.
- No `/sources` redesign, no Layout A/default-home flip.
- No 6b work-item save, 6c thread persistence, 6d–6f vendor work, CloudAgent, new ORM or paid service.
- No demo packs, invented ClickUp IDs, `pulse_metrics` or `ai_citation_log` writes.
- Do not merge from this branch.

The existing Prod `FEATURE_CONVERSATION_STUDIO=1` does **not** authorize LIVE/cap/env changes here. Those remain separate GM Approves.

## Verification

- Unit: fence/truncation, attach resolution via tenancy predicates, no-attach parity, foreign/unusable rejection, quota short-circuit, oversized fixture.
- Component/e2e: picker enabled, select + badge, clear, empty/unavailable honesty, request carries only `attachedSourceId`.
- `npm run lint`, `npm run typecheck`, focused Vitest suites, and the Studio e2e spec.
