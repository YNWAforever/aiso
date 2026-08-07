-- ============================================================
-- 023_alert_evaluation_hardening.sql
-- 1. Make notification deduplication compatible with PostgREST on_conflict
-- 2. Add bounded alert weekly-summary snapshot RPC and supporting index
-- ============================================================

-- Replace the old partial index from 011 with a non-partial unique index so
-- PostgREST/Supabase can infer the arbiter for:
--   onConflict: 'client_id,type,scan_week'
--
-- PostgreSQL unique indexes are NULLS DISTINCT by default, so manual or
-- null-valued notifications remain free to have multiple rows when client_id
-- or scan_week is null.
DROP INDEX IF EXISTS public.notifications_dedup_idx;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedup_idx
  ON public.notifications (client_id, type, scan_week);

-- Bound alert snapshot reads to the latest two aggregate weeks per requested
-- client inside PostgreSQL, before the Data API returns rows.
CREATE INDEX IF NOT EXISTS pulse_weekly_summary_alert_snapshot_idx
  ON public.pulse_weekly_summary (client_id, scan_week DESC, id DESC)
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
  ranked AS (
    SELECT
      summary.client_id,
      summary.scan_week,
      summary.sov_score,
      row_number() OVER (
        PARTITION BY summary.client_id
        ORDER BY summary.scan_week DESC, summary.id DESC
      ) AS row_number
    FROM public.pulse_weekly_summary AS summary
    INNER JOIN requested_clients
      ON requested_clients.client_id = summary.client_id
    WHERE summary.platform IS NULL
  )
  SELECT
    ranked.client_id,
    ranked.scan_week,
    ranked.sov_score
  FROM ranked
  WHERE ranked.row_number <= 2
  ORDER BY ranked.client_id, ranked.scan_week DESC;
$$;

REVOKE ALL ON FUNCTION public.get_alert_weekly_snapshot(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_alert_weekly_snapshot(uuid[]) FROM anon;
REVOKE ALL ON FUNCTION public.get_alert_weekly_snapshot(uuid[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_alert_weekly_snapshot(uuid[]) TO service_role;
