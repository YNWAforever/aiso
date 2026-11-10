# Phase 4 readiness: self-serve growth and per-fix billing

**Status:** Phase 4 ("Growth and billing") is parked in the current phase plan. This
is the audit that should precede its code, so the next step is a decision instead
of a guess. Read-only: no schema, entitlement, tenancy or UI change is proposed
here.

## 1. Free-scan → trial funnel: already built and instrumented

The self-serve path exists end to end today:

1. **Anonymous scan** — `components/home/ScanForm.tsx` posts `/api/scan` and routes
   to `/{lang}/result/[id]`; `scan_completed` is the first funnel event.
2. **Public result** — `components/result/ResultClient.tsx` shows each check's
   verdict but no messages, details or remediation to an anonymous reader, records
   `scan_result_viewed` and, when the scan has a usable score, `signup_cta_viewed`.
3. **Unlock** — `components/result/AccountUnlockCard.tsx` POSTs
   `/api/scans/{id}/claim-intent` (signed cookie, rate-limited), then offers Google
   or a magic link; `signup_started` records the provider and `scanId`.
4. **Return** — `components/result/ClaimScanOnReturn.tsx` completes the session,
   posts the claim, records `signup_succeeded` + `scan_claim_succeeded` (or
   `scan_claim_failed` with a redacted code), and continues to onboarding with the
   scan for prefill.
5. **Account** — the Neon Auth `user.created` webhook
   (`app/api/webhooks/neon/route.ts`) provisions the `profiles` + `accounts` pair;
   the account starts as `plan 'basic', status 'active'` with **no trial dates**.
6. **Trial** — the seven-day trial starts when onboarding completes (`POST
   /api/onboarding/complete`, which calls `completeOnboarding` → `initializeOnboarding`):
   the `trial` CTE sets `accounts.trial_started_at` and
   `trial_ends_at = coalesce(trial_started_at, now()) + interval '7 days'`
   (`lib/onboarding/store.ts:54-57`), then it creates the brand and seeds prompts
   under `PULSE_ACTIVE_QUESTIONS_PER_BRAND`.
7. **Instrumentation** — the event vocabulary and redacted shape are declared twice
   (`lib/funnel-client.ts` for the browser, `lib/observability/funnel.ts` for the
   server validator); `POST /api/funnel-events` is public, 2 KiB-capped,
   rate-limited and stores only redacted fields.
8. **More brands** — `components/dashboard/AddBrandWizard.tsx` links to the same
   onboarding from the dashboard, shown only when the plan's brand capacity allows
   it (`app/[lang]/dashboard/page.tsx`).

So neither "self-serve brand signup" nor the "free-scan → trial funnel" is missing
code. What remains is operational:

- **Trial drip emails are built but unscheduled.** `app/api/cron/trial-emails`
  sends the four emails in `lib/trial-emails.ts` (days 1/5/7/10 after
  `trial_started_at`), but the deployable Worker
  (`cloudflare/aiso-worker/wrangler.jsonc`) schedules only
  `17 4 * * *`, `47 7 * * 1` and `17 16 * * *` — not `0 9 * * *`. The Cloudflare
  free tier allows three triggers and all three are used, so enabling these means
  a paid plan or a named decision on which schedule gives way.
- **Onboarding is the activation step, and nothing re-prompts a stalled signup.**
  An account that signs in and never finishes onboarding keeps `trial_ends_at`
  null; the funnel records `onboarding_started`/`onboarding_completed`, so the
  drop-off is measurable, but no email or nudge exists for it.
- **Paid conversion is not instrumented.** The funnel ends at
  `upgrade_prompt_viewed`/`upgrade_prompt_clicked`; there is no
  `checkout_started` or `subscription_started` event, so a revenue-funnel report
  cannot see from pricing to paid.

## 2. Per-fix billing: nothing to bill yet

A fix pack is currently a **plan feature, not a billable unit**:

- Pricing advertises `row_fixpack` / `row_fixpack_adv`
  (`app/[lang]/(marketing)/pricing/page.tsx`).
- `app/api/fix/route.ts` generates and caches one pack per scan in `fix_packs`
  (migration `001`, extended by `012`).
- There is no price per fix, no one-off payment, invoice-creation or metered-billing
  code, and no per-brand charge or usage table. The only Stripe surfaces are
  subscription checkout, the billing portal and the subscription webhook (which
  handles `checkout.session.completed` and `invoice.payment_failed`).

"Per-fix billing views" therefore cannot be built safely as a view yet: there is
no charge to view. Three defensible models, in increasing scope:

- **A — visibility only.** Per-brand count of generated and accepted fix packs per
  month, read from existing `fix_packs`/`scans` rows. No money moves, no schema
  change, and it produces the data any later metered model needs.
- **B — metered subscription.** A Stripe metered price on the existing
  subscription, one meter event per billable fix. Needs the definition below,
  Stripe product/config work, and idempotent meter writes (retries must not
  double-bill).
- **C — one-off invoices.** An invoice per accepted fix or per site-edit hand-off
  (S8). Same definition, plus a finance workflow for dunning and refunds.

Decisions needed before code: **what counts as a billable fix** (pack generated,
fix accepted by the client, or hand-off sent), **who pays** (the brand's account —
which plans), **which surface** (client dashboard billing vs the internal
`/admin/billing`), and whether per-fix pricing **replaces or complements** the
plan prices. Without those answers a view would encode an invented policy.

## 3. Recommended next slices

1. **Decide trial-email scheduling.** If yes, it is one Worker schedule change
   plus a deploy under a named approval; if the free trigger limit binds, name
   which cron gives way.
2. **Decide the per-fix model.** "A" is shippable without a commercial decision
   or a migration; "B"/"C" need the definition above first.
3. **Optional:** close the paid-conversion instrumentation gap
   (`checkout_started`/`subscription_started`) if that metric matters more than a
   per-fix view right now.

## Not changed by this audit

No migrations, no entitlement or tenancy changes, no UI edits. The Q1 replay, the
retainer loop and monthly-report work are unaffected.
