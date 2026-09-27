import type { NeonQueryFunction } from '@neondatabase/serverless'

/**
 * The approved disposable target for the four cross-account tenancy suites.
 *
 * Those suites delete rows. They ran in the default integration project, where
 * `setup.ts` provisions their branch, and that was safe — but it was safe by
 * *ownership of the config*, not by anything the suite itself checked: point
 * TEST_DATABASE_URL somewhere else and they would have run happily against it.
 * The five older exact-target suites answer this by naming the branch they
 * expect and refusing anything else, and these four now do the same.
 *
 * One variable set for all four rather than four near-identical sets. The older
 * suites each carry their own prefix (C9_, C9C_, C9D_, C9E_) because each was
 * approved separately by a human at a different time; these four are one
 * decision, and four copies of the same three names would only invite three of
 * them to drift.
 */
export const TENANCY_TARGET_VARIABLES = 'C9F_TENANCY_DISPOSABLE_BRANCH_ID, C9F_TENANCY_PROJECT_ID and C9F_TENANCY_OWNER_ROLE'

export type TenancyTarget = {
  branch: string
  project: string
  role: string
}

/** Null when any part is missing — the caller turns that into one loud failure. */
export function approvedTenancyTarget(): TenancyTarget | null {
  const branch = process.env.C9F_TENANCY_DISPOSABLE_BRANCH_ID?.trim()
  const project = process.env.C9F_TENANCY_PROJECT_ID?.trim()
  const role = process.env.C9F_TENANCY_OWNER_ROLE?.trim()
  if (!branch || !project || !role) return null
  // A branch id is `br-` plus lowercase words and digits. Checked here so a
  // half-set value (an empty expansion, a literal '$VAR') cannot pass for an
  // approval — the same reason the older suites pattern-match theirs.
  if (!/^br-[a-z0-9-]+$/.test(branch)) return null
  return { branch, project, role }
}

/**
 * The in-band half: ask the database it is actually connected to who and where
 * it is, and refuse unless that matches the approval.
 *
 * `neon.project_id` and `neon.branch_id` are set by Neon on the connection, so
 * they describe the real target rather than what the caller claimed. The role
 * check matters separately: these suites write and delete across a dozen tables,
 * so a connection that is not the branch owner would fail deep inside a fixture
 * with a permission error instead of here with an explanation.
 *
 * Deliberately NOT a protected-branch deny-list. A deny-list answers "is this
 * one of the branches we know to avoid"; this answers "is this the exact branch
 * approved for this run", and only the second is still true the day someone adds
 * a new persistent branch.
 */
export async function assertDisposableTenancyTarget(
  sql: NeonQueryFunction<false, false>,
  target: TenancyTarget,
): Promise<void> {
  const [identity] = (await sql`
    select
      current_setting('neon.project_id', true) as project,
      current_setting('neon.branch_id', true) as branch,
      current_user as role
  `) as Array<{ project: string | null; branch: string | null; role: string | null }>

  const mismatches = [
    identity?.project === target.project ? null : `project ${identity?.project ?? 'unknown'}`,
    identity?.branch === target.branch ? null : `branch ${identity?.branch ?? 'unknown'}`,
    identity?.role === target.role ? null : `role ${identity?.role ?? 'unknown'}`,
  ].filter(Boolean)

  if (mismatches.length) {
    // The approved values are not repeated in the message: the point is to say
    // what was reached, not to help someone edit their way past the check.
    throw new Error(
      'Disposable tenancy target mismatch — refusing to run. '
      + `The connected database reports ${mismatches.join(', ')}, which is not the approved target. `
      + 'These suites delete rows; run them through scripts/ci/run-exact-target-suites.mjs.',
    )
  }
}
