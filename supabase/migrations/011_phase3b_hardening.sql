-- ============================================================
-- 011_phase3b_hardening.sql
-- 1. DB-level brand limit enforcement (solves TOCTOU race)
-- 2. scan_week column on notifications + unique dedup index
-- ============================================================

-- ──────────────────────────────────────────────
-- 1. Brand-limit trigger
-- ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.check_brand_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_count INTEGER;
  plan_name     TEXT;
  brand_limit   INTEGER;
BEGIN
  -- Look up the account's plan
  SELECT plan INTO plan_name
  FROM public.accounts
  WHERE id = NEW.account_id;

  -- Map plan name → brand limit (keep in sync with lib/tier.ts)
  brand_limit := CASE plan_name
    WHEN 'starter'    THEN 1
    WHEN 'pro'        THEN 3
    WHEN 'enterprise' THEN 10
    ELSE 1
  END;

  -- Count brands already owned by this account
  SELECT COUNT(*) INTO current_count
  FROM public.clients
  WHERE account_id = NEW.account_id;

  IF current_count >= brand_limit THEN
    RAISE EXCEPTION 'BRAND_LIMIT_REACHED'
      USING DETAIL = format('plan=%s limit=%s', plan_name, brand_limit);
  END IF;

  RETURN NEW;
END;
$$;

-- Drop existing trigger if it exists (idempotent)
DROP TRIGGER IF EXISTS enforce_brand_limit ON public.clients;

CREATE TRIGGER enforce_brand_limit
  BEFORE INSERT ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION public.check_brand_limit();

-- ──────────────────────────────────────────────
-- 2. Notification deduplication
-- ──────────────────────────────────────────────

-- Add scan_week so we can deduplicate one alert per (client, type, week)
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS scan_week date;

-- Partial unique index: only deduplicate rows that have a scan_week set
-- (recovery / manual notifications without scan_week are not deduplicated)
CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedup_idx
  ON public.notifications (client_id, type, scan_week)
  WHERE client_id IS NOT NULL AND scan_week IS NOT NULL;
