# Conversation Studio Stage B2

Base: `0b82158ccb836da00643d8866c500e7640465257` (B1).

The existing saved-evidence reply remains local. With both
`FEATURE_CONVERSATION_STUDIO=1` and `FEATURE_CONVERSATION_STUDIO_LIVE=1`, the
composer also exposes the current commercial plan's runtime platforms. One Send
asks one question on the selected platforms and displays live output beside the
saved reply. Only the question, brand name and response language are sent; neither
saved records nor earlier conversation turns are supplied to the model. Live
output is explicitly unverified and never becomes a Pulse observation or mention
measurement. Threads remain in page memory.

## Flags and spend

- `FEATURE_CONVERSATION_STUDIO_LIVE`: default off, effective only while the base
  Studio flag is on. Off preserves the B1 UI and makes the route return 404 before
  auth, SQL, or provider calls.
- `STUDIO_LIVE_ANSWERS_PER_WEEK`: default **0**. Missing, malformed, negative,
  fractional or unsafe integer values fail closed. Zero returns 429 without a
  provider call. The name reserves the future durable setting; B2 implements a
  **temporary per-account, per-process UTC-week attempt counter** only. It is
  shared across brands in one warm process, resets on restart, and is independent
  across instances. It does not enforce an account-wide hosted weekly quota.

Each selected platform consumes one answer unit, reserved synchronously before
dispatch. Failed and unknown attempts remain charged because they may have spent
money. There are no automatic retries. The entire fan-out also reserves the
existing `createTaskBudget` call/token limits before dispatch; its default three
calls can reject a larger platform selection with 429, without partial spend.
Output is clamped to at most 1,000 tokens or the lower configured global ceiling.
Calls use a shared 20-second abort signal; Vercel's exact route duration is 30s.

Provider usage carries the closed `studio.answer` label. Logs retain numeric
usage, the requested model and a recognized finish reason, with no prompt/reply
or untrusted provider model/request identifiers. Provider error bodies are not
logged. Actual model and finish reason remain visible in the transient reply.

Optional web-plugin requests require `webSearchAllowance` and a local Studio
search reservation against its remaining allowance. Studio does not write the
Pulse usage tables or ledger. The additional search counter has the same
process-local limitations as the answer cap. Native Perplexity search is labelled
`native`; other calls without the plugin are `none`. Only provider search events
confirm execution; citations alone do not. No GSC, Firecrawl or DataForSEO request
is made, and no HK/zh-HK Mentions support is claimed.

**Preview-spend still requires Willy Approve before humans set LIVE=1 and cap>0
with provider credentials.** This draft does not set any hosted environment
variables. Production flags stay off. The exact branch
`codex/conversation-studio-stage-b2` has Git deployment disabled in `vercel.json`.

## API and evidence

`POST /api/dashboard/clients/[clientId]/studio/answer`

Input: `{ "prompt": "...", "platforms": ["gemini-flash"], "language": "en" }`.
The body limit is 4,096 actual bytes and the prompt cap is 1,000 UTF-16 characters.
Language is `en` or `zh-HK`; platforms must be a nonempty unique subset of the
plan grants. Unknown properties and invalid bodies return `INVALID_STUDIO_INPUT`
at 400, including oversized bodies. Auth runs before UUID and active owned-brand
lookup (401, then 404); only owned brands reach the no-platform 403
`UPGRADE_REQUIRED` check. Lookup failures return 503. Every response is no-store.

200 contains one result per selected platform, preserving partial/total failures
as `coverage: missing` and `answer: null`. Success is `present`, never verified
mention coverage. The renderer also handles `unsupported` explicitly. Results
include actual model, start time, duration, finish reason, search evidence, and
public provider citations filtered through `safeEvidenceUrl`. Answer text is
rendered as plain text. Missing answers never mean zero mentions. The response
quota reports only the responding process's remaining units, with `scope: process`.

There is **no migration and no persistence** to `pulse_metrics`,
`ai_citation_log`, Pulse runs/reservations, or a thread store. Billing, entitlement
resolution, onboarding, cron, MCP, and WorkspaceHome logic are unchanged.

## Validation and exclusions

Route tests use mocked fetch with the real OpenRouter adapter and verify kill
switches, auth ordering, strict input, cap failure, account isolation, reservation
before fan-out, token clamp, metadata-only logs, safe links, and provider failures.
A PGlite integration executes real tenant-scoped route SQL, denies another
account's brand, and verifies all metrics/citation/ledger sentinel rows remain
unchanged. No hosted Neon target or paid provider is used locally.

The browser fixture renders the production component in en and zh-HK and blocks
every outbound request. LIVE off and cap-zero sends produce no transport; LIVE
on intercepts only the local answer endpoint with synthetic results. Browser
checks include separate saved/live panels, partial errors, quota rejection,
safe sources, accessibility, narrow reflow and page-local state reset.

NO_GO: merge, Production enablement or environment writes, Stage C/D, durable
quota migration, billing/entitlement logic, onboarding brand_draft, Neon migration,
Pulse ledger changes, live provider tests. Hold Extra High PR-diff until CI is
green and AISO supplies a new brief.
