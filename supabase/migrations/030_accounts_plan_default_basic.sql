-- 030_accounts_plan_default_basic.sql
-- 003_phase3a_accounts.sql created accounts.plan as `not null default 'starter'`.
-- 014_subscription_tiers.sql then migrated every row to 'basic' and rewrote the
-- constraint to `check (plan in ('basic','pro','enterprise'))` -- but left the
-- column default behind. The default has not been a member of its own CHECK
-- since, so any INSERT that omits `plan` fails with accounts_plan_check.
--
-- Latent rather than live: the Neon user.created webhook, apply_stripe_account_event()
-- and every integration test pass `plan` explicitly. This closes the trap before
-- something falls into it.

alter table public.accounts alter column plan set default 'basic';
