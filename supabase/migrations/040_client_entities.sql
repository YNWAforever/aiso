-- Private organizational input only. No public verification or RLS change.
-- Existing profiles(id, account_id) key is supplied by migration 027.
create unique index if not exists clients_id_account_id_unique
  on public.clients (id, account_id);

create table public.client_entities (
  client_id uuid primary key,
  account_id uuid not null,
  display_name text not null check (char_length(display_name) between 1 and 120),
  aliases jsonb not null default '[]'::jsonb,
  revision integer not null default 1 check (revision > 0),
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_entities_owned_client_fk
    foreign key (client_id, account_id) references public.clients (id, account_id) on delete cascade,
  constraint client_entities_actor_fk
    foreign key (updated_by, account_id) references public.profiles (id, account_id) on delete set null (updated_by),
  constraint client_entities_alias_array check (
    case when jsonb_typeof(aliases) = 'array' then
      jsonb_array_length(aliases) <= 20
      and not jsonb_path_exists(aliases, '$[*] ? (@.type() != "string")')
      and not jsonb_path_exists(aliases, '$[*] ? (@ == "" || @ like_regex "^.{121,}$" flag "s")')
    else false end
  )
);

-- 037's default privileges include DELETE: narrow those explicitly.
revoke all on public.client_entities from public;
do $$
begin
  if to_regrole('aeo_app') is not null then
    revoke all on public.client_entities from aeo_app;
    grant select, insert, update on public.client_entities to aeo_app;
  end if;
end $$;
