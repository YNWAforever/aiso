alter table public.accounts add column trial_email_locale text
  check (trial_email_locale in ('en', 'zh-HK'));

create table public.trial_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  trial_started_at timestamptz not null,
  milestone smallint not null check (milestone in (1, 2, 4, 8)),
  payload jsonb,
  started_at timestamptz not null default clock_timestamp(),
  lease_owner uuid,
  lease_until timestamptz,
  sent_at timestamptz,
  provider_email_id text,
  needs_review_at timestamptz,
  unique (account_id, trial_started_at, milestone),
  check ((lease_owner is null) = (lease_until is null))
);

create index trial_email_deliveries_pending_idx on public.trial_email_deliveries (started_at)
  where sent_at is null and needs_review_at is null;

alter table public.trial_email_deliveries enable row level security;
revoke all on public.trial_email_deliveries from public, aeo_app;
grant select, insert, update on public.trial_email_deliveries to aeo_app;

create function public.due_trial_email_bit(started timestamptz, ends timestamptz, current_at timestamptz)
returns integer language sql immutable strict set search_path = ''
return case
  when ends <= started or current_at < started + interval '24 hours' then null
  when current_at < ends - interval '48 hours' then 1
  when current_at < ends - interval '24 hours' then 2
  when current_at < ends then 4
  when current_at >= ends + interval '72 hours' and current_at < ends + interval '168 hours' then 8
end;

revoke all on function public.due_trial_email_bit(timestamptz, timestamptz, timestamptz) from public;
grant execute on function public.due_trial_email_bit(timestamptz, timestamptz, timestamptz) to aeo_app;
