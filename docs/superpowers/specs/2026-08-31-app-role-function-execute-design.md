# Restore `aeo_app` EXECUTE on application RPCs — design

**Status:** Approved 2026-08-31
**Severity:** Confirmed defect in the migration chain. Affects the Stripe webhook path and the
entire client-reports feature on any database built from `001`–`037`.

## The defect

Migrations `024` and `027` revoke `EXECUTE` from `PUBLIC` **unconditionally**, then grant it
back **only to `service_role`** — a Supabase role that does not exist under Neon. Those grants
sit inside `if to_regrole('service_role') is not null` guards, so under Neon they silently
no-op. Nothing in `001`–`037` ever grants `EXECUTE` to `aeo_app`.

Migration `037` (PR #47, merged 2026-08-18) then moved the application off `neondb_owner` onto
the least-privilege `aeo_app` role. From that moment the application has been connecting as a
role that cannot execute the functions it calls.

### Evidence

Measured, not inferred — a disposable Neon branch with `001`–`037` applied, queried via
`has_function_privilege('aeo_app', oid, 'EXECUTE')`:

```
11 of 12 NOT executable by aeo_app
  NO   acquire_stripe_subscription_lease      NO   publish_client_report_latest
  NO   release_stripe_subscription_lease      NO   revoke_client_report
  NO   apply_stripe_account_event             NO   rotate_client_report_link
  NO   create_client_report_with_version      NO   increment_client_report_view
  NO   append_client_report_version           NO   increment_client_report_cta_click
  NO   check_brand_limit                      YES  handle_new_user
```

Ten of those are live call sites, all executed as `aeo_app`:

| Caller | Functions |
|---|---|
| `app/api/stripe/webhook/route.ts:100,177,229` | `apply_stripe_account_event`, both lease functions |
| `lib/reports/store.ts:560,579,604,618,631,812,826` | all seven client-report RPCs |

**`check_brand_limit` is not affected** despite reporting `NO`: PostgreSQL checks `EXECUTE` on
a trigger function at `CREATE TRIGGER` time, not per fire. It needs no grant, and granting one
would add privilege the application never exercises directly.

**`handle_new_user` is already executable** — it was never revoked.

### What is NOT established

Whether *production* is currently failing. The catalog could not be read from this machine
(`fetch failed`), so someone may have granted `EXECUTE` by hand outside the migration chain.
What is certain is that the chain itself is wrong, so any fresh database — including the
greenfield baseline — is broken. **Verifying production is a release-gate step, not an
assumption.**

## Scope

- **In:** a new migration `038` granting the 10 called functions to `aeo_app`; default
  privileges so future functions do not repeat this; the same grants mirrored into
  `supabase/baseline/000_baseline_2026-08-31.sql`; a regression test.
- **Out:** changing any function body or signature; changing what `024`/`027` did (they stay
  as historical record); granting `check_brand_limit`; the equivalence differ's ACL blindness
  (noted below as a follow-up).

## Design

### 1. `supabase/migrations/038_app_role_function_execute.sql`

Explicit `grant execute` on exactly the ten called functions, by full signature. Signatures
taken verbatim from the revoking statements in `024`/`027`:

```
acquire_stripe_subscription_lease(text, uuid)
release_stripe_subscription_lease(text, uuid)
apply_stripe_account_event(uuid, text, text, text, text, bigint, text, text, uuid)
create_client_report_with_version(uuid, uuid, uuid, uuid, text, text, integer, jsonb, uuid)
append_client_report_version(uuid, uuid, uuid, uuid, uuid, text, text, integer, jsonb, uuid)
publish_client_report_latest(uuid, uuid, uuid, uuid)
revoke_client_report(uuid, uuid, uuid)
rotate_client_report_link(uuid, uuid, uuid)
increment_client_report_view(text, integer)
increment_client_report_cta_click(text, integer)
```

Guarded on `to_regrole('aeo_app') is not null`, mirroring how `037` guards role-dependent
statements, so the migration is safe on a database where the role does not exist yet.

The header comment states the root cause plainly — grants aimed at a Supabase role that does
not exist under Neon — so the next reader does not re-derive it.

### 2. Default privileges for future functions

```sql
alter default privileges in schema public grant execute on functions to aeo_app;
```

`037` already does this for tables and sequences but **not** functions, which is precisely why
`024`/`027`'s functions were missed. Without it, migration `039`'s functions reproduce the bug.
This is the part that stops recurrence.

Note it applies only to objects created by the role that runs the `alter` — the same caveat
`037`'s existing default-privilege statements carry.

### 3. Mirror into the baseline

The greenfield baseline must land the same grants, or a new project is born with the defect.
Append them to `supabase/baseline/000_baseline_2026-08-31.sql`'s grants section — after the
function definitions, alongside the existing `037` layer.

Then re-run `npm run schema:equivalence`; it must still report **EQUIVALENT**. Two paths, one
outcome: legacy gets the grants from `038`, greenfield from the baseline.

### 4. Regression test

`__tests__/integration/least-privilege-role.test.ts` today asserts only *denials* — each
forbidden operation, by its specific error message. That asymmetry is why this shipped: no
test asserted the role can do what it must.

Add the positive direction: connecting as `aeo_app`, assert `has_function_privilege` is true
for all ten. Table-driven, so adding an RPC without granting it fails loudly.

## Error handling

- Migration is idempotent: `grant` is naturally repeatable, and the role guard makes it safe
  on a database without `aeo_app`.
- If the role is absent the migration raises a warning naming the grants to run later, rather
  than aborting — matching how the baseline handles the optional `neon_auth` grants.
- No data is touched; this is privilege-only.

## Verification

1. `npm run schema:equivalence` → EQUIVALENT, exit 0 (proves baseline and chain agree).
2. The new regression test against a real branch → all ten executable.
3. `npm run lint && npm run typecheck && npm test`.
4. **Release gate, human-run:** confirm against production whether the grants were already
   applied by hand, then apply `038` there. Until that runs, production status is *unknown*,
   not *fixed*.

## Follow-up, deliberately not in scope

The equivalence differ's `functions` class compares `returns|volatility|security_definer` but
**not ACLs**, so it would not have caught this and will not catch the next one. Extending it to
compare function grants is a real improvement, but it changes the differ rather than fixing the
defect, and belongs in its own change.
