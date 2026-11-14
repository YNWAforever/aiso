# SME capability and readiness evidence

Source reviewed **2026-11-14** against actual main
`73e97904550eff953ef70bf0ed74c62ea4b3eab3`. The latest canonical observation used
here is **2026-11-14T08:42:30.993Z**, from the
[PR267 release receipt](https://github.com/YNWAforever/aiso/pull/267#issuecomment-6874734189).
This is a dated source/evidence ledger, not a new operational probe or an instruction
to activate services. No deployed environment values, secrets or auth-state contents
were inspected for this audit; no live API/provider call was made to fill a row.

## How to read the evidence

- **Implemented:** current code and its callees expose the path and gates below.
- **Controlled:** fixture, pure-policy, mocked-provider, local SQL or disposable SQL
  checks exercise their stated layer. They do not establish customer execution.
- **Canonical read observed:** an exact deployed version rendered an explicitly
  allowed owned view at the recorded time. Empty data remains empty evidence.
- **Unknown:** configuration, entitlement, capacity, fresh data or external execution
  was not established for a named current account/brand. Unknown is not zero or a
  failed provider, and configuration shape is not operational success.
- **Human pending:** no actual participant observations have been supplied. The
  four-of-five target is not a result.

Runtime plan access uses the [commercial resolver](../../lib/tier.ts), including
subscription status/trial/override, not the plan-only helper or marketing release
labels in the [catalog](../../lib/plans/catalog.ts). Current deployed flags, per-brand
settings, grants, quota counters and provider health are unknown in this source-only
audit. Token/call ceilings are bounds, not a monetary quote. Endpoint gates differ;
no universal Studio rollout, entitlement or "read-only" label replaces the callee.

## Studio, Skills and MCP

| Operation | Current implementation and gate | Effects and evidence boundary |
| --- | --- | --- |
| Member Studio viewing | Studio flag/optional brand rollout list, session and owned brand; [page](<../../app/[lang]/dashboard/[clientId]/studio/page.tsx>), [gate](../../lib/conversation-studio/secondary.ts) | Initial retained-evidence page does not dispatch model/Google/DataForSEO/Firecrawl queries; `ask` prefills until Send. No fresh live Studio-view acceptance is claimed by the latest three-surface canonical cohort. |
| Staff Studio viewing | Platform admin plus live account grant; [staff gate/audit](../../lib/conversation-studio/secondary.ts) | Opening appends a staff audit row before render. Staff provider controls are suppressed, but grant-bound threads may be saved. A staff open is not a strictly no-write inspection. |
| Saved conversation/context skill | Saved server [composer](../../lib/conversation-studio/compose-server.ts), independently authorized [turn append](../../lib/conversation-studio/threads.ts), actual [UI dispatch](../../components/dashboard/ConversationStudio.tsx) | Composer itself reads retained evidence without a model. A UI tap saves a thread/turn and may dispatch separate provider reads. `allowLive:false` suppresses LIVE only; it is not a zero-provider promise. |
| LIVE answer | Global Studio+LIVE flags, session, owned active brand, runtime platform entitlement and own saved thread/history; [handler](../../lib/conversation-studio/live.ts) | Reserves durable quota before model fan-out: ten platform answers/brand/UTC-Monday week. Failed/unknown attempts consume reservations. Explicit LIVE response is not scheduled Pulse collection or observed business improvement. Actual provider health/use/cost is unknown here. |
| DataForSEO side read | Every nonstaff brand turn requests the side endpoint; Studio rollout/session/platform/owned-active-brand, valid keyword, credentials, enabled brand setting and reservation gate actual vendor call; [query](../../lib/conversation-studio/dfs-query.ts) | Up to twenty calls/brand/Hong Kong Monday week; failed/unknown attempts remain charged. Both saved and LIVE turns can attempt it, independently of turn-save success. Disabled/missing/capped states return before vendor; their current values were not inspected. |
| Search Console / Firecrawl side reads | Bound status prompts GSC; explicit URL prompts Firecrawl. [GSC query](../../lib/conversation-studio/gsc-query.ts) checks binding/credentials/domain; [Firecrawl query](../../lib/conversation-studio/firecrawl-query.ts) checks key, enabled setting, syntax and public DNS | May refresh Google credentials/read analytics or scrape a website. Saved mode does not suppress them. GSC's route uses its Search Console gate; Firecrawl uses Studio rollout/platform access. No fresh binding, successful provider response or monetary Firecrawl budget is established here. |
| Confirmed scan/Improve/report Skills | Current [action panel](../../components/dashboard/StudioActionPanel.tsx) and [dispatch boundary](../../lib/conversation-studio/action-outcomes.ts) use existing endpoints after inline confirmation and identity/domain/scan/month/plan checks | These actions are already wired, despite historical future-slice comments. Writes/provider effects follow the reused endpoint. Pending/unknown replies are not completed work or permission to retry automatically; retry-save stores only the action summary. |
| Google Docs export | Global Studio flag/session/platform, own active brand/turn and Drive credential; [export service](../../lib/conversation-studio/drive-export.ts) | Refreshes token, creates an external document and records an export ledger. Unknown create or failed ledger remains explicit. It is not a no-write readiness read. |
| Internal MCP | MCP flag, Studio rollout, signing-secret shape, session mint and reloaded bearer principal/account/brand/grant/entitlement; [transport](../../app/api/mcp/studio/route.ts), [operator runbook](../runbooks/studio-mcp-internal.md) | Six registered business-data reads; `tools/call` must append audit before data is returned. The recognized-tool branch uses a 30-row/60-second count guard, not an atomic concurrent reservation. Current gated Tools UI includes token mint/copy. No mint/transport call was performed; external bearer-only usability remains unverified, with the source caveat below. |

**Path-specific rollout:** page/thread paths check brand rollout; the LIVE handler
has global Studio+LIVE checks and own active brand/thread but no direct brand-list
check. Studio GSC uses Search Console's gate; Drive export uses the global Studio
flag. These are source facts, not an executed bypass or a decision that every path
must share one rollout policy.

**MCP loader caveat:** `content_opportunities` goes through the
[MCP executor](../../lib/conversation-studio/mcp/execute.ts),
[Studio loader](../../lib/conversation-studio/opportunities.ts) and normal
[session-authenticated service](../../lib/opportunities/service.ts). The bearer
principal does not replace that downstream browser session. Without a member session
the loader maps unauthenticated access to unavailable. Registry presence and mocked
executor tests do not establish six externally usable bearer-only tools. Skill tool
maps likewise do not prove a Studio tap invoked this transport.

## Scan, Improve, monitoring, reports and delivery

| Operation | Current implementation and gate | Effects and what remains unknown |
| --- | --- | --- |
| Website scan | [POST scan](../../app/api/scan/route.ts): auth lookup must succeed; public rate limit for anonymous/eligible public use; supplied client requires session/ownership and commercial scan allowance | Fetches public site/sitemap, can call models for GEO checks, writes scan/quota, and may dispatch client webhook **or** native Improve plus a separately configured global summary webhook. Scan 200 does not prove every check/provider or downstream workflow succeeded. Do not use as a readiness probe. |
| Saved Opportunities | [Service](../../lib/opportunities/service.ts): session, owned saved scan/Pulse sources and validated query | Deterministic suggestions from retained records; no provider call. Latest canonical Opportunities rendering was observed, but this does not prove fresh scanning, all source availability or persisted new drafts. Empty evidence and failed reads stay distinct. |
| Native Improve generation | [Generator](../../lib/agents/generate.ts): session/ownership, recommendation+platform entitlement, retained actionable scan, selected native producer, CAS claim and allowance recheck | At most one bounded provider request per claimed intent, then saved grounded drafts. Unknown started outcomes cannot automatically retry. Producer selection, current allowances, provider completion and production persistence are unknown here. |
| Grounded Fix Pack | [POST fix](../../app/api/fix/route.ts): session, eligible public/owned scan, bounded public evidence and shared AI-tool allowance | Current path uses no model, but fetches website evidence; changed packs consume allowance and attempt best-effort cache persistence. A new stored owned pack may enqueue metered billing/Stripe reporting. 200 means review-draft bytes, **not a persistence receipt**. Allowance/billing/provider-reporting state is unknown. |
| User Pulse collection | [Runs service](<../../app/api/dashboard/clients/[clientId]/pulse-runs/route.ts>), [access](../../lib/pulse/runs/user-access.ts), [availability](../../lib/pulse/runs/availability.ts): session, active owned brand, platform entitlement; POST additionally requires attempts flag and explicit intent | Start/resume persists work and schedules wake; 202 is accepted work, not collected answers. Paused/model/prompt/context/quota/existing-run states are separate. No current worker tick, collection, classification or complete week was verified for this audit. |
| Machine Pulse producer | [Cron driver](../../app/api/cron/pulse/route.ts) and [producer](../../app/api/pulse/run/route.ts): cron identity, active brand/account and runtime platform access | Attempts flag selects ledger versus compatibility producer; flag-off is **not** a blanket machine-collection kill switch. Model calls and persistence are possible. Configured schedules and historical ticks do not prove present execution; no schedule or provider was activated here. |
| Saved-answer repair | [Repair](../../lib/pulse/runs/saved-repair.ts): authorized saved run/context, bounded IDs and journal | Explicit run-backed repair may work while collection is paused. It does not recollect answers, but classification may call a model; literal-absence and summary-only replay paths can avoid that call. No production repair or current classification completeness is inferred. |
| Stored scan/monthly reports | [Report service](../../lib/reports/service.ts), [monthly service](../../lib/monthly-report/service.ts): session, resolved report entitlement, owned source/month/branding; publication needs valid share configuration | Draft/save/publish are writes and publication changes exposure. Optional AI wording can spend and return honest fallback; wording does not create missing evidence. Current source population, signing/binding configuration, actual publication and operator acceptance are unknown. |
| Manual delivery and package export | [Delivery service](../../lib/delivery/service.ts): session-derived account/actor, owned approved exact version/hash and operation-specific capabilities | Export GET appends its audit receipt before returning bytes. Export is not applied delivery. Attest/withdraw are writes; manual provenance remains `self_reported`. No populated production approval/export/delivery was exercised by the latest canonical cohort. |
| Developer handoff/live check | [Handoff service](../../lib/site-edit/handoff-service.ts): latest approved spec, recorded approving actor, site-edit entitlement/cap, verified domain and executor configuration | Send persists signed dispatch; receipt is executor claim. Live check fetches website bytes and persists verification only if its predicate passes. Executor/grants/current capacity/verified completion are unknown; no send, receipt simulation or live check was performed here. |
| Stored outcomes | [Projector](../../lib/outcomes/sources.ts) and [policy](../../lib/outcomes/evaluate.ts): owned member/version/hash, validated delivery history and retained source data | V1 has independent timing/comparability limits. V2 is explicitly unsupported by the current projector; review/export support does not imply outcome support. The approved next backend/UI releases address this gap without generating new observations. |

## Dated evidence, not a fresh business probe

| Evidence and date | Established result | Limit |
| --- | --- | --- |
| [PR267 CI run 43574323793](https://github.com/YNWAforever/aiso/actions/runs/43574323793), 2026-11-14 | All ten jobs; 9,219 unit, 432 combined integration (247 regular +185 exact-target), 2,618 browser; zero CI skips/flaky/unexpected | These are the recorded release results, not tests rerun for this ledger. Controlled providers and disposable SQL are not production provider/customer execution. |
| [PR267 release](https://github.com/YNWAforever/aiso/pull/267#issuecomment-6874734189), merged 2026-11-14T08:37:45Z | Candidate/tested/actual trees equal; actual SHA above is production Ready; build records all 107 shipped migrations at 08:37:56.928Z and completes 08:38:15.092Z on that UTC date | Migration-ledger/build evidence is not an external tool, call-audit or provider-health probe. A successful build does not exercise lazy auth/database runtime paths. |
| Canonical guarded reads, 2026-11-14T08:42:30.993Z, same release receipt | 52 views: 48 Today/Tasks/Opportunities locale/theme/width combinations with clear axe/reflow, plus four localized noindex missing-review views; six screenshots inspected; stable exact alias | All 16 Tasks views empty, saved-work continuation not populated; four missing-review responses streamed HTTP 200. No production draft/review/delivery persistence or actual outcome follow-up is inferred. |
| Canonical request guard, same timestamp | Zero page errors, unsafe/non-read forwards, redirects, unexpected reads, read failures or WebSockets; 375 prefetches and 68 background requests deliberately aborted | Normal session renewal/Pulse polling was not verified. An aborted background request is not successful business activity. Export/ROI/mint/MCP paths were not forwarded. |
| Actual-component preview and local checks, recorded in PR267 receipt | Real Node factory/freezer, shared controlled actors, 44 browser cases, 307 fixtures/29 renderers; local 9,204 unit passed +15 existing Windows skips; all 21 preview artifact/source hashes match tested packets | Closed memory transport, finite supported revisions, sample actor switching and local Arial/platform CJK fallback; no real sign-in, arbitrary freeze, provider, persistence, package download or exact Inter proof. |
| Human SME acceptance | No actual observations supplied; blank script/template prepared | Proposed four-of-five objective remains pending; no participant frequency, usability outcome or business uplift is claimed. |

The [saved SQL tests](../../__tests__/conversation-studio/saved-sql.test.ts) exercise
real loader SQL in PGlite while forbidding fetch. MCP
[transport](../../__tests__/api/mcp-transport.test.ts) and
[executor](../../__tests__/conversation-studio/mcp-execute.test.ts) tests mock important
services, including the opportunities seam; they do not close the bearer/session
caveat. The release's separate disposable integration layer proves the named test
scope, not current customer data or external credentials.

## Source findings to triage

These are source-only findings reviewed 2026-11-14, not participant observations or
newly executed production failures. They do not authorize a code/authority change.

| Finding | Evidence | Next decision |
| --- | --- | --- |
| Saved/context skill can issue external reads, while the execution preview omits DataForSEO | [UI dispatch](../../components/dashboard/ConversationStudio.tsx), [preview model](../../lib/conversation-studio/execution-preview.ts) | Review upfront action/provenance/cost wording before a provider-enabled pilot; actual spend and user misunderstanding are not observed here. |
| MCP opportunities retains a browser-session dependency | Executor → Studio loader → session service, linked above | Add a properly isolated bearer-only contract witness before claiming all registered tools usable; any principal/authority implementation change needs its own reviewed scope. |
| Studio rollout policies differ by endpoint | [LIVE](../../lib/conversation-studio/live.ts), [GSC route](<../../app/api/dashboard/clients/[clientId]/studio/search-console/route.ts>), [Drive route](<../../app/api/dashboard/clients/[clientId]/studio/exports/google-docs/route.ts>) | Confirm intended per-path policy; do not infer a tenant bypass or silently expand/restrict authority. |
| Some comments describe older slices or runtime state | Skill registry future-action copy; AI-tool guard says every call is OpenRouter; old scheduling/schema notes | Current callees and dated release receipts take precedence for this ledger. Docs-only corrections do not change provider, billing, flag or security behavior. |

Configuration/runtime [readiness reports](../runbooks/runtime-readiness.md) remain
report-only (`enforced:false`, `productionReady:false`). Their identity/config/DB/
auth/origin checks do not run business workloads. A pass is not permission to mint
credentials or activate a service. Additional evidence needs an exact target,
account/brand, action, workload and observed-at timestamp; retain unknown, unavailable
and not-due states without manufacturing records.

Use the [trial script](sme-activation-usability.md),
[blank observations/triage](sme-activation-observations.md) and
[approved development milestone](sme-outcome-workflow.md) for next work. Human feedback
prioritizes further Chat/MCP/Skill navigation changes; the confirmed V2 outcome gap
can proceed in parallel. No source-only finding in this ledger is counted as a
successful human trial.
