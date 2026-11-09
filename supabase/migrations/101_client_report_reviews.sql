-- 101: Phase 3 (advisory) — a client's decision on a monthly report version.
-- Design: docs/superpowers/specs/2026-11-09-monthly-report-client-signoff.md.
--
-- Scope is advisory by product decision (2026-11-09): a decision is RECORDED and
-- shown to the agency; it does not gate publishing. A per-brand "require sign-off"
-- gate can later read this table without changing it.
--
-- One decision per (report, version). A decision is final for its version: a later
-- version needs its own decision, and the older row remains as history. Nothing in
-- this table is ever updated or deleted by the app (insert-only), so a client
-- cannot silently change an answer.
--
-- The review link is signed over `report_id`, `version_id` and an expiry, with a
-- payload namespace distinct from the public share link (lib/monthly-report/
-- review-token.ts). Only the SHA-256 of that signature is stored (`token_hash`),
-- so a database read cannot reconstruct a working link.
--
-- Tenancy is in the key chain: both FKs are composite and include account/client,
-- matching 098's convention; no row exists without the account that owns it.
-- No RLS policies (036); RLS enabled with app grants only, like 089–091/097.

create table if not exists public.client_report_reviews (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  client_id uuid not null,
  report_id uuid not null,
  version_id uuid not null,
  decision text not null,
  -- Optional: a link holder may approve without naming themselves. When given,
  -- the agency sees the name; it is never presented as a verified identity.
  reviewer_name text,
  comment text,
  -- SHA-256 (hex) of the review signature this decision arrived with.
  token_hash text not null,
  decided_at timestamptz not null default now(),
  constraint client_report_reviews_decision_check check (decision in ('approved', 'changes_requested')),
  constraint client_report_reviews_reviewer_name_check
    check (reviewer_name is null or char_length(btrim(reviewer_name)) between 1 and 120),
  constraint client_report_reviews_comment_check
    check (comment is null or char_length(comment) between 1 and 2000),
  constraint client_report_reviews_token_hash_check check (token_hash ~ '^[0-9a-f]{64}$'),
  -- A changes-requested decision without a comment is the least actionable event
  -- in the flow; the route requires one, and the table refuses one without it.
  constraint client_report_reviews_comment_required_check
    check (decision <> 'changes_requested' or comment is not null),
  -- One decision per version, and a version can be decided once.
  unique (report_id, version_id),
  constraint client_report_reviews_report_tenant_fkey
    foreign key (report_id, account_id, client_id)
    references public.client_reports (id, account_id, client_id)
    on delete cascade,
  constraint client_report_reviews_version_tenant_fkey
    foreign key (version_id, report_id)
    references public.client_report_versions (id, report_id)
    on delete cascade
);

create index if not exists client_report_reviews_scope_idx
  on public.client_report_reviews (account_id, client_id, report_id, decided_at desc);

alter table public.client_report_reviews enable row level security;
revoke all on public.client_report_reviews from public;

do $acl$
begin
  if to_regrole('anon') is not null then
    execute 'revoke all on public.client_report_reviews from anon';
  end if;
  if to_regrole('authenticated') is not null then
    execute 'revoke all on public.client_report_reviews from authenticated';
  end if;
  if to_regrole('service_role') is not null then
    execute 'revoke all on public.client_report_reviews from service_role';
  end if;
  -- Insert-only history for the app: a recorded decision is never rewritten.
  if to_regrole('aeo_app') is not null then
    execute 'revoke all on public.client_report_reviews from aeo_app';
    execute 'grant select, insert on public.client_report_reviews to aeo_app';
  end if;
end
$acl$;
