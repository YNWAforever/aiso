-- Owner-registered pages: the page-level target AC-06 needs, which neither side
-- of the product retains. A scan finding keeps url.origin and reduces path,
-- query and fragment to booleans (origin-only.v1, lib/scan-evidence.ts); a Pulse
-- observation carries no url field at all. Relaxing that redaction would change
-- what every past scan's `limitations` array means, and compareOutcome reads
-- that contract — so the owner declares the pages instead.
--
-- Numbered 050 deliberately: 047-049 are claimed by open pull requests (#43
-- account invitations, #44 scan-claim attempts and domain verification), and a
-- third file at 047 would be a third meaning for the same number.
create table public.client_assets (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  client_id uuid not null,
  -- Normalised by lib/assets/schema.ts before it gets here: scheme and host
  -- lowercased, fragment dropped, default port dropped, path and query kept
  -- (they are case-sensitive, and a query string is often what identifies the
  -- page). The CHECK is a backstop for a writer that skips the normaliser.
  url text not null check (url ~ '^https?://' and char_length(url) between 8 and 1000),
  -- Stored rather than re-derived on read. This is the column a scan finding
  -- matches on, and parsing a URL inside every query to recover it would make
  -- the one join AC-06 rests on the slowest thing on the page.
  origin text not null check (origin ~ '^https?://' and char_length(origin) between 8 and 1000),
  label text not null check (char_length(btrim(label)) between 1 and 160),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_assets_owned_client_fk
    foreign key (client_id, account_id) references public.clients (id, account_id) on delete cascade,
  constraint client_assets_created_actor_fk
    foreign key (created_by, account_id) references public.profiles (id, account_id) on delete set null (created_by),
  -- Re-registering the same page updates it rather than making a second copy
  -- that would split one page's questions across two rows.
  unique (account_id, client_id, url),
  -- Lets a declaration bind its asset without re-deriving tenancy.
  unique (account_id, client_id, id)
);

-- "This page answers this question", declared by the owner.
--
-- This is the ONLY page-level claim available on the Pulse side. A pulse rule's
-- args are exactly {question, platform} and ai_citation_log cannot be joined to
-- a metric (no prompt_id, no scan_week, and a different platform vocabulary), so
-- there is nothing to infer a page from. Asking the owner is not a shortcut
-- around a missing join; it is the only non-invented answer available.
create table public.client_asset_questions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  client_id uuid not null,
  asset_id uuid not null,
  -- NOTE: prompt_bank predates tenancy. It has no account_id column and hangs
  -- off clients(id) rather than (id, account_id), so this FK CANNOT be composite
  -- and the database cannot prove the prompt belongs to this account. Every
  -- writer must therefore constrain it in the statement itself — see
  -- lib/assets/store.ts, which joins prompt_bank on client_id inside the insert
  -- rather than checking first. That is the documented preferred shape (no
  -- TOCTOU window), not an oversight to be tidied into a separate select.
  prompt_id uuid not null references public.prompt_bank (id) on delete cascade,
  declared_by uuid,
  declared_at timestamptz not null default now(),
  constraint client_asset_questions_owned_asset_fk
    foreign key (account_id, client_id, asset_id)
      references public.client_assets (account_id, client_id, id) on delete cascade,
  constraint client_asset_questions_declared_actor_fk
    foreign key (declared_by, account_id) references public.profiles (id, account_id) on delete set null (declared_by),
  -- One declaration per page and question. Two pages may answer the same
  -- question, which is a real thing an owner may say, so the uniqueness is on
  -- the pair rather than on the prompt alone.
  unique (account_id, client_id, asset_id, prompt_id)
);

create index client_assets_client_idx
  on public.client_assets (account_id, client_id, label, id);
-- The AC-06 join: every registered page on the origin a scan finding names.
create index client_assets_origin_idx
  on public.client_assets (account_id, client_id, origin);
create index client_asset_questions_asset_idx
  on public.client_asset_questions (account_id, client_id, asset_id, prompt_id);

-- 037's default privileges include DELETE: narrow those explicitly. Assets take
-- UPDATE because a label is editable; a declaration is not edited, it is made or
-- withdrawn, so it takes DELETE instead.
revoke all on public.client_assets from public;
revoke all on public.client_asset_questions from public;
do $$
begin
  if to_regrole('aeo_app') is not null then
    revoke all on public.client_assets from aeo_app;
    grant select, insert, update on public.client_assets to aeo_app;
    revoke all on public.client_asset_questions from aeo_app;
    grant select, insert, delete on public.client_asset_questions to aeo_app;
  end if;
end $$;
