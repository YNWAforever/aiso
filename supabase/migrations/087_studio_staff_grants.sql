-- 087: Studio R3 A2a — delegated staff access grants and their audit trail
-- (brief: docs/superpowers/plans/2026-11-03-aiso-brief-post6-studio-redesign.md, R3).
--
-- A client account grants a named Fimmick staff member (a platform admin,
-- profiles.is_admin) access to its brands in Studio. Any active member of the
-- client account may grant, renew or revoke; a grant lasts at most 90 days and
-- is renewable. The grantee belongs to a DIFFERENT account, so the grantee FK is
-- to profiles(id) alone, while the granting member is bound to the client
-- account by the composite FK used since 041-046.
--
-- Grants are never deleted: revoking sets revoked_at/revoked_by, renewing moves
-- expires_at. Every change, and every staff open of a brand, also lands in the
-- insert-only studio_staff_audit, which the client account can read.
-- No RLS policies (036); every query filters by account_id.

create table if not exists public.studio_staff_grants (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  grantee_profile_id uuid not null references public.profiles (id) on delete cascade,
  granted_by uuid not null,
  granted_at timestamptz not null default clock_timestamp(),
  renewed_at timestamptz,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid,
  unique (id, account_id),
  foreign key (granted_by, account_id) references public.profiles (id, account_id),
  -- A grant is never longer than 90 days from its last grant or renewal.
  constraint studio_staff_grants_window_check check ((
    expires_at > granted_at
    and expires_at <= coalesce(renewed_at, granted_at) + interval '90 days'
    and (renewed_at is null or renewed_at >= granted_at)
  ) is true),
  -- A revocation is indivisible: who and when together, or neither.
  constraint studio_staff_grants_revoke_check check ((revoked_at is null) = (revoked_by is null))
);

-- At most one unrevoked grant per (client account, staff member); expiry is
-- checked at use, so an expired-but-unrevoked grant is renewed, not duplicated.
create unique index if not exists studio_staff_grants_live_idx
  on public.studio_staff_grants (account_id, grantee_profile_id) where revoked_at is null;
create index if not exists studio_staff_grants_grantee_idx
  on public.studio_staff_grants (grantee_profile_id, account_id) where revoked_at is null;

create table if not exists public.studio_staff_audit (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  client_id uuid,
  actor_profile_id uuid not null references public.profiles (id) on delete cascade,
  action text not null,
  grant_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (client_id, account_id) references public.clients (id, account_id) on delete cascade,
  foreign key (grant_id, account_id) references public.studio_staff_grants (id, account_id) on delete cascade,
  constraint studio_staff_audit_action_check check (action in ('grant', 'renew', 'revoke', 'open', 'thread')),
  -- Grant lifecycle rows name their grant; an open names the brand.
  constraint studio_staff_audit_shape_check check ((
    (action in ('grant', 'renew', 'revoke') and grant_id is not null)
    or (action in ('open', 'thread') and client_id is not null)
  ) is true)
);

create index if not exists studio_staff_audit_recent_idx
  on public.studio_staff_audit (account_id, created_at desc, id desc);

-- Keep the Data API surface closed, mirroring 080-085.
alter table public.studio_staff_grants enable row level security;
alter table public.studio_staff_audit enable row level security;
revoke all on public.studio_staff_grants, public.studio_staff_audit from public;

do $acl$
begin
  if to_regrole('anon') is not null then
    execute 'revoke all on public.studio_staff_grants, public.studio_staff_audit from anon';
  end if;
  if to_regrole('authenticated') is not null then
    execute 'revoke all on public.studio_staff_grants, public.studio_staff_audit from authenticated';
  end if;
  if to_regrole('service_role') is not null then
    execute 'revoke all on public.studio_staff_grants, public.studio_staff_audit from service_role';
  end if;
  -- Grants: read, create, renew and revoke (update), never delete.
  -- Audit: insert-only for the app.
  if to_regrole('aeo_app') is not null then
    execute 'revoke all on public.studio_staff_grants, public.studio_staff_audit from aeo_app';
    execute 'grant select, insert, update on public.studio_staff_grants to aeo_app';
    execute 'grant select, insert on public.studio_staff_audit to aeo_app';
  end if;
end
$acl$;
