create table if not exists scans (
  id uuid primary key default gen_random_uuid(),
  url text not null,
  domain text not null,
  score numeric(5,2),
  results jsonb not null,
  created_at timestamptz default now()
);

create table if not exists fix_packs (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid references scans(id) on delete cascade,
  llms_txt text,
  robots_patch text,
  faq_schema text,
  created_at timestamptz default now()
);
