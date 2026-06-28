# Design: Local Trust ROI for SME Owners

**Date:** 2026-06-28  
**Status:** Approved for planning  
**Project:** Fimmick AISO

---

## Overview

Local Trust ROI adds an owner-facing business layer to the existing AISO dashboard for professional services and B2B SMEs. The feature helps owners answer two practical questions:

1. Can local buyers trust us when they discover us through AI search?
2. Can we prove that AISO work is creating visibility and business value?

The feature keeps the current product structure intact. It extends each client dashboard with a new ROI step after Monitor:

```text
Scan -> Results -> Improve -> Monitor -> ROI
```

The first version focuses on local trust discovery and owner reporting for firms such as accountants, consultants, agencies, real estate advisors, manufacturers, distributors, and export-oriented B2B businesses.

---

## Goals

- Make AISO useful to non-technical SME owners by translating scan and Pulse data into local trust signals.
- Show a plain-English story of marketing progress: score changes, completed fixes, visibility gains, and estimated enquiry value.
- Help owners understand why competitors appear more credible in local AI discovery journeys.
- Give Pro and Enterprise plans a stronger business outcome narrative without replacing the existing scan, Fix Pack, Pulse, or pricing structure.

## Non-Goals

- Do not build a full CRM or attribution platform.
- Do not promise exact revenue attribution from AI search.
- Do not change the existing Basic, Pro, and Enterprise plan architecture.
- Do not depend on nondeterministic AI output for the core score or ROI calculation.
- Do not redesign the dashboard navigation beyond adding the ROI step.

---

## Target Users

### Primary

SME owners and managing directors at professional services and B2B firms who need proof that their marketing work is improving local credibility and visibility.

### Secondary

Marketing managers or agency account managers who need a simple monthly story to explain progress to the owner.

### Target Discovery Journeys

- Local trust discovery: "best accountant in Hong Kong", "trusted B2B marketing agency Hong Kong", "industrial supplier Hong Kong", "real estate consultant for expats".
- Owner reporting: "what changed this month, what did we fix, and what business value might it create?"

---

## Feature Set

### 1. Local Trust Score

A deterministic 100-point score that summarizes whether the business looks locally credible to AI search systems and high-consideration buyers.

Score buckets:

| Bucket | Weight | Signals |
|---|---:|---|
| Local visibility | 25 | Region targeting, service-area clarity, local keywords, address or market coverage, local schema signals |
| Proof depth | 25 | Testimonials, case studies, credentials, awards, client logos, team bios, before/after evidence |
| AI answer readiness | 25 | FAQs, comparison content, concise service explanations, extractable text, structured data, internal linking |
| Market authority | 25 | Trusted local or industry citations, Pulse share-of-voice trend, competitor mention gap, authority score movement |

Each bucket returns:

- numeric score,
- short owner-facing explanation,
- strongest signal,
- weakest signal,
- top recommended action.

### 2. Trust Gap Checklist

A prioritized action list that turns the score into owner-friendly next steps.

Example items:

- Add Hong Kong service-area copy to priority service pages.
- Add partner or director credentials near consultation CTAs.
- Publish two local client case studies with measurable outcomes.
- Add comparison FAQs for common buyer questions.
- Add citations from trusted local industry sources.

Each item includes:

- impact: low, medium, high,
- effort: low, medium, high,
- affected bucket,
- rationale,
- suggested page or section,
- status: open, planned, done, skipped.

### 3. Local Competitor Snapshot

Enterprise users get a competitor snapshot for 3-5 local competitors.

The snapshot shows:

- which competitors appear more often in AI answers,
- which trust signals competitors have that the client lacks,
- citation or content patterns that seem to support competitor visibility,
- a short "catch-up plan" using existing Trust Gap Checklist items.

When competitor or Pulse data is missing, the section degrades gracefully into a setup prompt.

### 4. ROI Proof Timeline

A monthly timeline that shows progress in business terms.

Each month can include:

- AISO score movement,
- Local Trust Score movement,
- Pulse share-of-voice movement,
- completed trust gap items,
- new AI mentions or citation gains,
- estimated enquiry value range.

ROI estimates use a range rather than exact revenue. The app labels the estimate as low-confidence until the owner enters average lead value and close rate.

Default formula:

```text
estimated_value_low = estimated_extra_enquiries_low * average_lead_value * close_rate
estimated_value_high = estimated_extra_enquiries_high * average_lead_value * close_rate
```

If average lead value or close rate is missing, the UI shows visibility progress and asks the owner to add assumptions before showing value estimates.

---

## User Experience

### Dashboard Placement

Add a fifth dashboard step:

```text
Scan -> Results -> Improve -> Monitor -> ROI
```

The route stays under the existing dashboard page:

```text
/:lang/dashboard/:clientId?step=roi
```

This avoids a new standalone product area and keeps Local Trust ROI connected to the selected client.

### ROI Step Layout

The ROI step contains four sections:

1. **Owner Summary**
   - "Your local trust improved from 62 to 71 this month."
   - "The biggest gain came from clearer service-area signals."
   - "Next best action: add two Hong Kong client proof points."

2. **Local Trust Score**
   - Overall 100-point score.
   - Four bucket cards.
   - Plain-English explanation for each bucket.

3. **Trust Gap Checklist**
   - Sorted by high impact and low effort first.
   - Filters: all, quick wins, proof gaps, local gaps, AI answer gaps.
   - Owners can mark items done or skipped.

4. **ROI Proof Timeline**
   - Monthly cards or compact chart.
   - Shows score movement, fixes completed, visibility movement, and estimated value range when assumptions exist.

Enterprise adds a fifth section:

5. **Local Competitor Snapshot**
   - Competitor visibility table.
   - Competitor trust signal comparison.
   - Catch-up plan.

### Empty State

If there is not enough data, the ROI step shows a setup checklist:

- run first scan,
- add primary services,
- confirm service area,
- add average lead value and close rate,
- add competitors,
- enable or run Pulse.

The page should never show an empty chart without explaining what is missing.

---

## Plan Gating

| Feature | Basic | Pro | Enterprise |
|---|---|---|---|
| Local Trust ROI preview | Locked preview | Included | Included |
| Local Trust Score | Preview only | Included | Included |
| Trust Gap Checklist | Preview only | Included | Included |
| ROI Proof Timeline | Preview only | Included | Included |
| Competitor Snapshot | Locked | Locked preview | Included |
| Shareable monthly owner report | Locked | In-app only | Export/share |
| CSV/PDF export | Locked | Locked | Included |

Basic users see a locked preview with sample score movement and an upgrade CTA.

Pro users can use the score, checklist, and timeline in-app.

Enterprise users can export or share the monthly owner report and access competitor analysis.

---

## Data Inputs

### Existing Inputs

- Client brand name, domain, industry, region.
- Scan score, grade, and check results.
- Authority Engine signals.
- Pulse weekly summaries.
- Pulse missed opportunities.
- Agent competitor data when available.
- Plan features from the existing tier system.

### New Owner Inputs

Add a lightweight setup form for:

- primary services,
- service area,
- average lead value,
- estimated close rate,
- top local competitors if not already known.

These inputs should be optional, but ROI value estimates require average lead value and close rate.

---

## Data Model

### New Table: `local_trust_profiles`

Stores owner-provided assumptions and local business context.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid primary key | default `gen_random_uuid()` |
| `client_id` | uuid | references `clients(id)` on delete cascade |
| `account_id` | uuid | references account owner |
| `primary_services` | text[] | owner-entered services |
| `service_area` | text | e.g. "Hong Kong", "Greater Bay Area" |
| `average_lead_value` | numeric | nullable |
| `close_rate` | numeric | nullable, stored as 0-1 |
| `competitors` | text[] | optional competitor domains or names |
| `created_at` | timestamptz | default `now()` |
| `updated_at` | timestamptz | default `now()` |

### New Table: `local_trust_snapshots`

Stores monthly score and ROI snapshots.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid primary key | default `gen_random_uuid()` |
| `client_id` | uuid | references `clients(id)` on delete cascade |
| `account_id` | uuid | references account owner |
| `snapshot_month` | date | first day of the month |
| `local_trust_score` | numeric | 0-100 |
| `bucket_scores` | jsonb | four score buckets and explanations |
| `trust_gaps` | jsonb | generated deterministic checklist |
| `roi_estimate` | jsonb | nullable low/high range and assumptions |
| `source_scan_id` | uuid | nullable latest scan used |
| `source_pulse_week` | date | nullable latest Pulse week used |
| `created_at` | timestamptz | default `now()` |

### New Table: `local_trust_actions`

Stores checklist items and owner status changes independently of monthly snapshots.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid primary key | default `gen_random_uuid()` |
| `client_id` | uuid | references `clients(id)` on delete cascade |
| `snapshot_id` | uuid | references `local_trust_snapshots(id)` on delete cascade |
| `title` | text | checklist item |
| `bucket` | text | local, proof, answer-readiness, authority |
| `impact` | text | low, medium, high |
| `effort` | text | low, medium, high |
| `status` | text | open, planned, done, skipped |
| `created_at` | timestamptz | default `now()` |
| `updated_at` | timestamptz | default `now()` |

The first implementation includes this table because owners can mark checklist items as done or skipped in the ROI step.

---

## Analysis Logic

### Local Trust Score Function

Create a deterministic scoring module in `lib/localTrust/`.

Suggested public API:

```ts
type LocalTrustInput = {
  client: Client
  profile: LocalTrustProfile | null
  scan: Scan | null
  pulseSummary: PulseWeeklySummary[]
  missed: PulseMetric[]
  competitors: AgentCompetitor[]
}

function calculateLocalTrust(input: LocalTrustInput): LocalTrustSnapshotDraft
```

The function should not call external AI services. It maps known signals to bucket scores and recommendation items.

### ROI Estimate Function

Create a separate deterministic helper:

```ts
function estimateRoi(input: {
  previousSnapshot?: LocalTrustSnapshot
  currentSnapshot: LocalTrustSnapshotDraft
  averageLeadValue?: number
  closeRate?: number
}): RoiEstimate | null
```

Return `null` when assumptions are missing. Return a low/high range when assumptions exist.

### Monthly Snapshot Generation

Generate or refresh the current month snapshot when:

- the ROI step is opened and the month has no snapshot,
- the owner updates assumptions,
- a new scan becomes the latest scan,
- a Pulse week newer than the snapshot source is available.

A scheduled monthly job can be added later for report delivery, but v1 can generate on demand to reduce scope.

---

## Error Handling

| Scenario | Behavior |
|---|---|
| No scan exists | Show setup checklist and "Run scan" CTA |
| No Pulse data exists | Score still uses scan/profile data; Pulse sections show setup prompt |
| No owner assumptions | Hide value estimate and ask for lead value and close rate |
| No competitors | Hide competitor snapshot behind setup prompt |
| Snapshot calculation fails | Show last successful snapshot if available; otherwise show recoverable error |
| Plan lacks access | Show locked preview and upgrade CTA |
| Partial data | Score buckets explain which signals are missing |

---

## Copy Principles

- Speak to owners, not technical specialists.
- Use cautious ROI language: "estimated value range", "based on your assumptions", "directional".
- Prefer action wording over audit wording.
- Explain why each local trust signal matters for buyer confidence.
- Avoid implying guaranteed rankings, revenue, or AI placement.

Example summary:

> Your local trust score is 71/100. You have strong technical readiness, but your proof signals are thin for Hong Kong buyers. Adding two client case studies and clearer service-area copy is the fastest path to improving trust.

---

## Reporting

### Pro

Pro users get the owner report in-app inside the ROI step.

### Enterprise

Enterprise users can export or share a monthly report that includes:

- owner summary,
- score movement,
- completed trust actions,
- Pulse movement,
- competitor snapshot,
- estimated value range,
- next-month priorities.

The report should be generated from stored snapshots and deterministic copy templates. AI rewriting can be added later, but the first implementation should not require it.

---

## Testing Strategy

### Unit Tests

- Local Trust Score bucket scoring with complete data.
- Score behavior with missing scan, missing Pulse, and missing profile assumptions.
- Trust Gap Checklist ordering by impact and effort.
- ROI estimate returns `null` without assumptions.
- ROI estimate returns low/high range with assumptions.
- Plan gating for Basic, Pro, and Enterprise.

### Component Tests

- ROI step empty state.
- Local Trust Score renders all four buckets.
- Trust Gap Checklist renders prioritized items.
- Basic locked preview hides real report details.
- Enterprise competitor section renders when competitor data exists.

### Integration Tests

- Visiting `/:lang/dashboard/:clientId?step=roi` requires auth and account ownership.
- Pro user can see score/checklist/timeline.
- Enterprise user can see competitor/export affordances.
- Basic user sees locked preview.

---

## Rollout Plan

1. Build deterministic scoring and ROI helpers.
2. Add database tables and RLS policies for profiles, snapshots, and actions.
3. Add owner setup inputs for services, service area, lead value, close rate, and competitors.
4. Add ROI dashboard step with empty, locked, Pro, and Enterprise states.
5. Add snapshot generation on demand.
6. Add Enterprise report export/share affordance.

---

## Open Decisions Resolved

- **Target segment:** professional services and B2B SMEs.
- **Primary journeys:** local trust discovery and owner reporting.
- **Approach:** Local Trust + ROI Cockpit.
- **Product placement:** existing client dashboard, new `?step=roi` step.
- **Commercial packaging:** Pro gets in-app score/checklist/timeline; Enterprise gets competitor snapshot and export/share.
