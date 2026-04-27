-- Add optional domain field to clients for linking brands to their website
ALTER TABLE clients ADD COLUMN IF NOT EXISTS domain text;
