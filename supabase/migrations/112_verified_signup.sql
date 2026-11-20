-- A new signup is counted after provisioning links the first profile to its new account.
alter table public.accounts add column signup_provisioned_at timestamptz;
