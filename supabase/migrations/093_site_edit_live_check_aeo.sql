-- 093: site-edit S7 — record the scan's structured-data check (c4) beside each live check
-- (brief: docs/superpowers/plans/2026-11-03-aiso-brief-post6-site-edit.md, §3 step 4,
-- "and the relevant AEO check passes", deferred from S4).
--
-- The check runs on the very bytes the live check fetched (no second request),
-- through the scan's own lib/checks/structuredData.ts. It is recorded, never a
-- gate: "verified live" still means only that the approved payload was on the
-- page. Both columns are NULL for a check whose page did not load. Additive;
-- existing rows (S4–S6) simply have no verdict.

alter table public.site_edit_live_checks
  add column if not exists structured_data_status text,
  add column if not exists structured_data_message text;

alter table public.site_edit_live_checks
  add constraint site_edit_live_checks_structured_data_check check ((
    (structured_data_status is null) = (structured_data_message is null)
    and (structured_data_status is null or structured_data_status in ('pass', 'warn', 'fail'))
    and (structured_data_message is null or char_length(structured_data_message) between 1 and 100)
    and (structured_data_status is null or outcome <> 'fetch_failed')
  ) is true);
