# Alert evaluation release gate

Migrations `supabase/migrations/023_alert_evaluation_hardening.sql` and `supabase/migrations/024_alert_evaluation_snapshot_refinement.sql` must be applied, in order, before deploying the `app/api/cron/evaluate-alerts` route.

Do not deploy the route first: the route depends on `public.get_alert_weekly_snapshot(uuid[])`, and snapshot loading will fail if the RPC is absent or not granted to `service_role`.

Pre-deploy smoke checks:

1. Apply migration `023_alert_evaluation_hardening.sql` through the normal approved migration process.
2. Apply migration `024_alert_evaluation_snapshot_refinement.sql` through the normal approved migration process after `023`.
3. Verify function privileges:
   - `PUBLIC`, `anon`, and `authenticated` have no execute privilege on `public.get_alert_weekly_snapshot(uuid[])`.
   - `service_role` can execute `public.get_alert_weekly_snapshot(uuid[])`.
4. Run a bounded service-role RPC smoke check with a small known client-id sample and verify the result returns at most the latest two distinct `scan_week` values per client, ordered by `client_id` and rank.
5. Verify notification upsert conflict inference still works with `onConflict: 'client_id,type,scan_week'` for alert notifications.

This note is only a release gate. Do not apply production migrations, invoke the cron route, or send notification/email traffic from local review.
