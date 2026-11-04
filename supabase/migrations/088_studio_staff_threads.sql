-- 088: Studio R3 A2b — saved staff threads
-- (brief: docs/superpowers/plans/2026-11-03-aiso-brief-post6-studio-redesign.md, A2).
--
-- A platform admin holding a live studio_staff_grants row (087) for a client
-- account may save Studio threads on that account's brands. The thread lives
-- in the CLIENT account (account_id), owned by the staff member's profile,
-- which belongs to a different account. 081 bound every thread's
-- (profile_id, account_id) to profiles(id, account_id), which a staff profile
-- can never satisfy, so this migration splits that one rule in two:
--
--   member thread (staff_grant_id is null): profile is a member of the account,
--     enforced exactly as before through a stored generated column;
--   staff thread (staff_grant_id set): the grant belongs to this account AND
--     names this profile as its grantee, enforced by a composite FK.
--
-- A thread's grant is its provenance; whether the staff member may still READ
-- or WRITE it is decided per request by a live grant (unrevoked, unexpired),
-- in lib/conversation-studio/threads.ts. Grants are never deleted (087), so the
-- FK never strands a thread. Turns are unchanged: they FK to the thread's full
-- principal (id, account_id, client_id, profile_id), so they inherit both rules.
-- No RLS policies (036); every query filters by account_id.

-- Every (grant, account, grantee) triple a staff thread may name.
alter table public.studio_staff_grants
  add constraint studio_staff_grants_grantee_key unique (id, account_id, grantee_profile_id);

alter table public.studio_threads add column if not exists staff_grant_id uuid;

-- The profile a MEMBER thread must belong to; null for a staff thread, so the
-- member FK below (MATCH SIMPLE) does not apply to it.
alter table public.studio_threads add column if not exists member_profile_id uuid
  generated always as (case when staff_grant_id is null then profile_id end) stored;

-- Replace 081's (profile_id, account_id) FK. Looked up by definition rather
-- than by name so a differently named constraint cannot survive silently.
do $fk$
declare
  name text;
begin
  for name in
    select c.conname from pg_constraint c
    where c.conrelid = 'public.studio_threads'::regclass
      and c.contype = 'f'
      and c.confrelid = 'public.profiles'::regclass
      and c.conkey = array[
        (select attnum from pg_attribute where attrelid = 'public.studio_threads'::regclass and attname = 'profile_id'),
        (select attnum from pg_attribute where attrelid = 'public.studio_threads'::regclass and attname = 'account_id')
      ]::int2[]
  loop
    execute format('alter table public.studio_threads drop constraint %I', name);
  end loop;
end
$fk$;

alter table public.studio_threads
  add constraint studio_threads_member_profile_fkey
    foreign key (member_profile_id, account_id) references public.profiles (id, account_id),
  add constraint studio_threads_profile_fkey
    foreign key (profile_id) references public.profiles (id),
  add constraint studio_threads_staff_grant_fkey
    foreign key (staff_grant_id, account_id, profile_id)
    references public.studio_staff_grants (id, account_id, grantee_profile_id);

create index if not exists studio_threads_staff_grant_idx
  on public.studio_threads (staff_grant_id) where staff_grant_id is not null;
