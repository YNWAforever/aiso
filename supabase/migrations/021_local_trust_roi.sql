-- Local Trust ROI

alter table plan_features add column if not exists local_trust_roi boolean not null default false;
alter table plan_features add column if not exists local_trust_competitors boolean not null default false;
alter table plan_features add column if not exists local_trust_export boolean not null default false;

update plan_features set
  local_trust_roi = false,
  local_trust_competitors = false,
  local_trust_export = false
where plan = 'basic';

update plan_features set
  local_trust_roi = true,
  local_trust_competitors = false,
  local_trust_export = false
where plan = 'pro';

update plan_features set
  local_trust_roi = true,
  local_trust_competitors = true,
  local_trust_export = true
where plan = 'enterprise';

create table if not exists local_trust_profiles (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  primary_services text[] not null default '{}',
  service_area text,
  average_lead_value numeric,
  close_rate numeric check (close_rate is null or (close_rate >= 0 and close_rate <= 1)),
  competitors text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id)
);

create table if not exists local_trust_snapshots (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  snapshot_month date not null,
  local_trust_score numeric not null check (local_trust_score >= 0 and local_trust_score <= 100),
  bucket_scores jsonb not null default '[]'::jsonb,
  trust_gaps jsonb not null default '[]'::jsonb,
  roi_estimate jsonb,
  source_scan_id uuid references scans(id) on delete set null,
  source_pulse_week date,
  created_at timestamptz not null default now(),
  unique (client_id, snapshot_month)
);

create table if not exists local_trust_actions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  snapshot_id uuid not null references local_trust_snapshots(id) on delete cascade,
  stable_key text not null,
  title text not null,
  bucket text not null check (bucket in ('local_visibility', 'proof_depth', 'ai_answer_readiness', 'market_authority')),
  impact text not null check (impact in ('low', 'medium', 'high')),
  effort text not null check (effort in ('low', 'medium', 'high')),
  status text not null default 'open' check (status in ('open', 'planned', 'done', 'skipped')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (snapshot_id, stable_key)
);

create index if not exists local_trust_profiles_account_idx on local_trust_profiles(account_id);
create index if not exists local_trust_snapshots_client_month_idx on local_trust_snapshots(client_id, snapshot_month desc);
create index if not exists local_trust_actions_snapshot_idx on local_trust_actions(snapshot_id);

alter table local_trust_profiles enable row level security;
alter table local_trust_snapshots enable row level security;
alter table local_trust_actions enable row level security;

drop policy if exists "local_trust_profiles_select_own" on local_trust_profiles;
create policy "local_trust_profiles_select_own" on local_trust_profiles
  for select using (account_id in (select account_id from profiles where id = auth.uid()));

drop policy if exists "local_trust_profiles_insert_own" on local_trust_profiles;
create policy "local_trust_profiles_insert_own" on local_trust_profiles
  for insert with check (account_id in (select account_id from profiles where id = auth.uid()));

drop policy if exists "local_trust_profiles_update_own" on local_trust_profiles;
create policy "local_trust_profiles_update_own" on local_trust_profiles
  for update using (account_id in (select account_id from profiles where id = auth.uid()));

drop policy if exists "local_trust_snapshots_select_own" on local_trust_snapshots;
create policy "local_trust_snapshots_select_own" on local_trust_snapshots
  for select using (account_id in (select account_id from profiles where id = auth.uid()));

drop policy if exists "local_trust_snapshots_insert_own" on local_trust_snapshots;
create policy "local_trust_snapshots_insert_own" on local_trust_snapshots
  for insert with check (account_id in (select account_id from profiles where id = auth.uid()));

drop policy if exists "local_trust_snapshots_update_own" on local_trust_snapshots;
create policy "local_trust_snapshots_update_own" on local_trust_snapshots
  for update using (account_id in (select account_id from profiles where id = auth.uid()));

drop policy if exists "local_trust_actions_select_own" on local_trust_actions;
create policy "local_trust_actions_select_own" on local_trust_actions
  for select using (
    exists (
      select 1 from local_trust_snapshots s
      join profiles p on p.account_id = s.account_id
      where s.id = local_trust_actions.snapshot_id and p.id = auth.uid()
    )
  );

drop policy if exists "local_trust_actions_insert_own" on local_trust_actions;
create policy "local_trust_actions_insert_own" on local_trust_actions
  for insert with check (
    exists (
      select 1 from local_trust_snapshots s
      join profiles p on p.account_id = s.account_id
      where s.id = local_trust_actions.snapshot_id and p.id = auth.uid()
    )
  );

drop policy if exists "local_trust_actions_update_own" on local_trust_actions;
create policy "local_trust_actions_update_own" on local_trust_actions
  for update using (
    exists (
      select 1 from local_trust_snapshots s
      join profiles p on p.account_id = s.account_id
      where s.id = local_trust_actions.snapshot_id and p.id = auth.uid()
    )
  );
