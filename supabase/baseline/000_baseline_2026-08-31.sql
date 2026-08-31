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

-- 027. RLS enabled with deliberately ZERO policies -- default-deny, and the one
-- place in this file where an `enable row level security` appears at all.
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
