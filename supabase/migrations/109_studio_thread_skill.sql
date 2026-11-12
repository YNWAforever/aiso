-- 109: Conversation Studio thread skill (approved SME copilot redesign, slice 3).
--
-- A thread currently remembers its skill only implicitly: the first turn's
-- `studio_thread_turns.task` (and every later turn keeps its own task for
-- idempotency and branching). The redesign promotes skills to a first-class,
-- server-owned registry (`lib/conversation-studio/skills.ts`), so a thread can be
-- grouped by skill ("待跟進"), counted for analytics ("which skill is used") and
-- titled by its outcome without re-reading turn history.
--
--   skill   nullable text. NULL for threads created before this migration and for
--           any thread whose skill is not one of the registry ids. The closed
--           vocabulary is the registry's ids; a new skill is a deliberate code +
--           migration change together. No backfill: the reader derives the skill
--           from `first_task` exactly as before, so old rows keep working and a
--           wrong guess is never stored.
--
-- Turn-level `task` is unchanged and remains the authority for composing a turn
-- and for branch idempotency; `skill` is additive metadata only. It never gates
-- a read, a write, a plan feature or a LIVE quota.
--
-- The existing table grants cover new columns (privileges are table-level), so no
-- new GRANT/RLS posture is introduced (036/103).

alter table public.studio_threads
  add column if not exists skill text;

alter table public.studio_threads
  add constraint studio_threads_skill_check check (
    skill is null or skill in (
      'visibility_now', 'what_ai_says', 'top_opportunity', 'improve_page',
      'compare_competitors', 'draft_brief', 'monthly_report', 'scan_brand', 'explain_drop'
    )
  );

-- Grouping is per-brand ("which skills does this brand's team use"), and the
-- partial predicate keeps the index small: most rows predate the column.
create index if not exists studio_threads_client_skill_idx
  on public.studio_threads (account_id, client_id, skill, updated_at desc)
  where skill is not null;
