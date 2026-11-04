-- 093: site-edit S5 — let drafts and frozen versions carry a revert spec
-- (brief: docs/superpowers/plans/2026-11-03-aiso-brief-post6-site-edit.md, §3 step 5).
--
-- 086 pinned the stored spec's kind to 'jsonld', so a `jsonld_remove` revert
-- (S5) was refused by the database on draft save and on version submit. This
-- replaces both CHECKs with the same floor plus the one new kind; every other
-- clause is unchanged. Which removals are allowed (only a block an approved
-- version of the same item added) stays an application rule checked at save
-- and again at submit (lib/site-edit/revert.ts).

alter table public.evidence_work_items drop constraint evidence_work_items_edit_spec_check;
alter table public.evidence_work_items add constraint evidence_work_items_edit_spec_check check (
  edit_spec is null or ((
    jsonb_typeof(edit_spec) = 'object'
    and edit_spec->'schemaVersion' = '1'::jsonb
    and edit_spec->>'kind' in ('jsonld', 'jsonld_remove')
    and jsonb_typeof(edit_spec->'targetUrl') = 'string'
    and left(edit_spec->>'targetUrl', 8) = 'https://'
    and char_length(edit_spec->>'targetUrl') <= 2048
    and edit_spec->>'schemaType' in ('FAQPage', 'Organization', 'LocalBusiness')
    and jsonb_typeof(edit_spec->'payload') = 'object'
    and edit_spec->'payload'->>'@type' = edit_spec->>'schemaType'
    and octet_length(edit_spec::text) <= 20480
  ) is true)
);

alter table public.work_item_versions drop constraint work_item_versions_edit_spec_check;
alter table public.work_item_versions add constraint work_item_versions_edit_spec_check check (
  not (content ? 'editSpec') or ((
    jsonb_typeof(content->'editSpec') = 'object'
    and content->'editSpec'->'schemaVersion' = '1'::jsonb
    and content->'editSpec'->>'kind' in ('jsonld', 'jsonld_remove')
    and jsonb_typeof(content->'editSpec'->'targetUrl') = 'string'
    and left(content->'editSpec'->>'targetUrl', 8) = 'https://'
    and char_length(content->'editSpec'->>'targetUrl') <= 2048
    and content->'editSpec'->>'schemaType' in ('FAQPage', 'Organization', 'LocalBusiness')
    and jsonb_typeof(content->'editSpec'->'payload') = 'object'
    and content->'editSpec'->'payload'->>'@type' = content->'editSpec'->>'schemaType'
    and octet_length((content->'editSpec')::text) <= 20480
  ) is true)
);
