-- ============================================================
-- 024_alert_evaluation_snapshot_refinement.sql
-- 1. Rebuild the weekly snapshot supporting index with created_at tie-breaks
-- 2. Refine the bounded alert weekly snapshot RPC to keep one row per week
-- ============================================================

DROP INDEX IF EXISTS public.pulse_weekly_summary_alert_snapshot_idx;

CREATE INDEX IF NOT EXISTS pulse_weekly_summary_alert_snapshot_idx
  ON public.pulse_weekly_summary (client_id, scan_week DESC, created_at DESC NULLS LAST, id DESC)
  WHERE platform IS NULL;

CREATE OR REPLACE FUNCTION public.get_alert_weekly_snapshot(p_client_ids uuid[])
RETURNS TABLE (
  client_id uuid,
  scan_week date,
  sov_score numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH requested_clients AS (
    SELECT DISTINCT unnest(p_client_ids) AS client_id
  ),
  latest_distinct_weeks AS (
    SELECT DISTINCT ON (summary.client_id, summary.scan_week)
      summary.client_id,
      summary.scan_week,
      summary.sov_score
    FROM public.pulse_weekly_summary AS summary
    INNER JOIN requested_clients
      ON requested_clients.client_id = summary.client_id
    WHERE summary.platform IS NULL
    ORDER BY summary.client_id, summary.scan_week DESC, summary.created_at DESC NULLS LAST, summary.id DESC
  ),
  ranked AS (
    SELECT
      latest_distinct_weeks.client_id,
      latest_distinct_weeks.scan_week,
      latest_distinct_weeks.sov_score,
      row_number() OVER (
        PARTITION BY latest_distinct_weeks.client_id
        ORDER BY latest_distinct_weeks.scan_week DESC
      ) AS row_number
    FROM latest_distinct_weeks
  )
  SELECT
    ranked.client_id,
    ranked.scan_week,
    ranked.sov_score
  FROM ranked
  WHERE ranked.row_number <= 2
  ORDER BY ranked.client_id, ranked.row_number ASC;
$$;

REVOKE ALL ON FUNCTION public.get_alert_weekly_snapshot(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_alert_weekly_snapshot(uuid[]) FROM anon;
REVOKE ALL ON FUNCTION public.get_alert_weekly_snapshot(uuid[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_alert_weekly_snapshot(uuid[]) TO service_role;
