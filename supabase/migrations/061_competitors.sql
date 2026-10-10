-- Competitors as entities (GEO parity blueprint, Step 3).
--
-- Until now a brand's competitors were `clients.competitors text[]`: free text
-- with no identity, no other spellings and no domains. That is enough to ask a
-- classifier "is X named?", but not to attribute a citation to a competitor
-- (that needs its domains) or to report Share of Voice per competitor over time
-- (that needs a stable id that survives a rename).
--
-- `clients.competitors` is kept and still written by onboarding and brand
-- creation. Readers union the two, and the competitors API mirrors the active
-- names back into it, so nothing that reads the array changes behaviour.
--
-- Additive only. No RLS: like every table since 036, tenancy is the query's
-- `account_id` predicate (__tests__/security/tenancy-inventory.test.ts).

create table public.competitors (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  client_id uuid not null,

  -- Display name, and the canonical name reported when any alias matches.
  name text not null,
  -- Other written forms an answer may use ("HSBC" for "The Hongkong and
  -- Shanghai Banking Corporation"). Matched like the name, never inferred.
  aliases text[] not null default '{}',
  -- Registrable domains, lowercase, no scheme or path. Used to attribute
  -- citations; validated by lib/competitors/schema.ts before it gets here.
  domains text[] not null default '{}',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Archived rather than deleted, so a later per-competitor history keeps the
  -- id it was recorded against.
  archived_at timestamptz,

  constraint competitors_owned_client_fk
    foreign key (client_id, account_id) references public.clients (id, account_id) on delete cascade,
  constraint competitors_name_check
    check (name = btrim(name) and char_length(name) between 1 and 120),
  constraint competitors_aliases_check check (cardinality(aliases) <= 5),
  constraint competitors_domains_check check (cardinality(domains) <= 5)
);

-- One live competitor per name per brand; an archived one does not block
-- re-adding it.
create unique index competitors_client_name_live
  on public.competitors (client_id, lower(name)) where archived_at is null;
create index competitors_account_client on public.competitors (account_id, client_id);

-- Backfill from the array: trimmed, blank-free, de-duplicated case-insensitively
-- (first spelling wins), at most 10 per brand — the classifier's own cap.
with names as (
  select c.account_id, c.id as client_id, btrim(n.value) as name, n.ordinality,
         row_number() over (partition by c.id, lower(btrim(n.value)) order by n.ordinality) as duplicate_rank
  from public.clients c
  cross join lateral unnest(coalesce(c.competitors, '{}'::text[])) with ordinality as n(value, ordinality)
  where c.account_id is not null
    and char_length(btrim(n.value)) between 1 and 120
), firsts as (
  select account_id, client_id, name,
         row_number() over (partition by client_id order by ordinality) as kept_rank
  from names
  where duplicate_rank = 1
)
insert into public.competitors (account_id, client_id, name)
select account_id, client_id, name from firsts where kept_rank <= 10
on conflict do nothing;
