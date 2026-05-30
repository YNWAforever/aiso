-- supabase/migrations/016_trial_columns.sql
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS trial_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS trial_ends_at    timestamptz,
  ADD COLUMN IF NOT EXISTS trial_emails_sent integer NOT NULL DEFAULT 0;
