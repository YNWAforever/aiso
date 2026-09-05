import { redactSecrets } from '@/lib/security/redact-secrets'

/**
 * Which database is this connection actually talking to?
 *
 * On 2026-09-05 `.env.local`'s DATABASE_URL was found pointing at the AISO Neon
 * project as `neondb_owner` — the database owner, carrying DDL rights the
 * application is explicitly designed not to have (migration 037 exists to take
 * them away) — with a password that had since been rotated out from under it.
 * It had been that way since 2026-09-02, and nothing caught it: not a test, not
 * the application, not CI. It surfaced only because a human ran
 * scripts/verify-db-connection.mjs by hand.
 *
 * A CI-only test would not have caught it either. CI verifies CI's own binding,
 * which was never the one that was wrong — the wrong binding lived in a
 * developer's local environment and would live just as happily in a
 * mis-set Vercel variable. That is why the guard this module decides for runs
 * in the query path (lib/db.ts) rather than in a suite, and why it fails closed.
 *
 * This half is deliberately pure: an observed tuple plus an expectation in, a
 * verdict out. No I/O, no environment reads at decision time, so every rule
 * below is testable without a database.
 *
 * The identity mechanism is not invented here. `__tests__/integration/setup.ts`
 * has used it since it was written: Neon exposes `neon.project_id` and
 * `neon.branch_id` as GUCs, so the connection answers *in band, on the very
 * session that will run the statements* rather than being inferred from a
 * variable that may itself be the thing that is wrong. Absent GUCs read as null
 * and compare unequal, which fails closed.
 */

/** What the connection said about itself, plus the host we dialled. */
export type ObservedBinding = {
  /** `current_setting('neon.project_id', true)` — null when the GUC is absent. */
  projectId: string | null
  /** `current_setting('neon.branch_id', true)` — null when the GUC is absent. */
  branchId: string | null
  /** `current_user`. */
  role: string
  /** `current_database()`. */
  database: string
  /** The endpoint host from the connection string. Never the full DSN. */
  host: string
}

export type BindingExpectation = {
  /** Mandatory. Absent is a configuration error, not a soft failure. */
  projectId?: string
  /** Optional; compared only when set. */
  branchId?: string
  /** Optional; compared only when set. */
  role?: string
  /** Optional; compared only when set. */
  database?: string
  forbiddenProjectIds?: string[]
  forbiddenBranchIds?: string[]
  forbiddenHosts?: string[]
}

/**
 * `reason` is declared (as `undefined`) on the accepting arm too, so a caller
 * can read `verdict.reason` without narrowing first — a guard that made you
 * write the narrowing before you could log why it failed would get logged
 * badly. `ok` still discriminates, so `if (!verdict.ok)` narrows `reason` to
 * `string` where it matters.
 */
export type BindingVerdict =
  | { ok: true; reason?: undefined }
  | { ok: false; reason: string }

/** How an absent GUC reads in a reason — mirrors __tests__/integration/setup.ts. */
const ABSENT = 'unknown'

function fail(reason: string): BindingVerdict {
  // Every reason goes through redactSecrets on the way out. Reasons name
  // project ids, branch ids, role names and database names, none of which are
  // secrets — but `host` is taken from a connection string, and if a caller
  // ever hands this a full DSN instead of a hostname, the password must not
  // reach a log, an error page or a test snapshot. This is the choke point.
  return { ok: false, reason: redactSecrets(reason) }
}

/**
 * The mandatory half of the expectation, split out so it can be raised BEFORE a
 * connection is opened as well as from inside checkBinding().
 *
 * lib/db.ts calls this first: with the variable missing there is nothing an
 * identity query could tell us, and failing here means an operator sees "the
 * variable is unset" rather than whatever the connection attempt happens to say
 * (a fixture DSN in CI reports a refused socket, which names the wrong problem).
 * One rule, one message, two call sites — checkBinding still enforces it, so a
 * caller that skips this cannot skip the rule.
 */
export function assertExpectationConfigured(
  expected: BindingExpectation,
): asserts expected is BindingExpectation & { projectId: string } {
  if (!expected.projectId) {
    throw new Error(
      'EXPECTED_NEON_PROJECT_ID is not set. The database binding guard cannot verify which ' +
      'Neon project this connection reaches, so it refuses to let the query run. Set ' +
      'EXPECTED_NEON_PROJECT_ID (a non-secret identifier — see .env.example).',
    )
  }
}

/**
 * Decides whether a connection is the one this process was configured to use.
 *
 * Rules, in the order they are applied:
 *
 *  1. A missing `projectId` expectation THROWS. An application that cannot
 *     prove which database it is talking to should not serve, and a verdict of
 *     `{ok: false}` here would be indistinguishable from a real mismatch — the
 *     operator needs to be told the variable is missing, not that the database
 *     is wrong.
 *  2. Blocklists win over the allow-list. A connection matching both is a
 *     configuration error in itself, and the safe reading of a contradiction is
 *     the forbidding one.
 *  3. Project id must match. Branch, role and database are compared ONLY when
 *     their expectation is set — that is what lets the integration harness keep
 *     the guard armed: its ephemeral branches live inside the same project, so
 *     the project id matches while the branch id differs on every run.
 */
export function checkBinding(
  observed: ObservedBinding,
  expected: BindingExpectation,
): BindingVerdict {
  assertExpectationConfigured(expected)

  const onProject = observed.projectId ?? ABSENT
  const onBranch = observed.branchId ?? ABSENT

  if (expected.forbiddenProjectIds?.includes(onProject)) {
    return fail(`connected to Neon project ${onProject}, which is forbidden by FORBIDDEN_NEON_PROJECT_IDS`)
  }
  if (expected.forbiddenBranchIds?.includes(onBranch)) {
    return fail(`connected to Neon branch ${onBranch}, which is forbidden by FORBIDDEN_NEON_BRANCH_IDS`)
  }
  if (expected.forbiddenHosts?.includes(observed.host)) {
    return fail(`connected to host ${observed.host}, which is forbidden by FORBIDDEN_DB_HOSTS`)
  }

  if (onProject !== expected.projectId) {
    return fail(
      `wrong Neon project: expected ${expected.projectId}, connected to ${onProject}`,
    )
  }
  if (expected.branchId && onBranch !== expected.branchId) {
    return fail(`wrong Neon branch: expected ${expected.branchId}, connected to ${onBranch}`)
  }
  if (expected.role && observed.role !== expected.role) {
    return fail(`wrong database role: expected ${expected.role}, connected as ${observed.role}`)
  }
  if (expected.database && observed.database !== expected.database) {
    return fail(
      `wrong database: expected ${expected.database}, connected to ${observed.database}`,
    )
  }

  return { ok: true }
}

/**
 * A blank value is treated as absent.
 *
 * GitHub Actions substitutes '' for a `${{ secrets.X }}` reference whose secret
 * does not exist, and an expectation of '' compares unequal to every real
 * identifier — it would fail every query rather than being ignored. The same
 * `?.trim() || undefined` shape guards __tests__/helpers/neon-branch.ts.
 */
function value(name: string): string | undefined {
  return process.env[name]?.trim() || undefined
}

/** Comma-separated, trimmed, empties dropped — '' must never become a blocklist entry. */
function list(name: string): string[] {
  return (process.env[name] ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

/** The impure half: the seven variables documented in .env.example. */
export function readExpectationFromEnv(): BindingExpectation {
  return {
    projectId: value('EXPECTED_NEON_PROJECT_ID'),
    branchId: value('EXPECTED_NEON_BRANCH_ID'),
    role: value('EXPECTED_DB_ROLE'),
    database: value('EXPECTED_DB_NAME'),
    forbiddenProjectIds: list('FORBIDDEN_NEON_PROJECT_IDS'),
    forbiddenBranchIds: list('FORBIDDEN_NEON_BRANCH_IDS'),
    forbiddenHosts: list('FORBIDDEN_DB_HOSTS'),
  }
}
