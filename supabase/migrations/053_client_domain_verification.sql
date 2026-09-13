-- Domain-ownership verification (AC-03).
--
-- `verification: 'unverified'` was a literal in lib/entities/schema.ts: a
-- field whose TYPE admitted exactly one value. The product showed a
-- verification status it had no mechanism to establish, which is a claim
-- about the world backed by nothing. This is the mechanism.
--
-- One row per client, because a client has one domain (`clients.domain`).
-- The row is keyed by (account_id, client_id) rather than by domain, so two
-- accounts naming the same domain each prove it for themselves -- ownership
-- is not transitive, and one account's proof must never verify another's.

create table public.client_domain_verifications (
  account_id uuid not null,
  client_id uuid not null,

  -- The domain this row is ABOUT, captured when the token was issued.
  -- Verification is a fact about a (client, domain) pair, never about the
  -- client alone: repointing clients.domain must not carry the badge across,
  -- and the reader compares this against the current value to decide.
  domain text not null,

  -- Public by construction -- the owner publishes it at
  -- /.well-known/aiso-site-verification.txt -- so it is stored in plain text.
  -- Hashing would be theatre: the verifier has to compare against the literal
  -- value it told the owner to publish.
  token text not null,

  issued_at timestamptz not null default now(),
  -- Provenance, so erasable: 046's rule, and paired with no CHECK, which is
  -- what makes `set null` safe here.
  issued_by uuid,

  -- The last time ownership was actually proven. A later failed re-check does
  -- NOT clear it: deciding when a site that stops answering should lose its
  -- badge is a policy (how many failures, over what window) nobody has set,
  -- and inventing one here would silently revoke a real proof.
  verified_at timestamptz,
  last_checked_at timestamptz,
  last_outcome text,

  primary key (account_id, client_id),
  constraint client_domain_verifications_owned_client_fk
    foreign key (client_id, account_id) references public.clients (id, account_id) on delete cascade,
  constraint client_domain_verifications_issuer_fk
    foreign key (issued_by, account_id) references public.profiles (id, account_id) on delete set null (issued_by),

  -- Mirrors normalizeVerificationDomain(): already lowercase, trimmed, and
  -- dotted. A writer that skips normalisation fails here rather than storing a
  -- second spelling that can never match the current domain.
  constraint client_domain_verifications_domain_check check ((
    domain = lower(btrim(domain))
    and domain like '%.%'
    and char_length(domain) between 4 and 253
  ) is true),

  constraint client_domain_verifications_token_check
    check (token ~ '^aiso-site-verification=[0-9a-f]{32}$'),

  -- A closed vocabulary, so the surface can translate every outcome. An
  -- unrecognised code would render as a raw string at an owner.
  constraint client_domain_verifications_outcome_check check (
    last_outcome is null
    or last_outcome in ('verified', 'token_absent', 'unreachable', 'redirected', 'too_large')
  ),

  -- A check timestamp and its result are one fact recorded two ways.
  constraint client_domain_verifications_checked_check
    check (((last_checked_at is null) = (last_outcome is null)) is true)
);

-- 037 grants full DML on every new table in `public` by default, so the denial
-- has to be stated. No DELETE: re-issuing a token overwrites the row in place,
-- and a role that could delete one could erase the record of a proof.
revoke all on public.client_domain_verifications from public;
do $$ begin
  if to_regrole('aeo_app') is not null then
    revoke all on public.client_domain_verifications from aeo_app;
    grant select, insert, update on public.client_domain_verifications to aeo_app;
  end if;
end $$;
