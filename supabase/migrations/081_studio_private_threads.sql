-- Conversation Studio private threads and ordered turns.
-- Ownership principal is (account_id, client_id, profile_id). The composite
-- foreign keys keep a child turn from ever crossing its parent principal.
create table if not exists studio_threads (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  client_id uuid not null,
  profile_id uuid not null,
  kind text not null check (kind in ('research', 'brief')),
  title text not null check (char_length(title) between 1 and 200),
  goal text not null check (char_length(goal) between 1 and 1000),
  week text check (week is null or char_length(week) <= 40),
  source_title text check (source_title is null or char_length(source_title) <= 200),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (id, account_id, client_id, profile_id),
  foreign key (client_id, account_id) references clients(id, account_id) on delete cascade,
  foreign key (profile_id, account_id) references profiles(id, account_id)
);

create index if not exists studio_threads_principal_recent_idx
  on studio_threads (account_id, client_id, profile_id, updated_at desc, id desc);

create table if not exists studio_thread_turns (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null,
  account_id uuid not null,
  client_id uuid not null,
  profile_id uuid not null,
  position integer not null check (position >= 0),
  prompt text not null check (char_length(prompt) between 1 and 1000),
  task text check (task is null or task in ('brief', 'competitors', 'pulse', 'report', 'opportunity', 'improve')),
  reply jsonb not null check (jsonb_typeof(reply) = 'object' and octet_length(reply::text) <= 65536),
  attached jsonb check (attached is null or (jsonb_typeof(attached) = 'object' and octet_length(attached::text) <= 4096)),
  live jsonb check (live is null or (jsonb_typeof(live) = 'object' and octet_length(live::text) <= 65536)),
  created_at timestamptz not null default clock_timestamp(),
  unique (thread_id, position),
  foreign key (thread_id, account_id, client_id, profile_id)
    references studio_threads(id, account_id, client_id, profile_id) on delete cascade
);

create index if not exists studio_thread_turns_principal_idx
  on studio_thread_turns (account_id, client_id, profile_id, thread_id, position);

-- Keep the Data API surface closed. The direct database owner remains able to
-- consume the tables even when service-role credentials exist elsewhere.
alter table studio_threads enable row level security;
alter table studio_thread_turns enable row level security;
revoke all on studio_threads, studio_thread_turns from public;

do $acl$
begin
  if to_regrole('anon') is not null then
    execute 'revoke all on studio_threads, studio_thread_turns from anon';
  end if;
  if to_regrole('authenticated') is not null then
    execute 'revoke all on studio_threads, studio_thread_turns from authenticated';
  end if;
  if to_regrole('service_role') is not null then
    execute 'revoke all on studio_threads, studio_thread_turns from service_role';
  end if;
end
$acl$;
