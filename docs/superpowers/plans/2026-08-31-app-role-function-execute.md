# Restore `aeo_app` EXECUTE on Application RPCs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grant `aeo_app` EXECUTE on the ten RPCs the application calls, in both the migration
chain and the greenfield baseline, and add the regression test whose absence let this ship.

**Architecture:** One new migration (`038`) carrying explicit per-signature grants plus default
privileges for future functions; the identical grants mirrored into the baseline so both paths
converge; and a positive-direction assertion added to the existing least-privilege integration
test, which today asserts only denials.

**Tech Stack:** PostgreSQL DDL, `scripts/migrate.ts`, `scripts/schema-equivalence.mjs`, Vitest.

**Design:** `docs/superpowers/specs/2026-08-31-app-role-function-execute-design.md`

---

## Why the migration and the baseline mirror are ONE task

Adding `038` changes the legacy path only. If the baseline does not gain the same grants in the
same commit, `npm run schema:equivalence` flips from EQUIVALENT to DIVERGENT. They must land
together or the proof breaks. Task 1 does both; Task 2 adds the test.

---

### Task 1: Migration `038` and the baseline mirror

**Files:**
- Create: `supabase/migrations/038_app_role_function_execute.sql`
- Modify: `supabase/baseline/000_baseline_2026-08-31.sql`

- [ ] **Step 1: Confirm the current state is EQUIVALENT before changing anything**

Run: `npm run schema:equivalence`
Expected: `EQUIVALENT`, exit 0, all eight classes `ok`, and a `Deleted br-…` line. This is the
state you must not break. (~90s; provisions and destroys one disposable branch.)

If it is already DIVERGENT, STOP and report — something drifted before this task began.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/038_app_role_function_execute.sql`:

```sql
-- Restore EXECUTE for the application role on the RPCs it actually calls.
--
-- ROOT CAUSE. Migrations 024 and 027 revoke EXECUTE from PUBLIC unconditionally,
-- then grant it back only to `service_role` -- a Supabase role that does not
-- exist under Neon. Those grants sit inside `if to_regrole('service_role') is
-- not null` guards, so under Neon they silently no-op. Nothing in 001-037 ever
-- grants EXECUTE to aeo_app. Migration 037 then moved the application off
-- neondb_owner onto aeo_app, so from that point the app has connected as a role
-- that cannot execute the functions it calls:
--
--   app/api/stripe/webhook/route.ts:100,177,229      -> the three stripe functions
--   lib/reports/store.ts:560,579,604,618,631,812,826 -> the seven report RPCs
--
-- Measured on a disposable branch with 001-037 applied: 11 of 12 public
-- functions reported has_function_privilege('aeo_app', oid, 'EXECUTE') = false.
--
-- NOT INCLUDED, deliberately:
--   * check_brand_limit() -- a trigger function. PostgreSQL checks EXECUTE at
--     CREATE TRIGGER time, not per fire, so it works without a grant, and
--     granting it would add privilege the app never exercises directly.
--   * handle_new_user() -- never revoked; already executable.
--
-- 037 anticipated exactly this failure mode for TABLES ("Without this, migration
-- 038 creates a table aeo_app cannot read") and set default privileges for
-- tables and sequences -- but not for functions, which is why 024/027's
-- functions were missed. The `alter default privileges ... on functions` below
-- is what stops migration 039 reproducing this.

do $$
begin
  if to_regrole('aeo_app') is null then
    -- Warn rather than abort: on a database where 037 has not run yet there is
    -- nothing to grant to, and failing here would block the whole chain.
    raise warning 'aeo_app does not exist; skipping function grants. Re-run 038 after 037 creates the role.';
    return;
  end if;

  grant execute on function public.acquire_stripe_subscription_lease(text, uuid) to aeo_app;
  grant execute on function public.release_stripe_subscription_lease(text, uuid) to aeo_app;
  grant execute on function public.apply_stripe_account_event(
    uuid, text, text, text, text, bigint, text, text, uuid
  ) to aeo_app;

  grant execute on function public.create_client_report_with_version(
    uuid, uuid, uuid, uuid, text, text, integer, jsonb, uuid
  ) to aeo_app;
  grant execute on function public.append_client_report_version(
    uuid, uuid, uuid, uuid, uuid, text, text, integer, jsonb, uuid
  ) to aeo_app;
  grant execute on function public.publish_client_report_latest(uuid, uuid, uuid, uuid) to aeo_app;
  grant execute on function public.revoke_client_report(uuid, uuid, uuid) to aeo_app;
  grant execute on function public.rotate_client_report_link(uuid, uuid, uuid) to aeo_app;
  grant execute on function public.increment_client_report_view(text, integer) to aeo_app;
  grant execute on function public.increment_client_report_cta_click(text, integer) to aeo_app;

  -- Applies to functions created by the role running migrations (neondb_owner),
  -- the same caveat 037's table and sequence default privileges carry.
  alter default privileges in schema public grant execute on functions to aeo_app;
end $$;
```

- [ ] **Step 3: Mirror the grants into the baseline**

Open `supabase/baseline/000_baseline_2026-08-31.sql` and find the grants block — the
`grant select, insert, update, delete on all tables in schema public to aeo_app;` line (around
line 3044) and the `alter default privileges` statements just below it (around 3053–3055).

Append the same ten `grant execute` statements plus the functions default-privilege line
immediately after those, inside whatever role guard the surrounding block already uses. Match
the file's existing comment style, and note in a short comment that these mirror migration
`038` — change one, change the other, or the equivalence proof breaks.

Ordering is already satisfied: the baseline creates all twelve functions before the grants
block, so every function exists by the time these run.

- [ ] **Step 4: Re-prove equivalence**

Run: `npm run schema:equivalence`
Expected: **still `EQUIVALENT`, exit 0**, all eight classes `ok`, branch deleted.

Legacy gets the grants from `038`; greenfield from the baseline; the two must agree.

**If a class reports a difference:** most likely a signature typo — though note a `grant` on a
non-existent signature raises rather than silently missing, so the migration itself would have
failed first. Compare the migration and the baseline statement-for-statement.

**The differ cannot confirm the grants actually landed.** Its `grants` class reads
`information_schema.role_table_grants` (tables only), and its `functions` class compares
`returns|volatility|security_definer`, not ACLs. EQUIVALENT proves the two paths *agree*, not
that either is *correct*. Task 2's test is what proves correctness.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/038_app_role_function_execute.sql supabase/baseline/000_baseline_2026-08-31.sql
git commit -m "fix(db): grant aeo_app execute on the RPCs the app calls"
```

---

### Task 2: Regression test

**Files:**
- Modify: `__tests__/integration/least-privilege-role.test.ts`

This is the test whose absence let the defect ship. The file today asserts only *denials* —
each forbidden operation matched on its specific error message. Nothing asserted the role can
do what it must.

- [ ] **Step 1: Write the test**

The file already connects as `aeo_app` in `beforeAll`: it sets a generated password via the
owner connection, rebuilds the URL with `username = 'aeo_app'`, and exposes it as `app`. Reuse
that — do not build a second connection.

Add this `describe` block:

```ts
describe('aeo_app can execute the RPCs the application calls', () => {
  // The negative assertions elsewhere in this file are only half the contract.
  // 024 and 027 revoked EXECUTE from PUBLIC and granted it back only to
  // `service_role`, which does not exist under Neon, so after 037's cutover the
  // application connected as a role that could not run its own RPCs. Migration
  // 038 fixes that; this asserts it stays fixed. Adding an RPC without granting
  // it fails here.
  const CALLED_RPCS = [
    'public.acquire_stripe_subscription_lease(text, uuid)',
    'public.release_stripe_subscription_lease(text, uuid)',
    'public.apply_stripe_account_event(uuid, text, text, text, text, bigint, text, text, uuid)',
    'public.create_client_report_with_version(uuid, uuid, uuid, uuid, text, text, integer, jsonb, uuid)',
    'public.append_client_report_version(uuid, uuid, uuid, uuid, uuid, text, text, integer, jsonb, uuid)',
    'public.publish_client_report_latest(uuid, uuid, uuid, uuid)',
    'public.revoke_client_report(uuid, uuid, uuid)',
    'public.rotate_client_report_link(uuid, uuid, uuid)',
    'public.increment_client_report_view(text, integer)',
    'public.increment_client_report_cta_click(text, integer)',
  ]

  it.each(CALLED_RPCS)('grants EXECUTE on %s', async (signature) => {
    // Asked of the app connection itself, so this proves the privilege the
    // running application actually has -- not what the owner believes it granted.
    const rows = await app.query(
      "select has_function_privilege($1::text, 'EXECUTE') as can_execute",
      [signature],
    )
    expect(rows[0]?.can_execute).toBe(true)
  })

  it('does not grant EXECUTE on the trigger function, which needs none', async () => {
    // PostgreSQL checks EXECUTE on a trigger function at CREATE TRIGGER time,
    // not per fire, so check_brand_limit works unprivileged. Asserting the
    // absence keeps 038 from being widened without a reason.
    const rows = await app.query(
      "select has_function_privilege($1::text, 'EXECUTE') as can_execute",
      ['public.check_brand_limit()'],
    )
    expect(rows[0]?.can_execute).toBe(false)
  })
})
```

- [ ] **Step 2: Prove the test detects the defect**

A regression test that cannot fail is worthless. Temporarily remove the migration and run:

```bash
mv supabase/migrations/038_app_role_function_execute.sql /tmp/038.sql
npx vitest run --config vitest.integration.config.ts __tests__/integration/least-privilege-role.test.ts
mv /tmp/038.sql supabase/migrations/038_app_role_function_execute.sql
```

Expected with `038` absent: the ten `grants EXECUTE on …` cases FAIL (`can_execute` is
`false`), and the `check_brand_limit` case passes. Quote the actual failure output.

**If the ten cases PASS without `038`, the test is not measuring what it claims — STOP and
report.** (That would also mean the grants came from somewhere else, which is itself important.)

Confirm the migration file is back in place before continuing.

- [ ] **Step 3: Run it green**

```bash
npx vitest run --config vitest.integration.config.ts __tests__/integration/least-privilege-role.test.ts
```
Expected: all cases pass including the ten new ones; branch deleted. The run's output should
show `Applying 038_app_role_function_execute.sql … ok`, which is also the proof that `038`
applies cleanly from scratch (globalSetup drops `public` and replays the whole chain).

- [ ] **Step 4: Full check**

```bash
npm run lint && npm run typecheck && npm test
```
Expected: lint 0 errors / 0 warnings, typecheck clean, unit suite green. The unit project skips
integration loudly without `neonctl` — normal, not a failure.

- [ ] **Step 5: Commit**

```bash
git add __tests__/integration/least-privilege-role.test.ts
git commit -m "test(db): assert aeo_app can execute the RPCs the app calls"
```

---

## Final verification

- [ ] **Step 1: Equivalence intact**

Run: `npm run schema:equivalence`
Expected: `EQUIVALENT`, exit 0, branch deleted.

- [ ] **Step 2: Diff scope**

Run: `git diff main...HEAD --stat`
Expected: only `supabase/migrations/038_app_role_function_execute.sql` (new),
`supabase/baseline/000_baseline_2026-08-31.sql`,
`__tests__/integration/least-privilege-role.test.ts`, and docs. **No change to `024`, `027`, or
`037`** — they stay as historical record per the spec.

- [ ] **Step 3: Hand the production check back to a human**

This plan fixes the chain. It does **not** establish production's state, and must not claim to.
Report to the stakeholder:

> Migration `038` is ready but has **not** been applied to production. Before applying, confirm
> whether the grants were already made by hand — connect as the owner and run:
>
> ```sql
> select p.proname, has_function_privilege('aeo_app', p.oid, 'EXECUTE') as can_execute
> from pg_proc p join pg_namespace n on n.oid = p.pronamespace
> where n.nspname = 'public' order by p.proname;
> ```
>
> If those show `false`, the Stripe webhook and client-report paths have been failing since the
> `037` cutover (2026-08-18) and this is urgent. Apply with `npm run migrate`, which uses
> `MIGRATE_DATABASE_URL` — the owner connection, since `aeo_app` cannot grant to itself.
