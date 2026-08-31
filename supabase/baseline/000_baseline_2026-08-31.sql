-- ============================================================================
-- Greenfield baseline -- 2026-08-31
-- ============================================================================
--
-- WHAT THIS IS
--   One consolidated DDL file that builds the application-owned schema from an
--   empty `public`. It exists because a brand-new Neon project *cannot* replay
--   supabase/migrations/001-037: 003 creates a trigger on `auth.users` from the
--   dead Supabase era, which no migration in this repo ever creates, and 022
--   repoints profiles.id at `neon_auth.user`, which Neon provisions out of band.
--   ADR-007 chose a clean consolidated baseline over resurrecting dead objects
--   just so a replay could reach the end.
--
-- WHAT IT IS NOT
--   It is not a redesign. Every table below is the *final* shape of that same
--   table after replaying 001-037 -- its `create table` folded together with
--   every later `add column`, `alter column`, `add constraint` and
--   `drop constraint` -- emitted once, in dependency order. Where the source
--   migration explained WHY a column, default or check exists, that reasoning
--   is carried over here. A baseline nobody can review is a baseline nobody can
--   trust, and this file is now the only place a fresh database learns the
--   schema from.
--
-- HOW THE EQUIVALENCE CLAIM IS PROVED
--   `npm run schema:equivalence` provisions a disposable Neon branch, builds
--   both paths on it -- replay 001-037, reset, apply this file -- and diffs the
--   two resulting schemas across eight object classes: columns, constraints,
--   indexes, triggers, functions, grants, RLS and extensions. Constraints are
--   compared by BODY (pg_get_constraintdef), not by name, so a check with a
--   different bound is caught. Exit 0 means the two paths are
--   indistinguishable. Do not change this file without that command green.
--
-- DELIBERATE OMISSIONS -- equivalent, not missing
--   * The `auth` schema. Dead Supabase. It is retained in the *migration*
--     replay path only because 003 needs auth.users and auth.uid() to exist
--     (see __tests__/integration/setup.ts); a greenfield database has nothing
--     that reads it, so nothing here creates it.
--   * The 30 row-level-security policies. 036 dropped all of them and disabled
--     RLS on the 21 tables that carried them: auth.uid() under Neon is
--     `nullif(current_setting('request.jwt.claim.sub', true), '')::uuid` and
--     nothing sets that GUC, so every one of those policies was a silent
--     deny-all for any role without BYPASSRLS. Creating them here in order to
--     drop them again would be theatre. Tenancy is enforced in application code
--     by explicit account_id filters -- lib/localTrust/guard.ts is the shape to
--     copy -- and this file does not pretend otherwise.
--   * `neon_auth`. Neon owns that schema and its `user` table. This file may
--     REFERENCE neon_auth."user"; it must never create it.
--
-- ORDERING
--   Dependency order, not migration order.
-- ============================================================================


-- ============================================================================
-- Slice 1 -- core tenancy: accounts, profiles, clients
--
-- These three come first because nearly every other table in the schema FKs
-- into one of them. `accounts` is the tenancy root: account_id is the column
-- every query in the application must filter on, since migration 036 removed
-- the last (already inert) database-level backstop.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- accounts -- one row per subscription.
--
-- Consolidates: 003 (create), 014 (starter -> basic, plan check rewritten),
-- 016 (trial columns), 024 (Stripe event ordering + subscription uniqueness),
-- 028 (admin plan overrides), 030 (plan default finally follows 014).
-- ----------------------------------------------------------------------------
create table public.accounts (
  id uuid default gen_random_uuid()
    constraint accounts_pkey primary key,

  stripe_customer_id text
    constraint accounts_stripe_customer_id_key unique,
  stripe_subscription_id text,

  -- 003 created plan as `not null default 'starter'`; 014 migrated every row to
  -- 'basic' and rewrote the check to the three plans below -- but left the
  -- default behind. For sixteen migrations the column default was not a member
  -- of its own CHECK, so any insert omitting `plan` failed accounts_plan_check.
  -- Latent rather than live (the Neon user.created webhook,
  -- apply_stripe_account_event() and every integration test pass plan
  -- explicitly); 030 closed the trap. The default is 'basic' here from the
  -- start -- there is no 'starter' plan in this schema and never was, once 014
  -- had run.
  plan text not null default 'basic'
    constraint accounts_plan_check
    check (plan in ('basic', 'pro', 'enterprise')),

  status text not null default 'active'
    constraint accounts_status_check
    check (status in ('active', 'past_due', 'cancelled', 'trialing')),

  -- Trial state (016). resolveCommercialEntitlement() in lib/tier.ts and
  -- check_brand_limit() both read trial_ends_at; trial_emails_sent is the
  -- counter /api/cron/trial-emails advances so a reminder is sent once.
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  trial_emails_sent integer not null default 0,

  -- Stripe lifecycle ordering (024). Webhook delivery order is not event order,
  -- so the last applied event's creation time is stored and compared: an event
  -- older than stripe_event_created_at is stale and must not overwrite newer
  -- state. Default 0 makes the very first event unconditionally newer.
  stripe_event_created_at bigint not null default 0,
  stripe_event_id text,

  -- Admin plan comps (028), which survive the Stripe webhook: accounts.plan
  -- keeps exactly two writers (the signup webhook seeds 'basic', the Stripe
  -- webhook maintains it), so an admin grant writes these columns instead of
  -- plan and is no longer clobbered by the next subscription event.
  -- override_expires_at IS NULL means a permanent comp (internal/partner).
  --
  -- override_set_by deliberately carries NO foreign key. Attribution must
  -- outlive the actor it names, and profiles.id cascade-deletes from
  -- neon_auth.user while profiles.account_id cascade-deletes from accounts --
  -- an FK here would block deleting an admin's Neon Auth user, or their
  -- account, on a constraint naming a table the caller never touched.
  -- accounts_override_complete still guarantees a person is recorded at grant
  -- time.
  override_plan text,
  override_reason text,
  override_set_by uuid,
  override_expires_at timestamptz,

  created_at timestamptz default now(),

  -- accounts_override_plan_check restricts a comp to a known plan.
  -- accounts_override_complete makes an unattributed comp impossible at the
  -- database level -- a grant cannot exist without both a reason and a person.
  -- accounts_override_expiry_finite rejects 'infinity'/'-infinity', which
  -- check_brand_limit()'s `> pg_catalog.now()` would treat as permanently live
  -- while a TypeScript reader receiving a non-finite value would not.
  constraint accounts_override_plan_check
    check (override_plan is null
           or override_plan in ('free', 'basic', 'pro', 'enterprise')),
  constraint accounts_override_complete
    check (override_plan is null
           or (override_set_by is not null
               and override_reason is not null
               and char_length(btrim(override_reason)) between 1 and 500)),
  constraint accounts_override_expiry_finite
    check (override_expires_at is null
           or (override_expires_at > '-infinity'::timestamptz
               and override_expires_at < 'infinity'::timestamptz))
);

-- 024. One account per Stripe subscription, enforced in the database rather
-- than trusted from webhook payloads. Partial, because stripe_subscription_id
-- is null for every account that has never checked out and a plain unique
-- constraint would be satisfied by those nulls only by accident of SQL's
-- null semantics -- the partial index states the intent.
create unique index accounts_stripe_subscription_id_unique
  on public.accounts (stripe_subscription_id)
  where stripe_subscription_id is not null;


-- ----------------------------------------------------------------------------
-- profiles -- one row per authenticated user, joining that user to an account.
--
-- Consolidates: 003 (create), 022 (id repointed from auth.users to
-- neon_auth.user), 027 (tenant-composite unique key).
-- ----------------------------------------------------------------------------
create table public.profiles (
  -- 003 pointed this at Supabase's auth.users; 022 repointed it at Neon Auth.
  -- Neon owns neon_auth."user" -- this baseline references it and must never
  -- create it. lib/auth.ts's getProfile() is the only reader that matters:
  -- the session's user id IS this primary key.
  id uuid
    constraint profiles_pkey primary key
    constraint profiles_id_fkey references neon_auth."user"(id) on delete cascade,

  account_id uuid
    constraint profiles_account_id_fkey references public.accounts(id) on delete cascade,

  display_name text,
  is_admin boolean default false,
  created_at timestamptz default now(),

  -- 027. Lets other tables carry a composite (actor, account_id) foreign key
  -- into profiles -- account_report_branding.updated_by and
  -- client_reports.created_by both do -- so an attribution row physically
  -- cannot name a profile belonging to a different tenant.
  constraint profiles_id_account_id_unique unique (id, account_id)
);


-- ----------------------------------------------------------------------------
-- clients -- a brand being monitored. The unit a dashboard, a Pulse run and a
-- scan all hang off.
--
-- Consolidates: 002 (create), 004 (account_id, then NOT NULL), 009 (domain),
-- 013 (webhook_url), 018 (region), 019 (description), 021 (tenant-composite
-- unique key; 027 re-adds the same constraint defensively when absent).
-- ----------------------------------------------------------------------------
create table public.clients (
  id uuid default gen_random_uuid()
    constraint clients_pkey primary key,

  -- 004 added this nullable, backfilled every existing row to a seed account,
  -- and only then set NOT NULL. The seed row itself is data, not schema, and is
  -- not recreated here.
  account_id uuid not null
    constraint clients_account_id_fkey references public.accounts(id) on delete cascade,

  brand_name text not null,

  -- 009: optional, links a brand to its website.
  domain text,
  -- 019: brand description, used as AI context when generating Pulse questions.
  description text,

  industry text,
  -- 018: required by the onboarding wizard (step 3: industry & region).
  region text,

  competitors text[],

  -- 013: agent-dashboard callback target.
  webhook_url text default null,

  status text default 'active',
  created_at timestamptz default now(),

  -- 021. The composite key that makes tenant-scoped foreign keys possible:
  -- local_trust_* and client_reports reference clients (id, account_id) rather
  -- than clients (id), so a child row cannot point at a client owned by another
  -- account. 027 re-creates this same constraint behind an existence check
  -- because production had 021 applied and 027 not; either order had to work.
  constraint clients_id_account_id_unique unique (id, account_id)
);


-- ============================================================================
-- Slice 2 -- scan engine: scans, fix_packs, chunk_analysis
--
-- `scans` is the oldest table in the schema (001) and the one most later
-- migrations reached back into: it started life as an anonymous, tenant-less
-- record of one public URL scan and accreted tenancy (008, 027), brand
-- ownership (029), GEO context (012), agent tracking (013, 014) and lead
-- capture (015) over the following twenty-one migrations. Both other tables in
-- this slice hang off it by scan_id.
--
-- It sits after slice 1 because scans_client_tenant_fkey references
-- clients (id, account_id) -- the composite key 021 exists to provide.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- scans -- one AEO scan of one URL. Read by the public result page, the
-- dashboard, and the report snapshot RPCs.
--
-- Consolidates: 001 (create), 008 (account_id + its index), 012 (industry,
-- region, grade), 013 (agent_status), 014 (agent_platforms), 015 (lead_email),
-- 027 (tenant-composite unique key + account/domain index), 029 (client_id and
-- both of its foreign keys + index).
--
-- Every column added after 001 is nullable, and deliberately so: a scan can be
-- anonymous (no account_id), unattached to a brand (no client_id), and never
-- put through the agent pipeline (no agent_status). The public funnel writes
-- rows in exactly that state.
-- ----------------------------------------------------------------------------
create table public.scans (
  id uuid default gen_random_uuid()
    constraint scans_pkey primary key,

  -- 001. The scanned page and the host extracted from it. domain is stored
  -- separately rather than derived on read because 027's
  -- scans_account_domain_created_idx orders a tenant's scan history by it.
  url text not null,
  domain text not null,

  -- 001 score (the 0-100 composite lib/scoring.ts computes); 012 added grade,
  -- the letter assignGrade() derives from it. Both nullable -- a scan row is
  -- written before either is known.
  score numeric(5,2),
  grade text,

  -- 001. The per-check payload: c1..c20 keys plus the four <key>_data GEO
  -- blobs. NOT NULL from the start -- a scan with no results is not a scan.
  results jsonb not null,

  -- 008. Nullable because anonymous public-funnel scans belong to no account.
  -- No ON DELETE action, unlike almost every other account_id in this schema:
  -- deleting an account with scan history raises rather than silently
  -- discarding it.
  account_id uuid
    constraint scans_account_id_fkey references public.accounts(id),

  -- 029. Scans carried only account_id, so a brand workspace could not
  -- distinguish its own scans from any other brand's on the same account.
  -- Nullable for the same reason as account_id.
  client_id uuid,

  -- 012. GEO context captured at scan time, so a re-scored scan is compared
  -- against the industry/region pack it actually ran under.
  industry text,
  region text,

  -- 013. Agent-dashboard pipeline state. The check is written to permit NULL
  -- explicitly because the column is nullable and NULL is the normal state for
  -- every scan that never entered the pipeline.
  agent_status text default null
    constraint scans_agent_status_check
    check (agent_status is null
           or agent_status in ('pending', 'running', 'complete', 'error')),

  -- 014. Which AI platforms the agent run covered.
  agent_platforms text[] default null,

  -- 015. Post-scan email capture on the public result page.
  lead_email text,

  created_at timestamptz default now(),

  -- 027. The mirror of clients_id_account_id_unique: it lets
  -- client_report_versions carry composite (scan, account_id) foreign keys into
  -- scans, so a report version physically cannot cite a scan from another
  -- tenant.
  constraint scans_id_account_id_unique unique (id, account_id),

  -- 029. Two foreign keys, not one. scans_client_id_fkey is ordinary
  -- referential integrity; scans_client_tenant_fkey is the tenancy guarantee --
  -- a scan must not point at a brand owned by a different account, and clients
  -- carries a (id, account_id) unique constraint (021) precisely so this
  -- composite FK is expressible. ON DELETE SET NULL on both: deleting a brand
  -- must not delete its scan history.
  constraint scans_client_id_fkey
    foreign key (client_id) references public.clients (id) on delete set null,
  constraint scans_client_tenant_fkey
    foreign key (client_id, account_id) references public.clients (id, account_id)
    on delete set null
);

-- 008. Scan history for a logged-in account.
create index scans_account_id_idx on public.scans (account_id);

-- 027. Scan history for one tenant's domain, newest first -- the ordering the
-- report snapshot RPCs and the dashboard both read in.
create index scans_account_domain_created_idx
  on public.scans (account_id, domain, created_at desc);

-- 029. The same, narrowed to one brand workspace.
create index scans_client_created_idx
  on public.scans (client_id, created_at desc);


-- ----------------------------------------------------------------------------
-- fix_packs -- the generated remediation bundle for one scan (/api/fix).
--
-- Consolidates: 001 (create), 012 (the three GEO outputs).
--
-- scan_id is nullable as created in 001 and was never tightened; the delete
-- rule still cascades, so a deleted scan takes its fix pack with it.
-- ----------------------------------------------------------------------------
create table public.fix_packs (
  id uuid default gen_random_uuid()
    constraint fix_packs_pkey primary key,

  scan_id uuid
    constraint fix_packs_scan_id_fkey references public.scans(id) on delete cascade,

  -- 001. The three original fix-pack artefacts.
  llms_txt text,
  robots_patch text,
  faq_schema text,

  -- 012. GEO-era additions, generated by the fix/ subroutes rather than the
  -- main fix handler.
  geo_content_brief text,
  chunk_rewriter text,
  cluster_map text,

  created_at timestamptz default now()
);


-- ----------------------------------------------------------------------------
-- chunk_analysis -- per-page chunk extractability for one scan (012, GEO).
--
-- Unlike fix_packs, scan_id is NOT NULL: a chunk analysis is meaningless
-- detached from the scan that produced it.
-- ----------------------------------------------------------------------------
create table public.chunk_analysis (
  id uuid default gen_random_uuid()
    constraint chunk_analysis_pkey primary key,

  scan_id uuid not null
    constraint chunk_analysis_scan_id_fkey references public.scans(id) on delete cascade,

  page_url text not null,

  -- One entry per extracted chunk. Defaults to an empty array so a reader never
  -- has to distinguish "not analysed yet" from "analysed, no chunks".
  chunks jsonb not null default '[]',

  avg_extractability numeric(4,2),
  analyzed_at timestamptz default now()
);
