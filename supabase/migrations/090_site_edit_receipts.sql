-- 090: site-edit S3 — signed completion receipts from the executor
-- (brief: docs/superpowers/plans/2026-11-03-aiso-brief-post6-site-edit.md, §3a "Inbound").
--
-- One receipt closes one hand-off job (089). A receipt records the executor's
-- CLAIM — completed or rejected, at a URL, at a time — never proof: S4's
-- live-page check is what turns it into a verified delivery. Insert-only for
-- the app; an identical replay is recognised by the raw body's SHA-256 and
-- writes nothing, a different body for an already-closed job is refused.
-- No RLS policies (036); the row carries the job's account through the FK.

create table if not exists public.site_edit_receipts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  account_id uuid not null,
  status text not null,
  url text not null,
  completed_at timestamptz not null,
  note text,
  body_sha256 text not null check (body_sha256 ~ '^[0-9a-f]{64}$'),
  received_at timestamptz not null default clock_timestamp(),
  -- At most one receipt per job: the first valid one closes it.
  unique (job_id),
  foreign key (job_id, account_id) references public.site_edit_jobs (id, account_id) on delete restrict,
  constraint site_edit_receipts_status_check check (status in ('completed', 'rejected')),
  constraint site_edit_receipts_shape_check check ((
    char_length(url) between 1 and 2048
    and (note is null or char_length(note) <= 2000)
  ) is true)
);

alter table public.site_edit_receipts enable row level security;
revoke all on public.site_edit_receipts from public;

do $acl$
begin
  if to_regrole('anon') is not null then
    execute 'revoke all on public.site_edit_receipts from anon';
  end if;
  if to_regrole('authenticated') is not null then
    execute 'revoke all on public.site_edit_receipts from authenticated';
  end if;
  if to_regrole('service_role') is not null then
    execute 'revoke all on public.site_edit_receipts from service_role';
  end if;
  -- Insert-only ledger for the app.
  if to_regrole('aeo_app') is not null then
    execute 'revoke all on public.site_edit_receipts from aeo_app';
    execute 'grant select, insert on public.site_edit_receipts to aeo_app';
  end if;
end
$acl$;
