# Runbook: add a second member to an account, and let them approve

This is the procedure AC-14's `approve` and `request-changes` verbs need. Before
migrations 047 and 048 it was not a procedure at all — it was two direct
`UPDATE`s against production (`profiles.account_id` and `profiles.is_admin`),
neither of which the product could perform and neither of which left a record.

## What has to be true before anyone can approve

`can_decide` (`lib/change-sets/store.ts`) is true only when **all** of these hold
for the person looking at a submitted version:

1. they have a `profiles` row in the **same account** as the version;
2. they are **not** the profile that submitted it (AC-08, separation of duties);
3. they hold a live `account_approver` grant — `account_approver_state.active`,
   with the event behind the current revision being a `grant`.

So a workspace with one member can never approve anything, whatever roles that
member is given. Two of those three conditions are now reachable through the
product; the third needs one operator action, once per administrator.

## Step 1 — invite the second person (product, no operator)

Any member: **Settings → Members → Email address to invite → Send invitation**.

There is no accept link and no token. The invitation is consumed when that
address **signs in for the first time**, which is what makes it safe to email:
a forwarded copy grants nothing, because whoever receives it still has to prove
control of the address through Neon Auth.

Two consequences worth knowing before you type an address:

- **An address that already has an AISO account cannot be invited.** A profile
  is created once, during `user.created`, so an existing user can never take up
  an invitation. The form refuses with that reason rather than creating one that
  would sit at `pending` forever. Use an address that has never signed in.
- If the notification email fails, the invitation still stands — the panel says
  so. Tell the person yourself; signing in is what joins them.

Verify: their name appears under **People in this workspace**, marked
*Cannot approve work*.

## Step 2 — make somebody a platform administrator (operator, once)

Granting `account_approver` is done by `POST /api/admin/accounts/{accountId}/approvers`,
gated by `requireApiAdmin()` — i.e. `profiles.is_admin`. That flag is the
platform's to give, deliberately: migration 042 pins the granting actor as
`platform_admin` in a CHECK, so an account cannot appoint its own approvers.

Nothing in the application writes `is_admin`. Use the operator script:

```bash
npm run grant-admin -- --list
```

```bash
npm run grant-admin -- --grant <profile-uuid> --reason "why this person"
```

That is a **dry run**: it prints what it would do and writes nothing. Re-run
with `--yes` to apply:

```bash
npm run grant-admin -- --grant <profile-uuid> --reason "why this person" --yes
```

Notes:

- It runs through **`MIGRATE_DATABASE_URL`**, not `DATABASE_URL`, and refuses to
  start without it. Holding the owner credential *is* the authorisation; the
  running application does not have it. `npm run grant-admin` loads it from
  `.env.local` — never paste a connection string into a shell, because the Neon
  driver echoes the full URL, password included, in its error messages.
- The flag and the reason are written by **one statement**, so an administrator
  cannot exist without a `platform_admin_grants` row saying who and why.
  Re-granting to somebody who already holds it writes nothing.
- `--revoke <profile-uuid> --reason "..." --yes` takes it away and records that
  as its own entry.
- Deleting the profile does **not** delete the ledger row. That is deliberate
  (migration 046's rule): a decision is a frozen identity.

Do not grant platform administration to solve an account-level problem. It is
access to every account, not a bigger version of membership.

## Step 3 — grant the approver role (administrator, through the product)

As that administrator, `POST /api/admin/accounts/{accountId}/approvers` with the
profile id of the invited member and a reason. `GET` the same route first to
read the member list and the current revision — the mutation is revision-checked.

Verify: on **Settings → Members** the invited member now reads *Can approve
work*.

## Step 4 — check the thing you actually wanted

Have the **other** person submit a version, then open it as the approver. The
detail page should offer approve and request-changes. If it does not, the usual
cause is condition 2: the approver is also the submitter, and `can_decide` is
correctly false. That is the branch `tests/e2e/authenticated/owner-review.spec.ts`
exercised on 2026-09-11, when no second member could exist.

## Rolling back

- Withdraw an invitation: **Settings → Members → Withdraw**. The row is revoked,
  never deleted, so an offered membership stays explainable.
- Remove an approver: `POST` the approvers route with the revoke action.
- Remove an administrator: `npm run grant-admin -- --revoke … --yes`.
- There is **no supported way to remove a member from an account.** A profile's
  `account_id` never moves, because the composite-FK tenancy chain in 041–046
  would strand the history that profile authored. Revoking their approver role
  and their sign-in is the available answer; removing the person is a change
  that has not been designed yet.
