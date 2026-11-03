-- 086: site-edit S1 — a structured JSON-LD edit spec on a work-item draft,
-- frozen into its C9d review version so approval covers exactly what an
-- executor will apply (brief: docs/superpowers/plans/2026-11-03-aiso-brief-post6-site-edit.md;
-- option E executor hand-off; JSON-LD first). Nothing here contacts a site.
--
-- Numbered 086 deliberately: 085 (studio_drive_exports) is authored on an
-- open PR; scripts/migrate.ts applies whatever the ledger lacks in filename
-- order, so the two land independently.

alter table public.evidence_work_items add column if not exists edit_spec jsonb;

-- Shape at rest. lib/site-edit/edit-spec.ts is the full contract (strict keys,
-- https target, schema.org context, @type = schemaType, depth/node bounds,
-- markup breakout refusal); this is the database's own floor under it.
alter table public.evidence_work_items add constraint evidence_work_items_edit_spec_check check (
  edit_spec is null or ((
    jsonb_typeof(edit_spec) = 'object'
    and edit_spec->'schemaVersion' = '1'::jsonb
    and edit_spec->>'kind' = 'jsonld'
    and jsonb_typeof(edit_spec->'targetUrl') = 'string'
    and left(edit_spec->>'targetUrl', 8) = 'https://'
    and char_length(edit_spec->>'targetUrl') <= 2048
    and edit_spec->>'schemaType' in ('FAQPage', 'Organization', 'LocalBusiness')
    and jsonb_typeof(edit_spec->'payload') = 'object'
    and edit_spec->'payload'->>'@type' = edit_spec->>'schemaType'
    and octet_length(edit_spec::text) <= 20480
  ) is true)
);

-- 042/051's content CHECK does not pin an exact key set, so a version could
-- otherwise carry any editSpec at all. A separate constraint (rather than a
-- third rewrite of work_item_versions_content_check) adds the same floor to
-- frozen versions and leaves every spec-less version untouched.
alter table public.work_item_versions add constraint work_item_versions_edit_spec_check check (
  not (content ? 'editSpec') or ((
    jsonb_typeof(content->'editSpec') = 'object'
    and content->'editSpec'->'schemaVersion' = '1'::jsonb
    and content->'editSpec'->>'kind' = 'jsonld'
    and jsonb_typeof(content->'editSpec'->'targetUrl') = 'string'
    and left(content->'editSpec'->>'targetUrl', 8) = 'https://'
    and char_length(content->'editSpec'->>'targetUrl') <= 2048
    and content->'editSpec'->>'schemaType' in ('FAQPage', 'Organization', 'LocalBusiness')
    and jsonb_typeof(content->'editSpec'->'payload') = 'object'
    and content->'editSpec'->'payload'->>'@type' = content->'editSpec'->>'schemaType'
    and octet_length((content->'editSpec')::text) <= 20480
  ) is true)
);
