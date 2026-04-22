create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  brand_name text not null,
  industry text,
  competitors text[],
  status text default 'active',
  created_at timestamptz default now()
);

create table if not exists prompt_bank (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  category text,
  question text not null,
  language text default 'zh-HK',
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists pulse_metrics (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id),
  prompt_id uuid references prompt_bank(id),
  platform text not null,
  question text not null,
  raw_answer text,
  brand_mentioned boolean,
  sentiment text,
  mention_position int,
  competitors_mentioned text[],
  scan_week date not null,
  created_at timestamptz default now()
);

create table if not exists pulse_weekly_summary (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id),
  scan_week date not null,
  platform text,
  total_queries int,
  brand_mentions int,
  sov_score numeric(5,2),
  avg_sentiment_score numeric(3,2),
  top_competitors jsonb,
  created_at timestamptz default now()
);
