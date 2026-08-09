-- 033_alert_evaluation_hardening.sql
-- Neon-safe alert indexes. Alert snapshot reads execute in the server adapter.

DROP INDEX IF EXISTS public.notifications_dedup_idx;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedup_idx
  ON public.notifications (client_id, type, scan_week);

CREATE INDEX IF NOT EXISTS pulse_weekly_summary_alert_snapshot_idx
  ON public.pulse_weekly_summary (client_id, scan_week DESC, id DESC)
  WHERE platform IS NULL;
