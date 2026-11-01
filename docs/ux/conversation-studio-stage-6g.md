# Conversation Studio Stage 6g — durable weekly LIVE quota

Base: `7bb2a105d95ad6457da8bd480ee7ba792f5b1a8d` (`origin/main`).
Branch: `codex/conversation-studio-stage-6g`.

Governing brief: `/workspace/cli-aiso-6g/_fleet_docs/BRIEF.md`.
Locked product design:
`/workspace/cli-aiso-6g/_fleet_docs/2026-11-01-aiso-studio-prod-6g-6h-design.md`
§3–4, **6g**. Honesty copy:
`/workspace/cli-aiso-6g/_fleet_docs/2026-11-01-aiso-studio-6g-6h-string-pack.md`.
The brief and `_fleet_docs/` are local handoff inputs and are not committed.

## Outcome

LIVE answer reservations now use Neon migration
`080_studio_live_weekly_usage.sql`. The table has one row per
`(account_id, week_start)`, where `week_start` is the existing UTC-Monday key
from `studioWeek()`. An atomic conditional upsert increments `answer_count` only
when the selected platform fan-out fits under the configured cap.

`STUDIO_LIVE_ANSWERS_PER_WEEK` retains its exact name and fail-closed parser:
missing, malformed, negative, fractional, unsafe or zero values produce a
`STUDIO_QUOTA_EXCEEDED` 429 before any provider call. A zero cap also skips the
counter write. The whole fan-out is reserved before provider dispatch, and failed
or unknown provider attempts remain charged. The response reports
`{ cap, remaining, scope: 'account' }`.

The spend key remains `account_id`, not `clientId`: the owned active brand is the
authorization gate, while an account's brands share the weekly LIVE allowance.
The migration enables RLS and revokes access from `public`, `anon`,
`authenticated` and `service_role` where those roles exist, mirroring
`025_authenticated_scan_quotas.sql`.

Stage B2's process-local answer counter is superseded. Its process-local search
reservation remains in place: it only guards `reserveStudioSearches` within a
warm process and continues to require the existing Pulse `webSearchAllowance`.
No `search_count` column or second search ledger was added. This is a bounded
local guard, not a claim that search reservations are durable.

## UI and honesty

`conversationStudio.live.temporaryCap`, `usesQuota`, `remaining`, `exhausted`
and `disabled` use the Hazel string pack in both `en` and `zh-HK`. They state
account/brand weekly usage and that failed or unknown provider attempts still
consume quota. Over-cap and cap-zero sends stop LIVE and keep the saved-evidence
path available.

`conversationStudio.featureShellNote` is rendered as an `as-note` amber honesty
note inside the composer when Studio is enabled and LIVE is off. It is not a
top banner and does not change the FEATURE/LIVE flag values. An exhausted LIVE
control is disabled for the rest of the page session and uses a stronger
`as-live-exhausted` state while the saved-evidence reply remains usable.

## Verification

Focused contracts cover:

- persistence across separate module loads for the same account and UTC week;
- account isolation for the same week;
- cap zero rejecting before the counter query/provider path;
- over-cap and concurrent reservations not writing past the cap;
- route-level 429 handling and no provider dispatch after rejection;
- unchanged prompt/reply log redaction;
- migration shape/RLS and the exact Stage 6g Vercel deploy-disable entry.

The SQL contract uses an in-memory PGlite database and the real migration/query;
it does not claim a hosted Neon, Auth, Preview or provider acceptance run.

| Check | Result |
| --- | --- |
| `npm run lint` | Pass, 0 errors/warnings |
| `npm run typecheck` | Pass with generated Next.js route types |
| Focused Studio unit suite | 15 files / 144 tests pass |
| Full unit suite (`CI=1`, 2 workers) | 539 files / 7,170 tests pass |
| `npm run build` | Next.js 16.3.8 Turbopack production build pass |
| Component fixtures | 27 files / 165 tests pass |
| Focused Chromium Studio E2E | 30/30 pass, en + zh-HK |
| Hosted Neon/Auth integration | N/A / not run: requires the disposable Neon harness |

## NO_GOs

No Production or Preview environment writes; no `FEATURE_CONVERSATION_STUDIO`
or `FEATURE_CONVERSATION_STUDIO_LIVE` enablement; no Production cap increase;
no Stage 6a/b/c/d/e/f/h; no new vendors or model-spend paths; no CloudAgent; no
merge; no default-home flip; no layout redesign; no Pulse search-ledger
expansion; and no commit of `_fleet_docs/`.

Production FEATURE ON and the separate Production LIVE ON/cap approve remain
named GM decisions after merge. This delivery is a draft PR only.
