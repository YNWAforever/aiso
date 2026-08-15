-- 035_alert_email_delivery_ledger.sql
-- One alert email per (client, type, scan_week).
--
-- notifications already dedupes in-app rows through notifications_dedup_idx
-- (033), but email had no equivalent: runAlertEvaluation called sendAlertEmail
-- for every fired action, so re-running evaluation within the same week re-sent
-- every email while the notification insert correctly no-opped. Alert configs
-- can set notify_inapp = false (010_phase3b.sql:10), in which case no
-- notifications row is written at all, so that table cannot serve as the email
-- ledger even when it is present.
--
-- No RLS. The 21 leftover Supabase-era policies on other tables are inert --
-- the app connects as neondb_owner, which bypasses RLS -- so enabling it here
-- would add a dead policy rather than a control. Tenancy is enforced in the
-- query, as everywhere else.

CREATE TABLE IF NOT EXISTS public.alert_email_deliveries (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id  uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  type       text NOT NULL CHECK (type IN ('sov_threshold', 'sov_wow_drop', 'sov_recovery')),
  scan_week  date NOT NULL,
  recipient  text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS alert_email_deliveries_dedup_idx
  ON public.alert_email_deliveries (client_id, type, scan_week);
