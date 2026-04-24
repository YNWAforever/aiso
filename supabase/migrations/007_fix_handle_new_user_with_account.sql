-- Migration: auto-create personal starter account when a new user signs up
-- Replaces the existing handle_new_user() which only created a profile (account_id = NULL).

-- 1. Replace handle_new_user() to atomically create account + profile
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
BEGIN
  -- Create a personal starter account for this user
  INSERT INTO accounts (plan, status)
  VALUES ('starter', 'active')
  RETURNING id INTO v_account_id;

  -- Create profile linked to that account.
  -- ON CONFLICT: if profile already exists (e.g. old trigger ran without account),
  -- update account_id only if it is still NULL.
  INSERT INTO profiles (id, display_name, account_id)
  VALUES (new.id, new.raw_user_meta_data->>'full_name', v_account_id)
  ON CONFLICT (id) DO UPDATE
    SET account_id = EXCLUDED.account_id
    WHERE profiles.account_id IS NULL;

  RETURN new;
END;
$$;

-- 2. Backfill existing profiles that were created without an account
DO $$
DECLARE
  rec RECORD;
  v_account_id uuid;
BEGIN
  FOR rec IN SELECT id FROM profiles WHERE account_id IS NULL LOOP
    INSERT INTO accounts (plan, status)
    VALUES ('starter', 'active')
    RETURNING id INTO v_account_id;

    UPDATE profiles SET account_id = v_account_id WHERE id = rec.id;
  END LOOP;
END;
$$;
