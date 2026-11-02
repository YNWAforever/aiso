-- Conversation Studio Stage 6e: durable per-brand DataForSEO weekly usage and
-- the default-OFF per-brand enable switch. Weekly weeks start Monday 00:00 HKT.
create table if not exists studio_dataforseo_weekly_usage (
  account_id uuid not null references accounts(id) on delete cascade,
  client_id uuid not null,
  week_start date not null,
  call_count integer not null check (call_count >= 0),
  primary key (client_id, week_start),
  foreign key (client_id, account_id) references clients(id, account_id) on delete cascade
);

create index if not exists studio_dataforseo_weekly_usage_week_start_idx
  on studio_dataforseo_weekly_usage (week_start);

create table if not exists studio_dataforseo_brand_settings (
  account_id uuid not null references accounts(id) on delete cascade,
  client_id uuid primary key,
  enabled boolean not null default false,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  foreign key (client_id, account_id) references clients(id, account_id) on delete cascade,
  foreign key (updated_by, account_id) references profiles(id, account_id)
);

-- Keep the Data API surface closed. The direct database owner remains able to
-- consume the tables even when service-role credentials exist elsewhere.
alter table studio_dataforseo_weekly_usage enable row level security;
alter table studio_dataforseo_brand_settings enable row level security;
revoke all on studio_dataforseo_weekly_usage, studio_dataforseo_brand_settings from public;

do $acl$
begin
  if to_regrole('anon') is not null then
    execute 'revoke all on studio_dataforseo_weekly_usage, studio_dataforseo_brand_settings from anon';
  end if;
  if to_regrole('authenticated') is not null then
    execute 'revoke all on studio_dataforseo_weekly_usage, studio_dataforseo_brand_settings from authenticated';
  end if;
  if to_regrole('service_role') is not null then
    execute 'revoke all on studio_dataforseo_weekly_usage, studio_dataforseo_brand_settings from service_role';
  end if;
end
$acl$;
