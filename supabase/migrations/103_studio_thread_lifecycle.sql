-- 103: Conversation Studio thread lifecycle — visibility, pin, archive.
--
-- Phase A of the conversation-workspace design (2026-10-28 §10) requires threads
-- that can be renamed, pinned, archived and shared read-only with the brand team.
-- 081 covered persistence only, so this adds the three missing facts:
--
--   visibility   private (default) | shared. A shared thread is READ-ONLY to the
--                other members of the same brand: only its creator may rename,
--                pin, archive, share/unshare, or append turns. No per-recipient
--                ACL yet — sharing means "members who can already see this brand".
--   pinned_at    set while pinned; ordering only, never a permission.
--   archived_at  set while archived; archived threads leave every list but stay
--                readable by their creator through a direct link. Nothing deletes.
--
-- Staff threads (088) stay private: sharing them would expose a client-account
-- thread outside the grant that produced it, so the API refuses visibility
-- changes for a staff principal. No new RLS posture (036): RLS is already enabled
-- and every query filters by account_id and client_id.
--
-- Nothing here schedules or scans anything; threads are created by an explicit
-- user send.

alter table public.studio_threads
  add column if not exists visibility text not null default 'private',
  add column if not exists pinned_at timestamptz,
  add column if not exists archived_at timestamptz;

alter table public.studio_threads
  add constraint studio_threads_visibility_check check (visibility in ('private', 'shared'));

-- The list query now reads "my threads plus shared threads in this brand"; this
-- index keeps the shared half bounded without scanning the table.
create index if not exists studio_threads_shared_recent_idx
  on public.studio_threads (account_id, client_id, visibility, updated_at desc, id desc)
  where visibility = 'shared';
