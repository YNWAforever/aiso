-- 062 added grounding after 057 revoked table-wide UPDATE. Preserve the column allowlist.
grant update(grounding) on public.pulse_item_attempts to aeo_app;
