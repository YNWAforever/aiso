-- 097: Retainer OS Slice B — one record per brand per Hong Kong calendar month
-- (brief: docs/superpowers/plans/2026-11-06-aiso-brief-retainer-os.md, §2 Slice B).
--
-- A month is "opened" when its opening snapshot exists and "closed" when its
-- closing snapshot exists. Each snapshot is one row, written once and never
-- updated or deleted by the app: the history is insert-only.
--
-- Figures are computed AS OF the month boundary (`as_of`), from rows dated
-- before it, so a snapshot recorded late still describes the boundary.
-- `taken_at` records when it was actually written, because late-arriving data
-- (a Search Console re-sync) can still differ. A source with no data is stored
-- as an explicit state inside `figures`, never as 0.
--
-- What happened during the month (work items, site edits, deliveries) is NOT
-- copied here: it is derived from the rows that already record it.
-- No RLS policies (036); RLS enabled with app grants only, like 089–091.

create table if not exists public.brand_month_snapshots (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  client_id uuid not null,
  -- First day of the Hong Kong calendar month.
  month date not null,
  kind text not null,
  as_of timestamptz not null,
  figures jsonb not null,
  taken_at timestamptz not null default clock_timestamp(),
  unique (account_id, client_id, month, kind),
  foreign key (client_id, account_id) references public.clients (id, account_id) on delete cascade,
  constraint brand_month_snapshots_kind_check check (kind in ('opening', 'closing')),
  constraint brand_month_snapshots_shape_check check ((
    month = date_trunc('month', month)::date
    -- The boundary is fixed by the month and the kind: opening at the month's
    -- first Hong Kong midnight, closing at the next month's.
    and as_of = ((case when kind = 'opening' then month else (month + interval '1 month')::date end)::timestamp
                 at time zone 'Asia/Hong_Kong')
    and as_of <= taken_at
    and jsonb_typeof(figures) = 'object'
    and octet_length(figures::text) <= 16384
  ) is true)
);

create index if not exists brand_month_snapshots_scope_idx
  on public.brand_month_snapshots (account_id, client_id, month desc);

alter table public.brand_month_snapshots enable row level security;
revoke all on public.brand_month_snapshots from public;

do $acl$
begin
  if to_regrole('anon') is not null then
    execute 'revoke all on public.brand_month_snapshots from anon';
  end if;
  if to_regrole('authenticated') is not null then
    execute 'revoke all on public.brand_month_snapshots from authenticated';
  end if;
  if to_regrole('service_role') is not null then
    execute 'revoke all on public.brand_month_snapshots from service_role';
  end if;
  -- Insert-only history for the app.
  if to_regrole('aeo_app') is not null then
    execute 'revoke all on public.brand_month_snapshots from aeo_app';
    execute 'grant select, insert on public.brand_month_snapshots to aeo_app';
  end if;
end
$acl$;
