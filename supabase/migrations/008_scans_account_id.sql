-- Link scans to accounts so logged-in users can see their scan history
ALTER TABLE scans ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES accounts(id);
CREATE INDEX IF NOT EXISTS scans_account_id_idx ON scans(account_id);

-- Allow self-service brand creation: any authenticated user can insert a client
-- for their own account (existing ALL policy already covers SELECT + UPDATE).
DROP POLICY IF EXISTS "users insert own clients" ON clients;
CREATE POLICY "users insert own clients" ON clients
  FOR INSERT WITH CHECK (
    account_id = (SELECT account_id FROM profiles WHERE id = auth.uid())
  );
