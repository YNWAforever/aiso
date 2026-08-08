# Fimmick AISO Pro and Enterprise Product Design

**Date:** 2026-07-20
**Status:** Approved in conversation
**Primary objective:** Turn the existing paid-tier foundation into a recurring, sellable Agency workflow first, then extend it into a credible self-serve and sales-led Enterprise offer.

## 1. Context

Fimmick AISO already has the foundations of a paid SaaS product: Basic, Pro, and Enterprise plan identifiers; Stripe checkout and lifecycle handling; brand limits; plan-gated AI platforms; prompts; alerts; competitor-related analysis; AI Pulse history; exports; and a four-step Scan, Results, Improve, Monitor dashboard flow.

The current commercial surface is ahead of the product in several places. The pricing page promises white-label PDF reports, API access, custom AI platforms, and dedicated customer success, while the current entitlement model primarily supports platform access, recommendations, progress, alerts, brand limits, history, prompt editing, local-trust capabilities, and CSV export. Pricing, UI copy, Stripe behavior, and runtime permissions have also drifted independently.

This design resolves that gap through a vertical product strategy:

1. Complete the recurring Agency delivery loop in Pro.
2. Add standardized white-label and portfolio capabilities in self-serve Enterprise.
3. Build SSO, API, custom-platform, governance, and SLA capabilities only for Enterprise Custom demand.

## 2. Approved Commercial Decisions

- Pro primarily serves digital agencies and consultants managing client brands.
- Enterprise primarily serves larger in-house marketing and SEO teams, while remaining suitable for larger agencies.
- Pro and Enterprise are priced by workspace and brand allowance, not by user seat.
- Pro remains a self-serve subscription at the existing displayed price of $79 per month.
- Enterprise remains available as a standardized self-serve subscription starting at the existing displayed price of $199 per month.
- Enterprise Custom uses contact-sales and custom contracts.
- The configured Stripe currency remains the billing source of truth. This design does not change production currency or Stripe price amounts.
- Pro includes a shareable online client report carrying "Powered by Fimmick AISO" attribution.
- Enterprise includes white-label PDF reports.
- SSO, public API access, custom AI platforms, contractual SLA, custom quotas, and a dedicated customer success manager are Enterprise Custom capabilities.
- Delivery is Pro-first. Enterprise work starts after the Pro delivery loop is usable and measurable.

## 3. Product Packaging

| Capability | Pro ??$79/month | Enterprise ??from $199/month | Enterprise Custom |
|---|---|---|---|
| Primary buyer | Agency or consultant | Larger brand or agency | Group, multi-market brand, regulated organization |
| Tracked brands | 3 | 10 | Contract-defined |
| Collaborators | Included; no per-seat billing | Included; no per-seat billing | Contract-defined identity and roles |
| AI platform monitoring | All supported standard platforms | All supported standard platforms | Standard plus contracted custom sources |
| Monitoring cadence | Weekly automated monitoring per brand | Weekly automated monitoring per brand | Contract-defined |
| On-demand scans | Fair-use access with abuse protection | Fair-use access with abuse protection | Contract-defined quota and rate limit |
| History | 26 weeks | Account-lifetime history while subscribed | Contract-defined retention |
| Prompt bank | Editable | Editable | Editable with governance controls |
| Change intelligence | Brand and period comparison | Brand, period, and portfolio comparison | Custom comparison dimensions |
| Competitors | Concise trend summary | Full citation and Share-of-Voice benchmark | Custom competitor sets and sources |
| Action Queue | Included | Included | Included with advanced roles and auditability |
| Client report | Shareable online report with Fimmick attribution | White-label online report and PDF | Custom templates and delivery automation |
| Data export | Report-level download only | CSV and PDF | API and contracted export formats |
| Support | Standard product support | Priority product support | SLA and dedicated success manager |

"Fair use" is not implemented as a hidden marketing contradiction. The Plan Catalog exposes the actual automated cadence and protects on-demand scans with rate limits, duplicate-scan suppression, anomaly detection, and internal cost alerts. The pricing page must not claim unrestricted background processing.

## 4. Core Pro Outcome

Pro is not sold as a collection of extra buttons. It is sold as a monthly client-delivery system:

```text
Create brand
  -> configure tracked prompts and competitors
  -> run weekly monitoring
  -> compare the current and prior periods
  -> review prioritized actions
  -> add an Agency summary
  -> publish a client report
  -> repeat next month
```

The activation milestone is not merely purchasing Pro. A Pro workspace is activated when it has configured a brand, completed a scheduled monitoring cycle, reviewed at least one recommended action, and published its first client report.

## 5. Pro User Experience

### 5.1 Workspace portfolio

The localized workspace dashboard gives an Agency an operational view of all client brands:

- latest AISO score and change from the selected comparison period;
- monitoring health and last successful run;
- new alerts and open action count;
- next monthly-review date;
- latest report status;
- a primary "Start monthly review" action.

The view must support clear empty, loading, partial-data, failed-run, and upgrade states. It must never present missing data as a score of zero.

### 5.2 Brand workspace

The existing Scan, Results, Improve, Monitor flow remains. Pro adds three connected capabilities without replacing the whole navigation model:

1. **Period comparison** ??compares the latest eligible snapshot against the preceding weekly or monthly snapshot.
2. **Action Queue** ??turns evidence into accepted, assigned, completed, or skipped work.
3. **Report** ??publishes a reviewed, immutable view of the period's evidence and actions.

### 5.3 Monthly Review

Monthly Review is a focused guided flow:

1. Confirm brand and comparison period.
2. Review material improvements, regressions, and data gaps.
3. Accept, edit, or exclude proposed actions.
4. Add a concise consultant summary.
5. Preview the client-facing report.
6. Publish a new report version.

The system may draft summaries and actions with AI, but every externally shared statement remains editable and requires explicit publication by a workspace collaborator.

### 5.4 Pro report

The Pro report contains:

- report title, client brand, covered period, and publication date;
- executive summary;
- AISO score and period change;
- platform and prompt performance with explicit data coverage;
- concise competitor trend summary;
- material improvements and regressions;
- completed actions and recommended next actions;
- methodology and evidence notes;
- "Powered by Fimmick AISO" attribution.

The report is a read-only, responsive online page with a revocable share link. It does not expose private dashboard navigation, internal notes, unpublished actions, account identifiers, or gated raw data.

## 6. Enterprise Product

### 6.1 Self-serve Enterprise

Enterprise builds on the completed Pro workflow and adds standardized capabilities that can be bought without a sales-led implementation:

- up to 10 tracked brands;
- cross-brand portfolio comparison;
- full competitor citation and Share-of-Voice benchmarking;
- account-lifetime history while the Enterprise subscription remains active;
- CSV export;
- white-label settings for organization name, logo, primary color, and contact details;
- white-label online reports and generated PDFs;
- report password, expiry, and revocation controls;
- priority product support.

Workspace collaboration is included, but complex role-based access control is not part of the self-serve Enterprise release. All collaborators initially receive the existing standard workspace access model.

### 6.2 Enterprise Custom

Enterprise Custom is a sales-led extension of the same workspace and data model. It can add:

- SSO or SAML;
- Admin, Analyst, Viewer, and Client roles;
- audit logs;
- scoped API keys, rate limits, and usage reporting;
- custom AI platforms or contracted data sources;
- custom brand, scan, and retention allowances;
- contractual SLA and support routing;
- dedicated customer success management;
- custom report templates and scheduled delivery.

Customers must be upgradeable in place. A sales conversion must not require a new account, new workspace, or data migration.

### 6.3 Pricing and sales path

- The Enterprise card displays "$199/month starting price" and supports self-serve checkout.
- The card explains that SSO, API, custom platforms, more than 10 brands, and contractual service require Enterprise Custom.
- Enterprise Custom uses a localized sales form collecting company, role, brand count, markets, integration needs, target start date, and consent to follow up.
- Sales enquiries are distinct from support requests and from self-serve checkout failures.

## 7. Application Architecture

The implementation extends the existing account, client, scan, prompt, alert, AI Pulse, and Stripe architecture. It does not create a separate Enterprise application.

### 7.1 Plan Catalog

The Plan Catalog is the canonical source for:

- public plan name and price presentation;
- checkout eligibility and Stripe price mapping;
- brand allowance;
- monitoring cadence;
- history visibility;
- platform access;
- competitor detail level;
- report branding and export formats;
- share-link controls;
- support level;
- Enterprise Custom overrides.

UI components may render capabilities, but they must not independently redefine them. API routes enforce the same policies server-side. A hidden panel is not authorization.

Boolean feature flags remain appropriate for simple capabilities, but allowances and modes use typed values. Examples include `maxBrands`, `historyWeeks`, `competitorMode`, `reportBranding`, `exportFormats`, and `monitoringCadence` rather than multiplying ambiguous booleans.

### 7.2 Monitoring Schedule

Each tracked brand may have one active schedule per monitoring type. A schedule records cadence, timezone, next-run time, active state, and last outcome. Each trigger creates a uniquely identified monitoring run.

Runs are idempotent. Repeated delivery of the same scheduler event reuses the existing run and does not duplicate network work or quota usage. Manual scans and scheduled monitoring record different trigger sources.

### 7.3 Change Intelligence

Change Intelligence compares two immutable eligible snapshots and returns a normalized comparison model:

- overall score delta;
- check-level state changes;
- platform and prompt changes;
- competitor changes allowed by the plan;
- data-coverage changes;
- materiality and confidence labels.

It does not invent traffic, revenue, citations, or platform outcomes not present in stored evidence. If snapshots are not comparable, it explains why instead of generating a misleading delta.

### 7.4 Action Queue

An action belongs to one workspace and brand and references the evidence that created it. It stores priority, source, summary, recommended next step, status, optional assignee, due date, and timestamps. Editing the action does not mutate its source evidence.

Repeated monitoring must deduplicate materially identical open actions. A resolved action may reappear only when new evidence shows the problem has returned.

### 7.5 Report Service

Publishing creates an immutable report version containing the selected comparison, approved actions, consultant summary, branding configuration, and methodology metadata. A later update produces a new version rather than modifying a report already shared with a client.

Online reports use revocable high-entropy tokens stored only as hashes. Enterprise password protection uses a password hash separate from the share token. PDF generation and large exports run asynchronously and expose job status and retry controls.

### 7.6 Enterprise Policy

Enterprise Custom overrides belong to an account or workspace policy record with an explicit source and effective period. Runtime policy resolution applies:

1. safe default plan;
2. active paid or trial entitlement;
3. valid contracted overrides.

Expired, cancelled, or past-due subscriptions lose gated execution rights without deleting historical customer data. Visibility after downgrade follows the lower plan's history and feature policy.

## 8. Data Boundaries

The detailed implementation plan will map these concepts onto the existing schema, but the product requires the following bounded records:

- plan definition and typed allowances;
- workspace-level Enterprise policy override;
- brand monitoring schedule;
- idempotent monitoring run;
- comparison snapshot or reproducible comparison reference;
- evidence-linked action;
- report and immutable report version;
- report share credential and access policy;
- asynchronous export job;
- Enterprise Custom sales enquiry.

All tenant-owned records carry an account or workspace boundary and, where relevant, a client or brand boundary. Every server read and write validates ownership independently of client input.

## 9. Failure Handling

| Scenario | Required behavior |
|---|---|
| Scheduler event delivered twice | Reuse the idempotent run; do not repeat work or usage |
| One AI platform fails | Preserve partial evidence, label the missing platform, and allow targeted retry |
| Scan or comparison fails | Keep prior snapshots and reports available; show an actionable localized error |
| Snapshots cannot be compared | Explain the coverage or methodology mismatch; do not display a false delta |
| AI action drafting fails | Keep evidence usable and allow manual action creation or retry |
| Report publication fails | Keep the draft; do not expose a partial public report |
| PDF or CSV generation fails | Keep the online report available and offer asynchronous retry |
| Share link expires or is revoked | Return a neutral unavailable state without leaking report existence or metadata |
| Subscription downgrades | Preserve data; enforce lower-tier execution and visibility rules |
| Policy service fails | Fail closed for gated actions and report a service problem, not an upgrade prompt |
| Stripe webhook repeats or arrives out of order | Process idempotently and preserve the newest valid subscription state |

All errors are localized in English and Traditional Chinese, announced accessibly, and include a recovery action where one exists.

## 10. Security and Privacy

- Report, action, export, and schedule endpoints validate authenticated workspace ownership.
- Public report access is limited to the immutable published payload.
- Share tokens are high entropy, stored as hashes, revocable, and optionally expiring.
- Password-protected reports use a modern password hash and rate-limited verification.
- Export jobs verify entitlement both when requested and when executed.
- Enterprise Custom API keys are scoped, hashed at rest, individually revocable, and auditable.
- Logs avoid report tokens, API keys, client content, and unnecessary personal data.
- White-label assets are validated for type and size and served from controlled storage.
- Tenant isolation receives dedicated integration and end-to-end coverage.

## 11. Localization and Accessibility

- Pro, Enterprise, and Enterprise Custom maintain feature and commercial parity in `en` and `zh-HK`.
- Hong Kong copy uses concise business language rather than literal translation.
- Fimmick AISO, platform names, domains, identifiers, and code tokens remain untranslated where appropriate.
- Dates, periods, currencies, and numbers use locale-aware formatting.
- Portfolio tables, comparison views, action controls, dialogs, and report publication flows are fully keyboard operable.
- Status never relies on color alone.
- Async monitoring, publication, and export state changes use accessible live announcements.
- Shared reports work at 375px without horizontal page overflow; wide evidence tables use contained scrolling with labels.

## 12. Delivery Phases

### Phase 0 ??Commercial source of truth

- Introduce the typed Plan Catalog.
- Align pricing, Stripe, runtime entitlement, brand allowance, and localized copy.
- Remove, relabel, or mark unavailable promises that are not yet implemented.
- Add consistency tests that prevent commercial surfaces from drifting.

### Phase 1A ??Pro monitoring foundation

- Portfolio view.
- Weekly brand monitoring schedules and idempotent runs.
- Period comparison and data-coverage handling.
- Monitoring health and alerts.

### Phase 1B ??Pro client delivery

- Action Queue and deduplication.
- Monthly Review.
- Immutable Pro online report.
- Revocable share link and report analytics events.
- Contextual upgrade gates from Basic and Free.

### Phase 2 ??Self-serve Enterprise

- Cross-brand portfolio comparison.
- Full competitor benchmark.
- CSV export.
- White-label configuration and online reports.
- Asynchronous PDF generation.
- Password, expiry, and revocation controls.

### Phase 3 ??Enterprise Custom

- Localized sales-enquiry workflow and internal handoff.
- Contract policy overrides.
- SSO, advanced roles, audit logs, API, custom platforms, SLA tooling, and custom delivery only in response to validated design-partner or contracted demand.

Each phase is independently releasable behind server-enforced capabilities. Phase 2 does not begin merely because Phase 1 code exists; Pro activation, report usage, reliability, and unit cost must first be observable.

## 13. Measurement

Stable product events include:

- `monitoring_schedule_created`
- `monitoring_run_started`
- `monitoring_run_completed`
- `monitoring_run_failed`
- `period_comparison_viewed`
- `action_accepted`
- `action_completed`
- `monthly_review_started`
- `report_published`
- `report_opened`
- `report_revoked`
- `export_requested`
- `export_completed`
- `upgrade_started`
- `upgrade_completed`
- `enterprise_custom_enquiry_submitted`

Primary product and commercial metrics are:

- paid workspace to first configured brand;
- configured brand to first successful monitoring cycle within seven days;
- monthly-review completion rate;
- percentage of paid workspaces publishing a report each month;
- client report open rate;
- accepted and completed action rate;
- Pro retention and Pro-to-Enterprise upgrade rate;
- monitoring and AI cost per active workspace;
- gross margin by plan;
- failure and retry rate by monitoring platform.

Analytics failures never block the operational workflow.

## 14. Verification

### Automated

- Unit tests for Plan Catalog resolution, typed allowances, comparison logic, materiality, action deduplication, report snapshots, and policy precedence.
- API integration tests for tenant isolation, quota enforcement, idempotent schedules, partial platform failure, publication, share revocation, downgrade behavior, and export authorization.
- Stripe tests for checkout mapping, webhook idempotency, out-of-order lifecycle events, and Custom policy preservation.
- Component tests for portfolio states, Monthly Review, Action Queue, report preview, and localized recovery states.
- End-to-end coverage for the complete Pro monthly-delivery flow and Enterprise white-label report flow in both supported locales.
- Build, type, lint, and full test-suite verification before deployment.

### Production verification

- Confirm scheduled runs execute once and expose correlated logs.
- Confirm a partial provider failure remains visible and retryable.
- Confirm a published report is stable after a later scan.
- Confirm expired, revoked, and password-protected links reveal no private metadata.
- Confirm downgrades block gated execution without deleting history.
- Confirm Stripe, Vercel job, PDF/export, and report-access diagnostics are observable without logging secrets.

## 15. Scope Boundaries

In scope:

- sellable Pro Agency delivery loop;
- standardized self-serve Enterprise reporting and portfolio layer;
- typed commercial entitlements and usage policies;
- sales path and policy boundary for Enterprise Custom;
- EN and `zh-HK` parity;
- security, reliability, measurement, and production verification for the new workflows.

Out of scope for the first Pro implementation plan:

- SSO or SAML;
- public API;
- custom AI platform ingestion;
- complex RBAC and audit-log UI;
- contractual SLA operations;
- custom report-builder UI;
- per-seat billing;
- a replacement for Stripe, Neon Auth, the existing database, or the existing dashboard architecture;
- unrelated homepage or scan-algorithm redesign.

## 16. Acceptance Outcome

The first implementation program succeeds when an Agency can subscribe to Pro, configure up to three brands, receive reliable recurring monitoring, understand material period changes, turn evidence into managed actions, and publish a client-ready online report without leaving Fimmick AISO.

Enterprise succeeds when a larger customer can apply the same workflow across up to ten brands, compare the portfolio and competitors, export governed data, and publish secure white-label online and PDF reports. Needs beyond that standardized boundary enter a clearly defined Enterprise Custom sales and policy path rather than being silently promised by self-serve checkout.
