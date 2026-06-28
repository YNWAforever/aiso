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

alter table clients add constraint clients_id_account_id_unique unique (id, account_id);

create table if not exists local_trust_profiles (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  account_id uuid not null references accounts(id) on delete cascade,
  primary_services text[] not null default '{}',
  service_area text,
  average_lead_value numeric check (average_lead_value is null or average_lead_value >= 0),
  close_rate numeric check (close_rate is null or (close_rate >= 0 and close_rate <= 1)),
  competitors text[] not null default '{}',
  -- App routes set updated_at explicitly when owner-maintained fields change.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (client_id, account_id) references clients(id, account_id) on delete cascade,
  unique (client_id)
);

create table if not exists local_trust_snapshots (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  account_id uuid not null references accounts(id) on delete cascade,
  snapshot_month date not null,
  local_trust_score numeric not null check (local_trust_score >= 0 and local_trust_score <= 100),
  bucket_scores jsonb not null default '[]'::jsonb,
  trust_gaps jsonb not null default '[]'::jsonb,
  roi_estimate jsonb,
  source_scan_id uuid references scans(id) on delete set null,
  source_pulse_week date,
  created_at timestamptz not null default now(),
  foreign key (client_id, account_id) references clients(id, account_id) on delete cascade,
  unique (id, client_id),
  unique (client_id, snapshot_month)
);

create table if not exists local_trust_actions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  snapshot_id uuid not null,
  stable_key text not null,
  title text not null,
  bucket text not null check (bucket in ('local_visibility', 'proof_depth', 'ai_answer_readiness', 'market_authority')),
  impact text not null check (impact in ('low', 'medium', 'high')),
  effort text not null check (effort in ('low', 'medium', 'high')),
  status text not null default 'open' check (status in ('open', 'planned', 'done', 'skipped')),
  -- App routes set updated_at explicitly when action status changes.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (snapshot_id, client_id) references local_trust_snapshots(id, client_id) on delete cascade,
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
  for select using (
    exists (
      select 1 from clients c
      join profiles p on p.account_id = c.account_id
      where c.id = local_trust_profiles.client_id
        and c.account_id = local_trust_profiles.account_id
        and p.id = auth.uid()
    )
  );

drop policy if exists "local_trust_profiles_insert_own" on local_trust_profiles;
create policy "local_trust_profiles_insert_own" on local_trust_profiles
  for insert with check (
    exists (
      select 1 from clients c
      join profiles p on p.account_id = c.account_id
      where c.id = local_trust_profiles.client_id
        and c.account_id = local_trust_profiles.account_id
        and p.id = auth.uid()
    )
  );

drop policy if exists "local_trust_profiles_update_own" on local_trust_profiles;
create policy "local_trust_profiles_update_own" on local_trust_profiles
  for update using (
    exists (
      select 1 from clients c
      join profiles p on p.account_id = c.account_id
      where c.id = local_trust_profiles.client_id
        and c.account_id = local_trust_profiles.account_id
        and p.id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from clients c
      join profiles p on p.account_id = c.account_id
      where c.id = local_trust_profiles.client_id
        and c.account_id = local_trust_profiles.account_id
        and p.id = auth.uid()
    )
  );

drop policy if exists "local_trust_snapshots_select_own" on local_trust_snapshots;
create policy "local_trust_snapshots_select_own" on local_trust_snapshots
  for select using (
    exists (
      select 1 from clients c
      join profiles p on p.account_id = c.account_id
      where c.id = local_trust_snapshots.client_id
        and c.account_id = local_trust_snapshots.account_id
        and p.id = auth.uid()
    )
  );

drop policy if exists "local_trust_snapshots_insert_own" on local_trust_snapshots;
create policy "local_trust_snapshots_insert_own" on local_trust_snapshots
  for insert with check (
    exists (
      select 1 from clients c
      join profiles p on p.account_id = c.account_id
      where c.id = local_trust_snapshots.client_id
        and c.account_id = local_trust_snapshots.account_id
        and p.id = auth.uid()
    )
  );

drop policy if exists "local_trust_snapshots_update_own" on local_trust_snapshots;
create policy "local_trust_snapshots_update_own" on local_trust_snapshots
  for update using (
    exists (
      select 1 from clients c
      join profiles p on p.account_id = c.account_id
      where c.id = local_trust_snapshots.client_id
        and c.account_id = local_trust_snapshots.account_id
        and p.id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from clients c
      join profiles p on p.account_id = c.account_id
      where c.id = local_trust_snapshots.client_id
        and c.account_id = local_trust_snapshots.account_id
        and p.id = auth.uid()
    )
  );

drop policy if exists "local_trust_actions_select_own" on local_trust_actions;
create policy "local_trust_actions_select_own" on local_trust_actions
  for select using (
    exists (
      select 1 from local_trust_snapshots s
      join profiles p on p.account_id = s.account_id
      where s.id = local_trust_actions.snapshot_id
        and s.client_id = local_trust_actions.client_id
        and p.id = auth.uid()
    )
  );

drop policy if exists "local_trust_actions_insert_own" on local_trust_actions;
create policy "local_trust_actions_insert_own" on local_trust_actions
  for insert with check (
    exists (
      select 1 from local_trust_snapshots s
      join profiles p on p.account_id = s.account_id
      where s.id = local_trust_actions.snapshot_id
        and s.client_id = local_trust_actions.client_id
        and p.id = auth.uid()
    )
  );

drop policy if exists "local_trust_actions_update_own" on local_trust_actions;
create policy "local_trust_actions_update_own" on local_trust_actions
  for update using (
    exists (
      select 1 from local_trust_snapshots s
      join profiles p on p.account_id = s.account_id
      where s.id = local_trust_actions.snapshot_id
        and s.client_id = local_trust_actions.client_id
        and p.id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from local_trust_snapshots s
      join profiles p on p.account_id = s.account_id
      where s.id = local_trust_actions.snapshot_id
        and s.client_id = local_trust_actions.client_id
        and p.id = auth.uid()
    )
  );
