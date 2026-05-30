# Design: Trial Onboarding + Enhanced AI Pulse
**Date:** 2026-05-30
**Status:** Approved

---

## Overview

Two connected features:

1. **Trial onboarding flow** — converts result-page visitors into trial accounts with minimal friction. Magic-link signup, 7-day Fix Pack trial, hard cutoff with 4-email drip.
2. **Enhanced AI Pulse page** — single scrollable page replacing the current Pulse + separate /prompts pages. Three sections: Overview (existing charts), This Week's Scans (question × platform scan log), Question Bank (inline editor with AI generation).

---

## Part 1 — Trial Onboarding

### Trigger

On the result page, after email capture unlocks the deep GEO results, the Fix Pack CTA changes from a generic "Sign up" link to a trial-specific call-to-action:

> **"Start your free 7-day trial — get your Fix Pack now, no credit card required"**
> `[✉ Send me access]`

The email field is pre-filled from the already-captured lead email. One click fires a Supabase magic link. The button confirms inline: *"Check your inbox — magic link sent to you@company.com."*

No redirect to `/auth/login`. The auth flow happens entirely inline on the result page.

### Onboarding Wizard

Route: `/[lang]/onboarding?scan=[scanId]`

Three steps, progress bar at top. Scan data pre-fills steps 1 and 2.

| Step | Field | Pre-fill source |
|---|---|---|
| 1. Brand | Brand name | Guessed from domain (e.g. `fimmick.com` → `Fimmick`) |
| 2. Domain | Primary domain | From the scan record |
| 3. Industry + Region | Dropdowns | From scan if set; otherwise manual |

- "Skip for now" available on step 3 only.
- On completion: creates a `clients` record, links to `account_id`, redirects to `/[lang]/dashboard/[clientId]`.
- Ends with a success message: *"Your Fix Pack is ready →"*

### Trial Dashboard State

- Persistent top banner: `🎁 7-day trial · N days remaining` with `[Upgrade →]` CTA.
- **Fully active:** Fix Pack section (llms.txt, robots.txt patch, FAQ schema downloads), full 20-check report, deep GEO breakdown.
- **Visible but locked (Pro overlay):** AI Pulse, Competitor Analysis, Alerts. Each locked section shows a short explainer of what it does and an upgrade prompt.
- **Question Bank:** auto-generated on first load via existing `/api/pulse/onboard` endpoint using brand name + industry.

### Trial Expiry

Trial duration: **7 days** from account creation.

On day 8: dashboard goes read-only. Full-screen upgrade overlay with the user's scan score still visible behind it:
> *"Your trial ended — but your AISO score of 67/100 is waiting."*
> `[Upgrade to Basic — $29/mo]` `[See all plans]`

Fix Pack re-download locked. Original files the user already downloaded remain usable locally.

### Email Drip Sequence

Sent via Resend. Triggered by account `created_at` timestamp.

| Day | Subject line | Goal |
|---|---|---|
| 1 | ✅ Your Fix Pack is ready — deploy these 3 files | Activation — get them to use the files |
| 5 | ⏳ 2 days left — here's what you're missing in Pulse | FOMO — show Pulse value |
| 7 | 🔔 Last day of your trial | Urgency — direct upgrade link |
| 10 | Your AISO report is saved — come back anytime | Re-engagement — no hard sell |

### Plan Comparison (post-trial)

| Feature | Trial (7d) | Basic ($29/mo) | Pro ($79/mo) |
|---|---|---|---|
| Fix Pack (llms.txt, robots patch, FAQ schema) | ✅ | ✅ | ✅ Advanced |
| Full 20-check report | ✅ | ✅ | ✅ |
| Deep GEO analysis | ✅ | ✅ | ✅ |
| New scans | 1 | Unlimited | Unlimited |
| Brands | 1 | 1 | 3 |
| AI Pulse | ❌ | Gemini only | 5 platforms |
| Competitor benchmarking | ❌ | ❌ | ✅ |
| Alerts | ❌ | ❌ | ✅ |
| History | — | 4 weeks | 26 weeks |

---

## Part 2 — Enhanced AI Pulse Page

### Architecture

The current Pulse page (`/[lang]/pulse/[clientId]`) and the separate Prompts page (`/[lang]/dashboard/[clientId]/prompts`) are merged into a single scrollable page at the Pulse route.

The `/prompts` route is kept as a redirect to `/pulse/[clientId]#question-bank` for backwards compatibility.

### Section ① Overview (existing, unchanged)

- KPI cards: Share of Voice %, Brand Mentions, Sentiment
- SoV Trend chart (weekly sparkline)
- Platform Breakdown bars
- Missed Opportunities table

No changes to this section beyond moving it to the top of the unified page.

### Section ② This Week's Scans (new)

Displays every question that ran in the most recent weekly scan, grouped by category (Brand Queries, Competitor Queries, Intent Queries, Category Queries).

**Question row (collapsed):**
```
[P] [G] [C] [Ge]  "What are the best AI SEO tools in Hong Kong?"    3/4 ▼  ✏️
```
- 4 coloured platform dots: green = brand mentioned, red = not mentioned, amber = indirect mention
- `3/4` = mention count out of 4 platforms
- `▼` = expand to read full answers
- `✏️` = inline edit (scrolls to and highlights the question in Section ③)

**Question row (expanded):**
- 2-column grid, up to 4 cells (one per platform)
- Each cell shows:
  - Platform name + mention status badge (✓ Mentioned / ✗ Not mentioned / ⚠ Indirect)
  - AI's actual response snippet (first 200 chars)
  - Brand mention **highlighted in yellow** within the snippet
  - Competitors mentioned shown as small grey pills below the snippet

**Filters (above the list):**
- All / Not mentioned only / By category
- Week selector (current week default, previous weeks available for Pro plan)

**Data source:** `pulse_metrics` table — existing schema, no migration needed.

### Section ③ Question Bank (replaces /prompts page)

**Header bar:**
```
Question Bank   12 active / 15 total   [✨ Suggest more]   [+ Add question]
```

Questions grouped by category, each category collapsible. Each question row:
- Toggle (active/inactive) — stops question from running in next scan
- Question text — click to edit inline (Enter to save, Escape to cancel)
- Language badge (en / zh-HK)
- Edit ✏️ and Delete 🗑 buttons

**"✨ Suggest more" flow:**
1. Calls `POST /api/pulse/suggest-questions` with `{ clientId, count: 5 }`
2. Server calls OpenRouter (gpt-4o-mini) with brand + industry + existing questions as context
3. Returns 5 new question suggestions in a slide-in panel
4. Each suggestion has: Accept (adds to bank) / Edit then accept / Dismiss
5. Accepted questions are saved to `prompt_bank` with `is_active: true`

**"+ Add question" flow:**
- Inline form appears at bottom of selected category
- Text input + category selector + language selector + Save button
- Same as current `AddPromptRow` behaviour

**First-time experience:**
- When `prompt_bank` is empty for the client, auto-generate 20–30 seed questions via `/api/pulse/onboard`
- Show a dismissible banner: *"We generated 24 starter questions based on your brand and industry. Review and edit them below →"*
- Scroll anchor `#question-bank` jumps to this section

---

## Data Model Changes

| Change | Details |
|---|---|
| `accounts.trial_ends_at` | New column — `timestamptz`, set on account creation |
| `accounts.trial_started_at` | New column — `timestamptz`, set on account creation |
| `/api/pulse/suggest-questions` | New route — calls OpenRouter, returns 5 suggested questions |
| `/[lang]/onboarding` | New page — 3-step wizard |
| Resend email jobs | 4 scheduled emails triggered at account creation |

No changes to `pulse_metrics`, `prompt_bank`, or `clients` schemas.

### Trial Expiry Detection

`getProfile()` in `lib/auth.ts` is extended to compute `is_trial` and `trial_days_remaining` from `accounts.trial_ends_at`. All dashboard pages and the result page CTA read these values server-side. No client-side polling needed.

### Email Scheduling

Emails are scheduled via the existing `/api/cron/` pattern. A new `/api/cron/trial-emails` route runs daily (Vercel cron), queries accounts where `trial_started_at` is 1, 5, 7, or 10 days ago and `plan = 'basic'` (trial accounts), and fires the appropriate Resend template if not already sent. A `trial_emails_sent` integer column on `accounts` tracks which emails have fired (bitmask: 1=day1, 2=day5, 4=day7, 8=day10).

### Onboarding Without Scan ID

If a user visits `/[lang]/onboarding` without a `?scan=` param (e.g. direct link, expired scan), steps 1 and 2 are manual (brand name text input, domain text input). Step 3 (industry + region) is unchanged.

---

## Component Map

| Component | Location | Notes |
|---|---|---|
| `TrialCta` | `components/result/` | Replaces Fix Pack CTA post-email-gate |
| `OnboardingWizard` | `components/onboarding/` | 3-step form, client-side |
| `TrialBanner` | `components/dashboard/` | Persistent top bar with countdown |
| `PulsePage` (unified) | `app/[lang]/pulse/[clientId]/page.tsx` | Merges Pulse + Prompts |
| `ScanLogSection` | `components/pulse/` | Section ② — question rows + expand |
| `QuestionRow` | `components/pulse/` | Single expandable question with platform dots |
| `QuestionBankSection` | `components/pulse/` | Section ③ — wraps existing PromptBankEditor |
| `SuggestQuestionsPanel` | `components/pulse/` | Slide-in panel for AI suggestions |
| `/api/pulse/suggest-questions` | `app/api/pulse/suggest-questions/route.ts` | New OpenRouter call |

---

## Out of Scope

- Password-based auth (magic link + Google OAuth only)
- Multi-language email drip (English only for v1)
- Stripe integration changes (trial is free, no card required)
- Pulse scanner frequency changes (remains weekly)
- Mobile-specific layouts (responsive but not mobile-first redesign)
