-- Append-only external delivery declarations. No profile FK: actor snapshots survive removal.
create unique index work_item_decisions_delivery_approval_idx
  on public.work_item_decisions (account_id, client_id, work_item_id, version_id, content_hash, id, decision);

create table public.work_item_delivery_events (
  id uuid primary key default gen_random_uuid(),
  schema_version integer not null default 1 check (schema_version = 1),
  account_id uuid not null,
  client_id uuid not null,
  work_item_id uuid not null,
  version_id uuid not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  approval_decision_id uuid,
  approval_decision text,
  kind text not null check (kind in ('attest', 'withdraw')),
  actor_id uuid not null,
  actor jsonb not null,
  request_id uuid not null,
  recorded_at timestamptz not null default clock_timestamp(),
  destination text,
  delivered_at timestamptz,
  note text,
  target_attestation_id uuid,
  target_kind text,
  reason text,
  unique (account_id, actor_id, request_id),
  unique (target_attestation_id),
  unique (account_id, client_id, work_item_id, version_id, content_hash, id, kind),
  foreign key (account_id, client_id, work_item_id, version_id, content_hash)
    references public.work_item_versions (account_id, client_id, work_item_id, id, content_hash) on delete restrict,
  foreign key (account_id, client_id, work_item_id, version_id, content_hash, approval_decision_id, approval_decision)
    references public.work_item_decisions (account_id, client_id, work_item_id, version_id, content_hash, id, decision) on delete restrict,
  foreign key (account_id, client_id, work_item_id, version_id, content_hash, target_attestation_id, target_kind)
    references public.work_item_delivery_events (account_id, client_id, work_item_id, version_id, content_hash, id, kind) on delete restrict,
  constraint delivery_attest_check check ((kind <> 'attest' or (
    approval_decision_id is not null and approval_decision = 'approved'
    and char_length(destination) between 1 and 500
    and destination = btrim(destination) and destination = normalize(destination, NFC)
    and char_length(note) between 1 and 2000
    and note = btrim(note) and note = normalize(note, NFC)
    and delivered_at <= recorded_at
    and target_attestation_id is null and target_kind is null and reason is null
  )) is true),
  constraint delivery_withdraw_check check ((kind <> 'withdraw' or (
    target_attestation_id is not null and target_attestation_id <> id and target_kind = 'attest'
    and char_length(reason) between 1 and 2000
    and reason = btrim(reason) and reason = normalize(reason, NFC)
    and destination is null and delivered_at is null and note is null
    and approval_decision_id is null and approval_decision is null
  )) is true),
  constraint delivery_actor_check check ((
    jsonb_typeof(actor) = 'object'
    and actor->>'profileId' = actor_id::text
    and jsonb_typeof(actor->'displayName') in ('string', 'null')
    and actor->>'role' = 'account_member'
  ) is true)
);
create index work_item_delivery_events_history_idx
  on public.work_item_delivery_events (account_id, client_id, work_item_id, version_id, recorded_at desc, id desc);

-- Override inherited default privileges on this history table explicitly.
revoke all on public.work_item_delivery_events from public;
do $$ begin
  if to_regrole('aeo_app') is not null then
    revoke all on public.work_item_delivery_events from aeo_app;
    grant select, insert on public.work_item_delivery_events to aeo_app;
  end if;
end $$;
