/**
 * Installs the greenfield schema baseline onto ONE named, empty target.
 *
 *   BOOTSTRAP_PROJECT_ID=... BOOTSTRAP_BRANCH_ID=... BOOTSTRAP_DATABASE_URL=... \
 *     npm run bootstrap:project
 *
 * Deliberately NOT the same shape as scripts/schema-equivalence.mjs. That script
 * must refuse anything but a disposable branch it created itself; this one must
 * ACCEPT a real branch by name while refusing a database that already has
 * content. Merging them would mean weakening the guard least worth weakening.
 *
 * The guards below are exported and unit-tested without a database, because they
 * are the decisions that could destroy data.
 */

/** Production. Refused by id, never by convention. */
export const PRODUCTION_PROJECT_ID = 'red-firefly-93523049'

/**
 * The target, read from the environment. There is NO default and there must
 * never be one: a defaulted target is how a stale variable reaches a database
 * nobody meant to touch.
 *
 * `?.trim() ||` rather than `??` -- deploy environments substitute '' for a
 * variable that is declared but has no value, and '' is not a target.
 */
export function resolveTarget(env = process.env) {
  const projectId = String(env.BOOTSTRAP_PROJECT_ID ?? '').trim()
  const branchId = String(env.BOOTSTRAP_BRANCH_ID ?? '').trim()
  const connectionUri = String(env.BOOTSTRAP_DATABASE_URL ?? '').trim()

  const missing = [
    !projectId && 'BOOTSTRAP_PROJECT_ID',
    !branchId && 'BOOTSTRAP_BRANCH_ID',
    !connectionUri && 'BOOTSTRAP_DATABASE_URL',
  ].filter(Boolean)

  if (missing.length) {
    throw new Error(
      `Refusing to run: ${missing.join(', ')} not set (or empty). This script has no ` +
      'default target, deliberately -- name the project, branch and connection explicitly.',
    )
  }
  return { projectId, branchId, connectionUri }
}

/**
 * Asks the connection who it is, and compares that to who we meant to reach.
 *
 * Neon exposes neon.project_id / neon.branch_id as GUCs, so the target
 * identifies itself IN BAND on the very session that will run the statements,
 * rather than being inferred from a variable that could be stale. Absent GUCs
 * read as null and fail the comparison -- it fails closed.
 */
export function assertTargetIdentity(target, reported) {
  const onProject = reported?.projectId ?? null
  const onBranch = reported?.branchId ?? null

  if (!onProject || !onBranch) {
    throw new Error(
      'Refusing to act: the connection did not report neon.project_id / neon.branch_id. ' +
      'Absent GUCs read as null and this check fails closed rather than guessing.',
    )
  }
  if (onProject === PRODUCTION_PROJECT_ID) {
    throw new Error(
      `Refusing to act: the connection reports project ${onProject}, which is production. ` +
      'This script never touches production, whatever it was asked to do.',
    )
  }
  if (onProject !== target.projectId || onBranch !== target.branchId) {
    throw new Error(
      `Refusing to act: the connection reports branch ${onBranch} in project ${onProject}, ` +
      `but the target is ${target.branchId} in ${target.projectId}.`,
    )
  }
}

/**
 * A baseline installs onto an empty schema. Anything already there means this
 * is not a fresh project, and applying 3200 lines of DDL over it is not a
 * recovery procedure.
 */
export function assertEmptyPublicSchema(tableCount) {
  // Number() is far too permissive for a "did we actually read a value" check:
  // Number(null), Number(''), Number([]) and Number(false) are all 0, so an
  // unreadable count would sail through as "empty" and the caller would apply
  // the whole baseline over a database it never actually inspected. Reject
  // anything that is not a string or a number before coercing -- and reject
  // an empty (or whitespace-only) string explicitly, because it is still a
  // `string` and Number('') is *also* 0, so the typeof check alone does not
  // catch it.
  if (typeof tableCount !== 'string' && typeof tableCount !== 'number') {
    throw new Error(
      `Refusing to act: could not read the public table count (got ${JSON.stringify(tableCount)}).`,
    )
  }
  if (typeof tableCount === 'string' && tableCount.trim() === '') {
    throw new Error(
      `Refusing to act: could not read the public table count (got ${JSON.stringify(tableCount)}).`,
    )
  }
  const count = Number(tableCount)
  if (!Number.isInteger(count)) {
    throw new Error(
      `Refusing to act: could not read the public table count (got ${JSON.stringify(tableCount)}).`,
    )
  }
  if (count !== 0) {
    throw new Error(
      `Refusing to act: schema public already has ${count} table(s), so this is not a fresh ` +
      'project. To rebuild one deliberately, reset it first: ' +
      'drop schema public cascade; create schema public;',
    )
  }
}
