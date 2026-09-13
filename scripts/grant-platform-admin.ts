import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'

/**
 * Make somebody a platform administrator, or take it away.
 *
 * This exists because `profiles.is_admin` had no writer at all. It gates
 * requireAdmin(), the /admin subtree and — the reason this script was written
 * — `admin/accounts/[accountId]/approvers`, the only route that can grant the
 * `account_approver` role AC-14's approve and request-changes verbs require.
 * Migration 042 fixes the granting actor as `platform_admin` in a CHECK, so
 * that role genuinely is the platform's to give rather than an account's; what
 * was missing was a supported way for the platform to give it.
 *
 * Deliberately NOT a route. An HTTP endpoint that mints administrators would
 * need an administrator to gate it, which is the bootstrap problem restated,
 * and any weaker gate would become the weakest link in the whole authorisation
 * model. Requiring MIGRATE_DATABASE_URL means the caller already holds the
 * database owner credential — an operator secret the running application does
 * not have, even though `aeo_app` could technically perform this UPDATE. That
 * is the boundary being expressed.
 *
 * Usage:
 *   npm run grant-admin -- --list
 *   npm run grant-admin -- --grant <profile-uuid> --reason "why"
 *   npm run grant-admin -- --grant <profile-uuid> --reason "why" --yes
 *   npm run grant-admin -- --revoke <profile-uuid> --reason "why" --yes
 *
 * Without --yes it prints what it would do and writes nothing.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The concrete shape `neon(url)` returns. `ReturnType<typeof neon>` widens both
 * generics to `boolean`, which then refuses the `<false, false>` value every
 * caller actually has -- the same pinning lib/db.ts does.
 */
type Sql = NeonQueryFunction<false, false>

export type AdminGrantPlan =
  | { action: 'list' }
  | { action: 'grant' | 'revoke'; profileId: string; reason: string; apply: boolean }

const KNOWN_FLAGS = ['--list', '--grant', '--revoke', '--reason', '--yes']

/**
 * Strict by design. Every mistake this parser could make is expensive, so an
 * unrecognised flag is an error rather than something ignored — a mistyped
 * `--dry-run` must not be read as consent to write.
 */
export function parseAdminGrantArgs(argv: string[]): AdminGrantPlan {
  const unknown = argv.filter(arg => arg.startsWith('--') && !KNOWN_FLAGS.includes(arg))
  if (unknown.length) throw new Error(`Unknown flag: ${unknown.join(', ')}`)

  const valueOf = (flag: string) => {
    const index = argv.indexOf(flag)
    if (index === -1) return undefined
    const value = argv[index + 1]
    // A flag swallowing the NEXT flag as its value is how `--grant --reason x`
    // would otherwise become a grant to a profile named "--reason".
    return value === undefined || value.startsWith('--') ? '' : value
  }

  const list = argv.includes('--list')
  const grant = valueOf('--grant')
  const revoke = valueOf('--revoke')
  const chosen = [list, grant !== undefined, revoke !== undefined].filter(Boolean)
  if (chosen.length !== 1) {
    throw new Error('Give exactly one of --list, --grant <profile-uuid> or --revoke <profile-uuid>.')
  }
  if (list) return { action: 'list' }

  const action = grant !== undefined ? 'grant' : 'revoke'
  const raw = (grant ?? revoke)!
  if (!UUID.test(raw)) throw new Error(`--${action} needs a profile uuid, got: ${raw || '(nothing)'}`)

  // Mirrors migration 048's CHECK, which mirrors 042's: trimmed, NFC, 1-2000.
  // Normalising here rather than letting the database reject it means the
  // operator reads a sentence instead of a constraint name.
  const reason = (valueOf('--reason') ?? '').normalize('NFC').trim()
  if (!reason) throw new Error('--reason is required, and is recorded in platform_admin_grants.')
  if (reason.length > 2000) throw new Error('--reason must be 2000 characters or fewer.')

  return { action, profileId: raw.toLowerCase(), reason, apply: argv.includes('--yes') }
}

/**
 * The same refusal scripts/migrate.ts makes, for the same reason: falling back
 * to DATABASE_URL would run this as the least-privilege application role and
 * blur exactly the boundary the script exists to hold.
 */
function connectionString(): string {
  const url = process.env.MIGRATE_DATABASE_URL
  if (!url) {
    throw new Error(
      'MIGRATE_DATABASE_URL is not set. Granting platform administration is an operator action ' +
      'performed as the database owner, not as the application role in DATABASE_URL.',
    )
  }
  return url
}

export type AdminGrantOutcome = {
  profileExists: boolean
  changed: boolean
  ledgerId: string | null
}

/**
 * One statement, so the privilege and the reason for it cannot be written
 * apart. The ledger insert draws `from changed`, so it happens exactly when
 * the UPDATE actually altered something — re-granting to somebody who already
 * holds it writes nothing rather than padding the ledger with no-ops.
 */
export async function applyAdminGrant(
  sql: Sql,
  plan: Extract<AdminGrantPlan, { action: 'grant' | 'revoke' }>,
): Promise<AdminGrantOutcome> {
  const value = plan.action === 'grant'
  const rows = (await sql`
    with changed as (
      update profiles set is_admin = ${value}
      where id = ${plan.profileId}::uuid and is_admin is distinct from ${value}
      returning id
    ), recorded as (
      insert into platform_admin_grants (profile_id, action, reason, operator)
      select ${plan.profileId}::uuid, ${plan.action}, ${plan.reason}, current_user from changed
      returning id
    )
    select
      exists (select 1 from profiles where id = ${plan.profileId}::uuid) as profile_exists,
      exists (select 1 from changed) as changed,
      (select id from recorded) as ledger_id
  `) as Array<Record<string, unknown>>
  const row = rows[0]
  return {
    profileExists: row?.profile_exists === true,
    changed: row?.changed === true,
    ledgerId: (row?.ledger_id as string | null) ?? null,
  }
}

export async function listAdministrators(sql: Sql) {
  return (await sql`
    select p.id, p.display_name, p.account_id,
      to_char(p.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at
    from profiles p where p.is_admin is true
    order by p.created_at asc, p.id asc
  `) as Array<Record<string, unknown>>
}

async function main(): Promise<void> {
  const plan = parseAdminGrantArgs(process.argv.slice(2))
  const sql = neon(connectionString())

  if (plan.action === 'list') {
    const admins = await listAdministrators(sql)
    if (!admins.length) {
      console.log('No platform administrators.')
      return
    }
    for (const admin of admins) {
      console.log(`${admin.id}  ${admin.display_name ?? '(no name)'}  account=${admin.account_id}`)
    }
    return
  }

  if (!plan.apply) {
    console.log(
      `DRY RUN - would ${plan.action} platform administration for ${plan.profileId}\n` +
      `  reason: ${plan.reason}\n` +
      'Nothing was written. Re-run with --yes to apply.',
    )
    return
  }

  const outcome = await applyAdminGrant(sql, plan)
  if (!outcome.profileExists) {
    throw new Error(
      `No profile ${plan.profileId}. A profile exists only after that person has signed in at ` +
      'least once - Neon Auth owns neon_auth.user, and profiles.id is a foreign key to it.',
    )
  }
  if (!outcome.changed) {
    console.log(`No change: ${plan.profileId} already has is_admin=${plan.action === 'grant'}.`)
    return
  }
  console.log(
    `${plan.action === 'grant' ? 'Granted' : 'Revoked'} platform administration for ` +
    `${plan.profileId}. Ledger row ${outcome.ledgerId}.`,
  )
}

/** The same guard scripts/migrate.ts uses, so importing this file runs nothing. */
function isDirectInvocation(): boolean {
  if (!process.argv[1]) return false
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
}

if (isDirectInvocation()) {
  main().catch((error: unknown) => {
    // Never print the thrown value whole: the Neon driver echoes the full
    // connection URL, password included, in its error messages.
    console.error(error instanceof Error ? error.message : 'Failed.')
    process.exitCode = 1
  })
}
