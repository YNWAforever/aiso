-- 105: Studio turns record server-composed receipts and a client request id.
--
-- B1 moves saved-evidence composition to the server: the turn's stored reply is
-- composed from the same account-scoped records the page read, and `receipts`
-- records what was read (kind, id, record count, digest) so a later reader can
-- retell the provenance without trusting the client. `request_id` is the
-- client's idempotency key: one append per (thread, request), so a retry after a
-- timeout returns the stored turn instead of duplicating it.
--
-- Both columns are additive and nullable: every turn written before B1 keeps a
-- null receipts value and no request id, which reads as "not server-composed"
-- rather than as an empty receipt list.

alter table studio_thread_turns
  add column if not exists receipts jsonb
    check (receipts is null or (jsonb_typeof(receipts) = 'array' and octet_length(receipts::text) <= 32768)),
  add column if not exists request_id uuid;

create unique index if not exists studio_thread_turns_request_key
  on studio_thread_turns (thread_id, request_id)
  where request_id is not null;

comment on column studio_thread_turns.receipts is
  'Typed server composition receipts (kind, id, records, truncated, digest). Null means the turn predates server composition.';
comment on column studio_thread_turns.request_id is
  'Client idempotency key for one append to this thread; unique per thread.';
