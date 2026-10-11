-- Immutable request identity for new intents. Do not synthesize hashes for old drafts.
alter table public.onboarding_progress add column request_hash text check(request_hash is null or request_hash ~ '^[0-9a-f]{64}$');
