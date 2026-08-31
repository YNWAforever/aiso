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
