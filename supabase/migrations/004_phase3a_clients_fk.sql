-- Add account_id to clients
ALTER TABLE clients ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES accounts(id) ON DELETE CASCADE;

-- Create a seed account for existing Fimmick data
INSERT INTO accounts (id, plan, status)
VALUES ('00000000-0000-0000-0000-000000000001', 'enterprise', 'active')
ON CONFLICT (id) DO NOTHING;

-- Backfill existing clients to the seed account
UPDATE clients SET account_id = '00000000-0000-0000-0000-000000000001'
WHERE account_id IS NULL;

-- Now enforce NOT NULL
ALTER TABLE clients ALTER COLUMN account_id SET NOT NULL;

-- RLS: clients
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

-- Normal users see own account's clients
CREATE POLICY "users see own clients" ON clients
  FOR ALL USING (
    account_id = (SELECT account_id FROM profiles WHERE id = auth.uid())
    OR (SELECT is_admin FROM profiles WHERE id = auth.uid()) = true
  );

-- RLS: prompt_bank (via clients)
ALTER TABLE prompt_bank ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users see own prompts" ON prompt_bank
  FOR ALL USING (
    client_id IN (
      SELECT id FROM clients WHERE
        account_id = (SELECT account_id FROM profiles WHERE id = auth.uid())
    )
    OR (SELECT is_admin FROM profiles WHERE id = auth.uid()) = true
  );

-- RLS: pulse_metrics
ALTER TABLE pulse_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users see own metrics" ON pulse_metrics
  FOR ALL USING (
    client_id IN (
      SELECT id FROM clients WHERE
        account_id = (SELECT account_id FROM profiles WHERE id = auth.uid())
    )
    OR (SELECT is_admin FROM profiles WHERE id = auth.uid()) = true
  );

-- RLS: pulse_weekly_summary
ALTER TABLE pulse_weekly_summary ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users see own summary" ON pulse_weekly_summary
  FOR ALL USING (
    client_id IN (
      SELECT id FROM clients WHERE
        account_id = (SELECT account_id FROM profiles WHERE id = auth.uid())
    )
    OR (SELECT is_admin FROM profiles WHERE id = auth.uid()) = true
  );
