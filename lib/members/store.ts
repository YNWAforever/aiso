import 'server-only'
import { db } from '@/lib/db'
import {
  INVITATION_TTL_MS,
  MAX_ACCOUNT_MEMBERS,
  deriveInvitationStatus,
  normalizeInvitationEmail,
  type InvitationStatus,
} from './schema'

/**
 * Reads and writes for account membership.
 *
 * Every statement carries its tenancy inline — `account_id` is a predicate on
 * the write itself rather than a check performed beforehand, which is the shape
 * CLAUDE.md prefers and `prompts/[promptId]/route.ts` already uses: one
 * statement, no TOCTOU window, and zero rows means "not yours" without
 * distinguishing that from "absent". The caller supplies `accountId` from its
 * own session, but this module never assumes that it did.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function uuid(value: string): string {
  if (!UUID.test(value)) throw new Error('INVALID_INVITATION_INPUT')
  return value.toLowerCase()
}

export type AccountMember = {
  profileId: string
  displayName: string | null
  /** Holds a live `account_approver` grant, i.e. `can_decide` can be true. */
  approver: boolean
  /** False once removed. The row stays; it stops being a way in. */
  active: boolean
  joinedAt: string
}

export type AccountInvitation = {
  id: string
  email: string
  status: InvitationStatus
  invitedAt: string
  expiresAt: string
}

export type AccountMembersPage = {
  members: AccountMember[]
  invitations: AccountInvitation[]
}

/** Newest invitations first; revoked and accepted ones stay readable. */
const INVITATION_PAGE = 100

export async function loadAccountMembers(accountId: string): Promise<AccountMembersPage> {
  const account = uuid(accountId)
  const sql = db()

  // The approver join is the same three-table chain `can_decide` walks
  // (lib/change-sets/store.ts): state alone is not enough, because a revoke
  // writes state too — the event behind the current revision must be a grant.
  const memberRows = (await sql`
    select p.id, p.display_name,
      to_char(p.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as joined_at,
      coalesce(s.active and e.action = 'grant', false) as approver,
      p.deactivated_at is null as active
    from profiles p
    left join account_approver_state s
      on s.account_id = p.account_id and s.profile_id = p.id
    left join account_approver_events e
      on e.account_id = s.account_id and e.profile_id = s.profile_id
     and e.new_revision = s.revision and e.id = s.last_event_id
    where p.account_id = ${account}::uuid
    order by p.created_at asc, p.id asc
  `) as Array<Record<string, unknown>>

  // `registered` is computed here rather than stored, because "this address
  // already has an auth user" is the only thing separating a pending
  // invitation from one that can never be consumed.
  const invitationRows = (await sql`
    select i.id, i.email,
      to_char(i.invited_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as invited_at,
      to_char(i.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as expires_at,
      to_char(i.accepted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as accepted_at,
      to_char(i.revoked_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as revoked_at,
      exists (
        select 1 from neon_auth.user u where lower(btrim(u.email)) = i.email
      ) as registered
    from account_invitations i
    where i.account_id = ${account}::uuid
    order by i.invited_at desc, i.id desc
    limit ${INVITATION_PAGE}
  `) as Array<Record<string, unknown>>

  const now = Date.now()
  return {
    members: memberRows.map(row => ({
      profileId: String(row.id),
      displayName: (row.display_name as string | null) ?? null,
      approver: row.approver === true,
      active: row.active === true,
      joinedAt: String(row.joined_at),
    })),
    invitations: invitationRows.map(row => ({
      id: String(row.id),
      email: String(row.email),
      invitedAt: String(row.invited_at),
      expiresAt: String(row.expires_at),
      status: deriveInvitationStatus(
        {
          acceptedAt: (row.accepted_at as string | null) ?? null,
          revokedAt: (row.revoked_at as string | null) ?? null,
          expiresAt: String(row.expires_at),
          registered: row.registered === true,
        },
        now,
      ),
    })),
  }
}

export type CreateInvitationResult =
  | { kind: 'created'; invitation: AccountInvitation }
  /** The actor is not a member of the account being invited into. */
  | { kind: 'denied' }
  | { kind: 'already_member' }
  | { kind: 'already_registered' }
  | { kind: 'duplicate' }
  | { kind: 'limit_reached' }

/**
 * Two statements, not one.
 *
 * Freeing the slot an expired invitation still occupies has to commit before
 * the insert is attempted, because `account_invitations_live_email_uniq` cannot
 * mention now() and therefore still counts that row as live. Data-modifying
 * CTEs within one statement do not see each other's effects, and the order in
 * which each touches the index is unspecified, so folding these together would
 * raise a unique violation for a row this very call had just revoked. A
 * non-interactive batch gives statement 2 its own snapshot, which is exactly
 * what is needed — the same reasoning the provisioning webhook states.
 *
 * The second statement diagnoses and inserts together so the answer cannot
 * disagree with the outcome: a separate "may I?" query would be a TOCTOU window
 * in which the cap is checked against one state and enforced against another.
 */
export async function createInvitation({
  accountId,
  invitedBy,
  email,
}: {
  accountId: string
  invitedBy: string
  email: string
}): Promise<CreateInvitationResult> {
  const account = uuid(accountId)
  const actor = uuid(invitedBy)
  const address = normalizeInvitationEmail(email)
  const ttlSeconds = Math.floor(INVITATION_TTL_MS / 1000)
  const sql = db()

  const results = await sql.transaction([
    sql`
      update account_invitations
      set revoked_at = now(), revoked_reason = 'superseded'
      where account_id = ${account}::uuid and email = ${address}
        and accepted_at is null and revoked_at is null and expires_at <= now()
        and exists (
          select 1 from profiles p
          where p.id = ${actor}::uuid and p.account_id = ${account}::uuid
            and p.deactivated_at is null
        )
    `,
    sql`
      with actor as (
        -- Deactivated members keep their row but may not act.
        select 1 from profiles p
        where p.id = ${actor}::uuid and p.account_id = ${account}::uuid
          and p.deactivated_at is null
      ), member_match as (
        -- Cast both sides to text so this holds whether neon_auth.user.id is
        -- uuid or text. These tables are small enough that the cast costs
        -- nothing, and guessing wrong would be a silent false negative.
        select 1 from profiles p
        join neon_auth.user u on u.id::text = p.id::text
        where p.account_id = ${account}::uuid and lower(btrim(u.email)) = ${address}
      ), registered as (
        select 1 from neon_auth.user u where lower(btrim(u.email)) = ${address}
      ), live as (
        select 1 from account_invitations
        where account_id = ${account}::uuid and email = ${address}
          and accepted_at is null and revoked_at is null
      ), capacity as (
        select (select count(*) from profiles
                 where account_id = ${account}::uuid and deactivated_at is null)
             + (select count(*) from account_invitations
                 where account_id = ${account}::uuid
                   and accepted_at is null and revoked_at is null
                   and expires_at > now()) as used
      ), inserted as (
        insert into account_invitations (account_id, email, invited_by, expires_at)
        select ${account}::uuid, ${address}, ${actor}::uuid,
               now() + make_interval(secs => ${ttlSeconds})
        where exists (select 1 from actor)
          and not exists (select 1 from member_match)
          and not exists (select 1 from registered)
          and not exists (select 1 from live)
          and (select used from capacity) < ${MAX_ACCOUNT_MEMBERS}
        returning id, email,
          to_char(invited_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as invited_at,
          to_char(expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as expires_at
      )
      select
        exists (select 1 from actor) as actor_ok,
        exists (select 1 from member_match) as already_member,
        exists (select 1 from registered) as registered,
        exists (select 1 from live) as duplicate,
        (select used from capacity) as used,
        (select to_jsonb(i) from inserted i) as invitation
    `,
  ])

  const row = (results.at(-1) as Array<Record<string, unknown>> | undefined)?.[0]
  if (!row || row.actor_ok !== true) return { kind: 'denied' }
  // Precedence is deliberate. `already_member` and `duplicate` are facts about
  // the caller's OWN account, so they may be stated plainly. `already_registered`
  // is a fact about the platform, so it is reached only when neither of those
  // explains the refusal — see the note on the service.
  if (row.already_member === true) return { kind: 'already_member' }
  if (row.duplicate === true) return { kind: 'duplicate' }
  if (row.registered === true) return { kind: 'already_registered' }
  if (Number(row.used) >= MAX_ACCOUNT_MEMBERS) return { kind: 'limit_reached' }

  const invitation = row.invitation as Record<string, unknown> | null
  if (!invitation) {
    // Every refusal above is accounted for, so reaching here means the insert's
    // conditions and these branches have drifted apart. Throwing surfaces that
    // as a 5xx rather than letting a caller report a success that never wrote.
    throw new Error('INVITATION_NOT_CREATED')
  }
  return {
    kind: 'created',
    invitation: {
      id: String(invitation.id),
      email: String(invitation.email),
      invitedAt: String(invitation.invited_at),
      expiresAt: String(invitation.expires_at),
      status: 'pending',
    },
  }
}

/**
 * Withdraw an invitation. Returns false for "not yours", "already decided" and
 * "no such id" alike — the id came from the caller, so distinguishing them
 * would confirm that an id belongs to somebody.
 */
export async function revokeInvitation({
  accountId,
  invitationId,
  revokedBy,
}: {
  accountId: string
  invitationId: string
  revokedBy: string
}): Promise<boolean> {
  const account = uuid(accountId)
  const invitation = uuid(invitationId)
  const actor = uuid(revokedBy)
  const sql = db()

  // `revoked_by` carries no foreign key — it is a frozen identity under 046 —
  // so membership of the account is asserted here rather than by the schema.
  const rows = await sql`
    update account_invitations
    set revoked_at = now(), revoked_by = ${actor}::uuid, revoked_reason = 'member'
    where id = ${invitation}::uuid
      and account_id = ${account}::uuid
      and accepted_at is null and revoked_at is null
      and exists (
        select 1 from profiles p
        where p.id = ${actor}::uuid and p.account_id = ${account}::uuid
          and p.deactivated_at is null
      )
    returning id
  `
  return rows.length > 0
}

export type SetMemberActiveResult = 'updated' | 'unchanged' | 'self' | 'not_found'

/**
 * Remove somebody from the workspace, or put them back.
 *
 * Removal is deactivation — see migration 049 for why deletion is not on the
 * table. Restoring exists because it has to: a removed person keeps their
 * `neon_auth.user` row, so re-inviting them answers `already_registered`, and
 * without a restore an accidental removal would be permanent.
 *
 * There is no "last active member" guard, and that is not an omission. With N
 * active members, removing anyone but yourself leaves N-1 >= 1; removing
 * yourself is refused; and a deactivated member cannot act at all. The
 * self-check is therefore the whole guarantee that an account stays reachable,
 * and a separate rule would be dead code that read like a safety net.
 *
 * One statement: the diagnosis and the write share a snapshot, so the answer
 * cannot describe a state the write did not act on.
 */
export async function setMemberActive({
  accountId,
  profileId,
  actorId,
  active,
}: {
  accountId: string
  profileId: string
  actorId: string
  active: boolean
}): Promise<SetMemberActiveResult> {
  const account = uuid(accountId)
  const target = uuid(profileId)
  const actor = uuid(actorId)
  const sql = db()

  const rows = (await sql`
    with actor as (
      select 1 from profiles
      where id = ${actor}::uuid and account_id = ${account}::uuid
        and deactivated_at is null
    ), target as (
      select deactivated_at from profiles
      where id = ${target}::uuid and account_id = ${account}::uuid
    ), changed as (
      update profiles set
        deactivated_at = case when ${active} then null else now() end,
        deactivated_by = case when ${active} then null else ${actor}::uuid end
      where id = ${target}::uuid and account_id = ${account}::uuid
        and ${target} <> ${actor}
        and exists (select 1 from actor)
        -- Only when the state actually differs, so a repeat call cannot
        -- rewrite who removed them, or when they were removed.
        and (deactivated_at is null) <> ${active}
      returning id
    )
    select
      exists (select 1 from actor) as actor_ok,
      exists (select 1 from target) as target_ok,
      exists (select 1 from changed) as changed
  `) as Array<Record<string, unknown>>

  const row = rows[0]
  // Actor and target failures share one answer on purpose: the id came from
  // the caller, so distinguishing them would confirm that a profile exists.
  if (!row || row.actor_ok !== true || row.target_ok !== true) return 'not_found'
  if (target === actor) return 'self'
  return row.changed === true ? 'updated' : 'unchanged'
}
