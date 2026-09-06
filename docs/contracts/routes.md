# Route contract

Frozen from base plan §9, 2026-08-31. This is the authoritative route parity matrix for
Phase 2+ work — changes require a plan amendment, not a silent edit here.

## Reconciliation

- Manifest A (aiso filesystem routes): 21 pages + `robots.ts`/`sitemap.ts`/`opengraph-image.tsx`/`not-found.tsx`
- Manifest B (aiso API routes): 48 files, 57 method+path combinations (detail: plan §12.1)
- Manifest C (donor virtual routes): 120 canonical URLs (66 public × 2 locales + 54 workspace),
  30 exact legacy redirects, 1 temporary redirect, 8 localised legacy capabilities,
  4 localised route aliases, 4 legacy workspace section families, 2 worker-level 410 responses
- **This matrix: 53 rows — 32 donor public families + 21 workspace families**, counted
  directly against the table below on 2026-08-31. The base plan's own §9.1 reconciliation
  prose states "49 rows — 33 donor public families + 16 workspace families," which does not
  match the §9.2 table as committed; this is a pre-existing internal inconsistency in the base
  plan (recorded as D15 in its changelog), not an error introduced by this transcription.
  Locale variants collapse into one row per family (public families × 2 locales; workspace
  families → their concrete URLs), both accounted for by the family rows, not double-counted.
  Redirects live in the "Redirect/compatibility rule" column, not as separate rows.
- Intentional exclusions: `/result/demo-scan` (aliased, no independent page),
  `/platform/search-visibility` (alias only), `/handoff` (donor states it is not exposed), the
  5 concrete demo entity ids (fixture data, not routes).

## Parity matrix

Target actions: `reuse` · `restyle` · `port-onto-data` · `adapter` · `new-api` · `new-schema` · `redirect` · `fixture-only` · `defer` · `retire`.

| Surface | Donor route | Donor component | Existing `aiso` route | Existing API/service | Gate | Current data source | Target action | Redirect / compatibility | Phase | Acceptance test |
|---|---|---|---|---|---|---|---|---|---|---|
| Home | `/{loc}` | `HomePage` | `app/[lang]/page.tsx` | `POST /api/scan` | public | live | port-onto-data | none | 2 | E2E home + scan submit, both locales |
| Platform overview | `/{loc}/platform` | `PlatformOverview` | — | — | public | static | new page (restyle) | none | 2 | Playwright render + axe |
| Search intelligence | `/{loc}/platform/search-intelligence` | `CapabilityPage` | — | — | public | static | new page | `/platform/search-visibility` → 308 | 2 | render + redirect assert |
| Site health (public) | `/{loc}/platform/site-health` | `CapabilityPage` | — | — | public | static | new page | `/foundation` → 308 | 2 | render + redirect |
| Demand intelligence | `/{loc}/platform/demand-intelligence` | `CapabilityPage` | — | — | public | static | new page | `/answer-readiness` → 308 | 2 | render + redirect |
| Brand/product discovery | `/{loc}/platform/brand-product-discovery` | `CapabilityPage` | — | — | public | static | new page | none | 2 | render |
| AI visibility (public) | `/{loc}/platform/ai-visibility` | `CapabilityPage` | — | — | public | static | new page | `/citation-readiness`, `/ai-pulse` → 308 | 2 | render + 2 redirects |
| Action Studio (public) | `/{loc}/platform/action-studio` | `CapabilityPage` | — | — | public | static | new page | none | 2 | render |
| Governed agents | `/{loc}/platform/governed-agents` | `GovernedAgentsPage` | — | — | public | static | new page — **label Planned** | none | 2 | render + release-state assert |
| Proof (public) | `/{loc}/platform/proof` | `CapabilityPage` | — | — | public | static | new page | none | 2 | render |
| Solutions index | `/{loc}/solutions` | `SolutionsOverview` | — | — | public | static | new page | none | 2 | render |
| Solutions: SME | `/{loc}/solutions/sme` | `SolutionPage` | — | — | public | static | new page | none | 2 | render |
| Solutions: agencies | `/{loc}/solutions/agencies` | `SolutionPage` | — | — | public | static | new page | none | 2 | render |
| Solutions: enterprise | `/{loc}/solutions/enterprise` | `SolutionPage` | — | — | public | static | new page | none | 2 | render |
| Solutions: regulated | `/{loc}/solutions/regulated-industries` | `SolutionPage` | — | — | public | static | new page | none | 2 | render |
| How it works | `/{loc}/how-it-works` | `HowItWorks` | — | — | public | static | new page | `/how-it-works` → localised | 2 | render |
| Scan | `/{loc}/scan` | `ScanJourney` | home form (`components/home/ScanForm.tsx`) | `POST /api/scan` | public + rate limit | live | port-onto-data | `/scan` → localised | 3 | E2E scan, 429 path, error states |
| Result | `/{loc}/result/demo` | `ScanResult` | `app/[lang]/result/[id]` | `lib/result-access.ts` | public/signed | live | port-onto-data | `/result/demo-scan` → `/result/demo`; keep `/result/[id]` | 3 | legacy result renders; deep link |
| Discover | `/{loc}/discover` | `DiscoveryJourney` | — | **none** | public | fixture | fixture-only → defer | none | 5 | fixture labelled Demo |
| Entity profile (public) | `/{loc}/discover/hk/harbour-brew-one` | `PublicEntityProfile` | — | **none** | public | fixture | defer — needs ownership verification policy | none | 5+ | blocked until §18 policy |
| Sample report | `/{loc}/sample-report` | `SampleReportPage` | `app/[lang]/r/[slug]` | `lib/reports/public.ts` | signed | live | port-onto-data | `/r/demo` → 307 **temporary** (revocable) | 4 | revoked/expired states |
| Resources | `/{loc}/resources` | `ResourcesPage` | — | — | public | static | new page | none | 2 | render |
| Integrations (public) | `/{loc}/integrations` | `IntegrationsPage` | — | — | public | static | new page — **release states** | `/integrations` → workspace | 2 | release-state assert |
| Methodology | `/{loc}/methodology` | `MethodologyPage` | — | — | public | static | **new page — required by §13** | none | 3 | weights/version published |
| Security | `/{loc}/security` | `TrustPage` | — | — | public | static | new page | none | 2 | render |
| Trust | `/{loc}/trust` | `TrustPage` | — | `lib/product-facts.ts` | public | mixed | port-onto-data | none | 2 | runtime truth, not copy |
| Pricing | `/{loc}/pricing` | `PricingPage` | `app/[lang]/pricing` | `lib/plans/catalog.ts` | public | live | restyle **only** | `/pricing` → `/en/pricing` (exists) | 2 | prices from catalog, not markup |
| Privacy | `/{loc}/privacy` | `LegalSummary` | — | — | public | static | new page — **legal sign-off** | none | 2 | approved copy only |
| Terms | `/{loc}/terms` | `LegalSummary` | — | — | public | static | new page — **legal sign-off** | none | 2 | approved copy only |
| Contact | `/{loc}/contact` | `ContactHandoffPage` | — | — | public | static | new page | none | 2 | render |
| Login | `/{loc}/auth/login` | `LoginPage` | `app/[lang]/auth/login` | `/api/auth/[...path]` | public | live | restyle only | `/auth/login` → `/en/auth/login` (exists) | 4 | magic-link + verifier/challenge paths |
| Demo launcher | `/{loc}/demo` | `DemoLauncher` | — | — | public | fixture | fixture-only, **non-production** | none | — | must not ship to prod routes |
| Workspace home | `/dashboard/demo` | `OutcomeHome` | `app/[lang]/dashboard/[clientId]` | `/api/clients/[clientId]/overview` | auth+own | live | port-onto-data | `/dashboard` → `/{loc}/dashboard` | 4 | ownership + cross-account denial |
| Demand | `…/demand` | `DemandWorkspace` | `…/[clientId]/prompts` | prompts API | auth+ent+own | live | port-onto-data | `prompts` → `demand` | 4 | read/write entitlement asymmetry |
| Entity portfolio | `…/entities` | `EntityPortfolio` | — | **none** | auth | fixture | new-schema | none | 5 | tenant isolation |
| Entity overview | `…/entities/[id]/overview` | `EntityOverview` | — | none | auth | fixture | new-schema | none | 5 | isolation |
| Entity questions | `…/questions` | `QuestionWorkspace` | `prompt_bank` (partial) | prompts API | auth+ent | partial | adapter + extend | none | 5 | isolation |
| Entity evidence | `…/evidence` | `ObservationWorkspace` | — | none | auth | fixture | new-schema | none | 5 | provenance labelling |
| Entity sources | `…/sources` | `SourceWorkspace` | — | none | auth | fixture | new-schema | none | 5 | isolation |
| Entity pages | `…/pages` | `PageTruthWorkspace` | — | none | auth | fixture | new-schema | none | 5 | isolation |
| Entity actions | `…/actions` | `OpportunityBoard` | `agents/recommendations` | agents API | auth+ent+own | partial | adapter | none | 5 | entitlement |
| Entity history | `…/history` | `EntityHistory` | `scans` history | overview API | auth+own | partial | adapter | none | 5 | comparison signature |
| Search visibility | `…/search` | `SearchVisibility` | — | none | auth | fixture | defer — needs GSC | none | 6 | blocked on integration |
| AI visibility | `…/ai-visibility` | `AIVisibility` | `app/[lang]/pulse/[clientId]` | pulse APIs | auth+ent+own | live (empty in prod) | port-onto-data | `/pulse` → `ai-visibility` | 4 | empty-state is first-class |
| Site health | `…/site-health` | `SiteHealth` | `…/result/[scanId]` | scan/result | auth+own | live | port-onto-data | none | 4 | evidence states |
| Opportunities | `…/opportunities` | `OpportunityBoard` | `agents/recommendations` | agents API | auth+ent+own | partial | adapter | `/opportunities` → dashboard | 5 | prioritisation evidence |
| Actions | `…/actions` | `ActionStudio` | `/api/fix/*` | fix APIs | auth+own | partial | adapter + new-schema | `/fixes`, `/actions` → dashboard | 5 | draft-only enforced |
| Approvals | `…/approvals` | `ApprovalsWorkspace` | — | none | auth+role | fixture | new-schema | none | 5 | approver identity audited |
| Proof | `…/proof` | `ProofWorkspace` | reports | reports service | auth+ent+own | partial | adapter | `/result` → `proof` | 5 | outcome windows |
| Reports | `…/reports` | `ProofWorkspace` | `…/[clientId]/reports` | reports service | auth+ent+own | live | port-onto-data | `/reports` → dashboard | 4 | publish/revoke/rotate |
| Integrations (ws) | `…/integrations` | `IntegrationSettings` | — | none | auth | fixture | new-schema | `/integrations` → dashboard | 6 | release states |
| Settings | `…/settings` | `GovernanceWorkspace` | `[lang]/dashboard/settings` | clients/branding | auth+own | live | port-onto-data | `/dashboard/settings` → `/{loc}/dashboard/settings` | 4 | branding ownership |
| Agency portfolio | `/dashboard/portfolio` | `AgencyPortfolio` | `[lang]/dashboard` | `/api/dashboard/clients` | auth | live | port-onto-data | none | 4 | server-enforced isolation |

**`aiso` routes with no donor counterpart** — all `reuse` unchanged unless noted: `/{loc}/onboarding` (restyle, Phase 4), `/{loc}/auth/{logout,complete,google}` (reuse — `AuthComplete` is load-bearing), `/{loc}/admin/authority` (reuse), `/admin` (reuse, stays outside `[lang]`), `app/robots.ts` / `app/sitemap.ts` (**must be revised in Phase 2** — new public routes need sitemap entries and the donor's blanket `noindex` must not leak).

**Undocumented behaviours to preserve or replace deliberately:** donor `worker/index.ts` returns HTTP **410** for `/r/revoked` and `/r/expired` with a bilingual body disclosing no report content. `aiso` has `app/[lang]/r/[slug]/not-found.tsx`. Decide explicitly whether a revoked report is 404 or 410 — 410 is the more honest signal and is already the donor's choice.

## C9a amendment — 2026-09-06

New private entity page: /[lang]/dashboard/[clientId]/entities. New GET/PUT /api/clients/[clientId]/entity. Both require independent authentication and owned client lookup; no public route or cross-tenant admin bypass. GET is read-only; PUT uses the approved revisioned entity contract. Entity absence is distinct from an unavailable database/missing migration. Existing routes and aliases are unchanged.
