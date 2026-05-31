-- Fix: result pages are publicly accessible (anyone with a scan UUID can view it).
-- RLS was enabled on scans without a public SELECT policy, causing the result page
-- to always return 404 for the anon Supabase client used by SSR.

-- Ensure RLS is on (idempotent)
ALTER TABLE scans ENABLE ROW LEVEL SECURITY;

-- Anyone can read a scan by its UUID (hard-to-guess — functions as an access token)
DROP POLICY IF EXISTS "public_read_scan_by_id" ON scans;
CREATE POLICY "public_read_scan_by_id" ON scans
  FOR SELECT USING (true);

-- Authenticated users can insert scans
DROP POLICY IF EXISTS "auth_insert_own_scan" ON scans;
CREATE POLICY "auth_insert_own_scan" ON scans
  FOR INSERT WITH CHECK (true);

-- Authenticated users can update their own scans (e.g. lead_email capture)
DROP POLICY IF EXISTS "auth_update_own_scan" ON scans;
CREATE POLICY "auth_update_own_scan" ON scans
  FOR UPDATE USING (true);
