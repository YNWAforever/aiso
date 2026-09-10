-- 044 recorded the two source DECISIONS -- who revoked a source, who approved a
-- version -- as foreign keys into profiles with `on delete set null`, while a
-- CHECK on each table requires the actor and its timestamp to be null together:
--
--   client_sources_revoked_actor_fk            on delete set null (revoked_by)
--   client_sources_revocation_check            (revoked_at is null) = (revoked_by is null)
--   client_source_versions_approved_actor_fk   on delete set null (approved_by)
--   client_source_versions_approval_check      (approved_at is null) = (approved_by is null)
--
-- The clauses contradict each other. The referential action performs exactly the
-- write the CHECK forbids, so deleting the referenced profile fails. Neither
-- clause states that intent; it emerges from their disagreement, which is why the
-- error names a check constraint rather than anything about profiles.
--
-- It is present TWICE, and the versions half matters more -- client_source_versions
-- is append-only, so an approval is meant to be the most durable record in the
-- feature. Until now it was masked: PostgreSQL fires the referential triggers in
-- constraint-creation order, so client_sources raised first and the versions half
-- was never reached.
--
-- 042, 043 and 045 already settled this for the same feature family and say so out
-- loud. 042: "No profile FK: frozen identities intentionally survive profile
-- removal." 043: "No profile FK: actor snapshots survive removal." Neither they
-- nor 045 declares a single profiles foreign key. 044 is the outlier, and this
-- brings it into line rather than inventing a new rule.
--
-- The CHECKs are NOT relaxed. They make a decision indivisible ON WRITE, which is
-- the property worth keeping: a revocation with no actor, or an approval with no
-- approver, is a worse record than none. Relaxing them would also buy nothing --
-- `delete from accounts` still fails on client_source_versions_owned_source_fk,
-- which is `on delete restrict` by design.
--
-- created_by and imported_by keep their FK and their `set null`. They carry no
-- paired CHECK, so SET NULL is a real working behaviour there rather than a
-- contradiction, and losing "who first pasted this" when a colleague leaves is
-- acceptable in a way that losing "who approved it" is not. That asymmetry --
-- provenance is erasable, a decision is not -- is the point of this change.
--
-- Tenancy is not weakened. accountId and actorId are read from the same
-- getProfile() row in lib/sources/service.ts, so an actor belonging to another
-- account was never constructible; the composite FK asserted an invariant the
-- application already holds by construction.
--
-- This migration creates no relation, so `npm run migrate -- --verify` reports
-- `n/a` for it, permanently and correctly -- the same way 004, 007 and 009 read.
-- Do not add an index to give the verifier something to find: an `all present`
-- earned by an object nothing reads proves nothing about the DDL that matters.

alter table public.client_sources
  drop constraint client_sources_revoked_actor_fk;

alter table public.client_source_versions
  drop constraint client_source_versions_approved_actor_fk;
