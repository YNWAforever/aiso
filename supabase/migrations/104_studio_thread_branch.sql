-- 104: Conversation Studio branch lineage.
--
-- Phase A2 of the conversation-workspace design requires a discussion to branch
-- from a single message: the new thread inherits the selected turn's context and
-- records where it came from, without copying the original turns.
--
--   branched_from_thread_id  the origin thread, same account + brand. Deliberately
--                            NOT scoped to the origin's profile: a teammate's
--                            SHARED thread may be branched, and the new thread is
--                            owned by the viewer. 103 made shared threads read-only
--                            to others, so branching reads and never writes it.
--   branched_from_turn_id    the exact origin turn; both ids are set together or
--                            neither is, and a thread cannot branch from itself.
--
-- The origin FKs are brand-scoped so a lineage row can never point across
-- tenants. Column-specific ON DELETE SET NULL is used because the FKs include
-- account_id/client_id (NOT NULL) and must not null them on a cascade. Deleting
-- an origin turn nulls BOTH lineage ids in the same statement: turns are removed
-- by their parent thread's cascade, so the both-or-neither CHECK must never see
-- a half-cleared pair (a strict one-column SET NULL would block the delete).
--
-- Nothing here schedules anything; branching is an explicit user action.

alter table public.studio_threads
  add column if not exists branched_from_thread_id uuid,
  add column if not exists branched_from_turn_id uuid;

-- Cross-profile lineage needs a brand-scoped identity key on both tables: 081's
-- unique key includes profile_id, and a branch's profile differs from its origin's.
alter table public.studio_threads
  add constraint studio_threads_id_account_client_key unique (id, account_id, client_id);
alter table public.studio_thread_turns
  add constraint studio_thread_turns_id_thread_key unique (id, thread_id);

alter table public.studio_threads
  add constraint studio_threads_branch_origin_fkey
    foreign key (branched_from_thread_id, account_id, client_id)
    references public.studio_threads (id, account_id, client_id)
    on delete set null (branched_from_thread_id),
  add constraint studio_threads_branch_turn_fkey
    foreign key (branched_from_turn_id, branched_from_thread_id)
    references public.studio_thread_turns (id, thread_id)
    on delete set null (branched_from_turn_id, branched_from_thread_id),
  add constraint studio_threads_branch_pair_check check (
    (branched_from_thread_id is null) = (branched_from_turn_id is null)
  ),
  add constraint studio_threads_branch_no_self_check check (
    branched_from_thread_id is null or branched_from_thread_id <> id
  );

create index if not exists studio_threads_branch_origin_idx
  on public.studio_threads (branched_from_thread_id)
  where branched_from_thread_id is not null;
