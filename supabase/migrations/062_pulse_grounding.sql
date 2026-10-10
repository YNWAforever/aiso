-- Grounded Pulse answers and structured citations on every write path
-- (GEO parity blueprint, Step 1).
--
-- Pulse's GPT, Claude and Gemini answers came from training data. With
-- FEATURE_PULSE_GROUNDING on they are asked with web search, and the citations
-- the provider returns are kept. 060 stored provider citations only on the run
-- ledger (pulse_item_attempts); the legacy writer threw them away and
-- regex-extracted URLs from the answer text instead.
--
-- `grounding` records how an answer was produced, so a reader never presents a
-- training-data answer as a live one:
--   native -- the model searches by itself (Perplexity Sonar)
--   web    -- web search was requested for this call
--   none   -- answered without search
--   NULL   -- recorded before this migration; unknown
--
-- Additive only: nullable columns and a defaulted one, no rewrite of existing
-- rows. No RLS (036 convention).

alter table public.pulse_metrics
  add column provider_citations jsonb,
  add column grounding text,
  add constraint pulse_metrics_grounding_check check (grounding in ('native', 'web', 'none'));

alter table public.pulse_item_attempts
  add column grounding text,
  add constraint pulse_item_attempts_grounding_check check (grounding in ('native', 'web', 'none'));

-- Which URLs came from the provider's own citations and which were found in
-- the answer text. Every existing row was text-extracted.
alter table public.ai_citation_log
  add column source text not null default 'extracted',
  add constraint ai_citation_log_source_check check (source in ('extracted', 'provider'));

-- The weekly grounded-call cap counts web-searched attempts per account.
create index pulse_item_attempts_grounded on public.pulse_item_attempts (account_id, item_id) where grounding = 'web';
