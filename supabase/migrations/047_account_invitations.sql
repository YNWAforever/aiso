-- Account membership by invitation.
--
-- Why this table exists. `provisionAccountForUser` (app/api/webhooks/neon/route.ts)
-- always minted a FRESH account, so a second person who signed in landed in
-- their own account rather than the one that wanted them. And `profiles.id` is
-- a foreign key to `neon_auth.user(id)` (022), a table only Neon Auth writes, so
-- a member could not be created by this product at all. That is why AC-14's
-- approve / request-changes verbs were unreachable: `can_decide`
-- (lib/change-sets/store.ts) requires a second profile in the SAME account as
-- the version's submitter, and the product enforced a separation of duties
-- while providing no supported way to produce the second party it requires.
--
-- The invitation is consumed at PROVISIONING time, not by moving an existing
-- profile. A profile's `account_id` stays immutable on purpose: every tenancy
-- constraint in 041-046 is a composite foreign key on (..., account_id), so
-- moving a profile between accounts would strand the history it authored.
--
-- What authenticates the accept is Neon Auth itself. The webhook already proves
-- the payload's user id and email against `neon_auth.user` -- the one table an
-- attacker cannot forge -- so "consume the invitation for this address" can only
-- be performed by someone who really signed in as that address. No separate
-- invitation token is minted: a second secret would be a second thing to leak
-- without adding an authority the email match does not already carry.

create table public.account_invitations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,

  -- Stored ALREADY normalised, so the provisioning lookup and this row cannot
  -- disagree about which address they mean. lib/members/schema.ts's
  -- normalizeInvitationEmail() produces exactly this form, and the webhook
  -- matches with the same expression; a writer that skips normalisation fails
  -- here rather than quietly creating a second row for the same person.
  email text not null
    constraint account_invitations_email_check check ((
      email = lower(btrim(email))
      and email = normalize(email, NFC)
      and char_length(email) between 3 and 254
      and email ~ '^[^@[:space:][:cntrl:]]+@[^@[:space:][:cntrl:]]+\.[^@[:space:][:cntrl:]]+$'
    ) is true),

  -- Provenance, and therefore erasable -- 046's rule is that a decision is
  -- frozen and provenance is not. Deliberately NOT paired with any CHECK: that
  -- is what makes `on delete set null` safe here. 044 declared actor columns
  -- with `set null` while a CHECK required the actor and its timestamp to be
  -- null together, so the referential action performed exactly the write the
  -- CHECK forbade and deleting the profile failed on a constraint naming no
  -- profile. `invited_at` is this row's own creation time, not the actor's, so
  -- there is nothing to pair.
  invited_by uuid,
  invited_at timestamptz not null default now(),
  expires_at timestamptz not null,

  -- Frozen identities, on 046's other half: these record a decision, so they
  -- keep NO foreign key and survive profile removal.
  accepted_at timestamptz,
  accepted_profile_id uuid,
  revoked_at timestamptz,
  revoked_by uuid,
  revoked_reason text,

  constraint account_invitations_inviter_fk
    foreign key (invited_by, account_id) references public.profiles (id, account_id)
    on delete set null (invited_by),

  -- Acceptance is one fact recorded two ways; neither half may stand alone.
  constraint account_invitations_acceptance_check
    check (((accepted_at is null) = (accepted_profile_id is null)) is true),

  -- Revocation is one fact recorded three ways. A `member` revocation names the
  -- person who withdrew it. A `superseded` revocation has no human actor BY
  -- CONSTRUCTION -- it is what happens when a member replaces an invitation that
  -- expired without being consumed -- so it must be allowed a null actor rather
  -- than have one invented for it. `is not distinct from` rather than `=`
  -- because a null reason would otherwise make the comparison null, and a CHECK
  -- passes on null.
  constraint account_invitations_revocation_check check ((
    (revoked_at is null) = (revoked_reason is null)
    and (revoked_by is not null) = (revoked_reason is not distinct from 'member')
    and (revoked_reason is null or revoked_reason in ('member', 'superseded'))
  ) is true),

  -- One outcome at most. Without this, a revoked invitation could also read as
  -- accepted and the listing would have to pick a winner.
  constraint account_invitations_outcome_check
    check ((not (accepted_at is not null and revoked_at is not null)) is true),

  constraint account_invitations_window_check check ((expires_at > invited_at) is true)
);

-- At most one LIVE invitation per address per account.
--
-- Scoped to the account ON PURPOSE. A platform-wide constraint would make
-- "already invited" an answer account B could read about account A, which is
-- precisely the cross-account inference AC-12 forbids. Two accounts may
-- therefore hold a live invitation for the same address, and provisioning
-- resolves that deterministically (oldest live invitation wins) rather than by
-- row order.
--
-- `expires_at` is deliberately NOT in the predicate: now() is not immutable, so
-- it cannot appear in an index. An expired-but-unrevoked row therefore still
-- blocks a replacement -- which is what `superseded` is for, and why replacing
-- one is a single statement in lib/members/store.ts rather than a delete.
create unique index account_invitations_live_email_uniq
  on public.account_invitations (account_id, email)
  where accepted_at is null and revoked_at is null;

-- The provisioning lookup: live invitations for one address, oldest first.
create index account_invitations_live_lookup_idx
  on public.account_invitations (email, invited_at, id)
  where accepted_at is null and revoked_at is null;

-- The members surface: one account's invitations, newest first.
create index account_invitations_account_idx
  on public.account_invitations (account_id, invited_at desc, id desc);

-- 037 grants full DML on every new table in `public` by default, so the denial
-- has to be stated. No DELETE: an invitation is revoked, never removed, so an
-- offered membership stays explainable afterwards.
revoke all on public.account_invitations from public;
do $$ begin
  if to_regrole('aeo_app') is not null then
    revoke all on public.account_invitations from aeo_app;
    grant select, insert, update on public.account_invitations to aeo_app;
  end if;
end $$;
