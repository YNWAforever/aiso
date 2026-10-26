-- Sampled, provider-reported search appearance. A revised window replaces its categories.
create table public.search_console_appearance (
  account_id uuid not null, client_id uuid not null, date date not null,
  page_url text not null check(char_length(page_url) <= 2048),
  appearance text not null check(appearance ~ '^[A-Za-z0-9_]{1,80}$'),
  clicks integer not null check(clicks >= 0), impressions integer not null check(impressions >= 0),
  ctr double precision not null check(ctr between 0 and 1),
  position double precision not null check(position >= 0 and position < 'Infinity'),
  synced_at timestamptz not null default now(),
  primary key(account_id,client_id,date,page_url,appearance),
  foreign key(client_id,account_id) references public.clients(id,account_id) on delete cascade
);
revoke all on public.search_console_appearance from public;
do $$ begin if to_regrole('aeo_app') is not null then
  revoke all on public.search_console_appearance from aeo_app;
  grant select,insert,update,delete on public.search_console_appearance to aeo_app;
end if; end $$;

-- Historical query rows have no provable binding generation. Hide until refreshed.
alter table public.search_console_page_queries add column synced_at timestamptz not null default '-infinity'::timestamptz;
alter table public.search_console_page_queries alter column synced_at set default now();
