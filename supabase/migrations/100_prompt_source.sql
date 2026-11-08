-- Prompt provenance (Retainer OS Slice A, the leftover).
--
-- The brief requires prompts seeded from the brand profile to be labelled as
-- profile-based in the UI, "never as demand". Until now nothing recorded which
-- question came from where, so the UI could only infer it — or stay silent.
-- This column is that record.
--
-- Nullable on purpose: NULL means "provenance was never recorded" (every row
-- written before this migration, except the backfill below). It is never a
-- guess and never a default. A backfilled 'profile' is not an inference either:
-- `onboarding_seed_key` is the marker the onboarding seed itself writes, so the
-- row already carried the fact.
--
-- No grants: aeo_app already holds blanket DML on public (037). No RLS: like
-- every table since 036, tenancy is the query's account_id predicate.

alter table public.prompt_bank add column if not exists source text;

alter table public.prompt_bank drop constraint if exists prompt_bank_source_check;
alter table public.prompt_bank add constraint prompt_bank_source_check
  check (source is null or source in ('profile', 'demand'));

-- The onboarding seed is the only writer that left a marker behind.
update public.prompt_bank set source = 'profile'
where source is null and onboarding_seed_key is not null;
