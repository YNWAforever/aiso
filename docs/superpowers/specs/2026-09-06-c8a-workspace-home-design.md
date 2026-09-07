# C8a — Workspace outcome home design for review

Status: approved by user 2026-09-06. Local implementation authorized; C7 checkpoint d72ca72 remains separate.

## Recommended behavior

Add an outcome home as the default owned-client dashboard view. Preserve all explicit `?step=scan/results/improve/monitor/roi` links and clientId identifiers. The home shows actual persisted site-health diagnostics, latest observed Pulse data, permitted generated recommendations and links to existing tools. It makes no delivery, attributed-outcome or verified-entity claims.

Use a server-only owned-workspace loader and a pure `lib/view-models/workspace-home.ts` projection. The page and overview API retain their own authentication/ownership guards and response semantics. Keep existing service DTO fields compatible for entitled callers; redact unavailable paid agent fields at the server boundary. No new database table, provider request or write is required for this home.

## Mapping and corrections supported by source inspection

- Client identity: `clients` by id AND account_id; keep brand_name/domain/industry and status.
- Site health: latest owned scans by created_at descending; selected scanId must belong to the current client/account. An invalid explicit scanId never falls back to another client or scan. Use stored C7 diagnostics without fabricating comparison.
- History: latest ten owned scans; pass persisted score/grade/time only.
- Pulse: select the actual newest available week, then its aggregate/platform observations. The current ascending LIMIT40 query can omit recent history; add a >40-row regression and deterministic latest-week selection. No aggregate or no successful denominator yields unavailable, never 0% visibility.
- Recommendations: existing generated `agent_recommendations`/progress/competitor records, projected through `resolveCommercialEntitlement`; nothing is labelled delivered or published. API checks must match the existing permission rules rather than relying on hidden UI panels.
- Status: show observation timestamps. No stale threshold is approved, so freshness remains unknown rather than inventing an expiry period. An unavailable optional panel shows a localized load-error state; owned-client/auth failures retain whole-page fail-closed behavior. Do not report failed notification/Pulse retrieval as measured zero.
- Local Trust/ROI remains a link. Do not call potentially writing `getOrCreateLocalTrustSnapshot()` during a read-only home load.

## Files and tests

Map before implementation: `app/[lang]/dashboard/[clientId]/page.tsx`, `app/api/clients/[clientId]/overview/route.ts`, relevant `components/dashboard/**`, new `lib/view-models/workspace-home.ts` and bounded server loader, `docs/contracts/fields.md`, localized catalogs. Keep dashboard layout authentication and API authentication independent.

Regression requirements: actual account/client query parameter binding; non-owner404/anonymous401; invalid selected scan isolation; entitlement filtering on API and page; newest Pulse among >40 historical rows; missing/zero-success observations; per-panel errors; no write during home load; explicit old step links; bilingual mobile/desktop accessibility. No blanket feature flag disables existing functionality.

## Rollback and remaining decisions

Rollback only the new home routing/UI and adapter projection after review; preserve established routes and source records. The recommended choices to approve are default-home navigation, timestamp/unknown freshness, localized per-panel failures, and server-enforced existing entitlement projection. A conservative alternative is an opt-in Home tab preserving the old default; it reduces navigation change but hides the new primary view.

C8b–g still need their specific field mappings/designs. C9 requires entity-verification and approval/delivery contracts; C10 needs selected provider/connector ownership decisions; C11 needs named operators, target environment, canary/recovery evidence and separately approved operations. None are represented as completed by C7 or this design.