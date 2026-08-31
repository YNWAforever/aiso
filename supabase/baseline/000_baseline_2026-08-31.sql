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
