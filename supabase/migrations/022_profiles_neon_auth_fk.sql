-- Repoint profiles.id from the dead Supabase auth.users to Neon Auth's
-- neon_auth.user table. Safe to run any time after Neon Auth is enabled
-- on this project (neon_auth.user must exist first) — profiles has zero
-- rows in production as of this migration, so no data migration is needed.

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;

ALTER TABLE profiles
  ADD CONSTRAINT profiles_id_fkey
  FOREIGN KEY (id) REFERENCES neon_auth.user(id) ON DELETE CASCADE;
