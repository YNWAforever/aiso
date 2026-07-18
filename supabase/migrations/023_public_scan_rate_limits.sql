-- Durable fixed-window rate limiting for the anonymous /api/scan endpoint.
-- The application stores only a versioned HMAC-SHA-256 key, never the source address.
create table if not exists public_scan_rate_limits (
  key_hash text not null,
  window_start timestamptz not null,
  request_count integer not null check (request_count > 0),
  primary key (key_hash, window_start)
);

create index if not exists public_scan_rate_limits_window_start_idx
  on public_scan_rate_limits (window_start);

-- The app consumes this table only through its direct DATABASE_URL role.
-- Keep the Data API surface closed even on projects with legacy default grants.
alter table public_scan_rate_limits enable row level security;
revoke all on public_scan_rate_limits from public;

do $acl$
begin
  if to_regrole('anon') is not null then
    execute 'revoke all on public_scan_rate_limits from anon';
  end if;
  if to_regrole('authenticated') is not null then
    execute 'revoke all on public_scan_rate_limits from authenticated';
  end if;
  if to_regrole('service_role') is not null then
    execute 'revoke all on public_scan_rate_limits from service_role';
  end if;
end
$acl$;
