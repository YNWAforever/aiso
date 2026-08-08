-- 031_pulse_weekly_summary_unique.sql
-- pulse_weekly_summary has carried no uniqueness since 002_phase2.sql created it,
-- so every rollup appends instead of refreshing and no ON CONFLICT clause is even
-- expressible. Both n8n workflows assume `on conflict (client_id, scan_week,
-- platform)` exists: v2's summary node fails with 42P10 on every execution, and
-- v1's bare DO NOTHING silently duplicates.
--
-- NULLS NOT DISTINCT is the load-bearing part, not incidental. The table stores
-- two kinds of row: one per platform, and a `platform is null` aggregate. Under a
-- plain unique index NULLs compare distinct, so two aggregate rows for the same
-- client-week coexist happily — verified on PostgreSQL 16, a plain index leaves 2
-- rows where this leaves 1. That matters because cron/evaluate-alerts reads "the
-- last two aggregate weeks" and computes a week-over-week delta: handed two copies
-- of the same week it would compute 0% and never fire an alert.
--
-- Requires PostgreSQL 15+. Neon is 16/17.

-- Collapse any pre-existing duplicates before the index can be built. Keeps the
-- newest row per (client, week, platform); `is not distinct from` so the
-- aggregate rows group together rather than each being distinct from itself.
--
-- The tiebreak on id is not decorative. Rows written by one statement share a
-- created_at, because now() is transaction time — and duplicates are most likely
-- to arise from exactly that, a rollup inserting a whole week at once. Comparing
-- created_at alone leaves those untouched and the index build then fails.
-- (client_id, scan_week, platform, id) is a total order because id is the PK.
delete from public.pulse_weekly_summary a
using public.pulse_weekly_summary b
where a.client_id = b.client_id
  and a.scan_week = b.scan_week
  and a.platform is not distinct from b.platform
  and (a.created_at, a.id) < (b.created_at, b.id);

create unique index if not exists pulse_weekly_summary_client_week_platform_unique
  on public.pulse_weekly_summary (client_id, scan_week, platform)
  nulls not distinct;
