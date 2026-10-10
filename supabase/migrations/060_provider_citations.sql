-- Expand only. NULL preserves unknown provenance for historical attempts.
-- Extend only the existing mutable evidence columns, with no evidence backfill.
alter table public.pulse_item_attempts
  add column provider_citations jsonb
    check (provider_citations is null or (
      jsonb_typeof(provider_citations) = 'array'
      and jsonb_array_length(provider_citations) <= 50
      and octet_length(provider_citations::text) <= 524288
    )),
  add column provider_finish_reason text
    check (provider_finish_reason is null or length(provider_finish_reason) <= 64);

-- 057 deliberately revoked table-level UPDATE and uses a column allowlist.
grant update(provider_citations, provider_finish_reason)
  on public.pulse_item_attempts to aeo_app;
