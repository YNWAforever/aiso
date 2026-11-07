-- 099: Narrow forward CHECK replacement for monthly snapshot size only.
-- Raises client_report_versions_monthly_shape_check octet_length ceiling from
-- the historical queried 65536 target to 262144 (256 KiB), matching migration
-- 098's file-schema intent and MONTHLY_SNAPSHOT_MAX_BYTES. All other monthly
-- shape predicates stay identical. 098 is not edited or re-run. Runner owns
-- BEGIN/COMMIT and the schema_migrations ledger insert.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE public.client_report_versions
  DROP CONSTRAINT client_report_versions_monthly_shape_check,
  ADD CONSTRAINT client_report_versions_monthly_shape_check
  CHECK ((
    snapshot_schema_version <> 2 OR (
      source_scan_id IS NULL AND previous_scan_id IS NULL
      AND jsonb_typeof(snapshot) = 'object'
      AND octet_length(snapshot::text) <= 262144
    )
  ) IS TRUE);
