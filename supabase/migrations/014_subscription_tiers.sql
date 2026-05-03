-- Agent subscription tiers

-- 1. Plan features configuration table
create table if not exists plan_features (
  plan                text primary key check (plan in ('basic', 'pro', 'enterprise')),
  platform_access     text[] not null default '{}',
  agent_recs          boolean not null default true,
  agent_progress      boolean not null default false,
  agent_competitors   boolean not null default false,
  alerts              boolean not null default false,
  csv_export          boolean not null default false,
  max_brands          smallint not null default 1,
  history_weeks       smallint not null default 4,
  edit_prompts        boolean not null default false
);

-- Seed data
insert into plan_features (plan, platform_access, agent_recs, agent_progress, agent_competitors, alerts, csv_export, max_brands, history_weeks, edit_prompts) values
  ('basic',      '{gemini}',                                        true,  false, false, false, false, 1,  4,   false),
  ('pro',        '{gemini,gpt4o,claude,perplexity-s,perplexity-p}', true,  true,  false, true,  false, 3,  26,  true),
  ('enterprise', '{gemini,gpt4o,claude,perplexity-s,perplexity-p}', true,  true,  true,  true,  true,  10, 999, true)
on conflict (plan) do update set
  platform_access   = excluded.platform_access,
  agent_recs        = excluded.agent_recs,
  agent_progress    = excluded.agent_progress,
  agent_competitors = excluded.agent_competitors,
  alerts            = excluded.alerts,
  csv_export        = excluded.csv_export,
  max_brands        = excluded.max_brands,
  history_weeks     = excluded.history_weeks,
  edit_prompts      = excluded.edit_prompts;

-- 2. Rename starter → basic on accounts
update accounts set plan = 'basic' where plan = 'starter';

-- 3. Update plan constraint
alter table accounts drop constraint if exists accounts_plan_check;
alter table accounts add constraint accounts_plan_check check (plan in ('basic', 'pro', 'enterprise'));

-- 4. Add agent_platforms to scans
alter table scans add column if not exists agent_platforms text[] default null;
