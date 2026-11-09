-- 102: Conversation Studio LIVE weekly answer quota becomes PER BRAND.
--
-- Product rule (2026-11-09): one brand / single site may use at most 10 LIVE
-- answers per week, and nothing scans a site on a schedule — scans stay explicit
-- actions only. The cap itself lives in code (STUDIO_LIVE_ANSWERS_PER_BRAND_PER_WEEK)
-- so it cannot drift per deployment; this migration only scopes the counter that
-- enforces it to a brand.
--
-- 080 counted answers per ACCOUNT-week. Studio is a dark-launched preview
-- (FEATURE_CONVERSATION_STUDIO_LIVE defaults to 0, no production enablement is
-- recorded), so any existing counter rows are preview data that cannot be
-- attributed to a brand; they are cleared rather than guessed at.
--
-- A row without client_id can no longer exist, which makes the composite tenant
-- FK the thing that keeps one brand's usage from being charged to another.

delete from studio_live_weekly_usage;

alter table studio_live_weekly_usage drop constraint if exists studio_live_weekly_usage_pkey;
alter table studio_live_weekly_usage add column if not exists client_id uuid;

update studio_live_weekly_usage set client_id = null where client_id is not null;

alter table studio_live_weekly_usage alter column client_id set not null;

alter table studio_live_weekly_usage
  add constraint studio_live_weekly_usage_pkey primary key (account_id, client_id, week_start),
  add constraint studio_live_weekly_usage_client_tenant_fkey
    foreign key (client_id, account_id) references clients (id, account_id) on delete cascade;

comment on table studio_live_weekly_usage is
  'Conversation Studio LIVE answers used per brand (single site) per UTC week; cap is STUDIO_LIVE_ANSWERS_PER_BRAND_PER_WEEK (10).';
