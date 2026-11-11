# Per-fix billing runbook (Phase 4)

Design: [`../superpowers/specs/2026-11-11-per-fix-billing-design.md`](../superpowers/specs/2026-11-11-per-fix-billing-design.md)
Schema: `supabase/migrations/107_per_fix_billing.sql` (recorded 2026-11-11, applied by hand
under a named approval; the runner is `npm run migrate` with `MIGRATE_DATABASE_URL`).

Two shapes of money, deliberately separate:

- **Per-fix metered billing** — a Stripe Billing Meter (`fix_pack_generated` by default) and a
  metered subscription item on the account's plan subscription. One billable unit per newly
  generated fix pack.
- **One-off invoices** — an admin issues a `send_invoice` Stripe invoice (e.g. the monthly
  retainer) against the account's customer; Stripe emails the customer.

Code surfaces: `lib/billing/usage.ts` (meter), `lib/billing/accounts.ts` (open/switch),
`lib/billing/invoices.ts` (one-off invoices + mirror), `lib/billing/client-view.ts` (client
view). Routes: `POST /api/admin/billing/accounts`, `POST /api/admin/billing/invoices`,
`POST /api/admin/billing/usage/[eventId]/retry`, `GET /api/admin/billing/per-fix`,
`GET /api/billing`. UI: `/admin/billing` (panel), `/{lang}/dashboard/billing`.

## 1. Owner setup (one-time, before metered billing can open)

1. Stripe Dashboard → **Billing → Meters** → create meter `fix_pack_generated`
   (sum aggregation, up to us; usage is one event per generated fix pack).
2. Create a product (e.g. "AISO Fix Pack") and a **metered** recurring price that draws from
   that meter. Copy the `price_…` id.
3. Set in Vercel (Production + Preview) and `.env.local`:
   - `STRIPE_PRICE_FIX_METERED=price_…`
   - `STRIPE_FIX_METER_EVENT_NAME=fix_pack_generated` (must match the meter exactly)
   - optional `STRIPE_INVOICE_DAYS_UNTIL_DUE` (1–90, default 14)
4. Confirm the Stripe webhook subscribes to `invoice.finalized`, `invoice.paid`,
   `invoice.payment_failed`, `invoice.voided` in addition to the existing lifecycle events.

Until step 3 is complete the system is **fail-closed**: opening metered billing returns
`503 METERED_NOT_CONFIGURED`; no fix pack can be charged. `STRIPE_PRICE_FIX_METERED` and
`STRIPE_FIX_METER_EVENT_NAME` are read through `fixPackMeterConfig()` in `lib/stripe.ts`.

## 2. Open or switch an account

`POST /api/admin/billing/accounts` (super admin only; JSON):

| Body | Result |
| --- | --- |
| `{accountId, mode:'included'}` | Detaches the stored metered subscription item (if any) and records `included`. Fix packs stop counting as billable. |
| `{accountId, mode:'metered'}` | Requires a live subscription. Attaches (or reuses) the metered price as a second item on that subscription. |
| `{accountId, mode:'metered', plan:'basic'\|'pro'\|'enterprise', createSubscription:true}` | Only for accounts with no subscription. Creates a real `send_invoice` subscription with the plan price (day-14 due) **plus** the metered item, then links it to the account through the lease + `apply_stripe_account_event`. If linking fails the new subscription is cancelled. |

Rules that are structural, not conventions:

- A mode toggle never auto-subscribes. `createSubscription:true` is a separate, explicit body
  field because it creates a real invoice.
- Opening `included` never deletes the ledger; it only detaches the item. Switching back to
  metered reuses/creates the item.
- The route is gated by `requireApiAdmin`; the account id comes from the admin body (the admin
  console is platform-wide by design).
- `billing_invoices`/`account_billing` RLS is default-deny with app SELECT/INSERT/UPDATE only.

## 3. Meter flow and what "not billed" means

1. A billable fix pack is generated (brand-account scan → `POST /api/fix`).
2. `enqueueFixPackUsage` inserts one `fix_billing_events` row **only when that account's
   `account_billing.mode = 'metered'`** (`on conflict (fix_pack_id) do nothing` — the unique
   key is the double-billing guard). Identifier: `fixbilling:<uuid>`.
3. `after()` calls `reportFixPackUsage`: creates the Stripe meter event
   (`stripe.v2.billing.meterEvents.create`), then marks the row `reported`.
4. If Stripe fails or config is missing, the row is `pending`/`failed` with a bounded
   `last_error_code`; the fix-pack response is never failed by billing.

Honest states: `reported` = Stripe accepted it; `pending`/`failed` = **not billed**. The client
view and the admin overview show the split and never sum it into a billed figure.

Retry: `POST /api/admin/billing/usage/{eventId}/retry` — same identifier (no double charge),
attempts capped at 10, only inside the 24-hour window (`MAX_METER_ATTEMPTS`,
`METER_RETRY_WINDOW_MS`). Do not retry an event by editing the row in SQL; use the route.

Reconciliation query (read-only, owner credential):

```sql
select state, count(*), min(created_at), max(created_at)
from fix_billing_events group by state order by state;
```

Then compare reported rows against Stripe **Meter events** filtered by identifier prefix
`fixbilling:` for the same window. A `reported` row with no Stripe event is a defect; a
Stripe event with no row cannot come from this app (identifiers are minted at insert).

## 4. One-off invoices

- Issue: `POST /api/admin/billing/invoices {accountId, description, amountCents, currency:'usd'|'hkd'}`.
  Creates a `send_invoice` invoice (`auto_advance:false`, metadata `account_id`/`source`/`created_by`),
  adds the line item, finalizes, sends, then mirrors it into `billing_invoices`.
- If Stripe fails: nothing is written and any invoice it created is voided best-effort.
- If the mirror write fails after Stripe succeeded: `503 INVOICE_MIRROR_FAILED` includes
  `stripeInvoiceId` and `hostedInvoiceUrl`. **Re-mirror** with
  `POST /api/admin/billing/invoices {stripeInvoiceId}` — never issue a second invoice.
- Status mirror: webhook `invoice.finalized`/`invoice.paid`/`invoice.payment_failed`/
  `invoice.voided` with **no subscription** update the row (finalized/payment_failed → open,
  paid → paid, voided → void). Events for invoices this app did not create are acknowledged
  without writing.
- Refunds/disputes are Stripe-side; the local mirror does not model them. Use the Stripe
  dashboard and treat `billing_invoices` as a convenience mirror, not the ledger of record.

## 5. Rollback / stop the meter

1. `POST /api/admin/billing/accounts {accountId, mode:'included'}` → detaches the metered item.
   Existing reported usage stays on the invoice as normal Stripe usage; nothing new is accrued.
2. Remove `STRIPE_PRICE_FIX_METERED`/`STRIPE_FIX_METER_EVENT_NAME` to fail closed for any
   account that still has a metered item configured (`METERED_NOT_CONFIGURED` on new opens;
   existing items are untouched).
3. Never delete `fix_billing_events` rows — the table is insert-only by grant and is the audit
   trail for what was charged. `billing_invoices` rows may be corrected to match Stripe, but
   the webhook owns status; do not hand-edit status except during a documented incident.

## 6. Verification checklist after a deploy

- [ ] Production build log: `schema gate: all 105 shipped migrations are recorded.` (or newer count)
- [ ] `GET /api/billing` without a session → `401`
- [ ] `/admin/billing` (as super admin) shows the per-fix panel; a non-admin gets the admin gate
- [ ] One test pack on a metered sandbox account shows `reported` and appears in Stripe Meter events
- [ ] Un-metered account generates a pack → no `fix_billing_events` row
- [ ] Issuing a test one-off invoice sends the Stripe email and the row appears in
      `billing_invoices`; paying it flips status to `paid` via webhook
