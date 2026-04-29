-- ── Authority Engine ─────────────────────────────────────────────
create table if not exists authority_scores (
  id            uuid primary key default gen_random_uuid(),
  domain        text not null,
  industry      text not null,
  region        text not null,
  final_score   numeric(4,2) not null,
  tier          text not null check (tier in ('tier1','tier2','tier3','other')),
  category      text not null,
  breakdown     jsonb not null default '{}',
  computed_at   timestamptz default now(),
  expires_at    timestamptz default now() + interval '7 days',
  unique (domain, industry, region)
);

create table if not exists domain_signals (
  domain        text primary key,
  signals       jsonb not null default '{}',
  signal_score  numeric(4,2) not null default 0,
  fetched_at    timestamptz default now(),
  expires_at    timestamptz default now() + interval '30 days'
);

create table if not exists industry_packs (
  code             text primary key,
  display_name     text not null,
  multiplier       numeric(3,2) not null default 1.0,
  authority_domains jsonb not null default '{}',
  topical_keywords text[] not null default '{}',
  updated_at       timestamptz default now()
);

create table if not exists regional_packs (
  code         text primary key,
  display_name text not null,
  tiers        jsonb not null default '{}',
  updated_at   timestamptz default now()
);

create table if not exists authority_overrides (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid references clients(id) on delete cascade,
  domain        text not null,
  override_tier text check (override_tier in ('tier1','tier2','tier3','other','blacklist')),
  override_score numeric(4,2),
  reason        text,
  created_at    timestamptz default now()
);

-- ── Shared Citation Log (GEO Pulse → Authority L5) ──────────────
create table if not exists ai_citation_log (
  id              uuid primary key default gen_random_uuid(),
  pulse_run_id    uuid,
  client_id       uuid references clients(id) on delete set null,
  cited_url       text not null,
  cited_domain    text not null,
  platform        text not null check (platform in
    ('perplexity_sonar','perplexity_sonar_pro','chatgpt','claude','gemini','google_aio')),
  prompt_industry text,
  prompt_region   text,
  prompt_topic    text,
  prompt_text     text,
  cited_at        timestamptz default now()
);
create index if not exists idx_citation_domain_industry
  on ai_citation_log (cited_domain, prompt_industry);
create index if not exists idx_citation_recent
  on ai_citation_log (cited_at desc);
create index if not exists idx_citation_industry_recent
  on ai_citation_log (prompt_industry, cited_at desc);

-- ── GEO Tables ───────────────────────────────────────────────────
create table if not exists topical_clusters (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid not null references clients(id) on delete cascade,
  topic               text not null,
  pillar_page_url     text,
  cluster_articles    jsonb not null default '[]',
  completeness_score  numeric(4,2),
  detected_at         timestamptz default now()
);

create table if not exists chunk_analysis (
  id                  uuid primary key default gen_random_uuid(),
  scan_id             uuid not null references scans(id) on delete cascade,
  page_url            text not null,
  chunks              jsonb not null default '[]',
  avg_extractability  numeric(4,2),
  analyzed_at         timestamptz default now()
);

create table if not exists content_briefs (
  id                       uuid primary key default gen_random_uuid(),
  client_id                uuid not null references clients(id) on delete cascade,
  target_topic             text not null,
  brief_markdown           text not null,
  recommended_authorities  jsonb,
  created_at               timestamptz default now()
);

-- ── Extend existing tables ───────────────────────────────────────
alter table fix_packs
  add column if not exists geo_content_brief text,
  add column if not exists chunk_rewriter     text,
  add column if not exists cluster_map        text;

alter table scans
  add column if not exists industry text,
  add column if not exists region   text,
  add column if not exists grade    text;

-- ── RLS ──────────────────────────────────────────────────────────
alter table authority_scores    enable row level security;
alter table domain_signals      enable row level security;
alter table industry_packs      enable row level security;
alter table regional_packs      enable row level security;
alter table authority_overrides enable row level security;
alter table ai_citation_log     enable row level security;
alter table topical_clusters    enable row level security;
alter table chunk_analysis      enable row level security;
alter table content_briefs      enable row level security;

create policy "industry_packs_public_read"   on industry_packs   for select using (true);
create policy "regional_packs_public_read"   on regional_packs   for select using (true);
create policy "authority_scores_public_read" on authority_scores for select using (true);
create policy "domain_signals_public_read"   on domain_signals   for select using (true);

create policy "authority_overrides_own_client" on authority_overrides for all using (
  client_id in (select id from clients where account_id = (select account_id from profiles where id = auth.uid()))
);
create policy "ai_citation_log_own_client" on ai_citation_log for all using (
  client_id in (select id from clients where account_id = (select account_id from profiles where id = auth.uid()))
);
create policy "topical_clusters_own_client" on topical_clusters for all using (
  client_id in (select id from clients where account_id = (select account_id from profiles where id = auth.uid()))
);
create policy "chunk_analysis_own_scan" on chunk_analysis for all using (
  scan_id in (select id from scans where account_id = (select account_id from profiles where id = auth.uid()))
);
create policy "content_briefs_own_client" on content_briefs for all using (
  client_id in (select id from clients where account_id = (select account_id from profiles where id = auth.uid()))
);
