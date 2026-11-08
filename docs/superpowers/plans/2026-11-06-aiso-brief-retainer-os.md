# AISO brief — Retainer OS (the next phase, in bigger slices)

> **Status: Slice A started 2026-11-06 (draft PR, no migration).** It comes from a brainstorm with Willy on 2026-11-06.
> Willy approved the platforms (follow the plan: all five on Pro/Enterprise) and named the start of Slice A. Seeding any
> brand in production is still a separate named Approve (§2 Slice A, spend gate).

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
- **Built in the Slice A PR (2026-11-06):**
  - `PULSE_ACTIVE_QUESTIONS_PER_BRAND` = 10 (`lib/pulse/limits.ts`), enforced on every write that switches a question
    on: single add (saved paused past the limit, and the response says so), toggle (`409 ACTIVE_LIMIT_REACHED`), bulk
    preview/apply (`ACTIVE_LIMIT_REACHED`) and the onboarding seed (only free slots start active). Pausing is always
    allowed. Brands already over 10 are **not** changed; they see the budget line and can pause down.
  - `GET …/prompts/demand` drafts up to 10 questions from the last 28 synced days of the brand's own Search Console
    queries (current binding only, `synced_at >= bound_at`, domain still covered). Branded queries are left out.
    Rule-based wording (Q3: template, no LLM spend). The operator edits the CSV and applies it through the existing
    bulk preview → apply. Each draft shows its query, clicks, impressions and position, plus the date range.
  - Not built yet: a stored source label (demand versus profile) on each prompt. It needs a column, so a migration;
    left for a later slice rather than inferred.
  - **A2 (built 2026-11-08, migration `100`, draft PR): the source label exists.**
    - `prompt_bank.source text`, nullable, CHECK `(source is null or source in ('profile','demand'))`. NULL means the
      provenance was never recorded — it is never "manual" and never inferred. The migration backfills `profile` only
      where `onboarding_seed_key is not null`, a marker the onboarding seed itself wrote.
    - Writers: the onboarding seed writes `profile`; the demand flow's apply (bulk preview → apply) carries
      `source: 'demand'`, and `applyPromptBatch` accepts nothing else. A batch that applies existing rows never
      relabels them, and any other value is refused as `INVALID_PROMPT_BATCH`.
    - Readers: the prompts API and page select `source`, and the editor shows a label for recorded rows only.
    - Blocked on Willy applying `100` (`npm run migrate -- --verify` must show it recorded) before this merges, per
      the migration guardrail. Until then the schema gate correctly refuses a production build.

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
- **B1 (2026-11-06, draft PR, migration `097`):** the month record and its API. B2 (operator views: the month page
  and the cross-brand queue) follows.
  - `brand_month_snapshots`: one `opening` and one `closing` row per brand per Hong Kong month, insert-only
    (`aeo_app` has `select, insert` only). A CHECK pins `as_of` to the month's Hong Kong midnight for its kind.
  - Figures are computed **as of the boundary** from rows dated before it, so a snapshot written late still
    describes the boundary; `taken_at` records when it was written. Scan: latest score. Pulse: the latest fully
    ended week, per platform. Search Console: property clicks and impressions for the 28 days before the
    boundary, under the current binding. Missing is `none`, unbound is `not_connected`, never 0.
  - **Q4 default taken (the brief's proposal): the snapshot is automatic.** The opening is due at the boundary; the
    closing 3 days after the month ends, so late Pulse and Search Console syncs land first. B1 records due
    snapshots on `POST` (idempotent); B2 adds the scheduled call. Willy can still override Q4.
  - Activity is derived, not copied: work items opened and marked done, site edits sent, receipts, and C9e
    deliveries split into verified live and self-reported (withdrawn ones excluded).
  - **Not included: Studio answers saved.** Studio threads are private to each member, so counting them into an
    operator record needs its own decision.
  - `GET`/`POST /api/clients/[clientId]/months/[YYYY-MM]`: auth → `client_reports_online` → ownership (404).
    The current month and the 12 before it only.
- **B2a (draft PR): the month page,** `/{lang}/dashboard/[clientId]/month?m=YYYY-MM`, linked from Reports (the nav
  keeps Reports highlighted). Order: delivered (verified live, then self-reported), opening versus closing, then
  activity. Each missing value says why: 未有 (none), 未連接 (not connected), 未記錄 (not recorded). A due
  snapshot that is not recorded shows "Record now" (the idempotent `POST`). Page views never write.
- **B2b (draft PR): the cross-brand queue and the snapshot route.**
  - `/{lang}/dashboard/this-month`: one row per brand, those needing something first. Approvals waiting (a work
    item's latest version with no decision), edits sent but not verified (no refused receipt, no standing
    `verified_live` attestation), site-edit sends this month by the cap's own rule (flagged from 8 of 10), Pulse
    overdue (active questions, no rollup for a week starting in the last 14 days; 未啟用 with none active), Search
    Console stale (bound, nothing synced under the current binding for 3 days; 未連接 if unbound), and month
    snapshots not recorded. Reads only; each brand links to its month page.
  - `GET /api/cron/brand-months` (Vercel Cron header shape, `CRON_SECRET`): records every due snapshot for brands
    whose account has `client_reports_online`; idempotent. Its brand selection is account-blind by design
    (`loadDueMonthBrands`, declared in the tenancy inventory). **Not scheduled:** adding it to the cron Worker is a
    separate schedule change for Willy to approve. Until then the month page's "Record now" covers it.
  - Note: while the 09:00 Search Console trigger stays unscheduled, every bound brand will read as stale. That is
    true, not a bug.

### Slice C — The monthly deliverables report

- **C1 (2026-11-07, draft PR, migration `098`): drafts, no publishing.** Willy chose to build Slice C now with the
  visibility section held back until Q1 is decided against real Pulse data.
  - A monthly report is a second **kind** of client report (`client_reports.kind = 'monthly'`, one per brand per
    Hong Kong month), versioned like a scan report. Its versions are schema 2, built from the Brand Month (097) and
    the delivery rows; they name no scan. Two monthly-only RPCs create and append them.
  - Isolation, not a union: every scan-report read now filters `kind = 'scan'`, so a monthly report never enters the
    scan flow (list, detail, append, AI summary, publish), and the public resolver still serves only schema 1.
  - Sections, frozen in this order: delivered (verified live, then self-reported); visibility = "not enough data
    yet" (`movement_rule_pending`); search demand (opening and closing snapshot figures with their dates, or
    未連接/未記錄/未有); next month (open work items).
  - The narrative is the operator's (1–1,200 characters). The default only restates the delivered counts.
  - `/{lang}/dashboard/[clientId]/month/report?m=YYYY-MM` shows the latest draft and saves a new version.
- **C2 (follow-up on main, no migration): publish and share.**
  - Publish sends exactly the reviewed draft (`versionId`); 027's RPC refuses a stale one (409). Stop sharing uses
    027's revoke, which rotates the slug so the old link dies. Both read the report with `kind = 'monthly'` and check
    the RPC result is that kind again.
  - The share link has the same signed format as scan reports. `/{lang}/r/[slug]` tries the scan resolver first, then
    `resolvePublishedMonthlyReport`, which repeats every scan check (HMAC first, published, tuple, entitlement,
    locale) and copies an allow-list: no raw logo/contact URL, no internal version id.
  - **Logo and contact link (built 2026-11-08).** The public monthly page shows the agency logo and its contact CTA,
    but never the stored destinations: it links to `/api/public/monthly-reports/{slug}/logo|contact?v=&s=`, which
    re-verify the same signed link (`resolvePublishedMonthlyReportAssets`) before serving the image (SSRF-hardened
    `fetchReportLogo`, PNG/JPEG/WebP, 2 MiB) or a 303 to the re-normalised destination. The logo and contact are in
    the frozen snapshot's branding, so a client sees exactly what the agency reviewed. Monthly CTA clicks use the
    same aggregate counter as scan reports.
- **C3 (Q1, the movement rule — built 2026-11-08): the visibility section is real.**
  - `lib/monthly-report/movement.ts` (pure, rule version 1). A direction is reported only when **three consecutive
    week-to-week comparisons move the same way**, the weeks are **seven days apart** (a missing week breaks the chain
    rather than being spanned), and **every week has at least 5 answers**. Sub-threshold moves (< 0.5 percentage
    points) are flat. The most recent five usable weeks are judged. Anything else is "not enough data yet", never a
    zero: `no_pulse_data` when the month has no weekly rollups at all, otherwise a per-platform reason
    (`insufficient_weeks`, `insufficient_answers`, `no_clear_trend`).
  - The section shows the **recorded** opening and closing share of voice per platform from the 097 snapshots,
    `closing − opening`, and the rule's verdict. A figure that was never recorded stays `未記錄`, not 0.
  - Replayed against production on 2026-11-08: the only brand with Pulse data has three weekly rollups for October
    (the 19 Oct week is missing) and one for November, so the rule returns `insufficient_weeks` for all five
    platforms in both months. It claims no movement from the data that exists, which is the intended conservative
    result. The first month with four consecutive weekly rollups is when the section can say anything.
  - Stored schema-2 versions frozen before this change keep `movement_rule_pending`; the parser accepts that legacy
    reason and the view renders it as "not enough data yet", so history is never rewritten.
  - Thresholds are where Q1 is now decided; changing them means bumping `MOVEMENT_RULE_VERSION` so a frozen report
    still records which rule produced it.
  - **C4 (built 2026-11-09): an AI wording draft the operator approves.** The plan already allowed AI-drafted wording
    as a draft the operator must approve, restating figures only. `POST …/report/ai-narrative` (gated like the other
    monthly routes, body `{ locale }`) loads the month's **stored** version and hands the model a closed fact set:
    delivered counts, visibility state with rising/falling platform counts, search state with its recorded clicks and
    impressions, open-item count, and the current narrative. The reply passes the same plain-text guard as scan-report
    summaries (`validatePolishedText`): no Markdown, currency, percentages, rank or competitor claims, and no number
    absent from the facts. The editor only fills its textarea; saving a version is the approval step, so the route
    writes nothing and a month with no saved draft returns `DRAFT_REQUIRED`. A refused or failed draft leaves the
    operator's text untouched.

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
- **Q2 — Prompt budget and platforms. Decided (Willy, 2026-11-08): 10 questions per brand.**
  - `PULSE_PLATFORM_BUDGET` is the approved weekly platform set: gemini, gpt4o, claude, perplexity-s,
    perplexity-p. A Pulse run queries the plan's `platform_access` **intersected with this budget**, so a future
    plan entitlement cannot raise weekly spend silently, and cutting cost later is one edit rather than a plan change
    every customer sees. The 10-question cap stays as the per-brand budget.
  - Cost basis, measured on production before the approval: one Pulse week for one brand at 8 questions over the five
    platforms cost **$0.574** in collection calls (claude-haiku $0.102, gemini-flash $0.192, gpt-4o $0.133,
    perplexity-sonar $0.045, perplexity-sonar-pro $0.102) plus ~$0.006 in answer classification
    (gpt-4o-mini, ~$0.00015/answer) — **≈ $3.10/month per brand** at the 10-question budget.
  - The approved set is pinned by `__tests__/lib/pulse-platforms.test.ts`; changing it is a deliberate, cost-checked
    edit.
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
