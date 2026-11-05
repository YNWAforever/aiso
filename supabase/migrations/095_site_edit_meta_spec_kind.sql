-- 095: site-edit S9 — let drafts and frozen versions carry a `meta` edit spec:
-- the page's <title> and/or <meta name="description">
-- (brief: docs/superpowers/plans/2026-11-03-aiso-brief-post6-site-edit.md, S9).
--
-- 086/093 required `schemaType` and a JSON-LD `payload` on every stored spec,
-- so a `meta` spec was refused by the database on draft save and on version
-- submit. This replaces both CHECKs with the same shared floor (object,
-- schemaVersion 1, https target ≤ 2048, ≤ 20 KiB) and a per-kind clause:
--   * jsonld / jsonld_remove: exactly 093's clauses, unchanged;
--   * meta: `title` and `description` are each a string or JSON null, at least
--     one is a string, within 1–200 / 1–500 characters, with no `<` or `>`.
-- lib/site-edit/edit-spec.ts stays the full contract (exact key set, trimming,
-- NFC, no control characters); this is the database's own floor under it.
-- Constraint-only: no table, no data change, every stored spec already passes.

alter table public.evidence_work_items drop constraint evidence_work_items_edit_spec_check;
alter table public.evidence_work_items add constraint evidence_work_items_edit_spec_check check (
  edit_spec is null or ((
    jsonb_typeof(edit_spec) = 'object'
    and edit_spec->'schemaVersion' = '1'::jsonb
    and jsonb_typeof(edit_spec->'targetUrl') = 'string'
    and left(edit_spec->>'targetUrl', 8) = 'https://'
    and char_length(edit_spec->>'targetUrl') <= 2048
    and octet_length(edit_spec::text) <= 20480
    and (
      (
        edit_spec->>'kind' in ('jsonld', 'jsonld_remove')
        and edit_spec->>'schemaType' in ('FAQPage', 'Organization', 'LocalBusiness')
        and jsonb_typeof(edit_spec->'payload') = 'object'
        and edit_spec->'payload'->>'@type' = edit_spec->>'schemaType'
      ) or (
        edit_spec->>'kind' = 'meta'
        and jsonb_typeof(edit_spec->'title') in ('string', 'null')
        and jsonb_typeof(edit_spec->'description') in ('string', 'null')
        and (jsonb_typeof(edit_spec->'title') = 'string' or jsonb_typeof(edit_spec->'description') = 'string')
        and (jsonb_typeof(edit_spec->'title') = 'null'
          or (char_length(edit_spec->>'title') between 1 and 200 and edit_spec->>'title' !~ '[<>]'))
        and (jsonb_typeof(edit_spec->'description') = 'null'
          or (char_length(edit_spec->>'description') between 1 and 500 and edit_spec->>'description' !~ '[<>]'))
      )
    )
  ) is true)
);

alter table public.work_item_versions drop constraint work_item_versions_edit_spec_check;
alter table public.work_item_versions add constraint work_item_versions_edit_spec_check check (
  not (content ? 'editSpec') or ((
    jsonb_typeof(content->'editSpec') = 'object'
    and content->'editSpec'->'schemaVersion' = '1'::jsonb
    and jsonb_typeof(content->'editSpec'->'targetUrl') = 'string'
    and left(content->'editSpec'->>'targetUrl', 8) = 'https://'
    and char_length(content->'editSpec'->>'targetUrl') <= 2048
    and octet_length((content->'editSpec')::text) <= 20480
    and (
      (
        content->'editSpec'->>'kind' in ('jsonld', 'jsonld_remove')
        and content->'editSpec'->>'schemaType' in ('FAQPage', 'Organization', 'LocalBusiness')
        and jsonb_typeof(content->'editSpec'->'payload') = 'object'
        and content->'editSpec'->'payload'->>'@type' = content->'editSpec'->>'schemaType'
      ) or (
        content->'editSpec'->>'kind' = 'meta'
        and jsonb_typeof(content->'editSpec'->'title') in ('string', 'null')
        and jsonb_typeof(content->'editSpec'->'description') in ('string', 'null')
        and (jsonb_typeof(content->'editSpec'->'title') = 'string' or jsonb_typeof(content->'editSpec'->'description') = 'string')
        and (jsonb_typeof(content->'editSpec'->'title') = 'null'
          or (char_length(content->'editSpec'->>'title') between 1 and 200 and content->'editSpec'->>'title' !~ '[<>]'))
        and (jsonb_typeof(content->'editSpec'->'description') = 'null'
          or (char_length(content->'editSpec'->>'description') between 1 and 500 and content->'editSpec'->>'description' !~ '[<>]'))
      )
    )
  ) is true)
);
