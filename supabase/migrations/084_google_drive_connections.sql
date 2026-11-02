-- 084: per-member Google Drive connection for the post–Stage 6 act/edit path
-- (brief: docs/superpowers/plans/2026-11-02-aiso-brief-post6-drive-docs-mcp.md;
-- lock t223s832: «MCP = act／edit, not scrape／SERP／「攞資料」»).
--
-- Separate from 054's google_connections on purpose: that table is one row per
-- (account, Google login) for Search Console, and a Drive grant must not ride
-- on it or be revoked with it. One row per profile: each member saves into
-- their own Drive. Scope is drive.file only (files this app creates).
--
-- Tenancy is carried by the composite FK to profiles(id, account_id), per
-- 041-046. No RLS policies (036); every query filters by account AND profile.

create table if not exists public.google_drive_connections (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  profile_id uuid not null,
  google_subject text not null,
  google_email text,
  scopes text[] not null,
  -- AES-256-GCM output from lib/integrations/google/vault.ts, sealed with
  -- purpose 'drive:<profile_id>'. Null once revoked: disconnecting deletes the
  -- credential, not the row explaining the history (as in 054).
  token_ciphertext bytea,
  token_key_id text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id),
  unique (id, account_id),
  foreign key (profile_id, account_id) references public.profiles (id, account_id) on delete cascade,
  constraint google_drive_connections_status_check
    check (status in ('active', 'needs_reconnect', 'revoked')),
  constraint google_drive_connections_token_check check ((
    (status = 'revoked' and token_ciphertext is null and token_key_id is null)
    or (status <> 'revoked' and token_ciphertext is not null and token_key_id is not null)
  ) is true and (token_key_id is null or token_key_id <> ''))
);

-- Keep the Data API surface closed, mirroring 080-083.
alter table public.google_drive_connections enable row level security;
revoke all on public.google_drive_connections from public;

do $acl$
begin
  if to_regrole('anon') is not null then
    execute 'revoke all on public.google_drive_connections from anon';
  end if;
  if to_regrole('authenticated') is not null then
    execute 'revoke all on public.google_drive_connections from authenticated';
  end if;
  if to_regrole('service_role') is not null then
    execute 'revoke all on public.google_drive_connections from service_role';
  end if;
  -- As 054's google_connections: the app reads, inserts and updates (revoke
  -- nulls the credential, keeping the row), and never deletes.
  if to_regrole('aeo_app') is not null then
    execute 'revoke all on public.google_drive_connections from aeo_app';
    execute 'grant select, insert, update on public.google_drive_connections to aeo_app';
  end if;
end
$acl$;
