-- 039_cron_runs.sql
-- Records every invocation of a scheduled cron route, whether or not it found
-- work to do.
--
-- WHY THIS EXISTS. On 2026-09-03 nothing could distinguish "the Cloudflare
-- worker is deployed and idle" from "it was never deployed". All three
-- scheduled routes write only when they find work, and every input was empty:
-- zero trialing accounts, zero prompt_bank rows, zero pulse rollups, zero
-- notifications. Every table read back zero, equally consistent with both.
--
-- TWO WRITES PER RUN, NOT ONE. The start row is inserted before the job acts;
-- a completion update closes it. A completion-only row would make a crashed or
-- timed-out run indistinguishable from one that never happened -- the exact
-- blind spot this table closes. vercel.json caps these functions at 60s, so a
-- timeout is a real case, not a hypothetical. A row with finished_at IS NULL
-- and an old started_at means "started and died".
--
-- NO RLS. 036 disabled it on 21 tables, and 035 declined to add it for the same
-- reason: aeo_app holds BYPASSRLS deliberately (037), so a policy here would be
-- inert rather than a control. This is operational data with no tenant column.
-- __tests__/migrations/rls-policy-freeze.test.mjs fails if a migration after
-- 035 creates a policy.
--
-- gen_random_uuid() is core in PostgreSQL 13+ and production is 16. Do NOT add
-- `create extension pgcrypto` -- 027 had to be repaired for reaching for it.

create table if not exists cron_runs (
  id          uuid        primary key default gen_random_uuid(),
  route       text        not null,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  status      text,
  detail      jsonb,
  error       text
);

-- Every query is "most recent runs of route X".
create index if not exists cron_runs_route_started_idx
  on cron_runs (route, started_at desc);

-- 037 sets default privileges in schema public for tables, so this grant should
-- be redundant. It is stated anyway because 038 exists precisely because that
-- assumption held for tables and silently failed for functions, leaving
-- production broken for two weeks. Guarded so the migration still applies on a
-- database where 037 has not run.
do $$
begin
  if to_regrole('aeo_app') is not null then
    grant select, insert, update on cron_runs to aeo_app;
  end if;
end $$;
