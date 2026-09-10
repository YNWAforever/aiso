-- Customer-approved reference content: brand facts and FAQs a draft may cite.
-- Two tables for the same reason 041/042 split: identity and current policy are
-- mutable, the content is not. A source is revoked, never deleted, so a draft
-- that cited it can still be explained afterwards.
create table public.client_sources (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  client_id uuid not null,
  -- Canonical identity within the client, so re-importing the same pack updates
  -- it rather than silently creating a second copy of the same facts.
  source_key text not null check (source_key ~ '^[a-z0-9][a-z0-9_-]{0,119}$'),
  kind text not null check (kind in ('facts', 'faq')),
  label text not null check (char_length(btrim(label)) between 1 and 160),
  -- Default DENIED. A source is inert until someone says an agent may use it;
  -- the opposite default would make every import silently drafting material.
  agent_use_allowed boolean not null default false,
  revoked_at timestamptz,
  revoked_by uuid,
  latest_version integer not null default 0 check (latest_version >= 0),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_sources_owned_client_fk
    foreign key (client_id, account_id) references public.clients (id, account_id) on delete cascade,
  constraint client_sources_created_actor_fk
    foreign key (created_by, account_id) references public.profiles (id, account_id) on delete set null (created_by),
  constraint client_sources_revoked_actor_fk
    foreign key (revoked_by, account_id) references public.profiles (id, account_id) on delete set null (revoked_by),
  -- Revocation is one fact recorded two ways; neither half may stand alone.
  constraint client_sources_revocation_check check ((revoked_at is null) = (revoked_by is null)),
  unique (account_id, client_id, source_key),
  -- Lets a version bind its parent without re-deriving tenancy.
  unique (account_id, client_id, id)
);

-- Append-only. Editing an approved source creates version N+1; N stays readable
-- exactly as approved, because a draft may have cited it.
create table public.client_source_versions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  client_id uuid not null,
  source_id uuid not null,
  version_number integer not null check (version_number > 0),
  content jsonb not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  import_method text not null check (import_method in ('paste', 'csv')),
  -- Where the content came from, in the importer's words. Free text because the
  -- honest answer is often "the 2026 price list PDF", which no enum will hold.
  origin_ref text check (origin_ref is null or char_length(btrim(origin_ref)) between 1 and 500),
  imported_by uuid,
  imported_at timestamptz not null default now(),
  approved_by uuid,
  approved_at timestamptz,
  constraint client_source_versions_owned_source_fk
    foreign key (account_id, client_id, source_id) references public.client_sources (account_id, client_id, id) on delete restrict,
  constraint client_source_versions_imported_actor_fk
    foreign key (imported_by, account_id) references public.profiles (id, account_id) on delete set null (imported_by),
  constraint client_source_versions_approved_actor_fk
    foreign key (approved_by, account_id) references public.profiles (id, account_id) on delete set null (approved_by),
  -- Approval is one fact recorded two ways, as above.
  constraint client_source_versions_approval_check check ((approved_at is null) = (approved_by is null)),
  constraint client_source_versions_content_check check ((
    jsonb_typeof(content) = 'object'
    and content->'schemaVersion' = '1'::jsonb
    and jsonb_typeof(content->'entries') = 'array'
    and jsonb_array_length(content->'entries') between 1 and 200
    -- Every entry is a {question, answer} pair of non-empty strings. Enforced
    -- here as well as in the service: this table is the last line, and an entry
    -- with no answer is not a fact anyone can cite.
    and not jsonb_path_exists(content, '$.entries[*] ? (@.type() != "object")')
    -- Absence has to be checked separately from type. `@.answer.type() != "string"`
    -- compares an EMPTY sequence when the key is missing, which matches nothing,
    -- so an entry with no answer at all would slip through a type test alone.
    and not jsonb_path_exists(content, '$.entries[*] ? (!exists(@.question) || !exists(@.answer))')
    and not jsonb_path_exists(content, '$.entries[*] ? (@.question.type() != "string" || @.answer.type() != "string")')
    and not jsonb_path_exists(content, '$.entries[*] ? (@.question == "" || @.answer == "")')
    and octet_length(content::text) <= 131072
  ) is true),
  unique (account_id, client_id, source_id, version_number),
  -- The tuple a draft binds to, so a citation names an exact approved text.
  unique (account_id, client_id, source_id, id, content_hash)
);

create index client_source_versions_source_idx
  on public.client_source_versions (account_id, client_id, source_id, version_number desc);
create index client_sources_client_idx
  on public.client_sources (account_id, client_id, created_at desc, id desc);

-- 037's default privileges include DELETE: narrow those explicitly. Sources take
-- UPDATE because policy and revocation change; versions never do.
revoke all on public.client_sources from public;
revoke all on public.client_source_versions from public;
do $$
begin
  if to_regrole('aeo_app') is not null then
    revoke all on public.client_sources from aeo_app;
    grant select, insert, update on public.client_sources to aeo_app;
    revoke all on public.client_source_versions from aeo_app;
    grant select, insert on public.client_source_versions to aeo_app;
  end if;
end $$;
