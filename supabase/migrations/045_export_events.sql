-- Export receipts. The artifact hash was computed on every export and returned in
-- a response header, then discarded, so nothing recorded that an approved package
-- had ever left the system, or what exactly left it.
--
-- Two hashes are kept because they answer different questions and need not be
-- equal: content_hash is the APPROVED PAYLOAD a human signed off, and
-- artifact_hash identifies the rendered canonical envelope. For format 'text' the
-- delivered bytes are a human-readable rendering of that same envelope, so
-- artifact_hash still identifies the envelope rather than those bytes — which is
-- why the format and the renderer version are recorded beside it.
create table public.work_item_export_events (
  id uuid primary key default gen_random_uuid(),
  schema_version integer not null default 1 check (schema_version = 1),
  account_id uuid not null,
  client_id uuid not null,
  work_item_id uuid not null,
  version_id uuid not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  artifact_hash text not null check (artifact_hash ~ '^[0-9a-f]{64}$'),
  format text not null check (format in ('json', 'text')),
  renderer_version text not null check (char_length(renderer_version) between 1 and 120),
  actor_id uuid not null,
  actor jsonb not null,
  exported_at timestamptz not null default clock_timestamp(),
  -- Binds the exact approved version AND its payload hash, so a receipt can never
  -- name a version whose content differs from what was exported.
  foreign key (account_id, client_id, work_item_id, version_id, content_hash)
    references public.work_item_versions (account_id, client_id, work_item_id, id, content_hash) on delete restrict,
  constraint work_item_export_events_actor_check check ((
    jsonb_typeof(actor) = 'object'
    and actor->>'profileId' = actor_id::text
    and jsonb_typeof(actor->'displayName') in ('string', 'null')
    and actor->>'role' in ('account_member', 'account_approver', 'platform_admin')
  ) is true)
);

-- Deliberately NO uniqueness on (actor, version): re-downloading an approved
-- package is a real, separate event and the audit trail should show each one.
-- Collapsing repeats would answer "was it exported" while losing "how often, by
-- whom, and when".
create index work_item_export_events_history_idx
  on public.work_item_export_events (account_id, client_id, work_item_id, version_id, exported_at desc, id desc);

-- Override inherited default privileges on this history table explicitly.
revoke all on public.work_item_export_events from public;
do $$ begin
  if to_regrole('aeo_app') is not null then
    revoke all on public.work_item_export_events from aeo_app;
    grant select, insert on public.work_item_export_events to aeo_app;
  end if;
end $$;
