-- Append-only record of who was made a platform administrator, and why.
--
-- `profiles.is_admin` is the key to requireAdmin(), the whole /admin subtree
-- and the approver-grant route — and until now NOTHING in this repository ever
-- wrote it. Not the product, not a script, not a migration, not an environment
-- variable; migration 003 declares it `default false` and 004's dead policies
-- only read it. So the only way anyone became an administrator was an ad-hoc
-- UPDATE against production, leaving no record of who did it or why.
--
-- 047 removed the other direct write AC-14 needed (`profiles.account_id`).
-- This removes the last one. `scripts/grant-platform-admin.ts` performs the
-- update and the ledger row in ONE statement, so a privilege cannot be granted
-- without its reason being recorded alongside it.
--
-- No foreign key on `profile_id`, deliberately — 046's rule: a decision is a
-- frozen identity and survives the profile it names. Deleting a profile must
-- not erase the record that it once held administrator rights.

create table public.platform_admin_grants (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null,
  action text not null check (action in ('grant', 'revoke')),
  reason text not null
    constraint platform_admin_grants_reason_check check ((
      char_length(reason) between 1 and 2000
      and reason = btrim(reason)
      and reason = normalize(reason, NFC)
    ) is true),
  -- The database role that performed it, captured as `current_user` at write
  -- time. The script runs through MIGRATE_DATABASE_URL and holds no session,
  -- so there is no profile to name — the connecting role is the honest answer,
  -- and inventing a uuid here would be worse than recording none.
  operator text not null check (char_length(btrim(operator)) between 1 and 200),
  created_at timestamptz not null default now()
);

create index platform_admin_grants_profile_idx
  on public.platform_admin_grants (profile_id, created_at desc);

-- 037 grants full DML on every new table in `public` by default, so the denial
-- has to be stated. SELECT only: the application never grants platform
-- administration to anybody. That is an operator action performed through the
-- owner connection, which is exactly the boundary this posture expresses.
revoke all on public.platform_admin_grants from public;
do $$ begin
  if to_regrole('aeo_app') is not null then
    revoke all on public.platform_admin_grants from aeo_app;
    grant select on public.platform_admin_grants to aeo_app;
  end if;
end $$;
