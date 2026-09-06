-- Private organizational drafts. Source evidence is snapshotted and intentionally
-- has no foreign key to replaceable source rows.
create table public.evidence_work_items (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  client_id uuid not null,
  opportunity_key text not null check (char_length(opportunity_key) between 1 and 512),
  source_kind text not null check (source_kind in ('pulse-metric', 'scan-check', 'agent-recommendation')),
  source_id uuid not null,
  rule_version text not null check (char_length(rule_version) between 1 and 120),
  check_key text check (check_key is null or check_key in (
    'c1_robots', 'c2_llms_txt', 'c3_bot_access', 'c4_structured_data', 'c5_extractability',
    'c6_llms_full_txt', 'c7_mcp_card', 'c8_sitemap', 'c9_meta_desc', 'c10_headings',
    'c11_faq', 'c12_canonical', 'c13_render', 'c14_internal_links', 'c15_entity',
    'c16_freshness', 'c17_citation_density', 'c18_factual_density', 'c19_topical_authority', 'c20_chunkability'
  )),
  evidence_fingerprint text not null check (evidence_fingerprint ~ '^[0-9a-f]{64}$'),
  evidence_snapshot jsonb not null,
  status text not null default 'draft' check (status = 'draft'),
  title text not null,
  action text not null,
  notes text not null default '',
  locale text not null check (locale in ('en', 'zh-HK')),
  revision integer not null default 1 check (revision > 0),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint evidence_work_items_owned_client_fk foreign key (client_id, account_id) references public.clients (id, account_id) on delete cascade,
  constraint evidence_work_items_created_actor_fk foreign key (created_by, account_id) references public.profiles (id, account_id) on delete set null (created_by),
  constraint evidence_work_items_updated_actor_fk foreign key (updated_by, account_id) references public.profiles (id, account_id) on delete set null (updated_by),
  constraint evidence_work_items_source_check_key_check check (
    (source_kind = 'scan-check' and check_key is not null)
    or (source_kind <> 'scan-check' and check_key is null)
  ),
  constraint evidence_work_items_rule_source_check check (
    (source_kind = 'pulse-metric' and rule_version = 'pulse-brand-absent.v1' and check_key is null)
    or (source_kind = 'scan-check' and rule_version = 'scan-check-gap.v1' and check_key is not null)
    or (source_kind = 'agent-recommendation' and rule_version = 'stored-recommendation.v1' and check_key is null)
  ),
  constraint evidence_work_items_snapshot_object_check check (jsonb_typeof(evidence_snapshot) = 'object'),
  constraint evidence_work_items_snapshot_size_check check (octet_length(evidence_snapshot::text) <= 65536),
  constraint evidence_work_items_title_check check (char_length(btrim(title)) between 1 and 160),
  constraint evidence_work_items_action_check check (char_length(btrim(action)) between 1 and 4000),
  constraint evidence_work_items_notes_check check (char_length(notes) <= 8000),
  unique (account_id, client_id, opportunity_key)
);
create index evidence_work_items_account_client_created_idx
  on public.evidence_work_items (account_id, client_id, created_at desc, id desc);
-- 037's default privileges include DELETE: narrow those explicitly.
revoke all on public.evidence_work_items from public;
do $$
begin
  if to_regrole('aeo_app') is not null then
    revoke all on public.evidence_work_items from aeo_app;
    grant select, insert, update on public.evidence_work_items to aeo_app;
  end if;
end $$;
