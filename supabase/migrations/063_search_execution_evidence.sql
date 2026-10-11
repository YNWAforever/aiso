-- Additive provenance. Existing grounding remains a request/capability label.
alter table public.pulse_metrics add column search_evidence jsonb;
alter table public.pulse_item_attempts add column search_evidence jsonb;
grant update(search_evidence) on public.pulse_item_attempts to aeo_app;
