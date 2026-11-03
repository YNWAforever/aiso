-- 085: insert-only ledger of "Save to Google Docs" attempts (post–Stage 6
-- act/edit path, PR 2; brief docs/superpowers/plans/2026-11-02-aiso-brief-post6-drive-docs-mcp.md).
--
-- One row per create request that reached Google: created (with the file id),
-- failed (Google refused; nothing was created) or unknown (the response was
-- lost; a file may exist, so nothing retries automatically). A row is never
-- rewritten, like 054's search_console_sync_runs.
create table if not exists public.studio_drive_exports (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  client_id uuid not null,
  profile_id uuid not null,
  -- No FK: a ledger row is history and keeps its thread reference as recorded.
  thread_id uuid not null,
  turn_position integer not null check (turn_position >= 0),
  outcome text not null,
  google_file_id text,
  web_view_link text,
  created_at timestamptz not null default now(),
  foreign key (client_id, account_id) references public.clients (id, account_id) on delete cascade,
  foreign key (profile_id, account_id) references public.profiles (id, account_id) on delete cascade,
  constraint studio_drive_exports_outcome_check check (outcome in ('created', 'failed', 'unknown')),
  -- Only a created row names a file; failed/unknown never claim one.
  constraint studio_drive_exports_file_check check (
    (outcome = 'created' and google_file_id is not null and google_file_id <> '')
    or (outcome <> 'created' and google_file_id is null and web_view_link is null)
  )
);

create index if not exists studio_drive_exports_turn_idx
  on public.studio_drive_exports (account_id, profile_id, thread_id, turn_position, created_at desc);

alter table public.studio_drive_exports enable row level security;
revoke all on public.studio_drive_exports from public;

do $acl$
begin
  if to_regrole('anon') is not null then
    execute 'revoke all on public.studio_drive_exports from anon';
  end if;
  if to_regrole('authenticated') is not null then
    execute 'revoke all on public.studio_drive_exports from authenticated';
  end if;
  if to_regrole('service_role') is not null then
    execute 'revoke all on public.studio_drive_exports from service_role';
  end if;
  -- Insert-only for the app: no UPDATE, no DELETE.
  if to_regrole('aeo_app') is not null then
    execute 'revoke all on public.studio_drive_exports from aeo_app';
    execute 'grant select, insert on public.studio_drive_exports to aeo_app';
  end if;
end
$acl$;
