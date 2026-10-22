# Fimmick AISO — Phase 0 UX inventory (read-only)

Repo working tree, 2026-10-22. Nothing was edited. "Inferred" marks conclusions drawn from code reading rather than from running the app.

---

## 1. Route inventory

### 1.1 Layouts and boundary files

| File | Role |
|---|---|
| `app/layout.tsx` | Root html/body |
| `app/[lang]/layout.tsx` | Validates locale (`notFound()` on unknown, :15/:22), `NextIntlClientProvider` |
| `app/[lang]/(marketing)/layout.tsx` | `SiteHeader` + `<main id="main">` + `SiteFooter` |
| `app/[lang]/(marketing)/pricing/layout.tsx` | Metadata only (page is `'use client'`) |
| `app/[lang]/dashboard/layout.tsx` | `requireAuth` (:22), `TrialBanner`, `DashboardSidebar`, header row with `NotificationBell` only |
| `app/admin/layout.tsx` | `requireAdmin()` (:6), dark admin nav (“Super Admin”, “Back to Dashboard” hard-coded `/en/dashboard`) |
| `app/[lang]/error.tsx` | **The only error boundary.** `StatusPage` with `retry` (correct for Next 16 per `node_modules/next/dist/docs/.../error.md:117`) |
| `app/not-found.tsx` | Single app-wide 404 with marketing chrome |
| `app/[lang]/r/[slug]/not-found.tsx` | Only segment-level 404 |
| `app/[lang]/dashboard/[clientId]/reports/loading.tsx` | **The only `loading.tsx`** (skeleton; covers reports, reports/new, reports/[reportId]) |

No `app/error.tsx` / `global-error.tsx` → `app/admin/**` and `app/page.tsx` have no custom error boundary (Next default). Because the single error boundary sits at `[lang]`, a thrown error in any dashboard page replaces the **whole dashboard layout** (sidebar disappears) with a marketing-style 500 page (inferred from Next boundary semantics).

### 1.2 Pages (55 = 54 under `[lang]`/`admin` + `app/page.tsx`)

Legend — Auth: P = public, RA = `requireAuth` (layout + page), RA* = layout only / page uses a service that redirects, GP = `getProfile` + redirect, AD = `requireAdmin`. Boundaries column lists only *segment-specific* files; everything under `[lang]` inherits `[lang]/error.tsx` and root `not-found.tsx`.

#### Root / marketing (`app/[lang]/(marketing)/**`, all public, all inside marketing layout)

| URL | Purpose | Main components | Notes |
|---|---|---|---|
| `/` (`app/page.tsx`) | Redirect to `/en` | — | `redirect('/en')` (:6) |
| `/{lang}` | Landing page with hero scan form | `ScanForm` ×2 (:105, :280) | `#scan` and `#scan-again` anchors (:88, :273) |
| `/{lang}/scan` | Standalone scan form | `ScanForm` (:21) | Duplicates landing form |
| `/{lang}/pricing` | Plans, comparison table, FAQ, checkout | inline (`'use client'`, 421 lines) | own `layout.tsx` for metadata |
| `/{lang}/sample-report` | Static example report | `reports/SampleReport` | also target of `/r/demo` redirect (`next.config.ts:26-27`) |
| `/{lang}/methodology` | Scoring methodology prose | inline sections | only marketing page not on the shared template |
| `/{lang}/platform` | Platform overview | `PublicInformationPage` | |
| `/{lang}/platform/site-health` | Website readiness checks | `PublicInformationPage` | |
| `/{lang}/platform/search-intelligence` | Search foundation from findings | `PublicInformationPage` | |
| `/{lang}/platform/demand-intelligence` | Question bank / prompts | `PublicInformationPage` | |
| `/{lang}/platform/brand-product-discovery` | **Planned** brand/product info | `PublicInformationPage planned` | “not available today” |
| `/{lang}/platform/ai-visibility` | Pulse sampled AI answers | `PublicInformationPage` | |
| `/{lang}/platform/action-studio` | Fix tools → editable fixes | `PublicInformationPage` | |
| `/{lang}/platform/governed-agents` | **Planned** governed agent workflow | `PublicInformationPage planned` | “not available today” |
| `/{lang}/platform/proof` | Reports & evidence scrutiny | `PublicInformationPage` | |
| `/{lang}/solutions` | Solutions index | `PublicInformationPage` | |
| `/{lang}/solutions/sme` | SME audience | `PublicInformationPage` | |
| `/{lang}/solutions/agencies` | Agency audience | `PublicInformationPage` | |
| `/{lang}/solutions/enterprise` | Enterprise audience | `PublicInformationPage` | |
| `/{lang}/solutions/regulated-industries` | Regulated audience | `PublicInformationPage` | |
| `/{lang}/how-it-works` | Scan→review→change→check | `PublicInformationPage` | |
| `/{lang}/integrations` | External services list | `PublicInformationPage` | |
| `/{lang}/resources` | Guides index | `PublicInformationPage` | |
| `/{lang}/security` | Controls overview | `PublicInformationPage` | |
| `/{lang}/trust` | Measurement vs claim | `PublicInformationPage` | |
| `/{lang}/contact` | “Talk to your Fimmick contact” | `PublicInformationPage` | **no form, email or link** — copy says use “your existing Fimmick contact” |

#### Auth / onboarding / public result

| URL | Purpose | Auth | Components | Boundaries |
|---|---|---|---|---|
| `/{lang}/auth/login` | Magic link + Google sign-in | P | `LoginForm` (:110) | none |
| `/{lang}/auth/google` | Google popup bridge | P | `GoogleAuthStart` | none |
| `/{lang}/auth/complete` | Client-side session exchange | P | `AuthComplete` | none |
| `/{lang}/auth/logout` | Sign out (client page) | P | inline | none |
| `/{lang}/onboarding` | 4-step brand setup wizard | GP (:21-24) | `OnboardingWizard` | none; outside dashboard layout (no sidebar) |
| `/{lang}/result/[id]` | Public scan result (+OG image) | P (owner sees full) | `ResultClient` | none; **outside marketing layout** — own nav in `ResultClient.tsx:231` |
| `/{lang}/r/[slug]` | Published client report | P (signed link) | inline (328 lines) | `not-found.tsx` |
| `/{lang}/admin/authority` | “Unavailable” stub | **P (no gate)** | inline | none — harmless stub but a dead localised admin URL |
| `/{lang}/audit-fixture-error` | E2E error-boundary fixture | P, 404 unless `E2E_FIXTURE_MODE=1` (:9) | inline | — |

#### Dashboard (`app/[lang]/dashboard/**`, layout `requireAuth`)

| URL | Purpose | Page auth | Main components | Error/empty handling in page |
|---|---|---|---|---|
| `/{lang}/dashboard` | Portfolio of brands | RA (:25) | `PortfolioView`, `AddBrandWizard` (just a link), `BrandCard`, `RecentScans`, `ActivationProgress` | try/catch → inline error (:29-31); empty brands card |
| `/{lang}/dashboard/settings` | Plan, members, branding, Google | RA (:25) | `SettingsView`, `MembersPanel`, `ReportBrandingForm`, `GoogleConnectionsPanel` | partial try (:47) |
| `/{lang}/dashboard/[clientId]` (`?step=home`) | Workspace home | RA (:97) | `WorkspaceHome` | try → inline error (:104-108) |
| `…?step=scan` | Run scan + history | RA | `ScanStep` | shared try → inline error (:261-267) |
| `…?step=results` | Score summary for scan | RA | `ResultsStep` → `ScanSummary` → `ScoreRing`, `PillarScoreCards` | empty card (:303-307) |
| `…?step=improve` | AI recommendations (agents) | RA | `ImproveStep`, `AgentSection`, `AgentRecommendations/Progress/Competitors`, `LockedFeature` | empty card (:319-323) |
| `…?step=monitor` | Pulse visibility + alerts | RA | `MonitorStep` → `ObservedPulseView`, `AlertsTab`, `LockedFeature` | try → inline error (:116-118) |
| `…?step=roi` | Local Trust / ROI | RA | `LocalTrustStep` (+ 8 local-trust components) | shared try |
| `…?step=<anything else>` | — | RA | `StepHeader` falls back to Scan copy (:61) but **no body renders** | blank page (bug, inferred) |
| `/{lang}/dashboard/[clientId]/result/[scanId]` | Full scan result + **Fix Pack** | RA (:47) | `ScoreRing`, `ExpandableCheckItem`, `FixPackClient` | try → inline error |
| `/{lang}/dashboard/[clientId]/entities` | Brand identity + domain verification | RA* via `loadAuthenticatedEntityPage` (:28-33) | `EntityEditor`, `DomainVerificationPanel` | error + retry link (:39-50) |
| `/{lang}/dashboard/[clientId]/opportunities` | Evidence → save drafts | RA (:17) | `OpportunityWorkspace` → `GroupedOpportunityCards`, `EvidenceDetails`, `DraftEditor` | `initialError` + alert (:41-48) |
| `/{lang}/dashboard/[clientId]/observations` | Recorded Pulse answers | RA (:25) | `ObservationWorkspace`, `ObservationDetail`, `RunTroubleshooting` | handled |
| `/{lang}/dashboard/[clientId]/sources` | “Approved facts” source packs | RA (:36) | `SourcePackWorkspace` | `loadFailed` prop |
| `/{lang}/dashboard/[clientId]/prompts` | Question bank | RA (:42) | `QuestionBankSection` → `PromptBankEditor`, `SuggestQuestionsPanel`, `PromptBulkPanel` | **no try/catch** → throws to `[lang]/error.tsx`; Pro lock card (:61-77) |
| `/{lang}/dashboard/[clientId]/competitors` | Declared competitors | RA (:28) | `CompetitorsEditor` | **no try/catch** (:30-35) |
| `/{lang}/dashboard/[clientId]/citations` | Cited sources in AI answers | RA (:27) | `CitationExplorer` | catch → **bare unstyled `<main><p>` with hard-coded EN/ZH strings** (:34-35) |
| `/{lang}/dashboard/[clientId]/assets` | “Registered pages” + Search Console | RA (:35) | `AssetConvergenceView`, `SearchConsolePanel` | **no try/catch** (:37-43) |
| `/{lang}/dashboard/[clientId]/reports` | Client reports list | RA (:59) | `ReportsList` | lock card, empty card; `loading.tsx` |
| `/{lang}/dashboard/[clientId]/reports/new` | Build report from scan | RA (:31) | `ReportBuilder` | lock/empty cards; `loading.tsx` |
| `/{lang}/dashboard/[clientId]/reports/[reportId]` | Edit/publish report | RA (:21) | `ReportBuilder` → `ReportPreview`, `ReportStatusBadge` | `notFound()` on many states; `loading.tsx` |
| `/{lang}/dashboard/[clientId]/work-items/[workItemId]/versions` | Version review/approve/deliver/outcomes | RA (:17) | `VersionWorkspace` → `VersionDetails`, `DecisionForm`, `DeliveryWorkspace`, `OutcomeWorkspace` | redirects/404 (:24-47) |
| `/{lang}/pulse/[clientId]` | Standalone Pulse + share of voice | RA (:13) | `ObservedPulseView`, `ShareOfVoiceBenchmark` | inline error; **outside dashboard layout — no sidebar** |

#### Admin (`app/admin/**`, unlocalised, layout `requireAdmin`)

| URL | Purpose | Components |
|---|---|---|
| `/admin` | Account directory + schema health | `AdminDirectory`, `SchemaHealthPanel` (page re-calls `requireAdmin`, :17) |
| `/admin/billing` | Plan overrides (client page, hard-coded English) | `AccountRow`, `OverrideControls` — relies on layout gate only |
| `/admin/accounts/[accountId]/approvers` | Approver grants | `ApproverAccessWorkspace` (:14 `requireAdmin`) |

#### Boundary coverage gaps
- `loading.tsx`: 1 of 55 pages’ segments has one (reports). **All other dashboard pages are dynamic server renders with no loading UI** — navigation shows nothing until the server responds (inferred).
- `error.tsx`: only `[lang]`. No dashboard-scoped boundary (error drops the sidebar), none for admin or root.
- `not-found.tsx`: only root and `r/[slug]`. Dashboard 404s (`notFound()` used ~30 times) render the marketing 404 *without* dashboard chrome.

### 1.3 Navigation

**Dashboard sidebar** — `components/dashboard/DashboardSidebar.tsx` (278 lines)
- “Workflow” group, `STEPS` (:18-25): Home, Scan, Results, Improve, Monitor, ROI → all `?step=` on one page (6 items).
- “Tools” group (:139-225), only when a brand is in the route: Brand identity (`/entities`), Opportunities, Observations, Approved facts (`/sources`), Question Bank (`/prompts`, “Pro” pill), Competitors, Cited sources (`/citations`) (7 items).
- Footer: theme toggle, plan badge → Manage plan (`/dashboard/settings`), Admin (if admin), Sign out.
- **13 primary nav items + 3 utility.** Not in nav: `/assets` (no inbound link anywhere in the app — URL-only), `/reports` (reached by a banner on step pages, `[clientId]/page.tsx:285-296`, and Home tool grid), `/result/[scanId]` (via `RecentScans`, onboarding), `/pulse/[clientId]` (via Monitor/prompts links), work-item versions (via `DraftEditor.tsx:117`).
- `WorkspaceHome.tsx:115` renders a second tool grid (scan/results/improve/monitor/roi/reports/prompts) duplicating the sidebar.
- Active state: steps highlight by `?step`; tool entries use `pathname`; the dashboard header row contains **only** the notification bell — no breadcrumb, page title or brand switcher (brand chip comment in layout :26-33 explains why it never rendered).

**Marketing header/footer** — single source `lib/navigation.ts` `NAV` (:36-73); consumed by `components/marketing/SiteHeader.tsx` (78 lines) and `SiteFooter.tsx` (110 lines).
- Top: Home, Pricing, Scan, Sample report (Demo `available:false`).
- Platform (9), Solutions (5), Company (7 available: how-it-works, methodology, integrations, resources, security, trust, contact). `discover`, `privacy`, `terms` are `available:false` → **no privacy policy or terms pages exist** despite collecting emails and taking payments.
- Header desktop nav only at `xl` breakpoint (`hidden … xl:flex`), grouped sections via `<details>` dropdowns; “Get started” → `/{lang}#scan`; Sign in; locale switch.
- Result page (`/result/[id]`) and `/r/[slug]`, `/onboarding`, `/auth/*` do **not** use this chrome.

---

## 2. Feature overlap map

### 2.1 Concepts → where they surface

| Concept | UI surface | Type | API |
|---|---|---|---|
| Scan / score | `/`, `/scan` (anon), `?step=scan` (dashboard) | form | `POST /api/scan` |
| Result | `/result/[id]` (public/owner), `?step=results` (summary), `/dashboard/[clientId]/result/[scanId]` (full + Fix Pack) | **3 views** | — |
| Fix Pack (llms.txt, robots, FAQ JSON-LD) | only `/dashboard/[clientId]/result/[scanId]` (`FixPackClient`) | section | `POST /api/fix` (sign-in, 20/day, not persisted — “storageNotice”) |
| Content tools | **no UI** | — | `fix/cluster-map`, `fix/content-brief`, `fix/rewrite-chunks` (no component calls them) |
| Improve / agents | `?step=improve` (`ImproveStep`) | step | `clients/[id]/agents/{generate,recommendations,progress,competitors}` |
| Opportunities | `/opportunities` | page | `clients/[id]/opportunities` |
| Work items (drafts) | inline `DraftEditor` inside Opportunities | embedded | `clients/[id]/work-items[/…]`, `…/groups`, `…/operations` |
| Versions / change-sets | `/work-items/[id]/versions` (`components/change-sets/*`) | page | `…/versions[/versionId]` |
| Approvals (decision) | `DecisionForm` inside versions page | embedded | `…/versions/[v]/decision` |
| Approver grants | `/admin/accounts/[id]/approvers` | admin page | `admin/accounts/[id]/approvers` |
| Delivery | `DeliveryWorkspace` inside versions page | embedded | `…/delivery`, `…/withdraw`, `…/export` |
| Outcomes | `OutcomeWorkspace` inside versions page | embedded | `…/outcomes` |
| Observations | `/observations`; also Home coverage link, Pulse view | page | `clients/[id]/observations[/id]` |
| Pulse | `?step=monitor` **and** `/pulse/[clientId]` (both render `ObservedPulseView`) | step + page | `pulse/run`, `cron/pulse`, `dashboard/clients/[id]/pulse-runs` |
| Share of voice | only `/pulse/[clientId]` (`ShareOfVoiceBenchmark`) — though Monitor’s nav description says “AI share of voice tracking” | section | `dashboard/clients/[id]/share-of-voice` |
| Prompts / question bank | `/prompts` (Pro to edit) | page | `dashboard/clients/[id]/prompts[/bulk]`, `pulse/suggest-questions` |
| Competitors | `/competitors` (declared list) + Improve “competitors” (agent-derived, Enterprise) + Local Trust competitor snapshot + SoV benchmark | **4 places, 2 data sources** | `dashboard/clients/[id]/competitors` vs `clients/[id]/agents/competitors` |
| Citations | `/citations` (“Cited sources”) | page | `dashboard/clients/[id]/citations` |
| Sources | `/sources` (“Approved facts”) | page | `clients/[id]/sources[/…]/approve` |
| Entities | `/entities` (“Brand identity”) | page | `clients/[id]/entity`, `domain-verification` |
| Assets | `/assets` (“Registered pages” + Search Console) — **unlinked** | page | `dashboard/clients/[id]/assets[/declarations]`, `search-console` |
| Reports | `/reports`, `/reports/new`, `/reports/[id]`; public `/r/[slug]`; static `/sample-report` | pages | `client-reports/*`, `clients/[id]/reports`, `report-branding`, `public/client-reports/*` |
| Local Trust / ROI | `?step=roi` | step | `dashboard/clients/[id]/local-trust/*` |
| Alerts / notifications | `AlertsTab` in Monitor (Pro), `NotificationBell` in header | embedded | `dashboard/clients/[id]/alerts`, `notifications/*`, `cron/evaluate-alerts` |

### 2.2 Redundancies and confusing duplicates
1. **Three result views** for one scan: `/result/[id]` (public, gated breakdown), `?step=results` (summary only, no Fix Pack link — `ResultsStep.tsx` links only to Improve/Scan), `/dashboard/[clientId]/result/[scanId]` (full + Fix Pack). Each uses different score widgets (`ScoreReveal` vs `ScoreRing`+`PillarScoreCards`). Scan-in-dashboard (`ScanStep.tsx:69`) lands on `?step=results`, so the Fix Pack page is only reachable via `RecentScans` or onboarding.
2. **Pulse twice**: `?step=monitor` (ObservedPulseView + Alerts) vs `/pulse/[clientId]` (ObservedPulseView + Share of Voice, no sidebar). Monitor links to the latter as “full” (`MonitorStep.tsx:15`).
3. **Three “improvement” producers with different names**: Fix Pack (`/api/fix`), Improve/agents (`agents/generate`), Opportunities → work-item drafts. Plus three content-tool APIs with no UI. Marketing calls this “Action Studio”.
4. **Naming collisions**: “Sources” route = “Approved facts” label; “Citations” route = “Cited sources” label; “Assets” = “Registered pages”; “Entities” = “Brand identity”; “Prompts” = “Question Bank”; Monitor = Pulse = “Observed AI visibility”. Users see “sources” twice with different meanings.
5. **Governance chain hidden**: work item → version → decision (approval) → delivery → outcome all live on one deep page reached only from a draft in Opportunities; no list of work items or pending approvals anywhere in nav.
6. **Report rendering duplicated**: `r/[slug]/page.tsx` re-implements `ReportPreview.tsx` layout (score/grade/delta blocks ~identical, e.g. r/[slug]:229-246 vs ReportPreview:146-160) with its own hard-coded copy object (:24-60) rather than next-intl. `sample-report` is a third static rendering (`SampleReport.tsx`).
7. **Two API namespaces** for brand data: `/api/clients/[clientId]/*` and `/api/dashboard/clients/[clientId]/*`.
8. **Scan form ×3**: landing hero, landing bottom, `/scan`; dashboard has its own `ScanStep`.
9. Workflow steps vs tool pages are mixed paradigms: 6 query-string steps on one page + 8 sub-routes; `onSubRoute` hack in sidebar (:66) exists to stop wrong highlighting.

### 2.3 Marketing platform/solutions mapping

| Page | Claims | Maps to product surface |
|---|---|---|
| platform/site-health | crawl/structured/readiness | Scan + result |
| platform/search-intelligence | search foundation | Scan findings (no distinct feature) |
| platform/demand-intelligence | question bank | `/prompts` |
| platform/brand-product-discovery | **planned** | (partly `/entities`, `/sources`) |
| platform/ai-visibility | Pulse samples | Monitor / `/pulse` / `/observations` |
| platform/action-studio | Fix tools | Fix Pack, Improve, Opportunities |
| platform/governed-agents | **planned** | (work-item approvals exist but marketed as planned) |
| platform/proof | reports | `/reports`, `/r/[slug]` |
| solutions/{sme,agencies,enterprise,regulated-industries} | audience copy | no audience-specific product |

All 20 info pages (9 platform, 5 solutions, 6 company) share one template (`PublicInformationPage`: title, summary, 3 actions, evidence, limitations, related links) — content is copy-only, no screenshots/visuals (inferred from component).

---

## 3. components/ inventory

| Dir | Files | Purpose |
|---|---|---|
| `components/` (root) | 5 | `ScoreRing`, `PillarScoreCards`, `ExpandableCheckItem`, `FixPackClient`, `FixPackBlock` |
| `admin/` | 4 | Account rows, directory, overrides, schema health |
| `approvals/` | 1 | `ApproverAccessWorkspace` (313 lines) |
| `auth/` | 4 | Login, Google bridge, AuthComplete, SessionRefresh |
| `change-sets/` | 3 | Version review + decision |
| `dashboard/` | 26 | Shell, steps, portfolio, editors, notifications |
| `dashboard/local-trust/` | 9 | ROI/Local Trust step |
| `delivery/` | 3 | Manual delivery attestation |
| `entities/` | 2 | Entity editor, domain verification |
| `home/` | 1 | `ScanForm` |
| `integrations/` | 2 | Google connections, Search Console (386 lines) |
| `marketing/` | 4 | Header, footer, info template, StatusPage |
| `observations/` | 4 (3 tsx + copy.ts) | Observation list/detail |
| `onboarding/` | 2 | `OnboardingWizard` (506 lines), `BrandAssistant` |
| `opportunities/` | 3 | Workspace (438), cards, evidence |
| `outcomes/` | 2 | Outcome windows |
| `pulse/` | 16 | Pulse views, prompt bank, SoV, alerts (7 orphaned) |
| `reports/` | 6 | Builder (545), preview, list, branding, badge, sample |
| `result/` | 12 | Public result page pieces |
| `sources/` | 1 | `SourcePackWorkspace` (467) |
| `ui/` | 6 | shadcn: badge, button, card, input, label, separator |
| `work-items/` | 2 | `DraftEditor`, `WorkOperationsPanel` |
| `workspace/` | 1 | `MaintenanceNextSteps` |

**Total ≈ 120 files.** Several very large client components (ReportBuilder 545, OnboardingWizard 506, SourcePackWorkspace 467, OpportunityWorkspace 438, SearchConsolePanel 386, ResultClient 377).

**shadcn/ui is barely used**: only 13 files import from `components/ui/` (button ×12, card ×7, input ×4, badge ×2, label ×1); `separator.tsx` has **zero** importers. Most components hand-roll Tailwind buttons/cards/pills.

**Duplicated primitives**
- Score display: `ScoreRing` (dashboard), `result/ScoreReveal` (public), `dashboard/local-trust/LocalTrustScorePanel`, hand-rolled `{score} / 100` in `SampleReport`, `RecentScans`, `WorkspaceHome:108`, `r/[slug]:233`, `ReportPreview:152`.
- Locked/upsell: `dashboard/LockedFeature`, `result/LockedPreview`, `local-trust/LocalTrustLockedPreview`, plus inline lock `Card`s in prompts/reports/reports-new pages, `AddBrandWizard` limit card. `ImproveStep.tsx:136` says recommendations need “Pro” while `lib/plans/catalog.ts` grants `agent_recs` to Basic.
- Badges/pills: `ui/badge`, `reports/ReportStatusBadge`, `DeepGeoSection` local `TierBadge` (:118), inline status pills in `ResultClient.tsx:273-277,292-301`, “Pro” pill in sidebar.
- Two colour systems: `dash-*` tokens (dashboard steps, result/[scanId]) vs `muted/card/border` tokens (tool pages, Pulse, portfolio) — tool pages and steps look different inside the same shell (inferred from class names).
- i18n inconsistency: `useTranslations` vs direct `import en from '@/messages/en.json'` (PortfolioView, MonitorStep, pulse page, SampleReport, RecentScans) vs hard-coded copy objects (`ResultClient` ui :95/:115, `AccountUnlockCard`, `OnboardingWizard` COPY_EN/ZH, `r/[slug]`, citations error, `/admin/billing`, `result/[scanId]` “← Back to Results” / “Improve with AI agents →” at :390/:398).

**Orphaned components** — `__tests__/components/orphaned-components.test.ts:21-33` lists **7** (CLAUDE.md still says 11 — stale): `pulse/MissedTable`, `pulse/ScanLogSection`, `pulse/CompetitorTab`, `dashboard/PulseTabs`, `pulse/CompetitorChart`, `pulse/QuestionRow`, `pulse/PlatformBar`. All are the old Pulse read surface.

---

## 4. Journeys (from code)

### 4.1 Anonymous landing → first score
1. Land on `/{lang}` — URL input is in the hero (`page.tsx:105`), “no signup / no card” proof chips (:107-109).
2. Type URL (industry/region optional behind an expander, `ScanForm.tsx:94`).
3. Click Scan → synchronous `POST /api/scan` (`ScanForm.tsx:123`; up to 60 s `maxDuration`) with status text only (no progress steps).
4. Auto-redirect to `/{lang}/result/{id}` (`ScanForm.tsx:149`) showing score, grade, top issue, platform teaser.

**≈2 interactions, 1 wait, no email gate before the score.** Header “Get started” and every info page CTA go to `/#scan`, not `/scan`.

### 4.2 Score → full breakdown → first fix
The “email gate” is the account gate on the *full breakdown*: anonymous viewers get `ImpactTeaser` + `LockedPreview` + `AccountUnlockCard` (`ResultClient.tsx:358-365`). Full checks render only when `scan.account_id === profile.account_id` (`result/[id]/page.tsx:113-114`).

Path (inferred click count):
1. On result: enter work email → magic link (or Google popup) (`AccountUnlockCard.tsx`); claim-intent cookie set (:68).
2. Open email, click link → `/auth/complete` → back to `/result/{id}?claim=1` → `ClaimScanOnReturn` claims scan (sets `account_id` only, **no `client_id`** — `app/api/scans/[id]/claim/route.ts:19`).
3. Full breakdown visible. Click “Open your Fix Pack” → **goes to `/{lang}/dashboard` (portfolio), not to a fix** (`ResultClient.tsx:349-355`).
4. Portfolio has 0 brands → “first run” link to `/onboarding?scan={id}` (`PortfolioView.tsx`).
5. Onboarding: 4 steps. The code intends to skip to step 3 with a scan prefill, but `hasScanPrefill` requires `initialBrand`, which the page always passes as `''` (`onboarding/page.tsx:28`, `OnboardingWizard.tsx:167-168`) → **always starts at step 1** (domain is pre-filled at step 2).
6. Submit → `/dashboard/{clientId}/result/{scanId}` (`OnboardingWizard.tsx:269`).
7. Click Fix Pack CTA → `POST /api/fix`.

**≈10–12 actions incl. an email round-trip and a 4-step wizard.** Fix Pack is gated by **sign-in, not plan** (`lib/fix/guard.ts:41-55`, `paidOnly:false`), with a 20/day allowance (`guard.ts:26`). Errors are undifferentiated: any non-2xx (401, 429 limit, 503) shows the same “generation failed / retry” (`FixPackClient.tsx:36-41`). Output is not stored — reloading loses it.

### 4.3 Signup → first dashboard
`/auth/login` (magic link or Google; `LoginForm.tsx:50` default next = `/dashboard`) → email → `/auth/complete` → `/dashboard` portfolio (empty) → “first run” → onboarding 4 steps → **lands on `/dashboard/{clientId}/prompts`** (`OnboardingWizard.tsx:270-271`).

Plan context: new accounts are inserted as `plan='basic', status='active'` with no subscription (`app/api/webhooks/neon/route.ts:74-75`), which `resolveCommercialEntitlement` treats as **free** (`lib/tier.ts:135-146`) until onboarding starts a 7-day Basic trial (`lib/onboarding/store.ts:53-55`). Basic has `edit_prompts:false` (`lib/plans/catalog.ts`), so **the first screen after onboarding is the Question Bank lock card “see plans”** (`prompts/page.tsx:61-77`) — inferred as a high-friction first impression. There is no scan run automatically for a brand created without a scan.

---

## 5. Empty / loading / error states

| Surface | Empty | Loading | Error + retry |
|---|---|---|---|
| Portfolio | yes (first-run card) | none | inline message, **no retry** |
| Workspace home | via view-model states | none | inline, no retry |
| Scan step | history empty (inferred) | button state + `aria-busy` | yes |
| Results step | “no scan selected” card | none | shared inline, no retry |
| Improve | “no scan yet” card, `recs_empty` | spinner in generate button | “retry” label on error |
| Monitor / ObservedPulseView | `copy.empty` per panel | none | `copy.error` text, no retry |
| `/pulse/[clientId]` | same + SoV own error state | none | inline, no retry |
| ROI | setup form / locked preview | none | shared |
| Result `[scanId]` (dashboard) | — | none | inline load error |
| Fix Pack | — | button “generating”, `aria-busy` | generic retry |
| Entities | — | none (client saves busy) | **retry link** |
| Opportunities | yes | `aria-busy` | alert, in-component retry |
| Observations | yes | `aria-busy` | yes |
| Sources | yes | none at page | `loadFailed` banner |
| Prompts | editor empty | editors busy | **throws → global 500** |
| Competitors | editor empty | none | **throws → global 500** |
| Citations | yes (explorer) | none | **unstyled one-line text** |
| Assets | yes | none | **throws → global 500** |
| Reports list/new/[id] | yes | **skeleton (`loading.tsx`)** | lock/empty cards |
| Work-item versions | — | `aria-busy` | 404/redirect |
| Public result | collection-failed / unknown states (`ResultClient.tsx:203-214`) | none | — |
| `/r/[slug]` | not-found | none | — |

Skeletons (`animate-pulse`) exist **only** in `reports/loading.tsx`; elsewhere loading is button text/`aria-busy`. Server pages have no streaming/loading fallback.

---

## 6. Cron / Monitor

- **Committed deployable config** `cloudflare/aiso-worker/wrangler.jsonc:10`: `"crons": ["17 4 * * *", "47 7 * * 1"]` (Pulse daily, alerts Monday), `APP_BASE_URL=https://aiso-kappa.vercel.app` (:9), `workers_dev:false`. Legacy `cloudflare/cron-worker/wrangler.jsonc:16-20` still lists 3 incl. `0 9 * * *` (never to be deployed).
- **Runbook** `docs/runbooks/deploy-cron-worker.md:5`: “no live deployment or scheduled receipt follows from this code”; :24 activation steps are “preparation until … approved”.
- **Latest recorded deployed state** (`docs/remediation/2026-10-13/release-checklist.md:25`): Worker `aiso-cron-worker` version `a3f46e65…` at 100%, **only `47 7 * * 1` (weekly alerts); Pulse daily trigger absent.** `release-operations.md:3`: “Keep Pulse paused.” Earlier readback (2026-10-03, `docs/runbooks/aiso-runtime-evidence.md:40`) had schedules `[]`.
- So the committed config (2 crons) ≠ the last documented deployed config (1 cron). CLAUDE.md’s “deployable config enables two” describes source, not production.
- **UX implication (inferred):** Pulse is not scheduled in production, so Monitor, `/pulse/[clientId]`, Observations, Citations, Share of Voice, and Workspace Home visibility will typically show empty/unknown states for real users; alerts evaluate weekly against a rollup that Pulse is not producing. CLAUDE.md also records `prompt_bank` empty in production (2026-08-15), so even a scheduled Pulse would select no client until a brand has active prompts — and editing prompts is Pro-only.
