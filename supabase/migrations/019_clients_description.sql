-- Add brand description to clients for AI context and Pulse question generation
ALTER TABLE clients ADD COLUMN IF NOT EXISTS description text;
