-- AC-06's task half: a work item holds more than one source, so a website
-- finding and a question opportunity can be one approvable piece of work.
--
-- EXPAND HALF. evidence_work_items keeps its seven source columns; 052 drops
-- them once this code has run in production. Dropping a column is
-- irreversible, and lib/change-sets/store.ts reads d.evidence_snapshot and
-- d.source_kind directly, so a single-step change would need schema and code to
-- switch in the same instant with a restore as the only recovery.
create table public.work_item_sources (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  client_id uuid not null,
  work_item_id uuid not null,
  -- Identity of the opportunity, moved from evidence_work_items unchanged. It
  -- belongs to the source, not to the piece of work: what an item IS must not
  -- be decided by one of its inputs.
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
  attached_by uuid,
  attached_at timestamptz not null default now(),
  -- Withdrawn, never deleted (the 044 pattern). Without this a mis-attachment
  -- would occupy its opportunity key forever: aeo_app has no DELETE here.
  withdrawn_at timestamptz,
  withdrawn_by uuid,
  constraint work_item_sources_owned_item_fk
    foreign key (account_id, client_id, work_item_id)
      references public.evidence_work_items (account_id, client_id, id) on delete cascade,
  constraint work_item_sources_attached_actor_fk
    foreign key (attached_by, account_id) references public.profiles (id, account_id) on delete set null (attached_by),
  -- Moved from 041 verbatim. One source per row now, same rule.
  constraint work_item_sources_source_check_key_check check (
    (source_kind = 'scan-check' and check_key is not null)
    or (source_kind <> 'scan-check' and check_key is null)
  ),
  constraint work_item_sources_rule_source_check check (
    (source_kind = 'pulse-metric' and rule_version = 'pulse-brand-absent.v1' and check_key is null)
    or (source_kind = 'scan-check' and rule_version = 'scan-check-gap.v1' and check_key is not null)
    or (source_kind = 'agent-recommendation' and rule_version = 'stored-recommendation.v1' and check_key is null)
  ),
  constraint work_item_sources_snapshot_object_check check (jsonb_typeof(evidence_snapshot) = 'object'),
  constraint work_item_sources_snapshot_size_check check (octet_length(evidence_snapshot::text) <= 65536),
  -- One fact recorded two ways; neither half may stand alone.
  constraint work_item_sources_withdrawal_check check ((withdrawn_at is null) = (withdrawn_by is null)),
  -- The same source cannot be attached to one item twice.
  unique (account_id, client_id, work_item_id, source_kind, source_id)
);

-- Backfill: exactly one source per existing item, from the columns 052 removes.
insert into public.work_item_sources (
  account_id, client_id, work_item_id, opportunity_key,
  source_kind, source_id, rule_version, check_key,
  evidence_fingerprint, evidence_snapshot, attached_by, attached_at
)
select d.account_id, d.client_id, d.id, d.opportunity_key,
  d.source_kind, d.source_id, d.rule_version, d.check_key,
  d.evidence_fingerprint, d.evidence_snapshot, d.created_by, d.created_at
from public.evidence_work_items d;

-- An opportunity is claimed by at most one LIVE source. 041's unique was on the
-- item; this says the same thing in the place the source now lives, and lets a
-- withdrawn row release its claim.
create unique index work_item_sources_live_opportunity_idx
  on public.work_item_sources (account_id, client_id, opportunity_key)
  where withdrawn_at is null;

create index work_item_sources_item_idx
  on public.work_item_sources (account_id, client_id, work_item_id, opportunity_key);

-- 042's work_item_versions_content_check validated a single evidenceSnapshot
-- object because a version could only ever carry one. A work item can now hold
-- several sources, so a version needs to be able to carry all of them --
-- schemaVersion 2 introduces a plural evidenceSnapshots array alongside,
-- never replacing, schemaVersion 1's singular evidenceSnapshot, so every
-- version ever written under 042 stays valid unchanged.
--
-- Every clause below is reproduced from the live 042 definition, verified with
-- `grep -n -A 25 work_item_versions_content_check supabase/migrations/042_change_set_approvals.sql`
-- immediately before writing this file, not retyped from memory. Four of them
-- -- the evidenceSnapshot object-type check, its nested schemaVersion check,
-- its source-kind check, and its size cap -- move inside a new
-- schemaVersion = 1 branch instead of staying unconditional top-level ANDs.
-- content->'evidenceSnapshot' is SQL NULL on a schemaVersion 2 row (which
-- carries evidenceSnapshots instead), and NULL propagates through AND to
-- NULL, which the trailing `is true` treats as false -- so leaving those four
-- clauses unconditional would make schemaVersion 2 permanently unsatisfiable
-- and defeat the entire point of this migration. Relocating them, not
-- deleting or loosening them, is what keeps schemaVersion 1 exactly as strict
-- as 042 left it while actually admitting 2.
alter table public.work_item_versions drop constraint work_item_versions_content_check;
alter table public.work_item_versions add constraint work_item_versions_content_check check ((
  jsonb_typeof(content) = 'object'
  and content->'schemaVersion' in ('1'::jsonb, '2'::jsonb)
  and content->>'workItemId' = work_item_id::text
  and content->'draftRevision' = to_jsonb(draft_revision)
  and jsonb_typeof(content->'title') = 'string'
  and char_length(btrim(content->>'title')) between 1 and 160
  and jsonb_typeof(content->'action') = 'string'
  and char_length(btrim(content->>'action')) between 1 and 4000
  and jsonb_typeof(content->'notes') = 'string'
  and char_length(content->>'notes') <= 8000
  and content->>'locale' in ('en', 'zh-HK')
  and (
    (
      content->'schemaVersion' = '1'::jsonb
      and jsonb_typeof(content->'evidenceSnapshot') = 'object'
      and content->'evidenceSnapshot'->'schemaVersion' = '1'::jsonb
      and content->'evidenceSnapshot'->'source'->>'kind' in ('pulse-metric', 'scan-check')
      and octet_length((content->'evidenceSnapshot')::text) <= 65536
    )
    or (
      content->'schemaVersion' = '2'::jsonb
      and jsonb_typeof(content->'evidenceSnapshots') = 'array'
      and jsonb_array_length(content->'evidenceSnapshots') >= 1
    )
  )
  and octet_length(content::text) <= 131072
) is true);

-- 037's default privileges include DELETE: narrow those explicitly. Update
-- exists only so a source can be withdrawn; snapshots are never edited.
revoke all on public.work_item_sources from public;
do $$
begin
  if to_regrole('aeo_app') is not null then
    revoke all on public.work_item_sources from aeo_app;
    grant select, insert, update on public.work_item_sources to aeo_app;
  end if;
end $$;
