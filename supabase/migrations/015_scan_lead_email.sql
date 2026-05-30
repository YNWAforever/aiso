-- Add lead_email column to scans for post-scan email capture
ALTER TABLE scans ADD COLUMN IF NOT EXISTS lead_email text;
