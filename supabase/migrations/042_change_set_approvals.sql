-- Immutable review packages and access audit. No profile FK: frozen identities
-- intentionally survive profile removal. Stores authorize current profiles under locks.
create unique index evidence_work_items_version_owner_idx
  on public.evidence_work_items (account_id, client_id, id);

create table public.work_item_versions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  client_id uuid not null,
  work_item_id uuid not null,
  version_number integer not null check (version_number > 0),
  draft_revision integer not null check (draft_revision > 0),
  content jsonb not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  validation jsonb not null,
  submitter jsonb not null,
  submitted_at timestamptz not null default now(),
  foreign key (account_id, client_id, work_item_id)
    references public.evidence_work_items (account_id, client_id, id) on delete restrict,
  unique (account_id, client_id, work_item_id, draft_revision),
  unique (account_id, client_id, work_item_id, version_number),
  unique (account_id, client_id, work_item_id, id, content_hash),
  constraint work_item_versions_content_check check ((
    jsonb_typeof(content) = 'object'
    and content->'schemaVersion' = '1'::jsonb
    and content->>'workItemId' = work_item_id::text
    and content->'draftRevision' = to_jsonb(draft_revision)
    and jsonb_typeof(content->'title') = 'string'
    and char_length(btrim(content->>'title')) between 1 and 160
    and jsonb_typeof(content->'action') = 'string'
    and char_length(btrim(content->>'action')) between 1 and 4000
    and jsonb_typeof(content->'notes') = 'string'
    and char_length(content->>'notes') <= 8000
    and content->>'locale' in ('en', 'zh-HK')
    and jsonb_typeof(content->'evidenceSnapshot') = 'object'
    and content->'evidenceSnapshot'->'schemaVersion' = '1'::jsonb
    and content->'evidenceSnapshot'->'source'->>'kind' in ('pulse-metric', 'scan-check')
    and octet_length((content->'evidenceSnapshot')::text) <= 65536
    and octet_length(content::text) <= 131072
  ) is true),
  constraint work_item_versions_validation_check check ((
    jsonb_typeof(validation) = 'object'
    and validation->>'policyVersion' = 'change-set-review.v1'
    and validation->'checks' = '[{"code":"text","status":"pass"},{"code":"locale","status":"pass"},{"code":"evidence","status":"pass"},{"code":"content_size","status":"pass"}]'::jsonb
  ) is true),
  constraint work_item_versions_submitter_check check ((
    jsonb_typeof(submitter) = 'object'
    and submitter->>'profileId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and jsonb_typeof(submitter->'displayName') in ('string', 'null')
    and submitter->>'role' in ('account_member', 'account_approver', 'platform_admin')
  ) is true)
);

-- Events do not reference state: event first, then state is valid even at revision 1.
create table public.account_approver_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete restrict,
  profile_id uuid not null,
  action text not null check (action in ('grant', 'revoke')),
  previous_revision integer not null check (previous_revision >= 0),
  new_revision integer not null check (new_revision > 0 and new_revision = previous_revision + 1),
  administrator_id uuid not null,
  administrator jsonb not null,
  reason text not null check (char_length(reason) between 1 and 2000 and reason = btrim(reason) and reason = normalize(reason, NFC)),
  request_id uuid not null,
  created_at timestamptz not null default now(),
  unique (account_id, profile_id, new_revision),
  unique (account_id, administrator_id, request_id),
  unique (account_id, profile_id, new_revision, id),
  constraint account_approver_events_actor_check check ((
    jsonb_typeof(administrator) = 'object'
    and administrator->>'profileId' = administrator_id::text
    and jsonb_typeof(administrator->'displayName') in ('string', 'null')
    and administrator->>'role' = 'platform_admin'
  ) is true)
);

create table public.account_approver_state (
  account_id uuid not null references public.accounts (id) on delete restrict,
  profile_id uuid not null,
  active boolean not null,
  revision integer not null check (revision > 0),
  last_event_id uuid not null,
  updated_at timestamptz not null default now(),
  primary key (account_id, profile_id),
  foreign key (account_id, profile_id, revision, last_event_id)
    references public.account_approver_events (account_id, profile_id, new_revision, id)
    on delete restrict deferrable initially deferred
);

create table public.work_item_decisions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  client_id uuid not null,
  work_item_id uuid not null,
  version_id uuid not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  decision text not null check (decision in ('approved', 'changes_requested')),
  reason text not null check (char_length(reason) between 1 and 2000 and reason = btrim(reason) and reason = normalize(reason, NFC)),
  actor_id uuid not null,
  actor jsonb not null,
  grant_revision integer not null check (grant_revision > 0),
  grant_event_id uuid not null,
  request_id uuid not null,
  decided_at timestamptz not null default now(),
  unique (account_id, client_id, work_item_id, version_id),
  unique (account_id, client_id, work_item_id, version_id, actor_id, request_id),
  foreign key (account_id, client_id, work_item_id, version_id, content_hash)
    references public.work_item_versions (account_id, client_id, work_item_id, id, content_hash) on delete restrict,
  foreign key (account_id, actor_id, grant_revision, grant_event_id)
    references public.account_approver_events (account_id, profile_id, new_revision, id) on delete restrict,
  constraint work_item_decisions_actor_check check ((
    jsonb_typeof(actor) = 'object'
    and actor->>'profileId' = actor_id::text
    and jsonb_typeof(actor->'displayName') in ('string', 'null')
    and actor->>'role' = 'account_approver'
  ) is true)
);

-- Override 037's default privileges, including UPDATE and DELETE on history.
revoke all on public.work_item_versions from public;
revoke all on public.work_item_decisions from public;
revoke all on public.account_approver_events from public;
revoke all on public.account_approver_state from public;
do $$ begin
  if to_regrole('aeo_app') is not null then
    revoke all on public.work_item_versions from aeo_app;
    grant select, insert on public.work_item_versions to aeo_app;
    revoke all on public.work_item_decisions from aeo_app;
    grant select, insert on public.work_item_decisions to aeo_app;
    revoke all on public.account_approver_events from aeo_app;
    grant select, insert on public.account_approver_events to aeo_app;
    revoke all on public.account_approver_state from aeo_app;
    grant select, insert, update on public.account_approver_state to aeo_app;
  end if;
end $$;
