# Fimmick AISO Pro Client Report Workflow Design

**Date:** 2026-07-21
**Status:** Approved in conversation; written specification pending final user review
**Primary objective:** Make Pro operationally valuable to agencies by turning an owned scan into a reviewed, branded, revocable client report without exposing workspace data.

## 1. Context

Phase 0 established one commercial source of truth for Basic, Pro, and Enterprise. The plan catalog, Stripe checkout, webhook mapping, runtime entitlements, brand limits, scan quotas, and bilingual pricing now agree. The remaining commercial gap is delivery: a Pro subscriber can run scans and review dashboard evidence, but cannot yet turn that work into a controlled client-facing artifact.

The existing application already provides the required raw materials:

- account-scoped profiles and commercial entitlements;
- account-owned clients with brand and domain data;
- stored scan results, scores, grades, dates, and scan history;
- dashboard result and recommendation views;
- existing OpenRouter integration;
- English and `zh-HK` localization;
- public result pages and share UI patterns.

The existing public scan policy is not an acceptable report-security model. Reports need their own restricted tables and a server-mediated public projection. They must never expose the workspace, raw scan JSON, internal notes, account identifiers, or unpublished content.

This specification implements the first bounded slice of Phase 1B from the approved Pro and Enterprise product design. It does not implement monitoring schedules, the full Action Queue, white-label PDF, or Enterprise Custom controls.

## 2. Approved Product Decisions

- The first report is created manually from a completed scan.
- The author must review the report before publication.
- Public access uses an unlisted, revocable link and does not require the client to sign in.
- The executive summary starts from a deterministic rules-based draft.
- The author may request an AI-polished version, but AI failure never blocks delivery.
- The author may edit the summary before saving or publishing.
- Pro branding includes Agency name, Agency logo, Agency primary color, and mandatory `Powered by Fimmick AISO` attribution.
- Full white-label output remains unavailable in this phase.
- A report contains the current scan, the closest eligible previous scan, score change, material check changes, and up to five priority fixes.
- If no comparable previous scan exists, the report establishes a baseline and does not display a fabricated zero delta.
- Published content is immutable. Every edit creates a new version.
- Reports use snapshot-first storage so later scan, recommendation, localization, or branding changes cannot silently rewrite what a client was shown.
- The initial report experience is an online responsive page. Pro does not receive PDF export.

## 3. Goals and Non-Goals

### 3.1 Goals

1. Let an eligible Agency create a client-ready report from an owned scan in a short guided flow.
2. Keep externally shared claims editable, explicitly approved, versioned, and reproducible.
3. Preserve tenant isolation at every authenticated read and write.
4. Expose only a whitelisted immutable snapshot through the public route.
5. Support stable sharing, revocation, link rotation, and engagement counters without collecting client personal data.
6. Provide natural English and Hong Kong Traditional Chinese experiences.
7. Create a report architecture that can later support Enterprise white-label PDF without implementing PDF now.

### 3.2 Non-Goals

- scheduled monitoring or background scan orchestration;
- the complete Monthly Review workflow;
- a general-purpose report layout editor;
- drag-and-drop section ordering;
- PDF, CSV, email delivery, password protection, or link expiry;
- white-label removal of Fimmick attribution;
- client accounts, invitations, or client login;
- custom AI platforms, SSO, API keys, RBAC, audit-log UI, or SLA workflows;
- file upload or a new asset-storage provider;
- modifying scan scoring or recommendation generation;
- collecting viewer identity, IP address, fingerprint, or cookies for analytics.

## 4. Primary User Flows

### 4.1 Configure Agency branding

An authenticated account collaborator opens report-branding settings and configures:

- Agency display name;
- optional HTTPS logo URL;
- primary color as a validated six-digit hex value;
- optional contact CTA label;
- optional `mailto:` or HTTPS contact destination.

The preview uses Agency initials when the logo is absent or fails to load. Logo validation reuses the application's SSRF-safe public-URL boundary, accepts only PNG, JPEG, or WebP within a fixed size limit, and follows only validated public redirects. Public reports load the image through a report-authorized server proxy so a viewer does not contact an Agency-controlled host directly. Saving branding changes future drafts only. Existing report versions retain their branding URL snapshot; mutability of the remote image bytes is an accepted MVP limitation until controlled asset storage is introduced.

### 4.2 Create a report draft

1. The author opens an owned client scan result.
2. The author selects `Create client report`.
3. The server verifies authentication, effective plan, account ownership, client ownership, scan ownership, and domain match.
4. The server finds the nearest older eligible scan for the same normalized domain and account.
5. A pure snapshot builder computes the baseline or comparison model, material changes, deterministic summary, and priority fixes.
6. The author reviews branding, summary, score, delta, and fixes in the builder.
7. The author saves the draft.

Free and Basic users see a localized upgrade state. They never receive a successful draft response from the API.

### 4.3 AI-polish the summary

1. The author selects `Polish with AI`.
2. The server rebuilds the whitelisted facts from the owned scan and client rather than trusting facts submitted by the browser.
3. OpenRouter receives only the deterministic summary, score, comparison status, material changes, priority fixes, client display name, and locale.
4. The server validates the response as plain text, applies a length limit, and rejects unsupported numerical claims.
5. The polished summary returns as an editable candidate; it is not published automatically.

On timeout, provider failure, invalid output, or quota failure, the deterministic summary remains intact and the UI shows a localized non-blocking warning.

### 4.4 Preview and publish

1. The author opens the report preview rendered from the latest draft version.
2. The preview matches the public layout but remains inside authenticated dashboard navigation.
3. `Publish` atomically sets the report's published version to the latest version.
4. The server returns a reproducible signed share URL.
5. The author copies the link or opens it in a new tab.

Editing a published report creates a new draft version. The existing public link continues to show the last explicitly published version until the author publishes the update. This resolves the general product rule that externally shared statements require explicit publication.

### 4.5 Revoke, republish, and rotate

- Revocation immediately makes the public route return the neutral not-found experience.
- Revocation increments the share credential version so the old signature cannot be reused.
- Republishing a revoked report rotates the public slug and signature and publishes the latest version.
- A published report may rotate its link without changing content; the old link becomes invalid.
- Revocation does not delete versions or engagement counters.

### 4.6 Client views the report

The client opens a public link without authentication. The route validates the slug, signature, share version, publication state, and published version before returning content. The page increments engagement counters best-effort and still renders when analytics persistence fails.

The report includes an optional Agency contact CTA. The CTA uses a server redirect that validates the stored destination, increments the click counter best-effort, and then returns a redirect. The browser never supplies the redirect destination.

## 5. Report Content

Every report version contains the following client-facing fields:

- Agency name, logo URL or initials fallback, primary color, and contact CTA;
- mandatory `Powered by Fimmick AISO` attribution;
- client brand name and normalized domain;
- report locale, scan date, publication date, and evidence timestamp;
- executive summary;
- current AISO score and grade;
- comparison state: `baseline`, `comparable`, or `not_comparable`;
- previous score, score delta, and previous scan date only when comparable;
- material improvements, regressions, unchanged checks, and data gaps;
- up to five priority fixes with title, rationale, expected impact, and recommended next step;
- concise methodology and coverage notes;
- snapshot schema version.

The public payload excludes:

- account and profile identifiers;
- client and scan identifiers;
- share-credential fields;
- raw HTML;
- raw scan result JSON;
- internal notes and unpublished recommendations;
- webhook URLs;
- OpenRouter prompts or responses;
- dashboard routes and private navigation.

## 6. Comparison and Priority Logic

### 6.1 Eligible previous scan

The previous scan must:

- belong to the same account as the current scan;
- have the same normalized domain as the client and current scan;
- have `created_at` earlier than the current scan;
- contain a finite score and usable result object;
- be the nearest eligible scan by descending `created_at`.

The browser cannot choose the previous scan. If no eligible scan exists, the comparison state is `baseline`.

### 6.2 Check changes

The pure comparison function evaluates only known scan-result keys. Each key is classified as:

- improved;
- regressed;
- unchanged;
- added coverage;
- lost coverage;
- not comparable.

Missing or structurally incompatible values are data gaps, not failures and not score zero. The report never invents traffic, revenue, citations, competitor performance, or platform outcomes that are absent from stored evidence.

### 6.3 Priority fixes

Priority fixes come from server-owned evidence in this order:

1. eligible existing agent recommendations for the current scan;
2. regressed high-impact checks;
3. current failed checks;
4. current warning checks.

The builder normalizes these into a stable client-facing shape, deduplicates materially identical items, and returns at most five. Internal assignee, status, raw prompt, and model metadata are excluded.

## 7. Data Model

Migration `027_client_report_snapshots.sql` introduces three tenant-owned tables and service-only functions.

### 7.1 `account_report_branding`

| Column | Type | Rules |
|---|---|---|
| `account_id` | `uuid` | Primary key; references `accounts(id)` on delete cascade |
| `agency_name` | `text` | Required; trimmed length 1-120 |
| `logo_url` | `text` | Nullable; application accepts HTTPS only |
| `primary_color` | `text` | Required; six-digit hex; safe default |
| `contact_label` | `text` | Nullable; trimmed length 1-80 when present |
| `contact_url` | `text` | Nullable; application accepts HTTPS or `mailto:` only |
| `updated_by` | `uuid` | Nullable profile reference on delete set null |
| `created_at` | `timestamptz` | Required; defaults to `now()` |
| `updated_at` | `timestamptz` | Required; defaults to `now()` |

### 7.2 `client_reports`

| Column | Type | Rules |
|---|---|---|
| `id` | `uuid` | Primary key |
| `account_id` | `uuid` | Required tenant boundary |
| `client_id` | `uuid` | Required client boundary |
| `status` | `text` | `draft`, `published`, or `revoked` |
| `public_slug` | `text` | Unique, high-entropy, server-generated |
| `share_version` | `integer` | Positive; increments on revoke or rotation |
| `latest_version_id` | `uuid` | Latest saved version |
| `published_version_id` | `uuid` | Last explicitly published version; nullable |
| `view_count` | `bigint` | Non-negative; defaults to zero |
| `cta_click_count` | `bigint` | Non-negative; defaults to zero |
| `first_viewed_at` | `timestamptz` | Nullable |
| `last_viewed_at` | `timestamptz` | Nullable |
| `published_at` | `timestamptz` | Nullable |
| `revoked_at` | `timestamptz` | Nullable |
| `created_by` | `uuid` | Nullable profile reference on delete set null |
| `created_at` | `timestamptz` | Required |
| `updated_at` | `timestamptz` | Required |

The `(id, account_id, client_id)` tuple is unique so child and RPC checks can enforce the full tenant boundary. A report belongs to exactly one client for its lifetime.

### 7.3 `client_report_versions`

| Column | Type | Rules |
|---|---|---|
| `id` | `uuid` | Primary key |
| `report_id` | `uuid` | Required; references report on delete cascade |
| `account_id` | `uuid` | Required; must match parent report |
| `client_id` | `uuid` | Required; must match parent report |
| `version_number` | `integer` | Positive; unique within report |
| `source_scan_id` | `uuid` | Nullable FK on delete set null; snapshot survives source deletion |
| `previous_scan_id` | `uuid` | Nullable FK on delete set null |
| `locale` | `text` | `en` or `zh-HK` |
| `executive_summary` | `text` | Required; normalized plain text with length limit |
| `snapshot_schema_version` | `integer` | Required; starts at `1` |
| `snapshot` | `jsonb` | Required immutable public projection |
| `created_by` | `uuid` | Nullable profile reference on delete set null |
| `created_at` | `timestamptz` | Required |

The unique constraint on `(report_id, version_number)` and an account-scoped advisory transaction lock prevent duplicate version numbers under concurrent saves.

### 7.4 Share credentials

The public URL contains `public_slug`, `share_version`, and an HMAC signature generated with a dedicated server-only `REPORT_SHARE_SECRET`. The signature covers the slug and share version. The database stores no raw bearer secret.

This detailed design supersedes the earlier generic requirement to hash stored share tokens: the implementation avoids persisting a token entirely while retaining high entropy, reproducibility, rotation, and revocation. `REPORT_SHARE_SECRET` is required in preview and production and must be approved and configured before deployment.

## 8. Database Functions and Access Control

Migration 027 includes narrowly scoped service-only functions:

- create a report plus initial version atomically;
- append a report version with an advisory lock;
- publish the latest version;
- revoke and invalidate a share credential;
- rotate the share credential;
- increment view counters;
- increment CTA click counters.

The functions validate parent and child account/client tuples before mutation. Execution is revoked from `public`, `anon`, and `authenticated`; only the server service path may call them after application-level ownership and entitlement checks.

RLS is enabled on all three tables:

- account collaborators may read and manage branding for their account;
- account collaborators may read their reports and versions;
- no public SELECT policy exists for reports or versions;
- public rendering always passes through the server route and returns a DTO built from the published snapshot;
- service-role access is not treated as authorization; every authenticated API validates account and client ownership before service queries.

## 9. Application Boundaries

### 9.1 Domain modules

- `lib/reports/types.ts` defines versioned snapshot, branding, comparison, priority-fix, public DTO, and API types.
- `lib/reports/snapshot.ts` contains pure, deterministic snapshot construction.
- `lib/reports/comparison.ts` contains domain normalization and comparison logic.
- `lib/reports/summary.ts` builds the deterministic localized summary.
- `lib/reports/share.ts` creates and validates signed links; it is server-only.
- `lib/reports/store.ts` owns tenant-safe database reads and RPC calls; it is server-only.
- `lib/reports/ai.ts` builds the whitelisted AI prompt and validates the candidate response; it is server-only.

No UI component independently calculates entitlement, comparison, signature, or public payload fields.

### 9.2 Authenticated APIs

- `GET/PUT /api/report-branding`
- `GET /api/clients/[clientId]/reports`
- `POST /api/clients/[clientId]/reports`
- `POST /api/client-reports/[reportId]/versions`
- `POST /api/client-reports/[reportId]/ai-summary`
- `POST /api/client-reports/[reportId]/publish`
- `POST /api/client-reports/[reportId]/revoke`
- `POST /api/client-reports/[reportId]/rotate-link`

Create/version requests accept identifiers, locale, and editable summary only. The server rebuilds snapshot facts and branding from owned records. The browser cannot submit score, delta, fixes, share state, counters, or snapshot JSON.

### 9.3 Public routes

- `GET /[lang]/r/[slug]?v=<shareVersion>&s=<signature>` renders the report.
- `GET /api/public/client-reports/[slug]/contact?v=<shareVersion>&s=<signature>` increments the CTA counter and redirects to the stored snapshot destination.
- `GET /api/public/client-reports/[slug]/logo?v=<shareVersion>&s=<signature>` proxies the validated report logo with a size limit, strict image content types, and bounded cache headers.

Invalid, revoked, unpublished, mismatched, or stale links return the same neutral 404 experience. The public page sets `noindex, nofollow`, avoids private navigation, and does not expose different errors that reveal report state.

## 10. User Interface

### 10.1 Entry points

- Add `Create client report` to an eligible dashboard scan result.
- Add a Reports section to the client dashboard.
- Add Report branding to account settings.

The report action is visible but upgrade-gated for Free and Basic. Server enforcement remains authoritative.

### 10.2 Three-step builder

1. **Compose** — scan identity, Agency branding, deterministic summary, editable summary, and AI-polish action.
2. **Review** — public-layout preview with score, comparison, changes, priority fixes, methodology, and CTA.
3. **Publish** — publish update, copy/open link, engagement summary, revoke, and rotate controls.

The builder warns about unsaved changes. AI loading does not disable manual editing. Publication uses a confirmation step that identifies whether the author is publishing a first version or updating an existing public report.

### 10.3 Reports list

Each report row shows:

- client and source domain;
- draft, published, published-with-unpublished-changes, or revoked state;
- latest and published version numbers;
- published date;
- view count and CTA click count;
- first and last viewed times;
- open, edit, copy link, rotate, and revoke actions as applicable.

Empty, loading, partial-data, unavailable, and upgrade states use localized recovery actions. Missing engagement data is shown as unavailable, not zero, when the read fails.

### 10.4 Public layout

The report is mobile-first and print-friendly. It uses semantic headings, a single main landmark, accessible score and change labels, non-color status indicators, contained overflow for wide evidence, and minimum 44px interactive targets. It must render at 375px without document-level horizontal overflow.

Pro reports do not display a PDF download action. They always display `Powered by Fimmick AISO` regardless of Agency color or logo.

## 11. Entitlement and Commercial Truth

The plan catalog gains an available online client-report capability for Pro and Enterprise. Free and Basic remain false. Enterprise inherits the powered report in this phase; white-label mode and PDF stay planned for the later Enterprise release.

The server resolves effective entitlement for every create, version, AI, publish, revoke, and rotate operation. Past-due, cancelled, malformed, or service-failure states fail closed. Reading existing private drafts after downgrade may be allowed for data portability, but gated mutation and public publication are disabled. Already published reports become unavailable after the paid entitlement ends; historical versions remain stored.

Pricing copy may change the Pro online-report row from `Coming soon` to available only after migration, server enforcement, public-route security, browser verification, and production smoke checks pass.

## 12. AI Safety and Reliability

The AI input is a compact structured fact set, never raw HTML or the entire scan result. The prompt instructs the model to:

- preserve every number exactly;
- avoid claims about traffic, revenue, ranking, citation, or competitor outcomes not present in facts;
- avoid promises about product capabilities;
- write concise business language in the requested locale;
- return plain text only;
- remain within the configured character limit.

The server validates required numeric strings against the source fact set and rejects a response that introduces unsupported score-like numbers. The initial release performs one provider attempt within a bounded timeout and does not automatically retry expensive requests. A rejected or failed candidate returns a stable error code and the deterministic summary.

Logs include a correlation ID, report ID, operation, duration, and failure class. They exclude share URLs, signatures, summary content, client content, and model output.

## 13. Error Handling

| Scenario | Required behavior |
|---|---|
| User is unauthenticated | 401 API response; localized login continuation in UI |
| Plan is ineligible | 403 stable upgrade code; no report mutation |
| Entitlement lookup fails | 503 service-unavailable code; not an upgrade prompt |
| Client is not owned | Neutral 404 |
| Scan is not owned | Neutral 404 |
| Scan domain does not match client | 409 stable domain-mismatch code with recovery guidance |
| Previous scan is unavailable | Create a baseline report |
| Previous scan is structurally incompatible | Mark comparison `not_comparable` and explain the coverage gap |
| AI provider or validation fails | Preserve deterministic summary; show retry/manual-edit option |
| Concurrent version saves | Serialize per report; produce distinct monotonic versions |
| Publication fails | Keep latest draft; do not expose partial content |
| Public signature is invalid or stale | Neutral 404 |
| Report is revoked or entitlement is no longer active | Neutral 404 |
| View/click analytics write fails | Render or redirect normally; log sanitized failure |
| Contact URL is invalid | Hide CTA in snapshot and block redirect |
| Logo URL is private, oversized, or has an invalid content type | Reject the branding update with a localized validation error |
| Logo proxy fails after publication | Render Agency initials fallback; do not expose the upstream URL to the viewer |

All user-facing errors have English and `zh-HK` messages, accessible announcements, and a recovery action when one exists.

## 14. Localization and Accessibility

- All authenticated and public report copy has exact key parity in `en` and `zh-HK`.
- Hong Kong copy uses concise business language rather than literal translation.
- Agency and client names, domains, grades, and product names are not translated.
- Dates and numbers use the report locale.
- The deterministic summary is generated from locale-specific templates rather than translating an English paragraph after construction.
- Builder steps, dialogs, tabs, copy-link feedback, AI status, publication status, and errors are keyboard accessible.
- Status is never communicated by color alone.
- Async AI and publish states use live announcements without stealing focus.
- Primary-color customization is checked against report backgrounds; unsafe colors fall back to an accessible system color.

## 15. Engagement and Product Measurement

The report record stores aggregate engagement only:

- total successful public views;
- first successful view time;
- last successful view time;
- total successful Agency contact CTA clicks.

No viewer identifier, IP, user agent, cookie, or fingerprint is stored. Bot filtering and unique-view analytics are out of scope. The counters are directional engagement signals, not audited audience measurement.

Stable operational events are emitted best-effort:

- `report_draft_created`;
- `report_ai_polish_requested`;
- `report_ai_polish_failed`;
- `report_version_created`;
- `report_published`;
- `report_opened`;
- `report_contact_clicked`;
- `report_link_rotated`;
- `report_revoked`.

Analytics failures never change the operational response.

## 16. Testing Strategy

### 16.1 Unit tests

- domain normalization and domain-match edge cases;
- eligible previous-scan selection;
- baseline, comparable, and not-comparable states;
- check-state changes and data-gap handling;
- priority ordering, normalization, deduplication, and five-item cap;
- deterministic English and `zh-HK` summaries;
- public DTO allowlist;
- share-signature generation, validation, version invalidation, and constant-time comparison;
- AI prompt allowlist and unsupported-number rejection;
- branding validation and accessible-color fallback.

### 16.2 API and store tests

- authentication and effective-plan enforcement;
- account, client, scan, and report isolation;
- domain mismatch;
- browser-submitted commercial facts are ignored;
- atomic initial creation and concurrent version saves;
- published version remains stable while a newer draft exists;
- explicit publish update;
- revoke, republish, and link rotation;
- downgrade makes public access unavailable without deleting versions;
- AI timeout, provider error, invalid output, and deterministic fallback;
- engagement failure does not block public render or CTA redirect.

### 16.3 Migration contracts

- table and column constraints;
- composite tenant foreign keys;
- unique version numbers;
- no public report/version SELECT policy;
- service-only function execution;
- counter functions cannot mutate content;
- existing migrations 001-026 remain immutable.

### 16.4 Browser verification

Run English and `zh-HK` at 375px and 1440px for:

- branding settings and initials fallback;
- first report draft from a baseline scan;
- comparable scan with positive and negative changes;
- deterministic summary and AI failure fallback;
- manual edit, preview, first publish, and copy link;
- public report content and mandatory Fimmick attribution;
- creating a new draft without changing the public version;
- publishing the update;
- engagement counters;
- rotate and revoke behavior;
- contact CTA redirect;
- keyboard flow, live announcements, target sizes, console errors, and overflow.

### 16.5 Release gates

- focused report tests;
- full Vitest suite;
- TypeScript no-emit;
- ESLint with zero errors;
- production build using local non-secret placeholders;
- migration lint and production migration dry-run where available;
- final diff and secret scan;
- preview deployment smoke test;
- explicit approval before production migration 027 and `REPORT_SHARE_SECRET` configuration;
- production report create/publish/view/revoke smoke test after deployment.

## 17. Rollout

1. Implement migration, domain modules, and server APIs behind the catalog capability.
2. Add builder, report list, settings, public page, localization, and browser coverage.
3. Deploy to preview with a preview-only `REPORT_SHARE_SECRET`.
4. Verify tenant isolation, downgrade behavior, signed links, and revocation.
5. Request explicit production approval for migration 027 and the new secret.
6. Apply migration before enabling production UI.
7. Deploy production, run create/publish/view/revoke smoke tests, then mark the pricing capability available.
8. Monitor report creation, AI failure, public 404, and counter-write rates.

The rollout does not delete or alter existing public scan URLs. Hardening the legacy `scans` public policy is valuable but is a separate security project unless required to unblock this report feature.

## 18. Acceptance Criteria

The phase is complete when all of the following are true:

1. An effective Pro or Enterprise user can create a report from an owned, domain-matched scan.
2. Free and Basic users cannot create, modify, publish, revoke, rotate, or AI-polish a report through direct API calls.
3. The report establishes a truthful baseline or uses the nearest eligible previous scan.
4. The author can retain the deterministic summary, edit it, or request a validated AI-polished candidate.
5. A report remains a stable immutable snapshot after later scans, branding changes, recommendation changes, or locale copy changes.
6. Editing a published report does not change public content until an explicit publish action.
7. The public link works without login, exposes only the DTO allowlist, and is excluded from search indexing.
8. Revocation and link rotation invalidate old links immediately.
9. Downgrade removes public availability and gated mutation without deleting report history.
10. Agency branding and mandatory Fimmick attribution render in both locales and at both target widths.
11. A public report never causes the viewer's browser to request the Agency logo host directly.
12. View and contact counters update without collecting viewer personal data and never block content delivery.
13. Focused tests, full tests, typecheck, lint, build, migration checks, browser verification, preview smoke tests, and production smoke tests pass with recorded evidence.

## 19. Follow-On Work

After this phase is reliable and measured, the next independent specifications may cover:

- recurring monitoring and comparison scheduling;
- the full evidence-linked Action Queue and Monthly Review;
- Enterprise white-label online reports;
- asynchronous PDF generation;
- report passwords, expiry, and scheduled delivery;
- portfolio and cross-brand reporting.

These features must reuse the immutable version and public-projection boundaries rather than creating parallel report sources of truth.
