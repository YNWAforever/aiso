import 'server-only'
import { db } from '@/lib/db'
import { staffGrantStatus, type StaffAuditAction, type StaffAuditDto, type StaffGrantDto } from './schema'

/**
 * Studio R3 A2a store (migration 087). Every statement filters by the caller's
 * account, and every write is ONE statement that also checks the acting
 * member is active in that account and appends its audit row — so a grant can
 * never change without its audit line, and no check-then-write window exists.
 * Times use now() (one transaction timestamp) so 087's 90-day CHECK holds exactly.
 */

const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : value == null ? null : String(value))

export async function listStaffGrants(accountId: string): Promise<StaffGrantDto[]> {
  const rows = await db()`
    select g.id, g.granted_at, g.expires_at, g.revoked_at, gp.display_name as grantee_name, u.email as grantee_email,
      bp.display_name as granted_by_name
    from studio_staff_grants g
    join profiles gp on gp.id = g.grantee_profile_id
    left join neon_auth."user" u on u.id = gp.id
    left join profiles bp on bp.id = g.granted_by and bp.account_id = g.account_id
    where g.account_id = ${accountId}::uuid
    order by g.revoked_at is not null, g.granted_at desc, g.id desc
    limit 50`
  const now = new Date()
  return rows.map(row => {
    const grant = { revokedAt: iso(row.revoked_at), expiresAt: iso(row.expires_at)! }
    return {
      id: String(row.id), grantee: { name: (row.grantee_name as string | null) ?? null, email: (row.grantee_email as string | null) ?? null },
      grantedBy: (row.granted_by_name as string | null) ?? null, grantedAt: iso(row.granted_at)!, ...grant, status: staffGrantStatus(grant, now),
    }
  })
}

export async function listStaffAudit(accountId: string): Promise<StaffAuditDto[]> {
  const rows = await db()`
    select a.id, a.action, a.created_at, p.display_name as actor_name, u.email as actor_email, c.brand_name
    from studio_staff_audit a
    join profiles p on p.id = a.actor_profile_id
    left join neon_auth."user" u on u.id = p.id
    left join clients c on c.id = a.client_id and c.account_id = a.account_id
    where a.account_id = ${accountId}::uuid
    order by a.created_at desc, a.id desc
    limit 20`
  return rows.map(row => ({
    id: String(row.id), action: row.action as StaffAuditAction, actor: (row.actor_name as string | null) ?? (row.actor_email as string | null) ?? null,
    brand: (row.brand_name as string | null) ?? null, at: iso(row.created_at)!,
  }))
}

export type GrantResult = 'created' | 'exists' | 'not_member' | 'not_eligible'

/**
 * Grant a platform admin of ANOTHER account access to this account's brands.
 * Eligibility (admin, active, not already in this account) is decided inside
 * the statement; an ineligible address and an unknown one read the same.
 */
export async function createStaffGrant(accountId: string, actorId: string, email: string): Promise<{ result: GrantResult; id?: string }> {
  const [row] = await db()`
    with member as (
      select id from profiles where id = ${actorId}::uuid and account_id = ${accountId}::uuid and deactivated_at is null
    ), staff as (
      select p.id from profiles p join neon_auth."user" u on u.id = p.id
      where lower(btrim(u.email)) = ${email} and p.is_admin = true and p.deactivated_at is null and p.account_id <> ${accountId}::uuid
      limit 1
    ), existing as (
      select g.id from studio_staff_grants g join staff s on s.id = g.grantee_profile_id
      where g.account_id = ${accountId}::uuid and g.revoked_at is null
    ), inserted as (
      insert into studio_staff_grants (account_id, grantee_profile_id, granted_by, granted_at, expires_at)
      select ${accountId}::uuid, s.id, m.id, now(), now() + interval '90 days'
      from staff s cross join member m where not exists (select 1 from existing)
      returning id
    ), audited as (
      insert into studio_staff_audit (account_id, actor_profile_id, action, grant_id)
      select ${accountId}::uuid, ${actorId}::uuid, 'grant', id from inserted
      returning id
    )
    select (select count(*)::int from member) as members, (select count(*)::int from staff) as staff,
      (select id from existing limit 1) as existing_id, (select id from inserted) as id,
      (select count(*)::int from audited) as audited`
  if (!row || row.members === 0) return { result: 'not_member' }
  if (row.staff === 0) return { result: 'not_eligible' }
  if (row.existing_id) return { result: 'exists', id: String(row.existing_id) }
  return { result: 'created', id: String(row.id) }
}

/** Renew (90 days from now) or revoke an unrevoked grant of this account. false = no such grant, or the actor is not an active member. */
export async function changeStaffGrant(accountId: string, actorId: string, grantId: string, action: 'renew' | 'revoke'): Promise<boolean> {
  const rows = action === 'renew'
    ? await db()`
      with member as (select id from profiles where id = ${actorId}::uuid and account_id = ${accountId}::uuid and deactivated_at is null),
      changed as (
        update studio_staff_grants g set renewed_at = now(), expires_at = now() + interval '90 days'
        where g.id = ${grantId}::uuid and g.account_id = ${accountId}::uuid and g.revoked_at is null and exists (select 1 from member)
        returning g.id
      ), audited as (
        insert into studio_staff_audit (account_id, actor_profile_id, action, grant_id)
        select ${accountId}::uuid, ${actorId}::uuid, 'renew', id from changed returning id
      )
      select id from changed`
    : await db()`
      with member as (select id from profiles where id = ${actorId}::uuid and account_id = ${accountId}::uuid and deactivated_at is null),
      changed as (
        update studio_staff_grants g set revoked_at = now(), revoked_by = ${actorId}::uuid
        where g.id = ${grantId}::uuid and g.account_id = ${accountId}::uuid and g.revoked_at is null and exists (select 1 from member)
        returning g.id
      ), audited as (
        insert into studio_staff_audit (account_id, actor_profile_id, action, grant_id)
        select ${accountId}::uuid, ${actorId}::uuid, 'revoke', id from changed returning id
      )
      select id from changed`
  return rows.length === 1
}

/** The live (unrevoked, unexpired) grant letting this staff member into this account, if any. */
export async function loadLiveStaffGrant(accountId: string, granteeId: string): Promise<{ id: string } | null> {
  const [row] = await db()`
    select id from studio_staff_grants
    where account_id = ${accountId}::uuid and grantee_profile_id = ${granteeId}::uuid and revoked_at is null and expires_at > now()
    limit 1`
  return row ? { id: String(row.id) } : null
}

/** Append one staff open/thread line to the client account's audit. */
export async function recordStaffAudit(input: { accountId: string; clientId: string; actorId: string; action: Extract<StaffAuditAction, 'open' | 'thread'> }) {
  await db()`
    insert into studio_staff_audit (account_id, client_id, actor_profile_id, action)
    values (${input.accountId}::uuid, ${input.clientId}::uuid, ${input.actorId}::uuid, ${input.action})`
}
