-- 056: Attribution (Phase 2, sub-project 3): what an owner sees change after a
-- work item was delivered.
-- Spec: docs/superpowers/specs/2026-10-01-attribution-design.md (section 4)
--
-- Like 054 and 055, this migration is applied to no persistent database. It is
-- replayed on disposable Neon branches by the integration suite only.
--
-- Same tenancy rules as 054/055: composite (..., account_id) foreign keys, upsert
-- keys that lead with account_id, no RLS (036), and every query filters by account.
--
-- work_item_delivery_measures records WHICH targets an owner chose to have
-- measured for one delivery attestation: the whole site, or 1-20 registered
-- pages. It is insert-only: a measure is the owner's record of what was agreed
-- when the work was delivered, so it is never rewritten or removed.
--   * Its composite FK ends in (id, kind) of work_item_delivery_events, and
--     attestation_kind is pinned to 'attest', so a measure can only ever point at
--     an attest event, never at a withdraw. 043 already declares the unique key
--     (account_id, client_id, work_item_id, version_id, content_hash, id, kind)
--     this references; 050 declares client_assets (account_id, client_id, id).
--   * on delete restrict on both: the history a measure points at cannot be
--     deleted out from under it.
--
-- The shape rule (exactly one 'site' row, or 1-20 'page' rows and no 'site' row,
-- per attestation) spans rows, so a CHECK cannot state it. A constraint trigger
-- states it, deferred to commit so a multi-row insert can be built up inside one
-- transaction and is judged once, when it is whole. The route validates the same
-- rule first; the trigger is the backstop.
--
-- The trigger function is deliberately SECURITY INVOKER (the default), with every
-- relation schema-qualified, for the opposite reason 055's helper needs EXECUTE:
--   * It reads work_item_delivery_measures, and aeo_app already holds SELECT on
--     it, so there is nothing to elevate. SECURITY DEFINER would run it with the
--     migration owner's privileges for no gain, and would then need a pinned
--     search_path to be safe. Invoker needs neither; a qualified name cannot be
--     redirected by search_path.
--   * Like 055's CHECK helper, it runs as the role performing the INSERT. This
--     migration revokes PUBLIC's EXECUTE (as 024, 027 and 055 do) and grants it to
--     aeo_app explicitly inside the same to_regrole guard as the table grants,
--     rather than leaning on a default-privileges rule that only covers functions
--     created by the migration owner (038 says so itself).
--
-- search_console_coverage records from which date Search Console data is known to
-- exist for a property or a page. A brand whose property was bound last week has
-- no 'before' window for a delivery made a month ago, and that gap must read as
-- "no baseline", not as zero. aeo_app may update and delete it: a rebind resets
-- the property's coverage.
--
-- analytics_bindings.covered_from is the same idea for GA4: the first date the
-- binding's data is known to cover. Null means "not recorded", which consumers
-- must treat as unknown, never as the beginning of time.

create table public.work_item_delivery_measures (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  client_id uuid not null,
  work_item_id uuid not null,
  version_id uuid not null,
  content_hash text not null,
  attestation_id uuid not null,
  -- The last column of the FK below. Pinned so a measure can only target an
  -- attest event; a withdraw event shares the table and the key shape.
  attestation_kind text not null default 'attest',
  scope text not null,
  -- Null exactly when scope = 'site': the whole site has no registered page.
  asset_id uuid,
  -- clock_timestamp(), not now(): now() is pinned to transaction start, so rows
  -- recorded in one transaction would tie on recorded_at.
  recorded_at timestamptz not null default clock_timestamp(),
  constraint work_item_delivery_measures_attestation_kind_check
    check (attestation_kind = 'attest'),
  constraint work_item_delivery_measures_scope_check
    check (scope in ('site', 'page')),
  constraint work_item_delivery_measures_asset_scope_check
    check ((scope = 'site') = (asset_id is null)),
  constraint work_item_delivery_measures_attestation_fk
    foreign key (account_id, client_id, work_item_id, version_id, content_hash, attestation_id, attestation_kind)
    references public.work_item_delivery_events (account_id, client_id, work_item_id, version_id, content_hash, id, kind)
    on delete restrict,
  constraint work_item_delivery_measures_asset_fk
    foreign key (account_id, client_id, asset_id)
    references public.client_assets (account_id, client_id, id)
    on delete restrict,
  -- One site row (asset_id is null), or each page once. NULLS NOT DISTINCT
  -- (PostgreSQL 15+) is what makes the site rows collide: with a plain unique,
  -- two null asset_ids never compare equal and a second site row would be allowed.
  constraint work_item_delivery_measures_unique
    unique nulls not distinct (account_id, attestation_id, asset_id)
);

create index work_item_delivery_measures_attestation_idx
  on public.work_item_delivery_measures (account_id, client_id, attestation_id);

-- Judges the attestation of the row just inserted, once, at commit. After the
-- transaction's last insert, its rows are visible to this query, so a complete
-- set passes and a partial or mixed one does not.
create function public.work_item_delivery_measures_shape()
returns trigger
language plpgsql
as $$
declare
  sites integer;
  pages integer;
begin
  select count(*) filter (where scope = 'site'),
         count(*) filter (where scope = 'page')
    into sites, pages
    from public.work_item_delivery_measures
   where account_id = new.account_id and attestation_id = new.attestation_id;

  if (sites = 1 and pages = 0) or (sites = 0 and pages between 1 and 20) then
    return null;
  end if;

  raise exception
    'attestation % must have exactly one site measure, or 1 to 20 page measures and no site measure (found % site, % page)',
    new.attestation_id, sites, pages
    using errcode = 'check_violation',
          constraint = 'work_item_delivery_measures_shape';
end
$$;

create constraint trigger work_item_delivery_measures_shape_trg
  after insert on public.work_item_delivery_measures
  deferrable initially deferred
  for each row execute function public.work_item_delivery_measures_shape();

create table public.search_console_coverage (
  account_id uuid not null,
  client_id uuid not null,
  scope text not null,
  -- Null exactly when scope = 'property'.
  page_url text,
  covered_from date not null,
  covered_at timestamptz not null default clock_timestamp(),
  constraint search_console_coverage_client_fk
    foreign key (client_id, account_id) references public.clients (id, account_id) on delete cascade,
  constraint search_console_coverage_scope_check
    check (scope in ('property', 'page')),
  constraint search_console_coverage_page_url_scope_check
    check ((scope = 'property') = (page_url is null)),
  -- NULLS NOT DISTINCT for the same reason as search_console_daily_unique: the
  -- property row's page_url is null, and it must collide with itself.
  constraint search_console_coverage_unique
    unique nulls not distinct (account_id, client_id, scope, page_url)
);

alter table public.analytics_bindings add column covered_from date;

revoke all on public.work_item_delivery_measures, public.search_console_coverage from public;
revoke all on function public.work_item_delivery_measures_shape() from public;

do $$ begin
  if to_regrole('aeo_app') is not null then
    revoke all on public.work_item_delivery_measures, public.search_console_coverage from aeo_app;
    -- Insert-only: a measure is never rewritten or removed.
    grant select, insert on public.work_item_delivery_measures to aeo_app;
    -- A rebind resets the property's coverage (delete), and a re-sync moves it
    -- (update).
    grant select, insert, update, delete on public.search_console_coverage to aeo_app;
    -- The trigger function runs as the inserting role; see the header.
    grant execute on function public.work_item_delivery_measures_shape() to aeo_app;
  end if;
end $$;
