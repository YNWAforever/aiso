-- Durable calendar-month quota for authenticated Basic scans.
-- The direct DATABASE_URL role consumes this counter atomically.
create table if not exists authenticated_scan_monthly_usage (
  account_id uuid not null references accounts(id) on delete cascade,
  month_start date not null,
  request_count integer not null check (request_count > 0),
  primary key (account_id, month_start)
);

create index if not exists authenticated_scan_monthly_usage_month_start_idx
  on authenticated_scan_monthly_usage (month_start);

-- Keep the Data API surface closed. The direct database owner remains able to
-- consume the table even when service-role credentials exist elsewhere.
alter table authenticated_scan_monthly_usage enable row level security;
revoke all on authenticated_scan_monthly_usage from public, anon, authenticated, service_role;
