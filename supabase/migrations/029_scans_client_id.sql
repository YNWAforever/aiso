-- 029_scans_client_id.sql
-- Scans carried only account_id, so a brand workspace could not distinguish its
-- own scans from any other brand's on the same account. Nullable because
-- anonymous public-funnel scans legitimately belong to no brand.

alter table public.scans
  add column if not exists client_id uuid;

do $scans_client_fk$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'scans_client_id_fkey'
      and conrelid = 'public.scans'::regclass
  ) then
    alter table public.scans
      add constraint scans_client_id_fkey
      foreign key (client_id) references public.clients (id) on delete set null;
  end if;
end
$scans_client_fk$;

-- A scan must not point at a brand owned by a different account. clients
-- carries a (id, account_id) unique constraint (migration 021) precisely so
-- this composite FK is expressible.
do $scans_tenant_fk$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'scans_client_tenant_fkey'
      and conrelid = 'public.scans'::regclass
  ) then
    alter table public.scans
      add constraint scans_client_tenant_fkey
      foreign key (client_id, account_id) references public.clients (id, account_id)
      on delete set null;
  end if;
end
$scans_tenant_fk$;

create index if not exists scans_client_created_idx
  on public.scans (client_id, created_at desc);
