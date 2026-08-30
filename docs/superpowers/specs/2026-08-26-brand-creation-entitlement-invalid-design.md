# Brand creation: map ACCOUNT_ENTITLEMENT_INVALID — design

**Date:** 2026-08-26
**Status:** Approved, ready for implementation planning
**Scope:** `app/api/dashboard/clients/route.ts` error handling only.

## Problem

`check_brand_limit()` (migrations `026`/`028`) raises `ACCOUNT_ENTITLEMENT_INVALID` when an
account's stored `plan`/`status` is malformed and no live admin override rescues it (see
`docs/superpowers/specs/2026-07-26-admin-plan-override-design.md`). `POST
/api/dashboard/clients` only special-cases `BRAND_LIMIT_REACHED` from that same trigger; this
exception instead falls through to the generic handler and returns an opaque `500 "Failed to
create brand"`, indistinguishable from an unrelated database outage.
`__tests__/api/dashboard-clients.test.ts` covers unauthenticated, brand-limit (pre-check and
trigger race), a generic DB failure, and a sanitized-diagnostic unique-violation case — nothing
covers this one.

## Decision

Add a second `message.includes(...)` branch in the route's `catch` block, immediately after the
existing `BRAND_LIMIT_REACHED` branch and before the fallback `sanitizeDatabaseError`/500 path:

```ts
if (message.includes('BRAND_LIMIT_REACHED')) {
  return NextResponse.json({ error: 'BRAND_LIMIT_REACHED', plan, limit }, { status: 403 })
}
if (message.includes('ACCOUNT_ENTITLEMENT_INVALID')) {
  console.error(`[dashboard/clients] entitlement invalid for account ${profile.account_id}`)
  return NextResponse.json({ error: 'ACCOUNT_ENTITLEMENT_INVALID' }, { status: 409 })
}
```

**409, not 500:** the account's own stored state is what's wrong, not the request or an
infrastructure fault. Pairing it with a stable error code makes the condition diagnosable in
logs/monitoring without decoding a generic exception.

**A plain `console.error` is enough** — unlike a raw Postgres error code, which needs
`sanitizeDatabaseError`'s decoding to become meaningful, this message already names the
diagnosis (this specific account's `plan`/`status` is malformed).

**Rejected: a shared "trigger-exception → response" helper.** Only two cases exist today
(`BRAND_LIMIT_REACHED`, `ACCOUNT_ENTITLEMENT_INVALID`); abstracting two call sites in one file
is premature. Revisit if a third case appears.

**Out of scope: `AddBrandWizard.tsx`'s error UI.** It already falls back to a generic message
for anything other than `BRAND_LIMIT_REACHED`, so this change is backend-only diagnosability —
the user-visible behavior for this (rare, admin-state) edge case doesn't change. No migration or
`lib/tier.ts` change either: the trigger already raises this correctly today, covered by
`__tests__/db/brand-limit-entitlement.test.ts`.

## Testing

One new case in `__tests__/api/dashboard-clients.test.ts`, mirroring `'returns 403 when the
trigger raises BRAND_LIMIT_REACHED on the race'`: wire the insert to reject with
`Error('ACCOUNT_ENTITLEMENT_INVALID')`, assert `409` and
`{ error: 'ACCOUNT_ENTITLEMENT_INVALID' }`.
