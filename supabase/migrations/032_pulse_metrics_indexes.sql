-- pulse_metrics indexes
--
-- The table has carried no index of any kind since 002 created it — not on
-- client_id, not on scan_week, not on prompt_id. That was survivable while
-- nothing wrote or read it on a schedule. It is not any more: the weekly driver
-- (app/api/cron/pulse) runs, for every candidate client, on every tick:
--
--   select count(distinct m.prompt_id) from pulse_metrics m
--   where m.client_id = $1 and m.scan_week = date_trunc('week', now())::date
--
-- and the producer now deletes a prompt's rows for the week before rewriting
-- them, which is a second predicate over the same three columns. Both are
-- sequential scans over every row the table has ever accumulated, and the table
-- only grows: 50 prompts x 5 platforms x every client x every week.
--
-- Two indexes, matching the two access patterns exactly:
--
--   (client_id, scan_week)             — the driver's cursor derivation, and the
--                                        dashboard's missed-opportunity read
--   (client_id, prompt_id, scan_week)  — the producer's per-prompt delete
--
-- The second is deliberately NOT unique. Making it unique would be the stronger
-- fix for double-writes, but it cannot be applied while duplicate rows may
-- already exist — and whether they do is unknowable without a live connection,
-- because the pre-fence producer and both n8n workflows all wrote this table
-- with no dedupe. The application-side delete-before-insert in pulse/run is what
-- guarantees correctness; this migration is purely about the scans.
--
-- Not CONCURRENTLY: scripts/migrate.ts wraps every migration in a transaction
-- and assertNoTransactionControl refuses any file that tries to manage its own,
-- so CONCURRENTLY is not expressible here. These builds take a SHARE lock,
-- blocking writes to pulse_metrics but not reads. The only writer is the weekly
-- producer, so apply this when a run is not in flight.

create index if not exists pulse_metrics_client_week_idx
  on public.pulse_metrics (client_id, scan_week);

create index if not exists pulse_metrics_client_prompt_week_idx
  on public.pulse_metrics (client_id, prompt_id, scan_week);
