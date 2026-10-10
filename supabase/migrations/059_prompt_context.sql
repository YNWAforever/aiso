-- Expand only. Existing language codes and historical run snapshots are untouched.
alter table public.prompt_bank add column market text
  check (market is null or market in ('HK','TW','SG','JP','KR','US','UK','EU','AU','CA','global'));
-- Existing table CRUD grants cover this nullable metadata column. No role elevation.
