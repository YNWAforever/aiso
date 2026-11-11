# Per-fix billing design (models B + C)

**Status:** direction approved 2026-11-11; implementation awaiting a named migration approval and
Stripe objects the owner must create. Audit this builds on:
[2026-11-11-phase-4-growth-billing-readiness.md](2026-11-11-phase-4-growth-billing-readiness.md).

## Decisions taken

| Question | Decision (2026-11-11) |
| --- | --- |
| Billable unit | **each newly generated fix pack** |
| Model B | metered Stripe line on the brand's account, reported per fix pack |
| Model C | one-off Stripe invoices issued by the super admin |
| Who controls billing | platform administrator (`profiles.is_admin`, written only by `npm run grant-admin`) |
| Super admin identity | profile `b06b4886-bf0d-4396-9959-c0c5d65f980c` (`laichiwillyjp@gmail.com`), granted 2026-11-11, ledger row `41306b07-62f4-410d-9de4-ab583edc2a44` |
| New-brand account opening | unchanged self-serve onboarding; the admin **opens/controls billing on the account** rather than creating accounts |
| Trial emails | separate change, PR #223; scheduled once the Worker is on the paid plan |

## Non-goals

- No change to plan prices, entitlements, tenancy gates, or the free-scan funnel.
- No automatic dunning loop: retries are explicit, bounded and idempotent.
- No tax engine; Stripe's tax settings remain the source of truth.
- No change to the existing subscription lifecycle webhook (`apply_stripe_account_event`).

## Stripe objects (owner creates; code only reads env)

Stripe v22 / API `2026-04-22.dahlia` replaced legacy usage records with **Billing Meters and v2
meter events**. The price must reference a meter; usage is reported as meter events.

1. **Meter** — display name `Fix packs`, event name `fix_pack_generated`, aggregation `sum`,
   customer mapping `stripe_customer_id` (default), value key `value` (default).
2. **Product** — e.g. `AISO fix pack`.
3. **Price** — recurring, `recurring.meter` = that meter, `recurring.usage_type: 'metered'`,
   monthly interval, unit amount = the agreed per-fix-pack price.
4. Env vars the code reads:
   - `STRIPE_PRICE_FIX_METERED` — the metered price id.
   - `STRIPE_FIX_METER_EVENT_NAME` — `fix_pack_generated` (must match the meter).
   - `STRIPE_INVOICE_DAYS_UNTIL_DUE` — optional, default `14`.
   Unset price/event name = metering fails closed (`STRIPE_CONFIG_MISSING`), nothing is charged and
   the usage row stays `pending`/`failed` for the admin to see.

## Data model (migration 107)

Posture follows migration `101`: composite tenant FKs, RLS enabled with app SELECT/INSERT only,
`aeo_app` grants, no policies (asserted by the tenancy inventory test). `db()` is the only client.

### `account_billing` — one row per account whose billing the admin opened

```sql
create table if not exists public.account_billing (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  stripe_customer_id text not null unique,
  stripe_subscription_id text,
  stripe_metered_item_id text,
  mode text not null default 'included',
  opened_by uuid not null,              -- frozen platform-admin profile id, no FK
  opened_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_billing_mode_check check (mode in ('included', 'metered')),
  constraint account_billing_metered_shape_check
    check (mode <> 'metered' or stripe_metered_item_id is not null)
);
```

`included` = billing opened but fixes stay in the plan; `metered` = every newly generated fix pack
is billable. The row is the admin's control surface; `accounts.stripe_customer_id` remains the
customer pointer the checkout and subscription webhook already use.

### `fix_billing_events` — insert-only ledger, one row per billable fix pack

```sql
create table if not exists public.fix_billing_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  client_id uuid not null,
  fix_pack_id uuid not null unique references public.fix_packs(id) on delete restrict,
  quantity integer not null default 1 check (quantity = 1),
  state text not null default 'pending',
  stripe_meter_event_identifier text,
  attempts integer not null default 0 check (attempts between 0 and 10),
  last_error_code text,
  created_at timestamptz not null default now(),
  reported_at timestamptz,
  constraint fix_billing_events_state_check
    check (state in ('pending', 'reported', 'failed', 'void')),
  constraint fix_billing_events_reported_shape_check
    check (state <> 'reported'
           or (reported_at is not null and stripe_meter_event_identifier is not null)),
  constraint fix_billing_events_error_check
    check (last_error_code is null or last_error_code ~ '^[A-Z][A-Z0-9_]{2,40}$'),
  constraint fix_billing_events_client_tenant_fkey
    foreign key (client_id, account_id)
    references public.clients (id, account_id) on delete restrict
);
create index if not exists fix_billing_events_account_idx
  on public.fix_billing_events (account_id, created_at desc);
create index if not exists fix_billing_events_state_idx
  on public.fix_billing_events (state) where state <> 'reported';
```

`unique (fix_pack_id)` is the double-billing guard: a retry or a racing request cannot insert a
second row. The Stripe v2 meter event's `identifier` is `'fixbilling:' || fix_pack_id`; Stripe
enforces identifier uniqueness over a rolling 24 hours, which absorbs a lost response on retry.
Retries older than 24 h are refused by the admin action and surfaced for reconciliation instead of
risking a second charge.

### `billing_invoices` — mirror of admin-issued one-off invoices

```sql
create table if not exists public.billing_invoices (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete restrict,
  stripe_invoice_id text unique,
  description text not null,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null check (currency in ('usd', 'hkd')),
  status text not null default 'draft',
  hosted_invoice_url text,
  created_by uuid not null,             -- frozen platform-admin profile id, no FK
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_invoices_description_check
    check (char_length(btrim(description)) between 3 and 500),
  constraint billing_invoices_status_check
    check (status in ('draft', 'open', 'paid', 'void', 'uncollectible'))
);
create index if not exists billing_invoices_account_idx
  on public.billing_invoices (account_id, created_at desc);
```

Why a local ledger instead of reading Stripe live: the meter call has an unknown outcome on
timeout, so its state must be retryable and idempotent locally; both lists must render without a
Stripe round trip; and both records must survive a Stripe outage.

## Webhook coupling (must ship with attaching the metered item)

`app/api/stripe/webhook/route.ts` resolves the purchased plan with
`getPurchasedPlan(subscription)`, which requires `items.data` to contain **exactly one item**. A
metered item attached to an existing plan subscription makes it two, so every later
`customer.subscription.updated` would resolve `null` — the account would stop being updatable by
Stripe. The same slice that attaches the metered item must change plan resolution to:

- pick the one item whose `price.id` is in `STRIPE_PRICES`; 0 or 2+ plan-priced items stay a
  refusal (`invalid_price`), never a guess;
- ignore the metered price entirely;
- for a metered-only admin-created subscription (no plan-priced item), keep the account's current
  plan (`basic`) and let the status mapping proceed. Such a subscription is **not** written to
  `accounts.stripe_subscription_id` if the account already has a plan subscription; the metered
  item lives on that plan subscription instead.

The existing `invoice.payment_failed` branch keys off `object.subscription`; one-off invoices have
none, so the new one-off mapping must run before that branch and must not touch
`apply_stripe_account_event`.

## Flows

### Opening a brand's billing (super admin)

`POST /api/admin/billing/accounts` `{ accountId, mode: 'included' | 'metered', plan?: 'basic' |
'pro' | 'enterprise' }`, gated by `requireApiAdmin`.

1. Ensure the customer: reuse `accounts.stripe_customer_id`, else `stripe.customers.create`
   (email from the account's owner profile) and store it on `accounts`.
2. For `metered`: ensure a subscription exists. If the account has one, attach the metered price
   as a second subscription item (`stripe.subscriptionItems.create`). If not, create a
   subscription with the chosen plan price **and** the metered item, then store its id on
   `accounts.stripe_subscription_id` through the existing guarded path (not by raw update). The
   plan price is required because entitlements read it; default `basic` if the admin omits one.
3. Upsert `account_billing` with `opened_by` = the admin's profile id.
4. Switching `metered` → `included` removes the subscription item; the ledger rows stay.
   Re-opening is idempotent: ids are reused, only `mode` changes.

### Metering a generated fix pack (model B)

`app/api/fix/route.ts` currently returns early when the freshly built pack equals the newest cached
one, and otherwise inserts via `insert … select … limit 1`. Changes:

1. The insert gains `returning id` so the new pack id is known; the cache-equal path stays free.
2. When the pack was newly inserted and the scan belongs to an account with
   `account_billing.mode = 'metered'`, insert `fix_billing_events` (`state='pending'`). A unique
   conflict means the row already exists — proceed to step 3 only if the row is `pending`/`failed`.
3. After the response is produced, report the event with `stripe.v2.billing.meterEvents.create({
   event_name, identifier: 'fixbilling:' || fix_pack_id, payload: { stripe_customer_id, value: '1' }
   })`.
4. Success → `state='reported'`, `stripe_meter_event_identifier`, `reported_at=now()`.
   Failure → `state='failed'`, `attempts+1`, bounded `last_error_code` (`STRIPE_CONFIG_MISSING`,
   `STRIPE_METER_EVENT_FAILED`, `ACCOUNT_METER_NOT_OPEN`). The fix response is never failed by a
   billing error.
5. Anonymous scans (`scans.account_id is null`) and unpaid/cached packs are never metered.

Retry: `POST /api/admin/billing/usage/:id/retry` re-sends the same identifier, allowed only within
24 h of `created_at` and only while `state` is `pending` or `failed` (a stuck pending row is
recoverable without a manual database edit), bounded by `attempts`; the admin UI shows
pending/failed counts per brand.

### One-off invoice (model C)

`POST /api/admin/billing/invoices` `{ accountId, description, amountCents, currency }`, gated by
`requireApiAdmin`.

1. Ensure customer (same as above).
2. `stripe.invoiceItems.create({ customer, amount, currency, description })`.
3. `stripe.invoices.create({ customer, collection_method: 'send_invoice', days_until_due })`,
   `finalizeInvoice`, `sendInvoice` (Stripe emails it; no Resend involvement).
4. Insert `billing_invoices` with `stripe_invoice_id`, `hosted_invoice_url`, `status='open'`.
   A Stripe failure writes nothing; a local insert failure after Stripe success is surfaced as
   `503 INVOICE_MIRROR_FAILED` and the admin action is retryable by hosted URL (the Stripe id
   says the invoice exists; the next attempt fills the mirror).

Webhook: extend `app/api/stripe/webhook/route.ts` with `invoice.finalized`, `invoice.paid`,
`invoice.payment_failed`, `invoice.voided`. When the invoice has no `subscription` (one-off), map
`finalized → open`, `paid → paid`, `payment_failed → open`, `voided → void` onto
`billing_invoices` by `stripe_invoice_id`. Subscription invoices keep the existing lifecycle path
unchanged.

### Client view

`app/[lang]/dashboard/billing/page.tsx` + `GET /api/billing` (account-scoped, `getProfile()`
filtered by `profile.account_id`):

- plan and entitlement source from `resolveCommercialEntitlement` (never `getPlanFeatures`);
- billing mode in plain language: "billed per fix pack" or "included in your plan";
- this Hong Kong month's billable fix-pack count, splitting **reported** from **not yet reported**;
  pending/failed must read as "not yet billed", never as billed (honesty copy, same as the
  `未有／未記錄／未連接` convention);
- one-off invoices with description, amount/currency, status and hosted invoice link;
- link to the existing Stripe customer portal (`/api/stripe/portal`).

`en` and `zh-HK` strings in `messages/`.

### Admin view

Extend `app/admin/billing/page.tsx` (reachable now that an admin exists) per account: opened mode,
usage counts by state, failed rows with a retry action, "Open billing / change mode" form,
"Issue one-off invoice" form, and Stripe customer/subscription links. All new admin routes gate on
`requireApiAdmin`; every response is computed from the session's admin profile, never from a
caller-supplied account id without an existence check.

## Slices (each its own PR)

1. **`107` schema + tests** — migration file, migration-reading test, tenancy inventory review.
2. **Usage recording + meter reporting** — fix route, local ledger, v2 meter event, admin retry
   API, unit tests with mocked Stripe.
3. **Admin billing controls** — open/switch account billing, issue invoice, admin UI, tests.
4. **Client billing view** — page + API + messages + tests.
5. **Webhook invoice statuses + multi-item plan resolution** — one-off invoice mapping, and the
   `getPurchasedPlan` change above shipped together with the slice that first attaches a second
   subscription item.
6. **Runbook/operator notes** — how to open, meter, invoice, retry and reconcile against Stripe.

## Named approvals still needed

1. **Migration 107 apply** before slice 2 merges: `npm run migrate` with `MIGRATE_DATABASE_URL`,
   then `npm run migrate -- --verify` must show `107_per_fix_billing.sql … recorded`, and the
   production build's schema gate must pass.
2. **Stripe objects and env vars** (above) — owner action in the Stripe dashboard; the code path
   fails closed until they exist.
3. **Worker deploy** for trial emails (PR #223) — separate named step; the account must be on the
   Cloudflare Workers paid plan first.

## Open questions

1. Does a metered account keep its normal plan subscription with the metered line added, or is the
   metered line the only subscription? This design adds the metered line to the existing plan
   subscription and requires a plan price when opening a subscription-less account (default
   `basic`).
2. Invoice currency: the design allows `usd` and `hkd`; default `usd`. Confirm before the first
   invoice.
3. Who may issue one-off invoices? Design: any `profiles.is_admin` (one admin role, no second
   tier). Confirm if invoicing should be narrower.
4. Retries: v1 is admin-triggered only. Add a scheduled retry later only if failed rows are common.
