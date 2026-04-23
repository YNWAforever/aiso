-- accounts: one per subscription
CREATE TABLE IF NOT EXISTS accounts (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_customer_id     text UNIQUE,
  stripe_subscription_id text,
  plan                   text NOT NULL DEFAULT 'starter'
                         CHECK (plan IN ('starter','pro','enterprise')),
  status                 text NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active','past_due','cancelled','trialing')),
  created_at             timestamptz DEFAULT now()
);

-- profiles: extends auth.users
CREATE TABLE IF NOT EXISTS profiles (
  id           uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id   uuid REFERENCES accounts(id) ON DELETE CASCADE,
  display_name text,
  is_admin     boolean DEFAULT false,
  created_at   timestamptz DEFAULT now()
);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO profiles (id, display_name)
  VALUES (new.id, new.raw_user_meta_data->>'full_name')
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- RLS: accounts
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users see own account" ON accounts
  FOR ALL USING (
    id = (SELECT account_id FROM profiles WHERE id = auth.uid())
  );

-- RLS: profiles
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users see own profile" ON profiles
  FOR ALL USING (id = auth.uid());
