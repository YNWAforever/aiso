-- Durable UTC-week answer quota for Conversation Studio LIVE.
-- The direct DATABASE_URL role reserves this counter atomically before dispatch.
create table if not exists studio_live_weekly_usage (
  account_id uuid not null references accounts(id) on delete cascade,
  week_start date not null,
  answer_count integer not null check (answer_count >= 0),
  primary key (account_id, week_start)
);

create index if not exists studio_live_weekly_usage_week_start_idx
  on studio_live_weekly_usage (week_start);

-- Keep the Data API surface closed. The direct database owner remains able to
-- consume the table even when service-role credentials exist elsewhere.
alter table studio_live_weekly_usage enable row level security;
revoke all on studio_live_weekly_usage from public;

do $acl$
begin
  if to_regrole('anon') is not null then
    execute 'revoke all on studio_live_weekly_usage from anon';
  end if;
  if to_regrole('authenticated') is not null then
    execute 'revoke all on studio_live_weekly_usage from authenticated';
  end if;
  if to_regrole('service_role') is not null then
    execute 'revoke all on studio_live_weekly_usage from service_role';
  end if;
end
$acl$;
