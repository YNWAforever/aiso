-- alert_configs: per-client alert settings
CREATE TABLE IF NOT EXISTS public.alert_configs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  enabled_sov   boolean NOT NULL DEFAULT false,
  sov_threshold integer NOT NULL DEFAULT 50,
  enabled_wow   boolean NOT NULL DEFAULT false,
  wow_threshold integer NOT NULL DEFAULT 10,
  notify_email  boolean NOT NULL DEFAULT true,
  notify_inapp  boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id)
);

ALTER TABLE public.alert_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_all_alert_configs" ON public.alert_configs
  USING (
    client_id IN (
      SELECT id FROM public.clients WHERE account_id = (
        SELECT account_id FROM public.profiles WHERE id = auth.uid()
      )
    )
  );

-- notifications: in-app notification inbox
CREATE TABLE IF NOT EXISTS public.notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  client_id   uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  type        text NOT NULL CHECK (type IN ('sov_threshold', 'sov_wow_drop', 'sov_recovery')),
  title       text NOT NULL,
  message     text NOT NULL,
  read        boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_all_notifications" ON public.notifications
  USING (
    account_id = (
      SELECT account_id FROM public.profiles WHERE id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS notifications_account_read_idx
  ON public.notifications(account_id, read, created_at DESC);
