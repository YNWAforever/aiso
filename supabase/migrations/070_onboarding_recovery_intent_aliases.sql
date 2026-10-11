-- Preserve the original intent/hash and journal every subsequent recovery request.
-- Existing aliases are unknown; do not invent hashes for historical recovery calls.
alter table public.onboarding_progress add column request_aliases jsonb not null default '{}'::jsonb check(jsonb_typeof(request_aliases)='object');
