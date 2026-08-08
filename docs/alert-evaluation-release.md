# Alert evaluation release gate

Migrations `supabase/migrations/033_alert_evaluation_hardening.sql` and
`supabase/migrations/034_alert_evaluation_snapshot_refinement.sql` must be applied,
in order, to the target Neon database before deploying
`app/api/cron/evaluate-alerts`.

The route uses direct Neon SQL rather than a Supabase RPC. Migration 033 creates the
notification deduplication constraint required by the `ON CONFLICT` write, and migration
034 creates the deterministic aggregate-snapshot index used by keyset pagination.

Pre-deploy smoke checks:

1. Apply migration 033 through the normal approved Neon migration process.
2. Apply migration 034 through the normal approved Neon migration process after 033.
3. Verify `pg_indexes` contains:
   - the unique `notifications_dedup_idx` on `(client_id, type, scan_week)`;
   - the partial `pulse_weekly_summary_alert_snapshot_idx` with the `created_at` and `id`
     tie-break columns.
4. Run a bounded Neon SQL smoke check with a small known client-id sample and verify
   the snapshot returns at most the latest two aggregate (`platform IS NULL`) weeks per
   client in deterministic order.
5. Verify notification insertion remains idempotent for the same
   `(client_id, type, scan_week)`.

This note is only a release gate. Do not apply production migrations, invoke the cron
route, or send notification/email traffic from local review.
