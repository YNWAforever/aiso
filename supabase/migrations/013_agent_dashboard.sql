-- Agent-powered dashboard tables

-- 1. Agent recommendations — per-platform, per-check fix suggestions
create table if not exists agent_recommendations (
  id            uuid primary key default gen_random_uuid(),
  scan_id       uuid not null references scans(id) on delete cascade,
  platform      text not null,
  category      text not null,
  priority      text not null check (priority in ('high', 'medium', 'low')),
  recommendation text not null,
  impact_score  smallint not null check (impact_score >= 1 and impact_score <= 10),
  created_at    timestamptz default now(),
  unique (scan_id, platform, category)
);

-- 2. Agent progress — before/after metric snapshots
create table if not exists agent_progress (
  id             uuid primary key default gen_random_uuid(),
  scan_id        uuid not null references scans(id) on delete cascade,
  platform       text not null,
  metric         text not null,
  current_value  numeric not null,
  previous_value numeric,
  delta          numeric,
  created_at     timestamptz default now(),
  unique (scan_id, platform, metric)
);

-- 3. Agent competitors — per-platform competitor gap analysis
create table if not exists agent_competitors (
  id                uuid primary key default gen_random_uuid(),
  scan_id           uuid not null references scans(id) on delete cascade,
  platform          text not null,
  competitor_domain text not null,
  competitor_name   text,
  mention_rate      numeric not null check (mention_rate >= 0 and mention_rate <= 100),
  your_rate         numeric not null check (your_rate >= 0 and your_rate <= 100),
  gap_analysis      text not null,
  created_at        timestamptz default now(),
  unique (scan_id, platform, competitor_domain)
);

-- Add agent tracking to scans
alter table scans add column if not exists agent_status text default null
  check (agent_status is null or agent_status in ('pending', 'running', 'complete', 'error'));

-- Add webhook URL to clients
alter table clients add column if not exists webhook_url text default null;
