-- Add region column to clients table
-- Required by onboarding wizard (step 3: industry & region)
ALTER TABLE clients ADD COLUMN IF NOT EXISTS region text;
