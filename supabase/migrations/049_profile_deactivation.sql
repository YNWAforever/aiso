-- Removing somebody from a workspace, without deleting them.
--
-- Deletion is not available and never will be. `profiles.account_id` cannot
-- move and the row cannot go, because the composite-FK tenancy chain in
-- 041-046 binds every version, decision, delivery and source that profile
-- authored to `(…, account_id)`. Dropping the row would strand that history —
-- the same reason 047 consumes an invitation at provisioning time rather than
-- moving an existing profile between accounts.
--
-- So removal is deactivation: the row stays, and stops being a way in.
-- `getProfile()` (lib/auth.ts) refuses a deactivated profile, and that is the
-- single chokepoint every gated route passes through — there is no global
-- middleware gate, but there is no gate that does not call getProfile().
--
-- `deactivated_by` carries NO foreign key: 046's rule, a decision is a frozen
-- identity and survives the profile it names. That absence is also exactly
-- what makes the paired CHECK below safe. 044 declared actor columns with
-- `on delete set null` while a CHECK required the actor and its timestamp to
-- be null together, so the referential action performed the write the CHECK
-- forbade and deleting the referenced profile failed on a constraint naming
-- no profile. With no FK there is no referential action to collide with.

alter table public.profiles
  add column deactivated_at timestamptz,
  add column deactivated_by uuid;

-- Removal is one fact recorded two ways; neither half may stand alone.
alter table public.profiles
  add constraint profiles_deactivation_check
  check (((deactivated_at is null) = (deactivated_by is null)) is true);

-- Every membership read filters on this: the members list, the seat cap, and
-- the actor check on each write.
create index profiles_account_active_idx
  on public.profiles (account_id) where deactivated_at is null;
