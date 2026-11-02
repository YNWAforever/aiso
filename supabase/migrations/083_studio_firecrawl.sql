-- Conversation Studio Stage 6f: default-OFF per-brand Firecrawl public scrape
-- switch. There is no weekly product counter: Approve caps one URL per turn.
create table if not exists studio_firecrawl_brand_settings (
  account_id uuid not null references accounts(id) on delete cascade,
  client_id uuid primary key,
  enabled boolean not null default false,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  foreign key (client_id, account_id) references clients(id, account_id) on delete cascade,
  foreign key (updated_by, account_id) references profiles(id, account_id)
);

-- Keep the Data API surface closed. The direct database owner remains able to
-- consume the table even when service-role credentials exist elsewhere.
alter table studio_firecrawl_brand_settings enable row level security;
revoke all on studio_firecrawl_brand_settings from public;

do $acl$
begin
  if to_regrole('anon') is not null then
    execute 'revoke all on studio_firecrawl_brand_settings from anon';
  end if;
  if to_regrole('authenticated') is not null then
    execute 'revoke all on studio_firecrawl_brand_settings from authenticated';
  end if;
  if to_regrole('service_role') is not null then
    execute 'revoke all on studio_firecrawl_brand_settings from service_role';
  end if;
end
$acl$;
