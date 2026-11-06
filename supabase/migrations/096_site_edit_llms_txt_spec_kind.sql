-- 096: site-edit S10 — let drafts and frozen versions carry an `llms_txt` edit
-- spec: replace the domain's /llms.txt with approved text
-- (brief: docs/superpowers/plans/2026-11-03-aiso-brief-post6-site-edit.md, S10).
--
-- 095 knew only the JSON-LD kinds and `meta`, so an `llms_txt` spec was refused
-- by the database on draft save and on version submit. This replaces both CHECKs
-- again: the shared floor (object, schemaVersion 1, https target ≤ 2048) and the
-- jsonld / meta clauses are unchanged, and each kind now carries its own size cap:
--   * jsonld / jsonld_remove / meta: 20 KiB of stored spec, as before;
--   * llms_txt: target is exactly https://<host>/llms.txt, `content` is a
--     non-blank string of at most 16 KiB, and the stored spec at most 40 KiB.
--     JSON escaping can roughly double text full of newlines, so 16 KiB of
--     content plus a 2 KiB URL always fits 40 KiB and never fails here as a 503.
-- lib/site-edit/edit-spec.ts stays the full contract (exact key set, LF line
-- endings, NFC, no control characters but tab and newline); this is the
-- database's own floor under it. Constraint-only: every stored spec already passes.

alter table public.evidence_work_items drop constraint evidence_work_items_edit_spec_check;
alter table public.evidence_work_items add constraint evidence_work_items_edit_spec_check check (
  edit_spec is null or ((
    jsonb_typeof(edit_spec) = 'object'
    and edit_spec->'schemaVersion' = '1'::jsonb
    and jsonb_typeof(edit_spec->'targetUrl') = 'string'
    and left(edit_spec->>'targetUrl', 8) = 'https://'
    and char_length(edit_spec->>'targetUrl') <= 2048
    and (
      (
        edit_spec->>'kind' in ('jsonld', 'jsonld_remove')
        and edit_spec->>'schemaType' in ('FAQPage', 'Organization', 'LocalBusiness')
        and jsonb_typeof(edit_spec->'payload') = 'object'
        and edit_spec->'payload'->>'@type' = edit_spec->>'schemaType'
        and octet_length(edit_spec::text) <= 20480
      ) or (
        edit_spec->>'kind' = 'meta'
        and jsonb_typeof(edit_spec->'title') in ('string', 'null')
        and jsonb_typeof(edit_spec->'description') in ('string', 'null')
        and (jsonb_typeof(edit_spec->'title') = 'string' or jsonb_typeof(edit_spec->'description') = 'string')
        and (jsonb_typeof(edit_spec->'title') = 'null'
          or (char_length(edit_spec->>'title') between 1 and 200 and edit_spec->>'title' !~ '[<>]'))
        and (jsonb_typeof(edit_spec->'description') = 'null'
          or (char_length(edit_spec->>'description') between 1 and 500 and edit_spec->>'description' !~ '[<>]'))
        and octet_length(edit_spec::text) <= 20480
      ) or (
        edit_spec->>'kind' = 'llms_txt'
        and edit_spec->>'targetUrl' ~ '^https://[^/?#]+/llms\.txt$'
        and jsonb_typeof(edit_spec->'content') = 'string'
        and char_length(btrim(edit_spec->>'content')) >= 1
        and octet_length(edit_spec->>'content') <= 16384
        and octet_length(edit_spec::text) <= 40960
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
    and (
      (
        content->'editSpec'->>'kind' in ('jsonld', 'jsonld_remove')
        and content->'editSpec'->>'schemaType' in ('FAQPage', 'Organization', 'LocalBusiness')
        and jsonb_typeof(content->'editSpec'->'payload') = 'object'
        and content->'editSpec'->'payload'->>'@type' = content->'editSpec'->>'schemaType'
        and octet_length((content->'editSpec')::text) <= 20480
      ) or (
        content->'editSpec'->>'kind' = 'meta'
        and jsonb_typeof(content->'editSpec'->'title') in ('string', 'null')
        and jsonb_typeof(content->'editSpec'->'description') in ('string', 'null')
        and (jsonb_typeof(content->'editSpec'->'title') = 'string' or jsonb_typeof(content->'editSpec'->'description') = 'string')
        and (jsonb_typeof(content->'editSpec'->'title') = 'null'
          or (char_length(content->'editSpec'->>'title') between 1 and 200 and content->'editSpec'->>'title' !~ '[<>]'))
        and (jsonb_typeof(content->'editSpec'->'description') = 'null'
          or (char_length(content->'editSpec'->>'description') between 1 and 500 and content->'editSpec'->>'description' !~ '[<>]'))
        and octet_length((content->'editSpec')::text) <= 20480
      ) or (
        content->'editSpec'->>'kind' = 'llms_txt'
        and content->'editSpec'->>'targetUrl' ~ '^https://[^/?#]+/llms\.txt$'
        and jsonb_typeof(content->'editSpec'->'content') = 'string'
        and char_length(btrim(content->'editSpec'->>'content')) >= 1
        and octet_length(content->'editSpec'->>'content') <= 16384
        and octet_length((content->'editSpec')::text) <= 40960
      )
    )
  ) is true)
);
