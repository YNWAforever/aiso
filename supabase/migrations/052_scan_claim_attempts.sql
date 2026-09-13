-- Single-use consumption for the signed scan-claim intent (AC-03).
--
-- `lib/security/scan-claim-intent.ts` has always minted an `attemptId` and
-- always signed it into the canonical string -- and nothing ever recorded it.
-- A signed cookie that is never consumed is a bearer token valid for its whole
-- 15-minute window: a copy of it claims the scan again every time it is
-- presented. The signature proved the token was ours. It never proved this was
-- the first use of it.
--
-- The primary key IS the mechanism. `insert ... on conflict do nothing
-- returning attempt_id` decides the winner inside one statement, so two
-- concurrent presentations of the same cookie cannot both win -- a read
-- followed by a write could, and that is the shape this replaces.
--
-- No foreign key to `scans`. The row records that a token was spent, which
-- stays true whether or not the scan survives; 046's rule, and scan records
-- are retention-limited (`scan-record-retention` in every evidence envelope).
--
-- Rows are prunable. An intent expires after 15 minutes and
-- verifyScanClaimIntent refuses an expired one before consumption is ever
-- reached, so a row older than that can never prevent anything. Nothing prunes
-- them today; the table is one narrow row per claim attempt and that is a
-- housekeeping job, not a correctness one.
create table public.scan_claim_attempts (
  attempt_id uuid primary key,
  scan_id uuid not null,
  consumed_at timestamptz not null default now()
);

-- Supports pruning by age, the only query that is not a primary-key hit.
create index scan_claim_attempts_consumed_at_idx
  on public.scan_claim_attempts (consumed_at);

-- 037 grants full DML on every new table in `public` by default, so the denial
-- has to be stated. No UPDATE and no DELETE: a spent attempt is a fact, and a
-- role that could delete one could replay the claim it guards.
revoke all on public.scan_claim_attempts from public;
do $$ begin
  if to_regrole('aeo_app') is not null then
    revoke all on public.scan_claim_attempts from aeo_app;
    grant select, insert on public.scan_claim_attempts to aeo_app;
  end if;
end $$;
