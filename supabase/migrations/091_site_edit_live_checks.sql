-- 091: site-edit S4 — check the live page, then record a VERIFIED delivery
-- (brief: docs/superpowers/plans/2026-11-03-aiso-brief-post6-site-edit.md, §3 step 4).
--
-- A member asks AISO to fetch the job's frozen target URL (through the SSRF-safe
-- public fetcher) and look for the approved JSON-LD payload. Every check is
-- recorded, insert-only, whatever it found. Only a check that FOUND the payload
-- may also write a C9e attestation, and that attestation carries
-- provenance 'verified_live' bound to its job — the manual attestation path
-- keeps the default 'self_reported'. "Verified live" means only that the
-- payload was on the page at fetch time. No RLS policies (036).

-- 1. C9e provenance. Additive: every existing row is a self-reported attestation
--    or a withdrawal, so the default is exactly what they already were.
alter table public.site_edit_jobs
  add constraint site_edit_jobs_version_identity_key unique (id, account_id, version_id, content_hash);

alter table public.work_item_delivery_events
  add column if not exists provenance text not null default 'self_reported',
  add column if not exists site_edit_job_id uuid;

alter table public.work_item_delivery_events
  add constraint delivery_provenance_check check ((
    provenance in ('self_reported', 'verified_live')
    and (provenance = 'verified_live') = (site_edit_job_id is not null)
    and (provenance = 'self_reported' or kind = 'attest')
  ) is true),
  -- A verified attestation names the job whose live check found the payload,
  -- and that job must be for this very version and hash.
  add constraint delivery_site_edit_job_fk foreign key (site_edit_job_id, account_id, version_id, content_hash)
    references public.site_edit_jobs (id, account_id, version_id, content_hash) on delete restrict;

create unique index if not exists work_item_delivery_events_id_account_idx
  on public.work_item_delivery_events (id, account_id);

-- 2. The live-check ledger: one row per check, never updated.
create table if not exists public.site_edit_live_checks (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  account_id uuid not null,
  outcome text not null,
  http_status integer,
  page_sha256 text,
  checked_at timestamptz not null,
  actor_id uuid not null,
  attestation_id uuid,
  recorded_at timestamptz not null default clock_timestamp(),
  foreign key (job_id, account_id) references public.site_edit_jobs (id, account_id) on delete restrict,
  foreign key (actor_id, account_id) references public.profiles (id, account_id),
  foreign key (attestation_id, account_id) references public.work_item_delivery_events (id, account_id) on delete restrict,
  unique (attestation_id),
  constraint site_edit_live_checks_outcome_check check (outcome in ('found', 'missing', 'fetch_failed')),
  constraint site_edit_live_checks_shape_check check ((
    (http_status is null or http_status between 100 and 599)
    and (page_sha256 is null or page_sha256 ~ '^[0-9a-f]{64}$')
    and (outcome = 'fetch_failed' or (http_status between 200 and 299 and page_sha256 is not null))
    and (attestation_id is null or outcome = 'found')
    and checked_at <= recorded_at
  ) is true)
);

create index if not exists site_edit_live_checks_job_idx
  on public.site_edit_live_checks (account_id, job_id, checked_at desc);

alter table public.site_edit_live_checks enable row level security;
revoke all on public.site_edit_live_checks from public;

do $acl$
begin
  if to_regrole('anon') is not null then
    execute 'revoke all on public.site_edit_live_checks from anon';
  end if;
  if to_regrole('authenticated') is not null then
    execute 'revoke all on public.site_edit_live_checks from authenticated';
  end if;
  if to_regrole('service_role') is not null then
    execute 'revoke all on public.site_edit_live_checks from service_role';
  end if;
  -- Insert-only ledger for the app.
  if to_regrole('aeo_app') is not null then
    execute 'revoke all on public.site_edit_live_checks from aeo_app';
    execute 'grant select, insert on public.site_edit_live_checks to aeo_app';
  end if;
end
$acl$;
