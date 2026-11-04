-- 089: site-edit S2 — hand-off of an approved edit spec to the executor
-- (brief: docs/superpowers/plans/2026-11-03-aiso-brief-post6-site-edit.md, §3/§3a).
--
-- One job per approved version (site_edit_jobs), and an insert-only event log
-- for it (site_edit_job_events). Nothing here is ever updated or deleted:
--
--   claim    written BEFORE the single outbound call, so two members clicking
--            "send" at once cannot both reach the executor (unique (job_id, seq));
--   sent     the executor answered 2xx — it accepted the job;
--   failed   the executor answered 4xx/5xx;
--   unknown  timeout or transport error — the job may or may not have arrived.
--
-- A claim with no outcome row after the call deadline also reads as unknown
-- (the process died mid-call); the state is derived on read, newest event
-- wins, as search_console_sync_runs does it. A manual re-send of the same job
-- (same jobId, which the executor treats as an idempotency key) is a new
-- claim after a failed/unknown outcome; nothing is ever sent after `sent`.
--
-- The job is bound to the exact approved package by the composite FK onto
-- work_item_versions (…, id, content_hash), and to its account through every
-- FK. Receipts (S3) will land in their own insert-only table.
-- No RLS policies (036); every query filters by account_id.

create table if not exists public.site_edit_jobs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  client_id uuid not null,
  work_item_id uuid not null,
  version_id uuid not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (id, account_id),
  -- At most one hand-off job per approved version.
  unique (account_id, version_id),
  foreign key (account_id, client_id, work_item_id, version_id, content_hash)
    references public.work_item_versions (account_id, client_id, work_item_id, id, content_hash) on delete restrict,
  foreign key (created_by, account_id) references public.profiles (id, account_id)
);

create table if not exists public.site_edit_job_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  account_id uuid not null,
  seq integer not null check (seq >= 1),
  kind text not null,
  actor_id uuid not null,
  executor_status integer,
  executor_ref text,
  created_at timestamptz not null default clock_timestamp(),
  -- Serialises claims: two concurrent sends compute the same next seq and one fails.
  unique (job_id, seq),
  foreign key (job_id, account_id) references public.site_edit_jobs (id, account_id) on delete restrict,
  foreign key (actor_id, account_id) references public.profiles (id, account_id),
  constraint site_edit_job_events_kind_check check (kind in ('claim', 'sent', 'failed', 'unknown')),
  constraint site_edit_job_events_shape_check check ((
    (executor_status is null or executor_status between 100 and 599)
    and (executor_ref is null or char_length(executor_ref) between 1 and 200)
    and (kind <> 'claim' or (executor_status is null and executor_ref is null))
    and (kind <> 'sent' or executor_status between 200 and 299)
    and (kind <> 'failed' or executor_status between 400 and 599)
    and (kind <> 'unknown' or executor_status is null)
  ) is true)
);

create index if not exists site_edit_job_events_job_idx
  on public.site_edit_job_events (job_id, seq desc);

-- Keep the Data API surface closed, mirroring 080-088.
alter table public.site_edit_jobs enable row level security;
alter table public.site_edit_job_events enable row level security;
revoke all on public.site_edit_jobs, public.site_edit_job_events from public;

do $acl$
begin
  if to_regrole('anon') is not null then
    execute 'revoke all on public.site_edit_jobs, public.site_edit_job_events from anon';
  end if;
  if to_regrole('authenticated') is not null then
    execute 'revoke all on public.site_edit_jobs, public.site_edit_job_events from authenticated';
  end if;
  if to_regrole('service_role') is not null then
    execute 'revoke all on public.site_edit_jobs, public.site_edit_job_events from service_role';
  end if;
  -- Insert-only ledger for the app.
  if to_regrole('aeo_app') is not null then
    execute 'revoke all on public.site_edit_jobs, public.site_edit_job_events from aeo_app';
    execute 'grant select, insert on public.site_edit_jobs, public.site_edit_job_events to aeo_app';
  end if;
end
$acl$;
