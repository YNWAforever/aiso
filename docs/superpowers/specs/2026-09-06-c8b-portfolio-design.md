# C8b portfolio and site-health design

Status: approved by user 2026-09-06. Local implementation authorized; external operations remain excluded.

## Scope and recommendation

Continue after the verified C8a local diff. Adapt the existing /[lang]/dashboard portfolio, brand cards and recent scan history through a bounded server read model. Retain clientId, existing brand creation POST, result access guards, catalogue and entitlement semantics. No new schema or live writes are needed.

Recommended approach: one tenant-scoped portfolio loader plus a pure display adapter. It produces explicit availability states, batches latest observations, and aligns the UI quota display with the existing API. This makes the field/query contract independently testable.

Alternatives considered: patching the page inline would be smaller initially but would duplicate evidence and error semantics; calling the full C8a loader once per client would reuse code but would fetch unnecessary agent data and create an N+1 query pattern. Neither is recommended.

## Observed current behavior

- app/[lang]/dashboard/page.tsx authenticates and queries active owned clients and the latest ten owned scans. Query errors currently abort the page.
- Its Pulse query picks the most recent aggregate for each active client without checking newer raw-only weeks, usable answer counts or consistency. This can disagree with C8a's evidence rules.
- The page calculates the brand cap from active clients; POST /api/dashboard/clients counts all owned clients. The UI can therefore offer creation when the server correctly rejects it.
- RecentScans uses environment-default date formatting. BrandCard has an optional bare SoV number without observation/availability context.

## Intended behavior

The portfolio retains its current active-client list. Each card shows identity, a link to the owned home, and latest observed visibility with its week or an explicit unavailable/error state. Apply the same conservative Pulse validity rules as C8a, including newest raw-only weeks, whitespace-aware response presence and matching summary counts. Do not claim all provider attempts succeeded. Freshness remains unknown.

Keep the latest ten owned scan records, with persisted score/grade, explicit locale-aware dates and the established guarded result links. No cross-brand ranking, trend arrow or numeric improvement delta is introduced: a raw score difference does not establish comparable collection or attributed improvement. Historical diagnostic snapshots retain their stored versions.

Use a separate count of all owned clients to match the existing POST quota semantics. If that count fails, creation availability is unknown and the UI does not imply capacity; this does not change the API's independent entitlement and trigger enforcement. The authenticated active-client lookup is authoritative; its failure renders a localized portfolio load error rather than a fake empty state. Optional history/Pulse failures remain separate.

## Exact boundaries and proposed files

- New lib/workspace/load-owned-portfolio.ts: authenticated account id supplied by the page; tenant-bound tagged SQL for active clients, all-client count, latest ten scans and batched recent Pulse observations. No mutation or provider calls.
- New lib/view-models/portfolio.ts only for the narrower presentation DTO: client identity; visibility state/data/observedAt/freshness; history state; capacity known/unknown and count/limit. No arbitrary raw response text or internal account fields.
- Extract a small shared pure Pulse validity projection from lib/workspace/load-owned-workspace.ts if required; preserve C8a's response shape and tests. Batch portfolio queries instead of invoking the whole workspace loader for every card.
- Update app/[lang]/dashboard/page.tsx, components/dashboard/BrandCard.tsx and RecentScans.tsx, messages/en.json and zh-HK.json, and append the approved mapping to docs/contracts/fields.md.
- Preserve app/api/dashboard/clients/route.ts request/response and mutation behavior. Add regression coverage of its existing count/entitlement boundary; repairs beyond the portfolio discrepancy require a separately identified defect.

## Field mapping

| Presentation | Source | Boundary |
|---|---|---|
| Client identity/link | clients id,brand_name,domain,industry,status | account_id and active status |
| Creation capacity | count of all clients + resolveCommercialEntitlement | same tenant/count semantics as existing POST |
| Recent scan score/grade/date | scans persisted fields | account_id, deterministic newest ten order |
| Visibility/week | newest Pulse summary/raw-observation week | join to owned active client; same validity rules as C8a |
| Unknown/error/empty | read outcome and verified absence | never convert a failed query into zero |
| Historical diagnostics | existing owned result view | preserve result ownership and stored methodology |

## Verification and rollback

Write regressions for anonymous page rejection, actual query parameter tenancy, absence versus query failure, inactive-client quota accounting, missing count, latest raw-only Pulse week, invalid denominator/numerator, deterministic ordering, no writes and explicit locale dates. Retain C8a tests and existing client creation/result access tests. Run bilingual narrow/wide and light/dark component browser accessibility checks, complete local unit suite, lint, Next type generation, TypeScript and isolated production build. Report fixture versus real Auth/database evidence separately.

Keep the C8a reviewed patch intact and checkpoint it separately before C8b implementation. C8b rollback is its own source diff; no migration/data rollback. No push, merge, deployment, database/credential/provider operation or real customer write is implied.

## Remaining sequence

After C8b, prepare and review C8c demand/Pulse, C8d generated work, C8e report lifecycle/sample, C8f Local Trust/alerts and C8g settings/billing/agency in order. Preserve their independent service gates. C9 needs entity verification, team/approval and delivery contracts before new public claims or role semantics. C10 needs selected connector/provider ownership decisions. C11 needs named operators and exact environment/canary/cutover decisions; local readiness preparation is possible, but real operational acceptance requires separate authorization.
