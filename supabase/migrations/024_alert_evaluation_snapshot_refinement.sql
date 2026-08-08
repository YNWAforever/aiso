-- 024_alert_evaluation_snapshot_refinement.sql
-- Refine the Neon alert snapshot index with deterministic tie-break columns.

DROP INDEX IF EXISTS public.pulse_weekly_summary_alert_snapshot_idx;

CREATE INDEX IF NOT EXISTS pulse_weekly_summary_alert_snapshot_idx
  ON public.pulse_weekly_summary (
    client_id,
    scan_week DESC,
    created_at DESC NULLS LAST,
    id DESC
  )
  WHERE platform IS NULL;
