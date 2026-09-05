# C8c–g guarded workspace completion design

Status: approved by user 2026-09-06. Local implementation authorized. C8a and C8b are implemented and independently verified locally. This design does not claim C9–C11 implementation or authorize external operations.

## Recommended execution

Approve this existing-feature adaptation batch once, then execute C8c, C8d, C8e, C8f and C8g as separate locally tested, independently reviewed diffs without reopening settled choices. Checkpoint the exact reviewed C8b manifest first and preserve the original continuation plan. Each slice gets a field/query-to-DTO mapping and an implementation checklist before editing; no new schema is required by this batch.

Use existing services and narrow view adapters where their DTO differs from presentation. Alternatives are (1) a broad workspace rewrite, which risks duplicating guards and completed shell work, or (2) leaving unavailable routes and inconsistent states intact while only changing styles. Neither is recommended.

## C8c — Prompt demand and observed AI visibility

Confirmed seams: lib/prompts/guard.ts, categories.ts, existing prompt-bank routes/editor, components/dashboard/MonitorStep.tsx, existing SovChart/MissedTable, lib/pulse/observed-summary.ts and the owned workspace read layer. The current app/[lang]/pulse/[clientId]/page.tsx is an unavailable placeholder.

Restore that Pulse page as an authenticated owned-client read view using requireAuth plus an explicit account/client lookup. Keep existing URLs and the dashboard Monitor link. No publicly accessible customer Pulse report is introduced. Keep prompt reading available to authenticated owners and writing restricted by edit_prompts, with entitlement-before-ownership on writes and ownership fused into mutation SQL. Preserve category compatibility and MAX_PROMPTS.

Align Monitor/Pulse KPI and chart availability with C8a/b: latest observed week, validated usable denominator and matching summary, absent/error distinct from measured zero, explicit observation dates and unknown freshness. A chart gap stays unavailable rather than being connected through a fabricated zero. Expose only required prompt/platform/question/observation fields; no provider credentials or arbitrary raw answers. Preserve existing prompt/run mutations, but do not execute them against real accounts/providers during this work.

Tests: actual route/page guards and query binding, read/write asymmetry, quota/category compatibility, newest raw-only week, platform and aggregate gaps, failed queries, bilingual component rendering and browser accessibility.

## C8d — Generated work and Fix Packs

Use app/api/fix/**, existing agent routes, components/dashboard/ImproveStep.tsx and the reachable Fix Pack/content-tool presentation. Verify reachability before adapting components; do not restore orphaned or fenced features by removing guards.

Keep generated recommendations, fixes and content labelled drafts/suggestions. Display pending, unavailable, generation failure and persistence failure honestly; successful copy/export does not mean website publication. Preserve existing ownership, entitlement/platform filters, request/response fields and provider/cost boundaries. Improve keyboard labels, feedback and retry handling only where an observed reachable flow needs them. No new publishing or approval lifecycle is added here.

Tests: owned versus foreign scan/client, denied tiers/platform data, malformed/non-2xx responses, failed persistence, copy failure, pending/retry and no published-success claims. Provider calls and writes are mocked.

## C8e — Existing report lifecycle and synthetic sample

Use lib/reports/**, dashboard report list/editor/branding, app/[lang]/r/[slug] and existing lifecycle APIs. Preserve immutable snapshots, comparability rules, signed versioned share access, public DTO projection, revoke/rotate behavior, private error handling and response/security headers. No replacement sharing scheme.

Add app/[lang]/(marketing)/sample-report/page.tsx using explicit synthetic static data, with visible sample labels in both locales. It must not create report rows, increment customer report counters or call provider/report mutations. Reuse safe report presentation where practical, keeping the static sample distinct from live report resolution. Add distinct localized metadata, exact sitemap/NAV activation, and the frozen temporary /r/demo redirect only after the destination exists; preserve all other URL policy.

Tests: existing snapshot/publish/revoke/rotate contracts and failures, tenant guards and public allowlist, sample provenance, no database/provider calls on sample rendering, metadata/sitemap/redirect coverage and bilingual browser checks. Lifecycle operations run only through mocks/local fixtures.

## C8f — Local Trust and alerts

Use lib/localTrust/**, components/dashboard/local-trust/** and existing alerts/notification routes. Preserve auth→entitlement→ownership ordering, scoped stores, established deduplication and feature-specific export/competitor permissions. C8a notification unknown-count work remains completed.

Make existing empty/failed/unavailable data visible without inventing ROI, attributed outcomes or verified proof. Keep getOrCreateLocalTrustSnapshot confined to the established explicit ROI flow; do not introduce it into read-only home/portfolio/Pulse views. Audit the existing interactive error/disabled/retry states and repair demonstrated accessibility/truthfulness defects. No scheduler changes, real alert evaluation, email or customer mutation is performed.

Tests: gate order and denied-query absence, tenant filters, no-data and failures, unchanged deduplication contracts, CSV/export permissions and bilingual rendering/accessibility.

## C8g — Settings, billing, onboarding and agency navigation

The existing settings page uses the real catalogue/resolver but contains English-only plan/billing copy and a default-active display fallback. Localize its presentation and use an explicit unknown state for missing status. Preserve existing Stripe portal/checkout routes and report-branding service boundaries.

Retain C3 onboarding and C8a/b shell/portfolio work; adapt only remaining demonstrated accessibility or status gaps. No new agency/team roles, price changes, admin authority or entitlement model. Trial, cancellation, past-due and overrides remain governed by resolveCommercialEntitlement.

Tests: actual guarded settings/page props, catalogue/entitlement cases, missing account state, billing-link behavior without contacting Stripe, localized labels, focus/keyboard and mobile layout. Mocked authenticated component acceptance is local evidence; real Auth/signup/billing acceptance remains separately gated and must not be marked passed without execution.

## Common verification and rollback

For each slice: failing focused regression before behavior repair, source and permission review, focused tests and an exact rollback diff. Once stable: complete local units, source lint, installed Next type generation, standalone TypeScript, isolated default production build and configured bilingual mobile/desktop light/dark browser checks. Read installed Next16 guides before framework code. Report mocked SQL/Auth/provider evidence explicitly.

No live database, production/environment/credential/provider mutation, migration, real email/paid scan, customer write, deployment, push or merge is authorized by this design. Preserve API call sites and public DTO/security behavior. No blanket flag disables existing product behavior. Rollback each source slice independently; no data migration is introduced.

## C9–C11 continuation and material gates

C9 is new product work. Prepare exact local subcontracts for entities/aliases, observation provenance, opportunities, immutable change sets, approvals, delivery attestations and outcome windows after these adapters. Before implementing public verified entity claims, decide ownership verification. Before new approval roles, decide who may approve. Before outcomes, define acceptable delivery evidence and distinguish observation from attribution. Do not infer these policy decisions from UI fixtures.

C10 local work can inventory automation/provider/auth/billing boundaries and add justified deterministic failure tests. A new connector needs a selected provider, scopes and ownership contract; legacy token/role obligations require operator confirmation without retrieving secrets. No scheduler/credential/remote settings change follows automatically.

C11 can prepare a commit-specific readiness matrix, exact target/diff/validation/rollback proposals and evidence collection instructions. Named owners, target environment, canary, write fences and recovery evidence are material inputs. Cutover, migrations, restores and live sends remain unexecuted until separately authorized. Missing live proof is a release gate, not a reason to leave independent local C8 work unfinished.
