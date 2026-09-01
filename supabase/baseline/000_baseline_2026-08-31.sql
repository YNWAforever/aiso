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


-- ============================================================================
-- Slice 3 -- monitoring: prompt bank, Pulse metrics, alerting
--
-- The weekly AI-visibility loop, in the order it runs. prompt_bank holds the
-- questions a brand is monitored against; pulse_metrics stores one row per
-- (prompt, platform) answer; pulse_weekly_summary is the rollup those rows are
-- aggregated into; and alert_configs / notifications / alert_email_deliveries
-- are the alerting that reads that rollup a few hours later -- which is why
-- cloudflare/cron-worker schedules /api/cron/pulse at 17 4 * * 1 and
-- /api/cron/evaluate-alerts at 47 7 * * 1, in that order.
--
-- Everything here hangs off clients (slice 1). notifications is the one table
-- that also references accounts directly: its client_id is ON DELETE SET NULL,
-- so a notification outlives the brand it was raised for and still needs an
-- inbox to belong to.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- prompt_bank -- the questions one brand is monitored against.
--
-- Consolidates: 002 (create). Nothing later changed its shape -- 004 added an
-- RLS policy over it and 036 dropped that policy again.
--
-- Note what is deliberately absent: `category` carries no CHECK.
-- lib/prompts/categories.ts is the single source of truth for the four category
-- keys, and the writers here are LLMs -- so the value is validated on the way
-- in, in application code, and read permissively on the way out. A constraint
-- here would turn a rejected suggestion into a failed generation run.
--
-- is_active is what selectPendingClients() in lib/pulse/schedule.ts filters on,
-- and an empty prompt_bank is the whole reason the Pulse rollup has never
-- written a production row: no active prompt, no candidate client, no producer
-- run.
-- ----------------------------------------------------------------------------
create table public.prompt_bank (
  id uuid default gen_random_uuid()
    constraint prompt_bank_pkey primary key,

  -- Nullable as created in 002 and never tightened; the delete rule cascades,
  -- so removing a brand removes its bank.
  client_id uuid
    constraint prompt_bank_client_id_fkey references public.clients(id) on delete cascade,

  category text,
  question text not null,

  -- The bank was built for a Hong Kong client base, so a row that does not say
  -- otherwise is Cantonese.
  language text default 'zh-HK',

  is_active boolean default true,
  created_at timestamptz default now()
);


-- ----------------------------------------------------------------------------
-- pulse_metrics -- one raw answer: what one platform said to one prompt in one
-- scan week.
--
-- Consolidates: 002 (create), 032 (the table's first two indexes -- it carried
-- none at all for the thirty migrations in between).
--
-- There is no unique key, and the baseline keeps it that way rather than
-- quietly fixing it. total_queries in the weekly rollup is a COUNT over these
-- rows, so writing one prompt twice inflates sov_score -- the single number the
-- whole feature reports. 032 declined to make the second index below unique
-- because a unique index cannot be built while duplicate rows may already
-- exist, and whether production carried any was unknowable without a live
-- connection. Correctness therefore lives in app/api/pulse/run, which deletes a
-- prompt's rows for the week before writing them. Any new writer of this table
-- needs the same discipline; tightening the schema instead is a migration with
-- its own data-cleanup step, not something a baseline gets to decide.
-- ----------------------------------------------------------------------------
create table public.pulse_metrics (
  id uuid default gen_random_uuid()
    constraint pulse_metrics_pkey primary key,

  -- Neither foreign key carries an ON DELETE action, unlike prompt_bank's
  -- above: deleting a client or a prompt that still has metrics raises rather
  -- than discarding the history.
  client_id uuid
    constraint pulse_metrics_client_id_fkey references public.clients(id),
  prompt_id uuid
    constraint pulse_metrics_prompt_id_fkey references public.prompt_bank(id),

  -- Which assistant answered. The vocabularies live in lib/pulse/, not in a
  -- CHECK -- the set of platforms a plan grants is an entitlement question.
  platform text not null,

  -- The question as actually asked, stored here as well as in prompt_bank, so a
  -- row stays readable after the prompt behind it is edited or deactivated.
  question text not null,

  -- The answer, and what lib/pulse/'s analysis extracted from it.
  raw_answer text,
  brand_mentioned boolean,
  sentiment text,
  mention_position integer,
  competitors_mentioned text[],

  -- date_trunc('week', now())::date. Every read of this table is keyed on it.
  scan_week date not null,

  created_at timestamptz default now()
);

-- 032. Two indexes matching the two access patterns exactly, on a table that
-- carried none at all from 002 until then and only ever grows -- prompts x
-- platforms x clients x weeks:
--
--   (client_id, scan_week)            the weekly driver's cursor derivation
--                                     (count distinct prompt_id for this week)
--                                     and the dashboard's missed-opportunity
--                                     read
--   (client_id, prompt_id, scan_week) the producer's delete-before-insert
--
-- Both were sequential scans over every row the table had ever accumulated.
create index pulse_metrics_client_week_idx
  on public.pulse_metrics (client_id, scan_week);

create index pulse_metrics_client_prompt_week_idx
  on public.pulse_metrics (client_id, prompt_id, scan_week);


-- ----------------------------------------------------------------------------
-- pulse_weekly_summary -- singular, not _summaries -- the weekly rollup of
-- pulse_metrics: one row per (client, week, platform), plus one aggregate row
-- per (client, week) carrying platform IS NULL.
--
-- Consolidates: 002 (create), 031 (the NULLS NOT DISTINCT unique key the
-- rollup's ON CONFLICT needs), 033 (the alert snapshot index), 034 (that same
-- index, refined with deterministic tie-breaks).
-- ----------------------------------------------------------------------------
create table public.pulse_weekly_summary (
  id uuid default gen_random_uuid()
    constraint pulse_weekly_summary_pkey primary key,

  -- No ON DELETE action, matching pulse_metrics.
  client_id uuid
    constraint pulse_weekly_summary_client_id_fkey references public.clients(id),

  scan_week date not null,

  -- A NULL platform is not missing data: it is the cross-platform aggregate row
  -- for that client-week, and it is the row cron/evaluate-alerts reads. The
  -- unique index below and the snapshot index both depend on that meaning.
  platform text,

  -- total_queries is a COUNT over pulse_metrics rows, which is how a
  -- double-written prompt surfaces here as an inflated sov_score.
  total_queries integer,
  brand_mentions integer,
  sov_score numeric(5,2),
  avg_sentiment_score numeric(3,2),
  top_competitors jsonb,

  created_at timestamptz default now()
);

-- 031. The arbiter `on conflict (client_id, scan_week, platform)` needs. The
-- table carried no uniqueness at all from 002 until then, so every rollup
-- appended instead of refreshing and no ON CONFLICT clause was even expressible
-- (42P10).
--
-- NULLS NOT DISTINCT is the load-bearing part, not incidental. Under a plain
-- unique index NULLs compare distinct, so two aggregate rows for the same
-- client-week coexist happily -- verified on PostgreSQL 16, a plain index
-- leaves 2 rows where this leaves 1. cron/evaluate-alerts reads the last two
-- aggregate weeks and computes a week-over-week delta; handed two copies of the
-- same week it computes 0% and never fires. Requires PostgreSQL 15+; Neon is
-- 16/17.
create unique index pulse_weekly_summary_client_week_platform_unique
  on public.pulse_weekly_summary (client_id, scan_week, platform)
  nulls not distinct;

-- 033, refined by 034. The alert snapshot read: the newest aggregate weeks for
-- one client. 033 ordered by (client_id, scan_week DESC, id DESC); 034 added
-- created_at DESC NULLS LAST ahead of the id tie-break so the ordering between
-- two rows sharing a week is deterministic rather than decided by a random uuid.
create index pulse_weekly_summary_alert_snapshot_idx
  on public.pulse_weekly_summary (
    client_id,
    scan_week desc,
    created_at desc nulls last,
    id desc
  )
  where platform is null;


-- ----------------------------------------------------------------------------
-- alert_configs -- per-client alert settings, at most one row per client.
--
-- Consolidates: 010 (create). Unchanged since; 036 dropped its RLS policy.
--
-- Both alerts default OFF while both delivery channels default ON: arming an
-- alert is a deliberate act, and once armed it goes out over every channel the
-- user has not switched off. notify_inapp = false is exactly why notifications
-- cannot double as the email ledger -- see alert_email_deliveries below.
--
-- No trigger maintains updated_at; the dashboard alerts route sets it to now()
-- in its own upsert. Triggers are not omitted here by accident -- there simply
-- is not one.
-- ----------------------------------------------------------------------------
create table public.alert_configs (
  id uuid default gen_random_uuid()
    constraint alert_configs_pkey primary key,

  client_id uuid not null
    constraint alert_configs_client_id_fkey references public.clients(id) on delete cascade,

  -- Absolute floor: lib/alerts/evaluate.ts fires sov_threshold when the latest
  -- aggregate sov_score is below sov_threshold, and sov_recovery when it climbs
  -- back above it.
  enabled_sov boolean not null default false,
  sov_threshold integer not null default 50,

  -- Week-over-week fall, in percentage points rather than percent: sov_wow_drop
  -- fires when (previous - latest) >= wow_threshold.
  enabled_wow boolean not null default false,
  wow_threshold integer not null default 10,

  notify_email boolean not null default true,
  notify_inapp boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- 010 wrote this as a bare UNIQUE (client_id); the name below is the one
  -- Postgres generated for it, and it is the arbiter the alerts route upserts
  -- against.
  constraint alert_configs_client_id_key unique (client_id)
);


-- ----------------------------------------------------------------------------
-- notifications -- the in-app alert inbox. NotificationBell in the dashboard
-- layout header is the reader; upsertNotification in lib/alerts/neon-store.ts
-- is the only writer.
--
-- Consolidates: 010 (create + the inbox index), 011 (scan_week and a partial
-- dedup index), 033 (that dedup index rebuilt without its WHERE clause).
-- ----------------------------------------------------------------------------
create table public.notifications (
  id uuid default gen_random_uuid()
    constraint notifications_pkey primary key,

  -- The inbox this belongs to. NOT NULL and cascading -- an account's
  -- notifications go with it.
  account_id uuid not null
    constraint notifications_account_id_fkey references public.accounts(id) on delete cascade,

  -- The brand the alert was raised about. Nullable, and SET NULL rather than
  -- CASCADE: deleting a brand must not empty an inbox of alerts already
  -- delivered to a human.
  client_id uuid
    constraint notifications_client_id_fkey references public.clients(id) on delete set null,

  -- The same three alert types lib/alerts/evaluate.ts emits and
  -- alert_email_deliveries records.
  type text not null
    constraint notifications_type_check
    check (type in ('sov_threshold', 'sov_wow_drop', 'sov_recovery')),

  title text not null,
  message text not null,
  read boolean not null default false,

  -- 011. The week the alert is about, and the third column of the dedup key
  -- below. Nullable: a recovery or manually raised notification need not name a
  -- week.
  scan_week date,

  created_at timestamptz not null default now()
);

-- 010. The inbox query: one account's notifications, narrowed by read state,
-- newest first.
create index notifications_account_read_idx
  on public.notifications (account_id, read, created_at desc);

-- 011, rebuilt by 033. One in-app alert per (client, type, week).
--
-- 011 made this partial -- WHERE client_id IS NOT NULL AND scan_week IS NOT
-- NULL -- which reads like a tightening and buys nothing: a plain unique index
-- already treats NULLs as distinct, so those rows were never deduplicated
-- either way. What the predicate did cost is the ON CONFLICT: Postgres will not
-- infer a partial index as the arbiter for a bare
-- `on conflict (client_id, type, scan_week)` unless the statement repeats the
-- same predicate, and that bare clause is exactly what upsertNotification
-- writes. 033 dropped the WHERE clause -- same dedup behaviour, an arbiter that
-- can actually be named.
create unique index notifications_dedup_idx
  on public.notifications (client_id, type, scan_week);


-- ----------------------------------------------------------------------------
-- alert_email_deliveries -- the ledger that makes an alert email at-most-once
-- per (client, type, scan_week).
--
-- Consolidates: 035 (create).
--
-- notifications already deduplicated in-app rows through notifications_dedup_idx
-- (033), but email had no equivalent: runAlertEvaluation called sendAlertEmail
-- for every fired action, so re-running evaluation inside the same week re-sent
-- every email while the notification insert correctly no-opped. notifications
-- cannot serve as that ledger even when it is present, because an alert config
-- may set notify_inapp = false and then no notifications row is written at all.
-- ----------------------------------------------------------------------------
create table public.alert_email_deliveries (
  id uuid default gen_random_uuid()
    constraint alert_email_deliveries_pkey primary key,

  client_id uuid not null
    constraint alert_email_deliveries_client_id_fkey references public.clients(id) on delete cascade,

  type text not null
    constraint alert_email_deliveries_type_check
    check (type in ('sov_threshold', 'sov_wow_drop', 'sov_recovery')),

  scan_week date not null,

  -- Who it went to, recorded at claim time rather than after the send, so a
  -- Resend failure cannot produce a second attempt.
  recipient text not null,

  created_at timestamptz not null default now()
);

-- 035. The claim itself. claimEmailDelivery inserts here with
-- `on conflict do nothing returning id` and sends only when a row comes back,
-- which is what turns this table into a send-once gate rather than a log
-- written after the fact.
create unique index alert_email_deliveries_dedup_idx
  on public.alert_email_deliveries (client_id, type, scan_week);


-- ============================================================================
-- Slice 4 -- features: client reports, local trust, authority, agents
--
-- Four independent feature areas, grouped because none of them is depended on
-- by anything outside itself: they are all leaves hanging off slice 1's
-- accounts/clients/profiles and slice 2's scans.
--
--   client_reports*     the shareable snapshot a agency sends its client
--   local_trust_*       local-visibility scoring and its ROI model
--   authority_*         domain authority scoring and its per-client overrides
--   agent_*             the agent-dashboard outputs, one row per scan/platform
--
-- Three of these tables -- account_report_branding, client_reports and
-- client_report_versions -- are the only ones in this slice that keep RLS
-- enabled; see the note above the `enable row level security` statements below.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- pgcrypto. Created HERE rather than alongside the rest of the extension /
-- grant / function work, because it is load-bearing for the very next statement
-- but one: client_reports.public_slug's DEFAULT calls public.gen_random_bytes(),
-- and a column default is resolved to a function OID at CREATE TABLE time, not
-- on first insert. Without the extension in place first, `create table
-- public.client_reports` fails outright with "function public.gen_random_bytes
-- (integer) does not exist".
--
-- 027 does exactly this, for exactly this reason, and its comment is worth
-- repeating: this project's Supabase origin had pgcrypto on by default, a fresh
-- Neon database does not. `if not exists` keeps it idempotent either way.
--
-- Note that gen_random_uuid(), used as a default all over this file, is NOT
-- from here -- it has been core PostgreSQL since 13.
create extension if not exists pgcrypto with schema public;


-- ----------------------------------------------------------------------------
-- account_report_branding -- the agency's white-label header on every report it
-- shares. One row per account, so account_id IS the primary key.
--
-- Consolidates: 027 (create).
--
-- The four CHECKs are all length/format bounds, and they exist because this
-- content is rendered into a public page: an unbounded agency_name or logo_url
-- is a layout break at best. primary_color is pinned to a six-digit hex literal
-- rather than "any CSS colour" for the same reason -- it is interpolated into
-- inline styles.
-- ----------------------------------------------------------------------------
create table public.account_report_branding (
  account_id uuid
    constraint account_report_branding_pkey primary key
    constraint account_report_branding_account_id_fkey
      references public.accounts(id) on delete cascade,

  agency_name text not null,
  logo_url text,
  primary_color text not null default '#111827',

  -- Contact block: both halves or neither, enforced by
  -- account_report_branding_contact_pair_check below. A label with no url
  -- renders as dead text on the shared report.
  contact_label text,
  contact_url text,

  -- Attribution for the last edit. Nullable, and the composite foreign key
  -- below sets only this column to NULL when the profile goes -- the branding
  -- row itself must survive, because the account still owns it.
  updated_by uuid,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint account_report_branding_agency_name_check
    check (char_length(btrim(agency_name)) between 1 and 120),
  constraint account_report_branding_logo_url_check
    check (logo_url is null or char_length(logo_url) between 1 and 2048),
  constraint account_report_branding_primary_color_check
    check (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  constraint account_report_branding_contact_pair_check
    check (
      (contact_label is null and contact_url is null)
      or (
        contact_label is not null
        and contact_url is not null
        and char_length(btrim(contact_label)) between 1 and 80
        and char_length(contact_url) between 1 and 2048
      )
    ),

  -- (updated_by, account_id) rather than just updated_by: this is the composite
  -- key profiles_id_account_id_unique (027, slice 1) exists to make expressible.
  -- It makes it physically impossible to credit an edit to a profile belonging
  -- to a different tenant. `on delete set null (updated_by)` is PostgreSQL 15+
  -- column-list SET NULL -- it nulls the attribution column alone and leaves
  -- account_id, which is the primary key, untouched. A bare SET NULL would try
  -- to null the primary key and fail.
  constraint account_report_branding_updated_by_tenant_fkey
    foreign key (updated_by, account_id)
    references public.profiles (id, account_id)
    on delete set null (updated_by)
);

-- 027. The reverse lookup for "what did this person last touch", and the index
-- that keeps the SET NULL above from scanning the table on profile deletion.
create index account_report_branding_updated_by_idx
  on public.account_report_branding (updated_by);


-- ----------------------------------------------------------------------------
-- client_reports -- one shareable report per (account, client). The row holds
-- the share link and its lifecycle; the content lives in
-- client_report_versions, which is append-only.
--
-- Consolidates: 027 (create, plus the two back-references added immediately
-- after client_report_versions exists -- see below).
--
-- Every mutation of this table goes through one of 027's SECURITY DEFINER RPCs
-- (create_client_report_with_version, append_client_report_version,
-- publish_client_report_latest, revoke_client_report,
-- rotate_client_report_link), each of which takes an advisory lock on the report
-- id and re-checks account_id and client_id. Those functions are not part of
-- this slice.
-- ----------------------------------------------------------------------------
create table public.client_reports (
  id uuid default gen_random_uuid()
    constraint client_reports_pkey primary key,

  -- Both NOT NULL and carried together into client_reports_client_tenant_fkey
  -- below: a report is always owned by a tenant and always about one of that
  -- tenant's brands.
  account_id uuid not null,
  client_id uuid not null,

  status text not null default 'draft'
    constraint client_reports_status_check
    check (status in ('draft', 'published', 'revoked')),

  -- The public URL segment. 24 random bytes, base64 with padding stripped and
  -- rendered url-safe -- 32 characters, which is what
  -- client_reports_public_slug_format_check pins. Generated in the DEFAULT
  -- rather than by the application so a report is never briefly shareable under
  -- a predictable slug, and regenerated by the revoke and rotate RPCs.
  public_slug text not null default pg_catalog.translate(
    pg_catalog.rtrim(pg_catalog.encode(public.gen_random_bytes(24), 'base64'), '='),
    '+/',
    '-_'
  ),

  -- Bumped every time public_slug is regenerated. The public page carries both,
  -- so a link captured before a rotation fails on the version even if the slug
  -- were somehow guessed.
  share_version integer not null default 1
    constraint client_reports_share_version_check check (share_version > 0),

  -- The two pointers into client_report_versions. Their foreign keys cannot be
  -- declared here -- the target table does not exist yet -- so they are added
  -- immediately below, which is the same shape 027 used and the one place in
  -- this file where create-then-alter is unavoidable rather than untidy.
  latest_version_id uuid,
  published_version_id uuid,

  -- Public-page telemetry, incremented by increment_client_report_view /
  -- _cta_click. bigint because these only ever grow and are never reset.
  view_count bigint not null default 0
    constraint client_reports_view_count_check check (view_count >= 0),
  cta_click_count bigint not null default 0
    constraint client_reports_cta_click_count_check check (cta_click_count >= 0),

  first_viewed_at timestamptz,
  last_viewed_at timestamptz,
  published_at timestamptz,
  revoked_at timestamptz,

  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint client_reports_public_slug_format_check
    check (public_slug ~ '^[A-Za-z0-9_-]{32}$'),

  -- Tenancy, twice over. The client FK cascades: deleting a brand deletes its
  -- reports. The created_by FK nulls only the attribution column, for the same
  -- reason as account_report_branding.updated_by above.
  constraint client_reports_client_tenant_fkey
    foreign key (client_id, account_id)
    references public.clients (id, account_id)
    on delete cascade,
  constraint client_reports_created_by_tenant_fkey
    foreign key (created_by, account_id)
    references public.profiles (id, account_id)
    on delete set null (created_by),

  -- The composite key client_report_versions_report_tenant_fkey references, so
  -- a version row cannot attach itself to a report under a different tenant or
  -- a different brand than the one it claims.
  constraint client_reports_id_account_id_client_id_key
    unique (id, account_id, client_id)
);


-- ----------------------------------------------------------------------------
-- client_report_versions -- the append-only content of a report. One row per
-- generated snapshot; publishing points client_reports.published_version_id at
-- one of them rather than mutating anything.
--
-- Consolidates: 027 (create).
--
-- snapshot is the whole rendered payload, frozen at generation time. That is the
-- point of the table: a report already sent to a client must keep saying what it
-- said, even after the scans behind it are re-run or deleted -- which is why
-- both scan foreign keys are SET NULL rather than CASCADE.
-- ----------------------------------------------------------------------------
create table public.client_report_versions (
  id uuid default gen_random_uuid()
    constraint client_report_versions_pkey primary key,

  report_id uuid not null,
  account_id uuid not null,
  client_id uuid not null,

  -- Dense from 1 within a report, allocated by append_client_report_version
  -- under an advisory lock and pinned by the (report_id, version_number) unique
  -- key below.
  version_number integer not null
    constraint client_report_versions_version_number_check check (version_number > 0),

  -- The scan this version reports on, and the earlier scan it is compared
  -- against. Both nullable: a first report has nothing to compare to, and
  -- either scan may later be deleted.
  source_scan_id uuid,
  previous_scan_id uuid,

  -- The two locales the app ships (see i18n/). Unlike prompt_bank.language, this
  -- one IS constrained -- the value picks a renderer, not a hint.
  locale text not null
    constraint client_report_versions_locale_check check (locale in ('en', 'zh-HK')),

  executive_summary text not null
    constraint client_report_versions_executive_summary_check
    check (char_length(executive_summary) between 1 and 1200),

  -- Pinned to exactly 1. Not a range: the reader in lib/reports/ understands one
  -- snapshot shape, so a row it cannot render must be impossible to write rather
  -- than merely unexpected. Widening this is a migration plus a reader that
  -- branches on the value.
  snapshot_schema_version integer not null
    constraint client_report_versions_snapshot_schema_version_check
    check (snapshot_schema_version = 1),
  snapshot jsonb not null,

  created_by uuid,
  created_at timestamptz not null default now(),

  -- The three-column tenancy FK, matching client_reports_id_account_id_client_id_key.
  constraint client_report_versions_report_tenant_fkey
    foreign key (report_id, account_id, client_id)
    references public.client_reports (id, account_id, client_id)
    on delete cascade,

  -- Both scan references are tenant-composite against scans_id_account_id_unique
  -- (027, slice 2), and both null only their own column: a deleted scan must not
  -- take a published report version with it.
  constraint client_report_versions_source_scan_tenant_fkey
    foreign key (source_scan_id, account_id)
    references public.scans (id, account_id)
    on delete set null (source_scan_id),
  constraint client_report_versions_previous_scan_tenant_fkey
    foreign key (previous_scan_id, account_id)
    references public.scans (id, account_id)
    on delete set null (previous_scan_id),
  constraint client_report_versions_created_by_tenant_fkey
    foreign key (created_by, account_id)
    references public.profiles (id, account_id)
    on delete set null (created_by),

  constraint client_report_versions_report_id_version_number_key
    unique (report_id, version_number),

  -- The key client_reports' two back-references point at. Including report_id
  -- means client_reports.latest_version_id cannot name a version of some other
  -- report.
  constraint client_report_versions_id_report_id_key
    unique (id, report_id)
);

-- The cycle, closed. client_reports points at client_report_versions and
-- client_report_versions points back, so one of the two directions has to be
-- added after both tables exist -- there is no ordering that avoids it.
--
-- DEFERRABLE INITIALLY DEFERRED is what makes create_client_report_with_version
-- work at all: it inserts the report, then the version, then updates the report
-- to point at it, all in one transaction. Checked immediately, the first insert
-- would fail against a version row that does not exist yet.
alter table public.client_reports
  add constraint client_reports_latest_version_id_fkey
    foreign key (latest_version_id, id)
    references public.client_report_versions (id, report_id)
    deferrable initially deferred,
  add constraint client_reports_published_version_id_fkey
    foreign key (published_version_id, id)
    references public.client_report_versions (id, report_id)
    deferrable initially deferred;

-- 027. The dashboard list: one tenant's reports for one brand, newest first.
create index client_reports_account_client_created_idx
  on public.client_reports (account_id, client_id, created_at desc);

-- The public page's only lookup, and the uniqueness that makes a slug an
-- identifier rather than a hint. Unique as an index rather than a constraint
-- because that is how 027 wrote it.
create unique index client_reports_public_slug_idx
  on public.client_reports (public_slug);

-- Support for the created_by / updated_by SET NULL cascades, same as
-- account_report_branding_updated_by_idx above.
create index client_reports_created_by_idx
  on public.client_reports (created_by);

-- 027. The version list for one report, newest version first, already narrowed
-- by tenant so the index serves the ownership check and the read at once.
create index client_report_versions_tenant_report_idx
  on public.client_report_versions (account_id, client_id, report_id, version_number desc);

-- The two scan back-references. Leading with the scan id makes these the
-- lookup a scan deletion needs in order to null the citing versions.
create index client_report_versions_source_scan_idx
  on public.client_report_versions (source_scan_id, account_id);
create index client_report_versions_previous_scan_idx
  on public.client_report_versions (previous_scan_id, account_id);

create index client_report_versions_created_by_idx
  on public.client_report_versions (created_by);

-- 027. RLS enabled with deliberately ZERO policies -- default-deny. Three of the
-- seven tables in this file that carry that posture; slice 5 has the other four
-- (public_scan_rate_limits, authenticated_scan_monthly_usage,
-- stripe_webhook_events, stripe_subscription_processing_leases), each from its
-- own creating migration rather than from 027.
--
-- This is not an oversight and not a leftover: 036 disabled RLS on the 21 tables
-- that carried a (dead) policy and pointedly left these three alone, because
-- their posture was chosen rather than inherited. 027 originally wrote six
-- `to authenticated` policies scoped by auth.uid(); neither half survives Neon
-- (the role does not exist, and auth.uid() reads a PostgREST GUC nothing sets,
-- so it returns NULL and every policy matches nothing). Default-deny is
-- behaviourally identical to a policy that never matches, minus the false signal
-- that the database is enforcing tenant isolation. It is not -- every query
-- filters by account_id in application code, and 027's RPCs are SECURITY
-- DEFINER with their own explicit predicates.
--
-- Note what this actually buys on its own: very little. aeo_app holds BYPASSRLS
-- (037), and 027 revokes table privileges from PUBLIC anyway, so a role without
-- grants gets a permission error long before RLS is consulted. It is kept
-- because it is pinned -- __tests__/db/client-report-migration.test.ts asserts
-- these three, __tests__/integration/migrate.test.ts asserts the full set of
-- seven against a real database -- so an eighth default-deny table is a
-- deliberate, reviewed change rather than a drift.
--
-- Do NOT add policies here. Zero policies is the mechanism, not a gap in it.
alter table public.account_report_branding enable row level security;
alter table public.client_reports enable row level security;
alter table public.client_report_versions enable row level security;


-- ----------------------------------------------------------------------------
-- local_trust_profiles -- the owner-maintained inputs to local trust scoring:
-- what a brand sells, where, and what a lead is worth to it.
--
-- Consolidates: 021 (create).
--
-- 021 originally opened by adding three local_trust_* entitlement flags to
-- plan_features and backfilling them. Those statements were removed from 021
-- itself, because 028 drops plan_features -- it was an orphaned third definition
-- of plan entitlements that no application code read. The flags live in
-- PLAN_CATALOG (lib/plans/catalog.ts) and resolve through lib/tier.ts. Nothing
-- schema-shaped was lost, and nothing here recreates them.
--
-- Every local_trust_* table carries client_id AND account_id and keys the pair
-- into clients (id, account_id). That is the 021 pattern lib/localTrust/guard.ts
-- mirrors in application code: auth, then entitlement, then ownership.
-- ----------------------------------------------------------------------------
create table public.local_trust_profiles (
  id uuid default gen_random_uuid()
    constraint local_trust_profiles_pkey primary key,

  -- client_id carries no FK of its own; the composite one below covers it.
  client_id uuid not null,
  account_id uuid not null
    constraint local_trust_profiles_account_id_fkey
      references public.accounts(id) on delete cascade,

  primary_services text[] not null default '{}',
  service_area text,

  -- The two ROI inputs. Both nullable -- the profile is useful before an owner
  -- has supplied either -- and both checks are written to permit NULL
  -- explicitly rather than relying on NULL-propagation to satisfy them.
  -- close_rate is a fraction, not a percentage: 0..1.
  average_lead_value numeric
    constraint local_trust_profiles_average_lead_value_check
    check (average_lead_value is null or average_lead_value >= 0),
  close_rate numeric
    constraint local_trust_profiles_close_rate_check
    check (close_rate is null or (close_rate >= 0 and close_rate <= 1)),

  competitors text[] not null default '{}',

  -- No trigger maintains updated_at. The Local Trust routes set it explicitly
  -- when owner-maintained fields change, exactly as alert_configs does.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint local_trust_profiles_client_id_account_id_fkey
    foreign key (client_id, account_id)
    references public.clients (id, account_id)
    on delete cascade,

  -- At most one profile per brand.
  constraint local_trust_profiles_client_id_key unique (client_id)
);


-- ----------------------------------------------------------------------------
-- local_trust_snapshots -- one computed local-trust score per brand per month,
-- with the bucket breakdown and gap list the dashboard renders.
--
-- Consolidates: 021 (create).
-- ----------------------------------------------------------------------------
create table public.local_trust_snapshots (
  id uuid default gen_random_uuid()
    constraint local_trust_snapshots_pkey primary key,

  client_id uuid not null,
  account_id uuid not null
    constraint local_trust_snapshots_account_id_fkey
      references public.accounts(id) on delete cascade,

  snapshot_month date not null,

  local_trust_score numeric not null
    constraint local_trust_snapshots_local_trust_score_check
    check (local_trust_score >= 0 and local_trust_score <= 100),

  -- Both default to an empty array so a reader never has to distinguish "not
  -- computed" from "computed, nothing found" -- the same reasoning as
  -- chunk_analysis.chunks in slice 2.
  bucket_scores jsonb not null default '[]'::jsonb,
  trust_gaps jsonb not null default '[]'::jsonb,
  roi_estimate jsonb,

  -- Provenance. The scan reference is ON DELETE SET NULL, not CASCADE: a
  -- snapshot is a historical record and must outlive the scan it was derived
  -- from. source_pulse_week is a plain date rather than a foreign key because
  -- pulse_weekly_summary has no natural single-column key to point at.
  source_scan_id uuid
    constraint local_trust_snapshots_source_scan_id_fkey
      references public.scans(id) on delete set null,
  source_pulse_week date,

  created_at timestamptz not null default now(),

  constraint local_trust_snapshots_client_id_account_id_fkey
    foreign key (client_id, account_id)
    references public.clients (id, account_id)
    on delete cascade,

  -- (id, client_id) exists purely so local_trust_actions can carry a composite
  -- FK back here and stay pinned to the same brand.
  constraint local_trust_snapshots_id_client_id_key unique (id, client_id),

  -- One snapshot per brand per month -- the recompute path upserts on this.
  constraint local_trust_snapshots_client_id_snapshot_month_key
    unique (client_id, snapshot_month)
);


-- ----------------------------------------------------------------------------
-- local_trust_actions -- the recommended fixes a snapshot produced, and the
-- owner's progress through them.
--
-- Consolidates: 021 (create).
--
-- stable_key is what makes a re-computed snapshot able to carry a status
-- forward: the generator derives the same key for the same underlying gap, so
-- (snapshot_id, stable_key) identifies an action across regenerations rather
-- than minting a new uuid each time.
-- ----------------------------------------------------------------------------
create table public.local_trust_actions (
  id uuid default gen_random_uuid()
    constraint local_trust_actions_pkey primary key,

  -- Both columns feed the composite FK below; neither has an FK of its own.
  client_id uuid not null,
  snapshot_id uuid not null,

  stable_key text not null,
  title text not null,

  -- The four scoring buckets, the impact/effort grid the dashboard sorts on,
  -- and the owner's status. All four are closed vocabularies rendered directly
  -- as UI, so unlike prompt_bank.category they are constrained here.
  bucket text not null
    constraint local_trust_actions_bucket_check
    check (bucket in ('local_visibility', 'proof_depth', 'ai_answer_readiness', 'market_authority')),
  impact text not null
    constraint local_trust_actions_impact_check
    check (impact in ('low', 'medium', 'high')),
  effort text not null
    constraint local_trust_actions_effort_check
    check (effort in ('low', 'medium', 'high')),
  status text not null default 'open'
    constraint local_trust_actions_status_check
    check (status in ('open', 'planned', 'done', 'skipped')),

  -- As on local_trust_profiles: no trigger, the routes set updated_at when an
  -- action's status changes.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- (snapshot_id, client_id) into local_trust_snapshots_id_client_id_key -- an
  -- action physically cannot attach to a snapshot of a different brand.
  constraint local_trust_actions_snapshot_id_client_id_fkey
    foreign key (snapshot_id, client_id)
    references public.local_trust_snapshots (id, client_id)
    on delete cascade,

  constraint local_trust_actions_snapshot_id_stable_key_key
    unique (snapshot_id, stable_key)
);

-- 021. One index per read: the account's profiles, a brand's snapshot history
-- newest month first, and one snapshot's action list.
create index local_trust_profiles_account_idx
  on public.local_trust_profiles (account_id);
create index local_trust_snapshots_client_month_idx
  on public.local_trust_snapshots (client_id, snapshot_month desc);
create index local_trust_actions_snapshot_idx
  on public.local_trust_actions (snapshot_id);


-- ----------------------------------------------------------------------------
-- authority_scores -- the cached output of lib/authority/'s layered engine for
-- one (domain, industry, region).
--
-- Consolidates: 012 (create).
--
-- This is a cache, not a ledger: expires_at defaults to seven days out and the
-- engine recomputes past it. Nothing enforces the expiry in the database -- no
-- trigger, no partial index -- the reader checks it.
--
-- Note numeric(4,2): the scale is 0..99.99, not 0..100.00. Taken verbatim from
-- 012 rather than widened; a 100.00 would fail this column, and that is the
-- shape production has carried since 012.
-- ----------------------------------------------------------------------------
create table public.authority_scores (
  id uuid default gen_random_uuid()
    constraint authority_scores_pkey primary key,

  domain text not null,
  industry text not null,
  region text not null,

  final_score numeric(4,2) not null,

  tier text not null
    constraint authority_scores_tier_check
    check (tier in ('tier1', 'tier2', 'tier3', 'other')),

  category text not null,

  -- The per-layer contributions computeAuthority() produced, kept so a score can
  -- be explained after the fact.
  breakdown jsonb not null default '{}',

  computed_at timestamptz default now(),
  expires_at timestamptz default now() + interval '7 days',

  -- The cache key. One score per domain per industry per region -- the same
  -- domain legitimately scores differently under a different industry pack.
  constraint authority_scores_domain_industry_region_key
    unique (domain, industry, region)
);


-- ----------------------------------------------------------------------------
-- domain_signals -- the raw external signals collected for one domain, cached
-- far longer than the score derived from them (30 days vs 7).
--
-- Consolidates: 012 (create).
--
-- Keyed by domain itself rather than a surrogate id: signals are a property of
-- the domain, independent of any industry or region, and there is exactly one
-- row per domain by construction.
-- ----------------------------------------------------------------------------
create table public.domain_signals (
  domain text
    constraint domain_signals_pkey primary key,

  signals jsonb not null default '{}',
  signal_score numeric(4,2) not null default 0,

  fetched_at timestamptz default now(),
  expires_at timestamptz default now() + interval '30 days'
);


-- ----------------------------------------------------------------------------
-- authority_overrides -- a manual correction to a domain's authority, scoped to
-- one client. The admin escape hatch behind app/[lang]/admin/authority/.
--
-- Consolidates: 012 (create).
--
-- override_tier admits a fifth value the engine's own tier column does not:
-- 'blacklist', which suppresses a domain outright rather than re-ranking it.
-- Both override columns are nullable -- an override may adjust the tier, the
-- score, or both.
-- ----------------------------------------------------------------------------
create table public.authority_overrides (
  id uuid default gen_random_uuid()
    constraint authority_overrides_pkey primary key,

  -- Nullable as created in 012 and never tightened; cascading, so removing a
  -- brand removes its overrides.
  client_id uuid
    constraint authority_overrides_client_id_fkey
      references public.clients(id) on delete cascade,

  domain text not null,

  override_tier text
    constraint authority_overrides_override_tier_check
    check (override_tier in ('tier1', 'tier2', 'tier3', 'other', 'blacklist')),
  override_score numeric(4,2),

  reason text,
  created_at timestamptz default now()
);


-- ----------------------------------------------------------------------------
-- agent_recommendations -- per-platform, per-category fix suggestions produced
-- by an agent run over one scan.
--
-- Consolidates: 013 (create).
--
-- All three agent_* tables share a shape: NOT NULL scan_id cascading from scans,
-- a platform column, and a unique key that makes a re-run idempotent per
-- (scan, platform, <dimension>). None of them carries account_id -- tenancy is
-- reached through scan_id, which is why every route reading them joins scans and
-- filters on profile.account_id there.
--
-- None of the three has RLS enabled: 013 simply never enabled it, unlike 012's
-- tables. They are therefore absent from 036 as well, and correctly carry
-- rowsecurity = false here -- the default for a fresh table.
-- ----------------------------------------------------------------------------
create table public.agent_recommendations (
  id uuid default gen_random_uuid()
    constraint agent_recommendations_pkey primary key,

  scan_id uuid not null
    constraint agent_recommendations_scan_id_fkey
      references public.scans(id) on delete cascade,

  platform text not null,
  category text not null,

  priority text not null
    constraint agent_recommendations_priority_check
    check (priority in ('high', 'medium', 'low')),

  recommendation text not null,

  -- 1..10, smallint. The dashboard orders on it, so it is bounded rather than
  -- free-form.
  impact_score smallint not null
    constraint agent_recommendations_impact_score_check
    check (impact_score >= 1 and impact_score <= 10),

  created_at timestamptz default now(),

  constraint agent_recommendations_scan_id_platform_category_key
    unique (scan_id, platform, category)
);


-- ----------------------------------------------------------------------------
-- agent_progress -- before/after metric snapshots for one scan and platform.
--
-- Consolidates: 013 (create). 014 mentions it only as a plan_features flag
-- column, which 028 later dropped along with the whole table.
--
-- The three value columns are bare `numeric` -- unconstrained precision and
-- scale, as 013 wrote them. A metric here may be a percentage, a count or a
-- score, so no single numeric(n,m) fits.
-- ----------------------------------------------------------------------------
create table public.agent_progress (
  id uuid default gen_random_uuid()
    constraint agent_progress_pkey primary key,

  scan_id uuid not null
    constraint agent_progress_scan_id_fkey
      references public.scans(id) on delete cascade,

  platform text not null,
  metric text not null,

  -- previous_value and delta are nullable: the first observation of a metric has
  -- nothing to compare against.
  current_value numeric not null,
  previous_value numeric,
  delta numeric,

  created_at timestamptz default now(),

  constraint agent_progress_scan_id_platform_metric_key
    unique (scan_id, platform, metric)
);


-- ----------------------------------------------------------------------------
-- agent_competitors -- per-platform competitor gap analysis for one scan.
--
-- Consolidates: 013 (create). As with agent_progress, 014's reference is to the
-- since-dropped plan_features flag, not to this table's shape.
--
-- Both rate columns are percentages bounded 0..100 -- note that these are
-- percentages while local_trust_profiles.close_rate is a 0..1 fraction. The
-- inconsistency is real and preserved; both are read by code written against
-- their own convention.
-- ----------------------------------------------------------------------------
create table public.agent_competitors (
  id uuid default gen_random_uuid()
    constraint agent_competitors_pkey primary key,

  scan_id uuid not null
    constraint agent_competitors_scan_id_fkey
      references public.scans(id) on delete cascade,

  platform text not null,
  competitor_domain text not null,
  competitor_name text,

  mention_rate numeric not null
    constraint agent_competitors_mention_rate_check
    check (mention_rate >= 0 and mention_rate <= 100),
  your_rate numeric not null
    constraint agent_competitors_your_rate_check
    check (your_rate >= 0 and your_rate <= 100),

  gap_analysis text not null,
  created_at timestamptz default now(),

  -- Keyed on the domain, not the display name: competitor_name is nullable and
  -- cosmetic.
  constraint agent_competitors_scan_id_platform_competitor_domain_key
    unique (scan_id, platform, competitor_domain)
);


-- ============================================================================
-- Slice 5 -- infrastructure ledgers and reference packs
--
-- Two unrelated groups, put together because both are leaves: nothing in the
-- schema references anything below, and everything below references only
-- slice 1's accounts and clients.
--
--   public_scan_rate_limits                anonymous /api/scan fixed-window counter
--   authenticated_scan_monthly_usage       calendar-month quota for signed-in scans
--   stripe_webhook_events                  Stripe event ledger, the idempotency key
--   stripe_subscription_processing_leases  serialises concurrent webhook handlers
--   industry_packs, regional_packs         authority-engine reference data
--   topical_clusters, content_briefs       GEO content-tool outputs, per client
--   ai_citation_log                        shared citation feed (Pulse -> authority L5)
--
-- The four infrastructure tables keep RLS enabled with zero policies -- see the
-- note above their `enable row level security` statements at the end of this
-- slice. The five 012 tables do NOT: 012 enabled RLS and wrote policies for them,
-- 036 dropped those policies and disabled RLS again, so they carry
-- rowsecurity = false here, which is simply the default for a fresh table.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- public_scan_rate_limits -- durable fixed-window rate limiting for the
-- anonymous /api/scan endpoint.
--
-- Consolidates: 023 (create).
--
-- 023's own opening line is the important one: the application stores only a
-- versioned HMAC-SHA-256 key, never the source address. Two consequences worth
-- keeping in view -- the table is not a log and cannot be used as one, and the
-- hashing secret (PUBLIC_SCAN_RATE_LIMIT_SECRET) has no production fallback, so
-- unset it takes every anonymous scan to 503 rather than silently degrading to
-- an unlimited one.
-- ----------------------------------------------------------------------------
create table public.public_scan_rate_limits (
  key_hash text not null,
  window_start timestamptz not null,

  -- Fixed window rather than sliding: one row per (key, window), incremented in
  -- place. `> 0` rather than `>= 0` because a row only comes into existence once
  -- a request has been counted -- a zero row would be a bug, not an idle window.
  request_count integer not null
    constraint public_scan_rate_limits_request_count_check
    check (request_count > 0),

  constraint public_scan_rate_limits_pkey primary key (key_hash, window_start)
);

-- Sweeping expired windows scans by age, and the primary key leads with the
-- hash, so it cannot serve that scan.
create index public_scan_rate_limits_window_start_idx
  on public.public_scan_rate_limits (window_start);


-- ----------------------------------------------------------------------------
-- authenticated_scan_monthly_usage -- durable calendar-month scan quota for
-- signed-in accounts. The counterpart to public_scan_rate_limits, one tier up.
--
-- Consolidates: 025 (create).
--
-- Note the deliberate asymmetry with the anonymous limiter: that one keys on an
-- opaque hash because there is no account to name, this one keys on account_id
-- directly and cascades with the account. The quota is calendar-month, not
-- rolling-30-day, which is why month_start is a plain `date` -- the reset
-- boundary is part of the key and needs no window arithmetic at read time.
-- ----------------------------------------------------------------------------
create table public.authenticated_scan_monthly_usage (
  account_id uuid not null
    constraint authenticated_scan_monthly_usage_account_id_fkey
      references public.accounts(id) on delete cascade,

  month_start date not null,

  request_count integer not null
    constraint authenticated_scan_monthly_usage_request_count_check
    check (request_count > 0),

  constraint authenticated_scan_monthly_usage_pkey
    primary key (account_id, month_start)
);

create index authenticated_scan_monthly_usage_month_start_idx
  on public.authenticated_scan_monthly_usage (month_start);


-- ----------------------------------------------------------------------------
-- stripe_webhook_events -- one row per Stripe event this application has
-- consumed. The idempotency ledger behind /api/stripe/webhook.
--
-- Consolidates: 024 (create).
--
-- event_id is Stripe's own id and is the primary key, which is the whole point:
-- apply_stripe_account_event() inserts here `on conflict (event_id) do nothing`
-- and treats a zero row count as `duplicate`, so a redelivered event cannot
-- apply twice. Note that event_id is an identity key and never a chronology --
-- ordering is accounts.stripe_event_created_at's job (slice 1), because webhook
-- delivery order is not event order.
--
-- event_created is Stripe's epoch-seconds timestamp, hence bigint; processed_at
-- is when we consumed it. Both are kept: the gap between them is the only
-- evidence of a delayed delivery.
-- ----------------------------------------------------------------------------
create table public.stripe_webhook_events (
  event_id text
    constraint stripe_webhook_events_pkey primary key,

  event_created bigint not null
    constraint stripe_webhook_events_event_created_check
    check (event_created >= 0),
  event_type text not null,

  account_id uuid not null
    constraint stripe_webhook_events_account_id_fkey
      references public.accounts(id) on delete cascade,

  processed_at timestamptz not null default now()
);


-- ----------------------------------------------------------------------------
-- stripe_subscription_processing_leases -- a short-lived exclusive lease per
-- Stripe subscription id, held while a webhook handler reads Stripe and writes
-- the account.
--
-- Consolidates: 024 (create).
--
-- 024's reason for it: serialize canonical Stripe reads and persistence without
-- holding a database transaction open across the Stripe network request. The
-- expiry is what makes that recoverable -- a handler that crashes before its
-- best-effort release would otherwise wedge that subscription permanently.
-- acquire_stripe_subscription_lease() takes a 300-second lease and re-acquires
-- only where lease_expires_at <= clock_timestamp(); apply_stripe_account_event()
-- re-validates ownership `for update` before touching anything, so an expired
-- lease can be stolen but its former owner can never persist after the takeover.
--
-- The btrim() check exists because the subscription id arrives from a webhook
-- payload, and a whitespace-only id would otherwise be a perfectly valid lease
-- on nothing.
-- ----------------------------------------------------------------------------
create table public.stripe_subscription_processing_leases (
  subscription_id text
    constraint stripe_subscription_processing_leases_pkey primary key
    constraint stripe_subscription_processing_leases_subscription_id_check
      check (btrim(subscription_id) <> ''),

  -- A caller-minted uuid, not a user or account id: it identifies the handler
  -- invocation holding the lease, so no foreign key applies.
  lease_owner uuid not null,
  lease_expires_at timestamptz not null
);


-- ----------------------------------------------------------------------------
-- industry_packs -- per-industry reference data for the authority engine: which
-- domains count as authoritative in that industry, and the vocabulary that
-- identifies its topics.
--
-- Consolidates: 012 (create).
--
-- Keyed by `code` (the industry slug) rather than a surrogate id -- these are
-- seeded reference rows, not user data; scripts/seed-packs.ts writes them.
-- 012 enabled RLS with a `using (true)` public-read policy; 036 dropped that
-- policy and disabled RLS, so nothing about read access is expressed here.
--
-- multiplier is numeric(3,2), so 0..9.99, taken verbatim from 012. It scales an
-- industry's computed authority, and no pack has ever needed a factor near that
-- ceiling.
-- ----------------------------------------------------------------------------
create table public.industry_packs (
  code text
    constraint industry_packs_pkey primary key,

  display_name text not null,

  multiplier numeric(3,2) not null default 1.0,

  -- Both default to empty rather than NULL so a half-seeded pack reads as "no
  -- authorities yet" instead of forcing every caller to null-check.
  authority_domains jsonb not null default '{}',
  topical_keywords text[] not null default '{}',

  -- No trigger maintains updated_at anywhere in this schema; the seeder sets it.
  updated_at timestamptz default now()
);


-- ----------------------------------------------------------------------------
-- regional_packs -- per-region reference data: the tier assignment a domain gets
-- in that region.
--
-- Consolidates: 012 (create).
--
-- The sibling of industry_packs and shaped the same way -- `code` primary key,
-- one jsonb payload, a seeder-maintained updated_at. Authority is scored as
-- (industry x region), which is why the two packs are separate tables rather
-- than one: authority_scores' unique key in slice 4 is (domain, industry,
-- region).
-- ----------------------------------------------------------------------------
create table public.regional_packs (
  code text
    constraint regional_packs_pkey primary key,

  display_name text not null,
  tiers jsonb not null default '{}',

  updated_at timestamptz default now()
);


-- ----------------------------------------------------------------------------
-- ai_citation_log -- every URL an AI platform cited during a Pulse run, kept as
-- the shared feed the authority engine's L5 layer reads.
--
-- Consolidates: 012 (create).
--
-- 012 describes it as the GEO Pulse -> Authority L5 bridge, and the two ends
-- explain both of its odd columns. pulse_run_id carries NO foreign key: there is
-- no table of Pulse runs to point at, it is a correlation id minted by the
-- producer. client_id is nullable and ON DELETE SET NULL rather than CASCADE --
-- a citation is evidence about a *domain*, and stays useful to the authority
-- engine long after the brand that happened to surface it is gone.
--
-- platform is a closed vocabulary here, unlike prompt_bank.category in slice 3:
-- these values select code paths in lib/pulse/, so an unknown one is a bug
-- rather than a display string.
-- ----------------------------------------------------------------------------
create table public.ai_citation_log (
  id uuid default gen_random_uuid()
    constraint ai_citation_log_pkey primary key,

  pulse_run_id uuid,

  client_id uuid
    constraint ai_citation_log_client_id_fkey
      references public.clients(id) on delete set null,

  cited_url text not null,
  cited_domain text not null,

  platform text not null
    constraint ai_citation_log_platform_check
    check (platform in ('perplexity_sonar', 'perplexity_sonar_pro', 'chatgpt',
                        'claude', 'gemini', 'google_aio')),

  -- The prompt context that produced the citation, denormalised. Nullable
  -- throughout: a citation is worth recording even when the producer cannot
  -- attribute it to an industry or a region.
  prompt_industry text,
  prompt_region text,
  prompt_topic text,
  prompt_text text,

  cited_at timestamptz default now()
);

-- The three read paths, and the one place in this file where index names take an
-- `idx_` prefix instead of the `_idx` suffix used everywhere else. 012 named
-- them; the names are compared by the equivalence differ, so they stay as
-- written rather than being tidied.
create index idx_citation_domain_industry
  on public.ai_citation_log (cited_domain, prompt_industry);
create index idx_citation_recent
  on public.ai_citation_log (cited_at desc);
create index idx_citation_industry_recent
  on public.ai_citation_log (prompt_industry, cited_at desc);


-- ----------------------------------------------------------------------------
-- topical_clusters -- a detected pillar-page-plus-supporting-articles cluster
-- for one brand, and how complete it looks.
--
-- Consolidates: 012 (create).
--
-- Read by /api/fix/cluster-map. cluster_articles defaults to '[]' for the same
-- reason chunk_analysis.chunks does in slice 2 -- "detected nothing" and "not
-- yet detected" should not be distinguishable by a reader who does not care.
-- completeness_score is numeric(4,2), so 0..99.99, matching authority_scores.
-- ----------------------------------------------------------------------------
create table public.topical_clusters (
  id uuid default gen_random_uuid()
    constraint topical_clusters_pkey primary key,

  client_id uuid not null
    constraint topical_clusters_client_id_fkey
      references public.clients(id) on delete cascade,

  topic text not null,
  pillar_page_url text,
  cluster_articles jsonb not null default '[]',
  completeness_score numeric(4,2),

  detected_at timestamptz default now()
);


-- ----------------------------------------------------------------------------
-- content_briefs -- one generated content brief for a brand and target topic.
--
-- Consolidates: 012 (create).
--
-- Written by /api/fix/content-brief. The brief itself is markdown in a text
-- column, not structured -- it is LLM output rendered straight to the user.
-- recommended_authorities is nullable jsonb rather than defaulting to '[]',
-- unlike its neighbours above: 012 wrote it that way, and a brief generated
-- before the authority engine had anything to say genuinely has no list rather
-- than an empty one.
-- ----------------------------------------------------------------------------
create table public.content_briefs (
  id uuid default gen_random_uuid()
    constraint content_briefs_pkey primary key,

  client_id uuid not null
    constraint content_briefs_client_id_fkey
      references public.clients(id) on delete cascade,

  target_topic text not null,
  brief_markdown text not null,
  recommended_authorities jsonb,

  created_at timestamptz default now()
);


-- The other four default-deny tables -- RLS enabled, deliberately ZERO policies.
-- Read the long note in slice 4 for why the posture is kept at all; what matters
-- here is that this is NOT 027's decision applied more widely. It is a
-- convention three separate migrations arrived at independently, and each one is
-- the place to look when changing its own table:
--
--   023  public_scan_rate_limits
--   024  stripe_subscription_processing_leases, stripe_webhook_events
--   025  authenticated_scan_monthly_usage
--
-- All three give the same reason: these tables are consumed only through the
-- application's direct database role, so the Data API surface is kept closed
-- even on a project carrying legacy default grants. 036 pointedly does not
-- disable RLS here -- it touched only the 21 tables that carried a policy -- so
-- omitting these four would leave the baseline visibly divergent.
--
-- Do NOT add policies. Zero policies is the mechanism, not a gap in it.
alter table public.public_scan_rate_limits enable row level security;
alter table public.authenticated_scan_monthly_usage enable row level security;
alter table public.stripe_webhook_events enable row level security;
alter table public.stripe_subscription_processing_leases enable row level security;


-- ============================================================================
-- Slice 6 -- the 037 layer: migration ledger, functions, trigger, role, grants
--
-- Everything in this slice is schema that is NOT a table of application data,
-- and it comes last for one load-bearing reason: 037 ends with
--
--     grant select, insert, update, delete on all tables in schema public
--
-- which is a point-in-time grant over the tables that exist WHEN IT RUNS, not a
-- standing rule. Every `create table` in this file -- slices 1-5 and
-- schema_migrations immediately below -- must therefore already have executed by
-- the time the grants block at the end of this slice is reached. Moving that
-- block earlier, or adding a table after it, silently produces a table the
-- application role cannot read.
--
-- Contents, in execution order:
--   1. schema_migrations       the migration runner's ledger
--   2. the 12 functions        007/017, 011/026/028, 024, 027 -- final forms only
--   3. enforce_brand_limit     the one trigger in `public`
--   4. aeo_app                 role, BYPASSRLS, grants, default privileges
--
-- WHAT THE EQUIVALENCE PROOF CANNOT SEE HERE -- read this before editing:
--   * Function BODIES. The differ compares each function by
--     `returns | volatility | security_definer` only. A mistranscribed body
--     passes green. The twelve below are transcribed verbatim from their final
--     source migration, deliberately keeping that migration's own casing and
--     dollar-quote tag, so a reviewer can diff them against the migration
--     character-for-character rather than re-reading them for meaning.
--   * Function-level ACLs (`revoke ... on function ... from public`). The
--     grants class reads information_schema.role_table_grants -- TABLES, for
--     aeo_app. Function privileges are invisible to it. They are carried over
--     anyway: unlike the table-level `revoke ... from public` statements in
--     023/024/027 (omitted from slices 1-5 because PUBLIC never holds table
--     privileges on a stock cluster, so those were no-ops), EXECUTE *is*
--     granted to PUBLIC by default, so these revokes are real ACL changes and
--     dropping them would hand every role execute rights the legacy chain took
--     away.
--   * `alter default privileges`. Same blind spot -- see the comment on those
--     statements at the end of the file.
--
-- The `anon` / `authenticated` / `service_role` branches that guard the ACL
-- statements in 023-028 are NOT carried over. Those three roles are Supabase's
-- and do not exist on Neon, so every one of those `do $acl$` blocks is a no-op
-- on both paths -- which is exactly why 027 wrapped them in a to_regrole() test
-- in the first place.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- schema_migrations -- the migration runner's ledger: one row per applied file.
--
-- Not created by any migration. scripts/migrate.ts creates it itself, before it
-- applies anything, which is why it has no numbered source file -- and why the
-- baseline has to create it too. A greenfield database built from this file and
-- nothing else would otherwise have no ledger at all, and the first
-- `npm run migrate` against it would be the thing that created it.
--
-- The shape below is a verbatim copy of the `create table if not exists` in
-- scripts/migrate.ts. These two declarations are the same table reached by two
-- paths and must not drift: change one, change the other, and re-run
-- `npm run schema:equivalence` -- the differ's `columns` class compares them
-- directly, so a column added to only one side reports as a divergence.
--
-- `checksum` carries the baseline's own digest (see the seed row at the end of
-- this file). The chain never populates it: migrate.ts's inserts name only
-- `filename`, because a migration applied from the chain still has its file in
-- the repo. The baseline is the one row whose source is a single consolidated
-- artefact, so it is the one row worth pinning.
-- ----------------------------------------------------------------------------
create table if not exists schema_migrations (
  filename text primary key,
  applied_at timestamptz not null default now(),
  checksum text
);


-- ============================================================================
-- Functions -- final definitions only
--
-- Two of these were rewritten in place across the chain. Only the last version
-- exists after a replay, so only the last version is here:
--
--   handle_new_user()    003 -> 007 -> 017   (017 is final)
--   check_brand_limit()  011 -> 026 -> 028   (028 is final)
--
-- The other ten were written once, by 024 and 027, and never revised.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- handle_new_user() -- provisions an account + profile for a newly created user.
--
-- Final form from 017. 003 wrote the first version and attached it to a trigger
-- on `auth.users`; 007 gave it the account insert; 017 changed the seeded plan
-- from 'starter' to 'basic' after 014's CHECK made 'starter' unrepresentable --
-- until then every new signup failed accounts_plan_check.
--
-- The FUNCTION is carried over; its TRIGGER is not. `on_auth_user_created` fires
-- on auth.users, and this file deliberately does not create the dead Supabase
-- `auth` schema (see DELIBERATE OMISSIONS at the top). Provisioning on a
-- greenfield database is done by app/api/webhooks/neon/route.ts on Neon Auth's
-- user.created event, not by a database trigger. The function is kept because
-- the legacy path has it and equivalence is the claim this file makes -- it is
-- unreachable here, not live.
--
-- SECURITY DEFINER with `SET search_path = public`, so the two unqualified table
-- names below resolve to public.accounts / public.profiles. Note the contrast
-- with check_brand_limit(), which pins `search_path = ''` and qualifies
-- everything including pg_catalog builtins -- the two conventions arrived ten
-- migrations apart and are carried over as written.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
BEGIN
  INSERT INTO accounts (plan, status)
  VALUES ('basic', 'active')
  RETURNING id INTO v_account_id;

  INSERT INTO profiles (id, display_name, account_id)
  VALUES (new.id, new.raw_user_meta_data->>'full_name', v_account_id)
  ON CONFLICT (id) DO UPDATE
    SET account_id = EXCLUDED.account_id
    WHERE profiles.account_id IS NULL;

  RETURN new;
END;
$$;


-- ----------------------------------------------------------------------------
-- check_brand_limit() -- enforces the per-plan brand cap on insert into clients.
--
-- Final form from 028. 011 wrote the first version against accounts.plan alone;
-- 026 replaced it with full entitlement resolution (status, Stripe subscription,
-- trial window); 028 added the admin override, evaluated FIRST -- before the
-- stored-plan validation and before has_subscription, because a comped account
-- has no Stripe subscription, and an account with malformed Stripe state is
-- exactly the case a comp exists to rescue.
--
-- This is the only place in the database that enforces a commercial limit, and
-- it enforces on INSERT only. lib/tier.ts resolveCommercialEntitlement() is the
-- application-side mirror; the brand_limit numbers below are pinned against
-- PLAN_CATALOG by __tests__/db/brand-limit-entitlement.test.ts.
--
-- The advisory lock is what makes the count correct under concurrency: without
-- it two simultaneous inserts for one account both read count = limit - 1 and
-- both succeed.
-- ----------------------------------------------------------------------------
create or replace function public.check_brand_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored_plan text;
  account_status text;
  stripe_subscription_id text;
  trial_ends_at timestamptz;
  override_plan text;
  override_expires_at timestamptz;
  override_is_live boolean;
  has_subscription boolean;
  trial_is_live boolean;
  effective_plan text;
  brand_limit integer;
  current_count integer;
begin
  if new.account_id is null then
    raise exception 'ACCOUNT_ENTITLEMENT_INVALID'
      using detail = 'account_id is required';
  end if;

  -- Serialize every brand insert for one account before reading account state or counting.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.account_id::text, 0)
  );

  select
    accounts.plan,
    accounts.status,
    accounts.stripe_subscription_id,
    accounts.trial_ends_at,
    accounts.override_plan,
    accounts.override_expires_at
  into
    stored_plan,
    account_status,
    stripe_subscription_id,
    trial_ends_at,
    override_plan,
    override_expires_at
  from public.accounts
  where accounts.id = new.account_id;

  if not found then
    raise exception 'ACCOUNT_ENTITLEMENT_INVALID'
      using detail = 'account does not exist';
  end if;

  override_is_live := override_plan is not null
    and override_plan in ('free', 'basic', 'pro', 'enterprise')
    and (override_expires_at is null or override_expires_at > pg_catalog.now());

  if override_is_live then
    effective_plan := override_plan;
  else
    if stored_plan is null
      or stored_plan not in ('basic', 'pro', 'enterprise')
      or account_status is null
      or account_status not in ('active', 'past_due', 'cancelled', 'trialing')
    then
      raise exception 'ACCOUNT_ENTITLEMENT_INVALID'
        using detail = 'account plan or status is malformed';
    end if;

    if stripe_subscription_id is not null
      and pg_catalog.btrim(stripe_subscription_id) = ''
    then
      raise exception 'ACCOUNT_ENTITLEMENT_INVALID'
        using detail = 'subscription id is malformed';
    end if;

    has_subscription := stripe_subscription_id is not null;
    trial_is_live := trial_ends_at is not null
      and trial_ends_at > pg_catalog.now();

    effective_plan := case
      when account_status in ('past_due', 'cancelled') then 'free'
      when account_status = 'active' and has_subscription then stored_plan
      when trial_is_live
        or (account_status = 'trialing' and has_subscription)
        then stored_plan
      else 'free'
    end;
  end if;

  -- Keep these in sync with PLAN_CATALOG[*].maxBrands in lib/plans/catalog.ts.
  -- __tests__/db/brand-limit-entitlement.test.ts fails if they diverge.
  brand_limit := case effective_plan
    when 'free' then 1
    when 'basic' then 1
    when 'pro' then 3
    when 'enterprise' then 10
    else null
  end;

  if brand_limit is null then
    raise exception 'ACCOUNT_ENTITLEMENT_INVALID'
      using detail = 'effective plan is malformed';
  end if;

  select count(*)
  into current_count
  from public.clients
  where clients.account_id = new.account_id;

  if current_count >= brand_limit then
    raise exception 'BRAND_LIMIT_REACHED'
      using detail = pg_catalog.format(
        'effective_plan=%s limit=%s',
        effective_plan,
        brand_limit
      );
  end if;

  return new;
end;
$$;

-- 028. Invisible to the differ (function ACLs are not compared) and carried over
-- anyway -- see the slice header. Harmless for the trigger itself: PostgreSQL
-- checks EXECUTE on a trigger function when the trigger is CREATED, not each
-- time it fires.
revoke all on function public.check_brand_limit() from public;


-- ----------------------------------------------------------------------------
-- acquire_stripe_subscription_lease / release_stripe_subscription_lease
--
-- From 024, unrevised. These serialize canonical Stripe reads and persistence
-- WITHOUT holding a database transaction open across the Stripe network call --
-- the lease is a row, not a lock, so a crashed handler expires rather than
-- wedging the subscription. `lease_expires_at <= clock_timestamp()` in the
-- on-conflict WHERE is the whole steal-an-expired-lease rule; acquire returns
-- false rather than raising when someone else holds a live lease.
--
-- SECURITY INVOKER, unlike 027's RPCs: these carry no tenancy predicate of their
-- own and are not meant to widen the caller's rights.
-- ----------------------------------------------------------------------------
create or replace function public.acquire_stripe_subscription_lease(
  p_subscription_id text,
  p_lease_owner uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_acquired integer;
begin
  if p_subscription_id is null or btrim(p_subscription_id) = '' then
    raise exception 'subscription id is required';
  end if;
  if p_lease_owner is null then
    raise exception 'lease owner is required';
  end if;

  insert into public.stripe_subscription_processing_leases (
    subscription_id,
    lease_owner,
    lease_expires_at
  )
  values (
    p_subscription_id,
    p_lease_owner,
    clock_timestamp() + interval '300 seconds'
  )
  on conflict (subscription_id) do update
    set lease_owner = excluded.lease_owner,
        lease_expires_at = excluded.lease_expires_at
    where public.stripe_subscription_processing_leases.lease_expires_at <= clock_timestamp();

  get diagnostics v_acquired = row_count;
  return v_acquired = 1;
end;
$$;

create or replace function public.release_stripe_subscription_lease(
  p_subscription_id text,
  p_lease_owner uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_subscription_id is null or btrim(p_subscription_id) = '' then
    raise exception 'subscription id is required';
  end if;
  if p_lease_owner is null then
    raise exception 'lease owner is required';
  end if;

  delete from public.stripe_subscription_processing_leases
    where subscription_id = p_subscription_id
      and lease_owner = p_lease_owner;

  return found;
end;
$$;

revoke all on function public.acquire_stripe_subscription_lease(text, uuid) from public;
revoke all on function public.release_stripe_subscription_lease(text, uuid) from public;


-- ----------------------------------------------------------------------------
-- apply_stripe_account_event() -- the whole Stripe webhook write path, in one
-- statement: lease check, event-ledger insert, ordering check, account update.
--
-- From 024, unrevised. 024 dropped the earlier eight-argument signature on
-- purpose (`create or replace` with a new argument list creates an OVERLOAD, it
-- does not replace), so that no caller can reach a version that does not prove
-- current lease ownership. A greenfield database never had that signature, so
-- there is nothing here to drop -- only the nine-argument form exists.
--
-- The four string returns are the contract app/api/stripe/webhook/route.ts
-- switches on: 'lease_lost', 'not_found', 'duplicate', 'stale', 'applied'. Note
-- that 'not_found' is deliberately returned BEFORE the ledger insert -- an event
-- that arrives before Checkout has linked the subscription must not be consumed,
-- or the retry would be swallowed as a duplicate.
-- ----------------------------------------------------------------------------
create or replace function public.apply_stripe_account_event(
  p_account_id uuid,
  p_subscription_id text,
  p_customer_id text,
  p_plan text,
  p_status text,
  p_event_created bigint,
  p_event_id text,
  p_event_type text,
  p_lease_owner uuid
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_account_id uuid;
  v_last_event_created bigint;
  v_inserted integer;
begin
  if p_subscription_id is null or btrim(p_subscription_id) = '' then
    raise exception 'subscription id is required';
  end if;
  if p_customer_id is null or btrim(p_customer_id) = '' then
    raise exception 'customer id is required';
  end if;
  if p_plan not in ('basic', 'pro', 'enterprise') then
    raise exception 'unsupported account plan: %', p_plan;
  end if;
  if p_status not in ('active', 'past_due', 'cancelled', 'trialing') then
    raise exception 'unsupported account status: %', p_status;
  end if;
  if p_event_created is null or p_event_created < 0 then
    raise exception 'invalid Stripe event creation time';
  end if;
  if p_event_id is null or btrim(p_event_id) = '' then
    raise exception 'event id is required';
  end if;
  if p_event_type is null or btrim(p_event_type) = '' then
    raise exception 'event type is required';
  end if;
  if p_lease_owner is null then
    raise exception 'lease owner is required';
  end if;

  -- Lock and validate the lease in this transaction before touching the event
  -- ledger or account. An expired lease can be stolen, but its former owner can
  -- never persist after the takeover.
  perform 1
    from public.stripe_subscription_processing_leases
    where subscription_id = p_subscription_id
      and lease_owner = p_lease_owner
      and lease_expires_at > clock_timestamp()
    for update;

  if not found then
    return 'lease_lost';
  end if;

  if p_account_id is not null then
    select accounts.id, accounts.stripe_event_created_at
      into v_account_id, v_last_event_created
      from public.accounts
      where accounts.id = p_account_id
      for update;
  else
    select accounts.id, accounts.stripe_event_created_at
      into v_account_id, v_last_event_created
      from public.accounts
      where accounts.stripe_subscription_id = p_subscription_id
      for update;
  end if;

  -- Do not consume the event before Checkout has linked the subscription.
  if v_account_id is null then
    return 'not_found';
  end if;

  insert into public.stripe_webhook_events (
    event_id,
    event_created,
    event_type,
    account_id
  )
  values (
    p_event_id,
    p_event_created,
    p_event_type,
    v_account_id
  )
  on conflict (event_id) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return 'duplicate';
  end if;

  if p_event_created < v_last_event_created then
    return 'stale';
  end if;

  -- The processing lease serializes canonical reads through this update, including
  -- equal-second events. Event IDs remain identity keys, never chronology.
  update public.accounts
    set stripe_customer_id = p_customer_id,
        stripe_subscription_id = p_subscription_id,
        plan = p_plan,
        status = p_status,
        stripe_event_created_at = greatest(stripe_event_created_at, p_event_created),
        stripe_event_id = p_event_id
    where id = v_account_id;

  if not found then
    raise exception 'account disappeared during Stripe event update';
  end if;

  return 'applied';
end;
$$;

revoke all on function public.apply_stripe_account_event(
  uuid, text, text, text, text, bigint, text, text, uuid
) from public;


-- ============================================================================
-- The seven client-report RPCs -- 027, unrevised
--
-- All seven are SECURITY DEFINER with `set search_path = ''`. That combination
-- is the point: they run as the owner, so every table reference is fully
-- qualified and every builtin is called through pg_catalog, leaving no name for
-- a caller-controlled search_path to capture. Tenancy is not delegated to RLS
-- (client_reports and client_report_versions are default-deny with zero
-- policies, and 036 removed the dead policy layer everywhere else) -- each
-- function carries `account_id` and `client_id` in its own WHERE clauses
-- instead, and raises CLIENT_REPORT_NOT_FOUND rather than distinguishing
-- "absent" from "not yours".
--
-- The domain checks repeated in the first two are not decoration: a report
-- snapshot is published at a public URL, so a scan for some other domain must
-- never be attachable to a client. `strpos(..., '://')` and friends reject a
-- stored value that is a URL rather than a hostname; the regexp_replace pair
-- compares hosts with a leading `www.` folded away.
--
-- public_slug is regenerated from public.gen_random_bytes(24) by publish (only
-- when resurrecting a revoked report), revoke and rotate -- pgcrypto lives in
-- `public` (slice 4), which is why the call is schema-qualified that way and not
-- through pg_catalog.
-- ============================================================================


create or replace function public.create_client_report_with_version(
  p_account_id uuid,
  p_client_id uuid,
  p_source_scan_id uuid,
  p_previous_scan_id uuid,
  p_locale text,
  p_executive_summary text,
  p_snapshot_schema_version integer,
  p_snapshot jsonb,
  p_created_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  new_report public.client_reports;
  new_version public.client_report_versions;
  client_domain text;
  source_domain text;
  source_created_at timestamptz;
  previous_domain text;
  previous_created_at timestamptz;
begin
  select clients.domain
  into client_domain
  from public.clients
  where clients.id = p_client_id
    and clients.account_id = p_account_id;

  if not found
    or client_domain is null
    or pg_catalog.btrim(client_domain) = ''
    or pg_catalog.strpos(client_domain, '://') > 0
    or pg_catalog.strpos(client_domain, '/') > 0
    or pg_catalog.strpos(client_domain, '?') > 0
    or pg_catalog.strpos(client_domain, '#') > 0
  then
    raise exception 'CLIENT_REPORT_NOT_FOUND';
  end if;

  select scans.domain, scans.created_at
  into source_domain, source_created_at
  from public.scans
  where scans.id = p_source_scan_id
    and scans.account_id = p_account_id;

  if not found
    or source_domain is null
    or source_created_at is null
    or pg_catalog.strpos(source_domain, '://') > 0
    or pg_catalog.strpos(source_domain, '/') > 0
    or pg_catalog.strpos(source_domain, '?') > 0
    or pg_catalog.strpos(source_domain, '#') > 0
    or pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.btrim(source_domain)), '^www\.', '')
      <> pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.btrim(client_domain)), '^www\.', '')
  then
    raise exception 'CLIENT_REPORT_SCAN_NOT_FOUND';
  end if;

  if p_previous_scan_id is not null then
    select scans.domain, scans.created_at
    into previous_domain, previous_created_at
    from public.scans
    where scans.id = p_previous_scan_id
      and scans.account_id = p_account_id;

    if not found
      or previous_domain is null
      or previous_created_at is null
      or previous_created_at >= source_created_at
      or pg_catalog.strpos(previous_domain, '://') > 0
      or pg_catalog.strpos(previous_domain, '/') > 0
      or pg_catalog.strpos(previous_domain, '?') > 0
      or pg_catalog.strpos(previous_domain, '#') > 0
      or pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.btrim(previous_domain)), '^www\.', '')
        <> pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.btrim(client_domain)), '^www\.', '')
    then
      raise exception 'CLIENT_REPORT_PREVIOUS_SCAN_INVALID';
    end if;
  end if;

  insert into public.client_reports (account_id, client_id, created_by)
  values (p_account_id, p_client_id, p_created_by)
  returning * into new_report;

  insert into public.client_report_versions (
    report_id,
    account_id,
    client_id,
    version_number,
    source_scan_id,
    previous_scan_id,
    locale,
    executive_summary,
    snapshot_schema_version,
    snapshot,
    created_by
  ) values (
    new_report.id,
    p_account_id,
    p_client_id,
    1,
    p_source_scan_id,
    p_previous_scan_id,
    p_locale,
    p_executive_summary,
    p_snapshot_schema_version,
    p_snapshot,
    p_created_by
  )
  returning * into new_version;

  update public.client_reports
  set latest_version_id = new_version.id,
      updated_at = pg_catalog.now()
  where client_reports.id = new_report.id
    and client_reports.account_id = p_account_id
    and client_reports.client_id = p_client_id
  returning * into new_report;

  return pg_catalog.jsonb_build_object(
    'report', pg_catalog.to_jsonb(new_report),
    'version', pg_catalog.to_jsonb(new_version)
  );
end;
$function$;

create or replace function public.append_client_report_version(
  p_report_id uuid,
  p_account_id uuid,
  p_client_id uuid,
  p_source_scan_id uuid,
  p_previous_scan_id uuid,
  p_locale text,
  p_executive_summary text,
  p_snapshot_schema_version integer,
  p_snapshot jsonb,
  p_created_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  locked_report public.client_reports;
  new_version public.client_report_versions;
  published_version public.client_report_versions;
  published_version_id_before_append uuid;
  new_version_number integer;
  client_domain text;
  source_domain text;
  source_created_at timestamptz;
  previous_domain text;
  previous_created_at timestamptz;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_report_id::text, 0)
  );

  select client_reports.*
  into locked_report
  from public.client_reports
  where client_reports.id = p_report_id
    and client_reports.account_id = p_account_id
    and client_reports.client_id = p_client_id
  for update;

  if not found then
    raise exception 'CLIENT_REPORT_NOT_FOUND';
  end if;

  published_version_id_before_append := locked_report.published_version_id;

  select clients.domain
  into client_domain
  from public.clients
  where clients.id = p_client_id
    and clients.account_id = p_account_id;

  if not found
    or client_domain is null
    or pg_catalog.btrim(client_domain) = ''
    or pg_catalog.strpos(client_domain, '://') > 0
    or pg_catalog.strpos(client_domain, '/') > 0
    or pg_catalog.strpos(client_domain, '?') > 0
    or pg_catalog.strpos(client_domain, '#') > 0
  then
    raise exception 'CLIENT_REPORT_NOT_FOUND';
  end if;

  select scans.domain, scans.created_at
  into source_domain, source_created_at
  from public.scans
  where scans.id = p_source_scan_id
    and scans.account_id = p_account_id;

  if not found
    or source_domain is null
    or source_created_at is null
    or pg_catalog.strpos(source_domain, '://') > 0
    or pg_catalog.strpos(source_domain, '/') > 0
    or pg_catalog.strpos(source_domain, '?') > 0
    or pg_catalog.strpos(source_domain, '#') > 0
    or pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.btrim(source_domain)), '^www\.', '')
      <> pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.btrim(client_domain)), '^www\.', '')
  then
    raise exception 'CLIENT_REPORT_SCAN_NOT_FOUND';
  end if;

  if p_previous_scan_id is not null then
    select scans.domain, scans.created_at
    into previous_domain, previous_created_at
    from public.scans
    where scans.id = p_previous_scan_id
      and scans.account_id = p_account_id;

    if not found
      or previous_domain is null
      or previous_created_at is null
      or previous_created_at >= source_created_at
      or pg_catalog.strpos(previous_domain, '://') > 0
      or pg_catalog.strpos(previous_domain, '/') > 0
      or pg_catalog.strpos(previous_domain, '?') > 0
      or pg_catalog.strpos(previous_domain, '#') > 0
      or pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.btrim(previous_domain)), '^www\.', '')
        <> pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.btrim(client_domain)), '^www\.', '')
    then
      raise exception 'CLIENT_REPORT_PREVIOUS_SCAN_INVALID';
    end if;
  end if;

  select coalesce(
    pg_catalog.max(client_report_versions.version_number) + 1,
    1
  )
  into new_version_number
  from public.client_report_versions
  where client_report_versions.report_id = p_report_id
    and client_report_versions.account_id = p_account_id
    and client_report_versions.client_id = p_client_id;

  insert into public.client_report_versions (
    report_id,
    account_id,
    client_id,
    version_number,
    source_scan_id,
    previous_scan_id,
    locale,
    executive_summary,
    snapshot_schema_version,
    snapshot,
    created_by
  ) values (
    p_report_id,
    p_account_id,
    p_client_id,
    new_version_number,
    p_source_scan_id,
    p_previous_scan_id,
    p_locale,
    p_executive_summary,
    p_snapshot_schema_version,
    p_snapshot,
    p_created_by
  )
  returning * into new_version;

  update public.client_reports
  set latest_version_id = new_version.id,
      updated_at = pg_catalog.now()
  where client_reports.id = p_report_id
    and client_reports.account_id = p_account_id
    and client_reports.client_id = p_client_id
  returning * into locked_report;

  if locked_report.published_version_id is distinct from published_version_id_before_append then
    raise exception 'CLIENT_REPORT_NOT_FOUND';
  end if;

  if locked_report.published_version_id is not null then
    select client_report_versions.*
    into published_version
    from public.client_report_versions
    where client_report_versions.id = locked_report.published_version_id
      and client_report_versions.report_id = locked_report.id
      and client_report_versions.account_id = locked_report.account_id
      and client_report_versions.client_id = locked_report.client_id;

    if not found then
      raise exception 'CLIENT_REPORT_NOT_FOUND';
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'report', pg_catalog.to_jsonb(locked_report),
    'version', pg_catalog.to_jsonb(new_version),
    'previous_published_version_id', published_version_id_before_append,
    'published_version', pg_catalog.to_jsonb(published_version)
  );
end;
$function$;

create or replace function public.publish_client_report_latest(
  p_report_id uuid,
  p_account_id uuid,
  p_client_id uuid,
  p_reviewed_version_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  locked_report public.client_reports;
  published_version public.client_report_versions;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_report_id::text, 0)
  );

  select client_reports.*
  into locked_report
  from public.client_reports
  where client_reports.id = p_report_id
    and client_reports.account_id = p_account_id
    and client_reports.client_id = p_client_id
  for update;

  if not found or locked_report.latest_version_id is null then
    raise exception 'CLIENT_REPORT_NOT_FOUND';
  end if;

  if locked_report.latest_version_id is distinct from p_reviewed_version_id then
    raise exception 'reviewed version is stale';
  end if;

  update public.client_reports
  set published_version_id = locked_report.latest_version_id,
      status = 'published',
      public_slug = case when locked_report.status = 'revoked' then pg_catalog.translate(
        pg_catalog.rtrim(pg_catalog.encode(public.gen_random_bytes(24), 'base64'), '='),
        '+/',
        '-_'
      ) else locked_report.public_slug end,
      share_version = case when locked_report.status = 'revoked' then locked_report.share_version + 1 else locked_report.share_version end,
      published_at = pg_catalog.now(),
      revoked_at = null,
      updated_at = pg_catalog.now()
  where client_reports.id = p_report_id
    and client_reports.account_id = p_account_id
    and client_reports.client_id = p_client_id
  returning * into locked_report;

  select client_report_versions.*
  into published_version
  from public.client_report_versions
  where client_report_versions.id = locked_report.published_version_id
    and client_report_versions.report_id = locked_report.id
    and client_report_versions.account_id = locked_report.account_id
    and client_report_versions.client_id = locked_report.client_id;

  if not found then
    raise exception 'CLIENT_REPORT_NOT_FOUND';
  end if;

  return pg_catalog.jsonb_build_object(
    'report', pg_catalog.to_jsonb(locked_report),
    'published_version', pg_catalog.to_jsonb(published_version),
    'latest_version', pg_catalog.to_jsonb(published_version)
  );
end;
$function$;

create or replace function public.revoke_client_report(
  p_report_id uuid,
  p_account_id uuid,
  p_client_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  locked_report public.client_reports;
  latest_version public.client_report_versions;
  published_version public.client_report_versions;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_report_id::text, 0)
  );

  select client_reports.*
  into locked_report
  from public.client_reports
  where client_reports.id = p_report_id
    and client_reports.account_id = p_account_id
    and client_reports.client_id = p_client_id
  for update;

  if not found then
    raise exception 'CLIENT_REPORT_NOT_FOUND';
  end if;

  update public.client_reports
  set status = 'revoked',
      share_version = locked_report.share_version + 1,
      public_slug = pg_catalog.translate(
        pg_catalog.rtrim(pg_catalog.encode(public.gen_random_bytes(24), 'base64'), '='),
        '+/',
        '-_'
      ),
      revoked_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  where client_reports.id = p_report_id
    and client_reports.account_id = p_account_id
    and client_reports.client_id = p_client_id
  returning * into locked_report;

  select client_report_versions.*
  into latest_version
  from public.client_report_versions
  where client_report_versions.id = locked_report.latest_version_id
    and client_report_versions.report_id = locked_report.id
    and client_report_versions.account_id = locked_report.account_id
    and client_report_versions.client_id = locked_report.client_id;

  if not found then
    raise exception 'CLIENT_REPORT_NOT_FOUND';
  end if;

  if locked_report.published_version_id is not null then
    select client_report_versions.*
    into published_version
    from public.client_report_versions
    where client_report_versions.id = locked_report.published_version_id
      and client_report_versions.report_id = locked_report.id
      and client_report_versions.account_id = locked_report.account_id
      and client_report_versions.client_id = locked_report.client_id;

    if not found then
      raise exception 'CLIENT_REPORT_NOT_FOUND';
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'report', pg_catalog.to_jsonb(locked_report),
    'latest_version', pg_catalog.to_jsonb(latest_version),
    'published_version', pg_catalog.to_jsonb(published_version)
  );
end;
$function$;

create or replace function public.rotate_client_report_link(
  p_report_id uuid,
  p_account_id uuid,
  p_client_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  locked_report public.client_reports;
  latest_version public.client_report_versions;
  published_version public.client_report_versions;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_report_id::text, 0)
  );

  select client_reports.*
  into locked_report
  from public.client_reports
  where client_reports.id = p_report_id
    and client_reports.account_id = p_account_id
    and client_reports.client_id = p_client_id
  for update;

  if not found
    or locked_report.status <> 'published'
    or locked_report.published_version_id is null
  then
    raise exception 'CLIENT_REPORT_NOT_FOUND';
  end if;

  update public.client_reports
  set share_version = locked_report.share_version + 1,
      public_slug = pg_catalog.translate(
        pg_catalog.rtrim(pg_catalog.encode(public.gen_random_bytes(24), 'base64'), '='),
        '+/',
        '-_'
      ),
      updated_at = pg_catalog.now()
  where client_reports.id = p_report_id
    and client_reports.account_id = p_account_id
    and client_reports.client_id = p_client_id
  returning * into locked_report;

  select client_report_versions.*
  into latest_version
  from public.client_report_versions
  where client_report_versions.id = locked_report.latest_version_id
    and client_report_versions.report_id = locked_report.id
    and client_report_versions.account_id = locked_report.account_id
    and client_report_versions.client_id = locked_report.client_id;

  if not found then
    raise exception 'CLIENT_REPORT_NOT_FOUND';
  end if;

  select client_report_versions.*
  into published_version
  from public.client_report_versions
  where client_report_versions.id = locked_report.published_version_id
    and client_report_versions.report_id = locked_report.id
    and client_report_versions.account_id = locked_report.account_id
    and client_report_versions.client_id = locked_report.client_id;

  if not found then
    raise exception 'CLIENT_REPORT_NOT_FOUND';
  end if;

  return pg_catalog.jsonb_build_object(
    'report', pg_catalog.to_jsonb(locked_report),
    'published_version', pg_catalog.to_jsonb(published_version),
    'latest_version', pg_catalog.to_jsonb(latest_version)
  );
end;
$function$;

create or replace function public.increment_client_report_view(
  p_public_slug text,
  p_share_version integer
)
returns table (
  view_count bigint,
  first_viewed_at timestamptz,
  last_viewed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  return query
  update public.client_reports
  set view_count = client_reports.view_count + 1,
      first_viewed_at = coalesce(client_reports.first_viewed_at, pg_catalog.now()),
      last_viewed_at = pg_catalog.now()
  where client_reports.public_slug = p_public_slug
    and client_reports.share_version = p_share_version
    and client_reports.status = 'published'
    and client_reports.published_version_id is not null
  returning client_reports.view_count,
            client_reports.first_viewed_at,
            client_reports.last_viewed_at;
end;
$function$;

create or replace function public.increment_client_report_cta_click(
  p_public_slug text,
  p_share_version integer
)
returns table (cta_click_count bigint)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  return query
  update public.client_reports
  set cta_click_count = client_reports.cta_click_count + 1
  where client_reports.public_slug = p_public_slug
    and client_reports.share_version = p_share_version
    and client_reports.status = 'published'
    and client_reports.published_version_id is not null
  returning client_reports.cta_click_count;
end;
$function$;

-- 027. Invisible to the differ, carried over for the same reason as the ones
-- above: EXECUTE on a new function is granted to PUBLIC by default, so leaving
-- these out would silently open seven SECURITY DEFINER functions on a
-- greenfield database that the legacy chain closes.
revoke execute on function public.create_client_report_with_version(uuid, uuid, uuid, uuid, text, text, integer, jsonb, uuid) from public;
revoke execute on function public.append_client_report_version(uuid, uuid, uuid, uuid, uuid, text, text, integer, jsonb, uuid) from public;
revoke execute on function public.publish_client_report_latest(uuid, uuid, uuid, uuid) from public;
revoke execute on function public.revoke_client_report(uuid, uuid, uuid) from public;
revoke execute on function public.rotate_client_report_link(uuid, uuid, uuid) from public;
revoke execute on function public.increment_client_report_view(text, integer) from public;
revoke execute on function public.increment_client_report_cta_click(text, integer) from public;


-- ============================================================================
-- Triggers
--
-- One, and only one, in `public`. The chain's other trigger --
-- `on_auth_user_created` on auth.users, from 003 -- is not carried over; see the
-- note on handle_new_user() above.
-- ============================================================================


-- Final form from 028, which recreated it after replacing check_brand_limit()
-- (026 had done the same after its own rewrite). BEFORE INSERT FOR EACH ROW:
-- there is no UPDATE arm, so moving a client between accounts is not gated by
-- this trigger.
create trigger enforce_brand_limit
  before insert on public.clients
  for each row
  execute function public.check_brand_limit();


-- ============================================================================
-- Slice 6, part 4 -- the application role. THIS MUST BE THE LAST THING IN THE
-- FILE.
--
-- Verbatim in effect from 037. The app connects as aeo_app, not as the database
-- owner: a leaked owner credential IS the database (it can drop any table, alter
-- any schema, create roles), whereas aeo_app can read and write application data
-- -- which the app does anyway -- and nothing else. It cannot run DDL, cannot
-- create roles, and cannot write Neon Auth's tables.
--
-- `grant ... on all tables in schema public` is a point-in-time loop over the
-- tables that exist right now, NOT a rule. That is why it is last, and why
-- adding a `create table` below it would produce a table the application cannot
-- read -- with the failure surfacing at runtime in whichever route touches it
-- first, long after this file looked like it succeeded.
--
-- The role is created NOLOGIN. A human sets the password out of band so it never
-- enters git:
--     alter role aeo_app login password '<generated>';
-- ============================================================================


-- 037 guards the create because `create role` is not idempotent and this file
-- may run on a branch cut from a parent that already has the role. The asymmetry
-- in the else branch is deliberate and is carried over exactly: NOLOGIN is only
-- re-asserted at creation. Re-asserting it on an existing role would silently
-- strip LOGIN from a role a human has already completed cutover on, and the
-- app's next connection would fail authentication.
--
-- BYPASSRLS is DELIBERATE and must stay. Seven tables in `public` have RLS
-- enabled with zero policies (023, 024, 025 and 027 each chose that posture for
-- the tables it created -- see the notes in slices 4 and 5). A NOBYPASSRLS role
-- granted SELECT on those returns ZERO ROWS SILENTLY. A freshly created role
-- defaults to rolbypassrls = false, so omitting the keyword reintroduces that
-- failure quietly. This is a grants decision, not an RLS decision.
do $$
begin
  if to_regrole('aeo_app') is null then
    create role aeo_app nologin bypassrls;
  else
    alter role aeo_app bypassrls;
  end if;
end $$;

grant usage on schema public to aeo_app;
grant select, insert, update, delete on all tables in schema public to aeo_app;
grant usage, select on all sequences in schema public to aeo_app;

-- Mirrors 038_app_role_function_execute.sql -- CHANGE ONE, CHANGE THE OTHER, or
-- the two paths stop being the same database.
--
-- This file reproduces 024's and 027's function bodies, and therefore inherits
-- the hole they left: both revoke EXECUTE from PUBLIC unconditionally and grant
-- it back only to `service_role`, a Supabase role that does not exist under Neon,
-- so the regrant silently no-ops and nothing else ever grants EXECUTE to the
-- application role. Without the ten statements below, every RPC in
-- app/api/stripe/webhook/route.ts and lib/reports/store.ts fails at runtime with
-- `permission denied for function`.
--
-- Enumerated one by one rather than `grant execute on all functions in schema
-- public`, deliberately. That shorter form would also grant check_brand_limit()
-- and handle_new_user(), which 038 does not: the first is a trigger function
-- (PostgreSQL checks EXECUTE at CREATE TRIGGER time, not per fire) and the second
-- was never revoked. The two paths would then hold genuinely different ACLs while
-- the differ -- whose functions class compares returns/volatility/
-- security_definer, never privileges -- went on reporting EQUIVALENT.
grant execute on function public.acquire_stripe_subscription_lease(text, uuid) to aeo_app;
grant execute on function public.release_stripe_subscription_lease(text, uuid) to aeo_app;
grant execute on function public.apply_stripe_account_event(
  uuid, text, text, text, text, bigint, text, text, uuid
) to aeo_app;

grant execute on function public.create_client_report_with_version(
  uuid, uuid, uuid, uuid, text, text, integer, jsonb, uuid
) to aeo_app;
grant execute on function public.append_client_report_version(
  uuid, uuid, uuid, uuid, uuid, text, text, integer, jsonb, uuid
) to aeo_app;
grant execute on function public.publish_client_report_latest(uuid, uuid, uuid, uuid) to aeo_app;
grant execute on function public.revoke_client_report(uuid, uuid, uuid) to aeo_app;
grant execute on function public.rotate_client_report_link(uuid, uuid, uuid) to aeo_app;
grant execute on function public.increment_client_report_view(text, integer) to aeo_app;
grant execute on function public.increment_client_report_cta_click(text, integer) to aeo_app;

-- Carried over from 037 and INVISIBLE TO THE EQUIVALENCE PROOF: the differ's
-- grants class reads information_schema.role_table_grants, which lists existing
-- tables only, so pg_default_acl is never compared. Omitting these would pass
-- green and then bite on the first migration applied after this baseline --
-- 038 would create a table aeo_app cannot read. Applies to objects created by
-- the role that runs migrations, which is the owner in MIGRATE_DATABASE_URL.
alter default privileges in schema public
  grant select, insert, update, delete on tables to aeo_app;
alter default privileges in schema public
  grant usage, select on sequences to aeo_app;

-- Also mirrors 038, and invisible to the proof for the same reason. 037 set
-- default privileges for tables and sequences but not for functions, which is
-- exactly how 024's and 027's functions came to be missed. This line is the half
-- of 038 that stops 039 shipping a function aeo_app cannot execute.
alter default privileges in schema public
  grant execute on functions to aeo_app;

-- The neon_auth grants are required, not optional:
--   * app/api/webhooks/neon/route.ts authenticates every payload against
--     neon_auth."user", and @neondatabase/auth ships no webhook signing, so that
--     lookup is the ONLY authentication that endpoint has;
--   * lib/alerts/neon-store.ts joins it to resolve recipient emails.
--
-- Guarded on the schema's existence for one reason: Neon provisions neon_auth
-- out of band and this file must never CREATE it (see DELIBERATE OMISSIONS at
-- the top of the file). On a real greenfield project Neon Auth is enabled before
-- the baseline runs (ADR-009) and the schema is there; on the disposable
-- equivalence branch it is inherited from the parent. But an ungated `grant
-- usage on schema neon_auth` would abort the entire baseline on a database where
-- it is genuinely absent, taking all 33 application tables with it -- a total
-- failure over an optional dependency. Skipping instead leaves exactly two
-- endpoints degraded, loudly, at the point they are used.
--
-- The owner may issue these: it is a member of the neon_auth role that owns the
-- schema.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'neon_auth') then
    execute 'grant usage on schema neon_auth to aeo_app';
    execute 'grant select on neon_auth."user" to aeo_app';
  else
    raise warning
      'neon_auth schema absent -- skipped the aeo_app grants on neon_auth."user". '
      'Enable Neon Auth, then run: grant usage on schema neon_auth to aeo_app; '
      'grant select on neon_auth."user" to aeo_app;';
  end if;
end $$;

-- Fail closed. If BYPASSRLS did not take, the seven default-deny tables would
-- return zero rows for every app query, silently. Raising here aborts the
-- baseline rather than leaving a database that looks built and reads empty.
do $$
declare
  bypasses boolean;
begin
  select rolbypassrls into bypasses from pg_roles where rolname = 'aeo_app';

  if bypasses is distinct from true then
    raise exception
      'aeo_app must have BYPASSRLS: without it the seven RLS-enabled, zero-policy '
      'tables silently return no rows to the application';
  end if;
end $$;


-- ============================================================================
-- The ledger seed -- LAST STATEMENT IN THE FILE, deliberately
--
-- A greenfield database's migration lineage starts here. Without this row the
-- ledger would be empty, and the first `npm run migrate` against a database
-- built from this file would trip assertBaselined() -- application tables
-- present, ledger empty -- which is that guard working exactly as designed, but
-- it leaves the operator with no record of where the schema came from. This row
-- is that record: one line naming one artefact, with the digest of the bytes
-- that produced it.
--
-- Also recorded: the 36 chain migrations this file subsumes, 001-004 and
-- 007-038. That is NOT a claim that those files executed here. The ledger's
-- meaning is "the objects of this migration are present, do not apply it
-- again" -- exactly the claim `npm run migrate -- --baseline` writes for a
-- database whose objects were created by hand, which is how production itself
-- was baselined. `npm run schema:equivalence` is what earns the claim: it
-- proves this file produces what replaying the chain produces.
--
-- An earlier version of this comment called recording them "a lie the runner
-- would then act on". That was wrong, and it left a real defect in place.
-- planMigrations() is `files.filter(f => !applied.has(f))` over the contents of
-- supabase/migrations/, so a lineage naming only this file reports all 36 as
-- pending and starts applying them against a schema that already has every one
-- of their objects. 001 aborts on the first `create table` of a table that
-- exists -- loud, and its transaction rolls back rather than corrupting
-- anything, but a failure, not a no-op. A greenfield database could not be
-- brought to head at all.
--
-- The chain rows carry no checksum, deliberately: `checksum` means "these bytes
-- produced this lineage", and only this file's bytes were hashed. It also makes
-- them byte-identical in shape to what scripts/migrate.ts writes on the legacy
-- path, which names only `filename`.
--
-- Migration 039 and later are listed nowhere here and must not be: they apply
-- to both lineages normally. __tests__/db/baseline-ledger.test.ts pins the
-- recorded list to a PREFIX of supabase/migrations/ so that stays true, and
-- scripts/schema-equivalence.mjs runs `migrate --dry-run` against the baselined
-- branch and requires "Nothing to apply", so the replay defect cannot return
-- unnoticed.
--
-- The lineage row is last because everything above it must have succeeded for
-- the claim to be true. Postgres does not wrap a multi-statement string in an
-- implicit transaction over the simple query protocol, so an abort partway
-- through leaves earlier statements committed -- but that row, being last, is
-- not among them. A half-built database therefore has no lineage row, which is
-- the honest outcome: `npm run migrate` refuses it rather than continuing from
-- 039 over a schema that is missing tables.
--
-- :'baseline_checksum' is substituted by scripts/schema-equivalence.mjs, which
-- hashes this file's raw bytes with SHA-256 before executing it. .gitattributes
-- pins supabase/baseline/*.sql to `eol=lf`, so the digest is the same on Windows
-- and on CI for byte-identical SQL. Editing this file changes the digest, which
-- is the point: the row records what was actually run, so a lineage claiming
-- this baseline can be checked against the file that supposedly produced it.
-- Anything applying this file by another route must perform the same
-- substitution -- psql does it natively with
-- `-v baseline_checksum="$(sha256sum ...)"`.
--
-- `on conflict do nothing` on both inserts because a row is a claim, not a
-- counter: re-running the file on a database that already has the lineage must
-- not rewrite a digest that was recorded from different bytes.
-- ============================================================================
insert into schema_migrations (filename)
values
  ('001_phase1.sql'),
  ('002_phase2.sql'),
  ('003_phase3a_accounts.sql'),
  ('004_phase3a_clients_fk.sql'),
  ('007_fix_handle_new_user_with_account.sql'),
  ('008_scans_account_id.sql'),
  ('009_clients_domain.sql'),
  ('010_phase3b.sql'),
  ('011_phase3b_hardening.sql'),
  ('012_aiso_v3.sql'),
  ('013_agent_dashboard.sql'),
  ('014_subscription_tiers.sql'),
  ('015_scan_lead_email.sql'),
  ('016_trial_columns.sql'),
  ('017_fix_handle_new_user_plan.sql'),
  ('018_clients_region.sql'),
  ('019_clients_description.sql'),
  ('020_scans_public_select.sql'),
  ('021_local_trust_roi.sql'),
  ('022_profiles_neon_auth_fk.sql'),
  ('023_public_scan_rate_limits.sql'),
  ('024_stripe_lifecycle_integrity.sql'),
  ('025_authenticated_scan_quotas.sql'),
  ('026_effective_brand_limit.sql'),
  ('027_client_report_snapshots.sql'),
  ('028_account_plan_overrides.sql'),
  ('029_scans_client_id.sql'),
  ('030_accounts_plan_default_basic.sql'),
  ('031_pulse_weekly_summary_unique.sql'),
  ('032_pulse_metrics_indexes.sql'),
  ('033_alert_evaluation_hardening.sql'),
  ('034_alert_evaluation_snapshot_refinement.sql'),
  ('035_alert_email_delivery_ledger.sql'),
  ('036_drop_dead_rls_policies.sql'),
  ('037_least_privilege_app_role.sql'),
  ('038_app_role_function_execute.sql')
on conflict (filename) do nothing;

insert into schema_migrations (filename, checksum)
values ('000_baseline_2026-08-31.sql', :'baseline_checksum')
on conflict (filename) do nothing;
