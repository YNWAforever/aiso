-- Fix handle_new_user() to use 'basic' instead of 'starter'
-- Migration 014 added a CHECK constraint (plan in ('basic','pro','enterprise')),
-- but the trigger was still inserting plan = 'starter', breaking all new signups.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
BEGIN
  INSERT INTO accounts (plan, status)
  VALUES ('basic', 'active')
  RETURNING id INTO v_account_id;

  INSERT INTO profiles (id, display_name, account_id)
  VALUES (new.id, new.raw_user_meta_data->>'full_name', v_account_id)
  ON CONFLICT (id) DO UPDATE
    SET account_id = EXCLUDED.account_id
    WHERE profiles.account_id IS NULL;

  RETURN new;
END;
$$;
