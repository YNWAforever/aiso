-- 036: retire the dead Supabase-era row-level-security policies.
--
-- These 30 policies have never fired. The app connects as neondb_owner
-- (rolbypassrls = true) and no public table sets FORCE ROW LEVEL SECURITY, so
-- row_security_active() is false for every query the application makes.
-- Dropping them cannot change any current result.
--
-- They are removed rather than left inert because auth.uid() EXISTS and returns
-- NULL under Neon -- it is
--   select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
-- and nothing sets that GUC. Pointing the app at a non-bypass role would
-- therefore NOT raise "function does not exist"; it would silently return zero
-- rows across most of the schema. Among these policies,
-- scans.auth_update_own_scan is an UPDATE policy granted to public whose
-- qualifier is literally `true` -- a cross-tenant write hole that would arm
-- itself the moment RLS became load-bearing.
--
-- RLS is disabled only on the 21 tables that carried a policy. Seven tables
-- keep RLS on with no policy at all: 027 chose that default-deny posture for the
-- report tables and __tests__/db/client-report-migration.test.ts pins it. Do not
-- add them here.
--
-- Tenancy is enforced in application code by explicit account_id filters --
-- lib/localTrust/guard.ts is the shape to copy. There is no database backstop,
-- and after this migration the schema no longer pretends otherwise.
--
-- The dead `auth` schema is deliberately NOT dropped: integration branches
-- replay every migration from 001, and 003 needs auth.users and auth.uid() to
-- exist. See __tests__/integration/setup.ts.

drop policy if exists "users see own account" on public.accounts;
drop policy if exists "ai_citation_log_own_client" on public.ai_citation_log;
drop policy if exists "owner_all_alert_configs" on public.alert_configs;
drop policy if exists "authority_overrides_own_client" on public.authority_overrides;
drop policy if exists "authority_scores_public_read" on public.authority_scores;
drop policy if exists "chunk_analysis_own_scan" on public.chunk_analysis;
drop policy if exists "users insert own clients" on public.clients;
drop policy if exists "users see own clients" on public.clients;
drop policy if exists "content_briefs_own_client" on public.content_briefs;
drop policy if exists "domain_signals_public_read" on public.domain_signals;
drop policy if exists "industry_packs_public_read" on public.industry_packs;
drop policy if exists "local_trust_actions_insert_own" on public.local_trust_actions;
drop policy if exists "local_trust_actions_select_own" on public.local_trust_actions;
drop policy if exists "local_trust_actions_update_own" on public.local_trust_actions;
drop policy if exists "local_trust_profiles_insert_own" on public.local_trust_profiles;
drop policy if exists "local_trust_profiles_select_own" on public.local_trust_profiles;
drop policy if exists "local_trust_profiles_update_own" on public.local_trust_profiles;
drop policy if exists "local_trust_snapshots_insert_own" on public.local_trust_snapshots;
drop policy if exists "local_trust_snapshots_select_own" on public.local_trust_snapshots;
drop policy if exists "local_trust_snapshots_update_own" on public.local_trust_snapshots;
drop policy if exists "owner_all_notifications" on public.notifications;
drop policy if exists "users see own profile" on public.profiles;
drop policy if exists "users see own prompts" on public.prompt_bank;
drop policy if exists "users see own metrics" on public.pulse_metrics;
drop policy if exists "users see own summary" on public.pulse_weekly_summary;
drop policy if exists "regional_packs_public_read" on public.regional_packs;
drop policy if exists "auth_insert_own_scan" on public.scans;
drop policy if exists "auth_update_own_scan" on public.scans;
drop policy if exists "public_read_scan_by_id" on public.scans;
drop policy if exists "topical_clusters_own_client" on public.topical_clusters;

-- The 21 tables that carried a policy. NOT the seven default-deny tables:
-- account_report_branding, authenticated_scan_monthly_usage,
-- client_report_versions, client_reports, public_scan_rate_limits,
-- stripe_subscription_processing_leases, stripe_webhook_events.
alter table if exists public.accounts disable row level security;
alter table if exists public.ai_citation_log disable row level security;
alter table if exists public.alert_configs disable row level security;
alter table if exists public.authority_overrides disable row level security;
alter table if exists public.authority_scores disable row level security;
alter table if exists public.chunk_analysis disable row level security;
alter table if exists public.clients disable row level security;
alter table if exists public.content_briefs disable row level security;
alter table if exists public.domain_signals disable row level security;
alter table if exists public.industry_packs disable row level security;
alter table if exists public.local_trust_actions disable row level security;
alter table if exists public.local_trust_profiles disable row level security;
alter table if exists public.local_trust_snapshots disable row level security;
alter table if exists public.notifications disable row level security;
alter table if exists public.profiles disable row level security;
alter table if exists public.prompt_bank disable row level security;
alter table if exists public.pulse_metrics disable row level security;
alter table if exists public.pulse_weekly_summary disable row level security;
alter table if exists public.regional_packs disable row level security;
alter table if exists public.scans disable row level security;
alter table if exists public.topical_clusters disable row level security;

-- Fail closed. The enumeration above is the inventory verified in production on
-- 2026-08-16. If this database carries a policy that was not in that inventory,
-- abort rather than leave it behind silently: the runner wraps each migration in
-- a transaction, so raising here rolls the whole file back and leaves the ledger
-- unmarked. Re-run once the surprise is understood.
do $$
declare
  leftover text;
begin
  select string_agg(tablename || '.' || policyname, ', ' order by tablename, policyname)
    into leftover
    from pg_policies
   where schemaname = 'public';

  if leftover is not null then
    raise exception 'unexpected RLS policies remain in public: %', leftover;
  end if;
end $$;
