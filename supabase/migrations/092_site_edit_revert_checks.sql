-- 092: site-edit S5 — a revert's live check verifies by ABSENCE
-- (brief: docs/superpowers/plans/2026-11-03-aiso-brief-post6-site-edit.md, §3 step 5).
--
-- A revert is an approved `jsonld_remove` edit spec, handed off like an add.
-- Its live check succeeds when the page loaded (2xx HTML) and the approved
-- block is no longer on it, so a verified attestation may now hang off a
-- `missing` check as well as a `found` one. Which outcome verifies is decided
-- by the version's frozen spec kind in lib/site-edit/live-check-store.ts; the
-- database still refuses any attestation on a `fetch_failed` check, so a page
-- that did not load can never "prove" a removal.

alter table public.site_edit_live_checks
  drop constraint site_edit_live_checks_shape_check;

alter table public.site_edit_live_checks
  add constraint site_edit_live_checks_shape_check check ((
    (http_status is null or http_status between 100 and 599)
    and (page_sha256 is null or page_sha256 ~ '^[0-9a-f]{64}$')
    and (outcome = 'fetch_failed' or (http_status between 200 and 299 and page_sha256 is not null))
    and (attestation_id is null or outcome in ('found', 'missing'))
    and checked_at <= recorded_at
  ) is true);
