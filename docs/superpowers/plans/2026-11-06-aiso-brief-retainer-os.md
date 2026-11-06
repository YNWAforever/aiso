# AISO brief — Retainer OS (the next phase, in bigger slices)

> **Status: proposed, not started.** It comes from a brainstorm with Willy on 2026-11-06. No code, migration, env change or
> vendor spend follows from this file until Willy names a start and approves each gate below.

## 0. What Willy decided (2026-11-06)

- **The operator is Fimmick's own team**, running AISO on behalf of client brands. It is not a self-serve brand
  marketer.
- **What Fimmick sells is a monthly retainer with a deliverables report.** That monthly cycle and its report are the
  backbone of the product. Every other surface exists to feed the report something true.
- **The report leads with verified delivery** (what was shipped and confirmed live). Visibility movement comes second,
  with an honest confidence label. Delivery is fully under Fimmick's control and provable; AI visibility is not.
- **Slices are bigger than the S1–S11 site-edit series**: three slices, each a working, reviewable increment.

## 1. Why now: the parts exist, the loop does not

| Part | State today (verify before relying on it) | Gap for a retainer |
|---|---|---|
| Pulse (`prompt_bank` → `pulse_metrics` → `pulse_weekly_summary`) | Built. The bank is capped at `MAX_PROMPTS` = 50. Onboarding now seeds it (`lib/onboarding/store.ts`, `onboarding_seed_key`), and `pulse/suggest-questions` offers LLM suggestions. CLAUDE.md's "never produced a rollup; `prompt_bank` empty" was **verified 2026-08-15 and may be stale**: re-check the production bank and rollup counts before Slice A. | The seeded questions come from the brand profile, not from what Hong Kong users actually search. Whether Pulse runs weekly in production is unconfirmed (see Scheduling). |
| Search Console (`054`, `search_console_page_queries`) | Built and recorded on hosted. Keeps the top 25 queries per page per day, per bound brand, with clicks, impressions and position. Gated on `FEATURE_SEARCH_CONSOLE=1` plus Pro/Enterprise. | Its real query data is never used to seed Pulse. |
| Work items, C9d approval, C9e delivery, site-edit S1–S11 | Built. Site-edit is waiting on ops env vars and Rick (`docs/runbooks/site-edit-readiness.md`). | Nothing groups the month's work by brand and period. |
| Client reports (`027`: `client_reports`, `client_report_versions`, share links, branding) | Built. Snapshot-based and shareable. | Not tied to a period or to delivery evidence; no monthly cadence. |
| Scheduling (`cloudflare/aiso-worker`) | The deployable config enables Pulse and alerts, but **nothing runs until the Worker is deployed** (`docs/runbooks/deploy-cron-worker.md`). | Pulse needs a working weekly schedule for a monthly series to exist. |

## 2. The phase in three slices

### Slice A — Demand-seeded Pulse ("give Pulse real questions")

Comes first, because Slices B and C have nothing to report without it.

- **Builds on what exists:** the onboarding seed, `suggest-questions` and the prompt-bank gate (`lib/prompts/`). The
  new part is the source.
- **Draft from demand.** For each brand bound to Search Console, AISO drafts a prompt bank from that brand's top
  Hong Kong queries. It turns search queries into the question form people ask AI assistants, in the query's own
  language (English or Traditional Chinese).
- **Every draft shows its source:** the query, its clicks and impressions, and the date range. No invented demand
  figures.
- **The operator approves or edits** each draft before it enters `prompt_bank`. Nothing is activated automatically.
- **Brands without Search Console** keep today's onboarding seed and `suggest-questions` path. Those prompts are
  labelled as profile-based in the UI, never as demand.
- **At most 10 active questions per brand** (Q2), well inside the store's 50-prompt cap. Show how many of the 10
  are used.
- **Spend gate.** Seeding prompts makes Pulse spend real LLM money every week. A per-brand prompt budget and the
  platforms Pulse runs on need a named Approve **before** any brand is seeded in production.
- **Done when:** one Fimmick-owned brand has an approved bank, and Pulse has written at least one weekly rollup
  row in Preview.

### Slice B — The Brand Month ("one record per brand per month")

- **A period record** per brand per Hong Kong calendar month (the same month boundary as the S8 send cap). It is
  insert-only history: a month is opened, accumulates, and is closed. It is never rewritten.
- **Opening baseline:** the latest scan score, the Pulse share of voice per platform, and Search Console clicks and
  impressions. Each figure records its own source date, and a missing source is stored as "none", never as 0.
- **What happened during the month,** derived from rows that already exist rather than copied: work items opened and
  closed; site edits sent, receipted and **verified live** (C9e attestations with `provenance = 'verified_live'`);
  manual delivery reports (`self_reported`), shown separately; Studio answers saved.
- **Closing snapshot:** the same figures as the baseline, at the end of the month.
- **Operator views:**
  - one month view per brand;
  - a **cross-brand queue** of this month's open items: approvals waiting, edits sent but not yet verified, Pulse runs
    overdue, brands near the 10-send cap, stale Search Console connections.
- **Expect a migration** (period table plus snapshots). As always, it ships file-only and is applied under a named
  Approve.

### Slice C — The monthly deliverables report

- **Drafted from the Brand Month,** extending the existing `client_reports` versions and share links rather than
  building a second report system.
- **Fixed section order** (this order is the product decision from §0):
  1. **Delivered this month:** verified-live changes first, each linked to its approved version and its check date.
     Then self-reported deliveries, labelled as such.
  2. **Visibility:** the opening versus closing share of voice per platform, with a **confidence label** from the
     movement rule (§3, Q1). "Not enough data yet" is a valid and expected result.
  3. **Search demand** (when Search Console is bound): clicks and impressions for the month versus the previous month,
     sourced and dated.
  4. **Next month:** open work items and planned edits.
- **The operator writes the narrative.** Any AI-drafted wording is a draft the operator must approve, and it may only
  restate figures from the record, never add new ones.
- **en and zh-HK,** using the existing report branding.
- **Done when:** a Fimmick-owned brand gets a full month's report, shared by link, with every figure traceable to a
  stored row.

## 3. Open questions (decide before the slice that needs them)

- **Q1 — The movement rule (blocks Slice C §2; the riskiest assumption).**
  - Weekly Pulse across a few platforms is noisy, and a month holds about 4 points per platform.
  - What counts as real movement? One candidate: at least 3 of 4 weeks in the same direction, with a minimum number
    of answers behind each week. Otherwise show "not enough data yet".
  - Proposal: decide this by replaying it on the first 4–6 weeks of real Pulse data from Slice A **before** building
    Slice C's visibility section.
- **Q2 — Prompt budget and platforms. Partly decided (Willy, 2026-11-06): 10 questions per brand.** Slice A drafts
  and activates at most 10 Pulse questions per brand. The `MAX_PROMPTS` cap of 50 stays as the store's limit. **Which AI
  platforms Pulse runs on is still open**, and it sets the weekly LLM spend, so it needs a named Approve before
  production seeding.
- **Q3 — How a query becomes a question.** Is it a rule-based template, or an LLM rewrite? An LLM rewrite costs money
  and must be reviewed by the operator either way.
- **Q4 — Month close.** Does a month close automatically at Hong Kong midnight, or when the operator presses "close
  month"? The proposal is automatic for the snapshot, with the operator finalising the report.
- **Q5 — What the client sees.** Is it only the shared report, or also a read-only month view? The proposal is the
  report only for this phase.
- **Q6 — Scheduling. Decided (Willy, 2026-11-06): Willy deploys the cron Worker** (`cloudflare/aiso-worker`,
  following `docs/runbooks/deploy-cron-worker.md`), so Pulse runs weekly. Until it is deployed and verified, no monthly
  series exists.

## 4. Guardrails (unchanged from the rest of AISO)

- **Honesty copy:** no invented metrics. Use 待核實／未有／未連接／未啟用 for unknown, missing, unconnected and
  disabled states. Every figure in a report traces to a stored row with its source and date.
- **Delivery claims:** only C9e attestations count as delivered. Only `verified_live` ones are called verified.
- **Tenancy:** every query filters by `account_id`, every route gates itself, and an ownership failure is a 404.
- **Migrations:** file-only. Applied by Willy under a named Approve, and `--verify` must show `recorded` before the
  code that needs it merges.
- **Spend:** no new vendor spend (Pulse runs, LLM rewrites) without a named Approve. CI and tests never call paid
  vendors.
- **Scope:** no vendor names in the UI. Copy is in en and zh-HK.

## 5. Out of scope for this phase (parked)

- Client sign-off through a review link (it touches the C9d approval model).
- Self-serve brand signup and the free-scan-to-trial funnel.
- Per-fix billing views.
- Causal claims ("our edit caused +X%"). The report shows sequence and evidence, never causation.

## 6. Proposed order and first step

0. **Re-check production first:** how many brands have an active prompt bank, and whether any `pulse_weekly_summary`
   rows exist. This decides how much of Slice A is new and how much is switching it on.
1. **Before any code:** Q2 (10 questions per brand) and Q6 (Willy deploys the Worker) are decided. Still needed: the
   Pulse platforms (Q2) and a named start for Slice A.
2. **Slice A**, then 4–6 weeks of real Pulse data on a Fimmick-owned brand. That data is what answers Q1.
3. **Slice B**, which can run in parallel with step 2's waiting period.
4. **Slice C**, once Q1 is decided against real data.

Each slice: a draft PR, `vercel.json` +1 for its branch, migrations file-only, and a Ready packet for Willy.
