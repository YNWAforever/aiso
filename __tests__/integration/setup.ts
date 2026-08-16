import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { Client, neonConfig } from '@neondatabase/serverless'
import {
  assertDisposableTestBranch,
  createTestBranch,
  createdBranchIds,
  deleteTestBranch,
  PROJECT_ID,
  type TestBranch,
} from '../helpers/neon-branch'

/**
 * A Neon branch is a copy-on-write snapshot of its parent, not an empty
 * database — `neonctl branches create` has no "start with nothing" option.
 * Its parent defaults to the project's default branch (production), which
 * already carries every table but no `schema_migrations` ledger. Left as
 * is, migrate.ts's assertBaselined() guard (correctly) refuses to touch it.
 * Drop and recreate `public` so the branch is genuinely empty before
 * migrating. What makes that safe is that the schemas the migrations depend
 * on live OUTSIDE `public` and therefore survive the cascade — there are two,
 * not one, and both are load-bearing:
 *
 *   neon_auth — provisioned by Neon Auth, never by SQL in this repo. Migration
 *               022 FKs profiles.id into neon_auth.user.
 *   auth      — the DEAD Supabase schema. Migration 003 FKs auth.users and
 *               calls auth.uid() in the policies it creates. Nothing here
 *               creates the schema either.
 *
 * That second one is a trap, and it is why `auth` is still here. Migration 036
 * dropped the inert policies, but deliberately did NOT drop this schema: doing
 * so would stop this harness provisioning a branch at all, because setup
 * re-runs 003 from scratch every time and 003 needs auth.users and auth.uid()
 * to exist. Retiring `auth` means shimming it here first, and is its own change.
 *
 * (Creating a fresh, empty *database* instead would avoid the drop entirely,
 * but it would carry neither schema, so 003 and 022 could not apply.)
 *
 * NOTE: this used to justify itself with "no migration creates a Postgres
 * extension". That stopped being true when 027 added
 * `create extension if not exists pgcrypto with schema public`. The conclusion
 * survives — a public-schema pgcrypto is dropped by the cascade and recreated
 * by 027 — but the reason does not, so do not lean on it.
 *
 * `drop schema public cascade` against production would destroy the business,
 * so this runs only after three independent proofs that it will not:
 *
 *  1. The argument is a TestBranch, not a connection string, so no refactor
 *     can hand this function `process.env.DATABASE_URL` in passing.
 *  2. assertDisposableTestBranch() requires the id *and* the exact uri to be
 *     in the private registry that only this process's own successful
 *     createTestBranch() writes to, rejects the production branch id, and
 *     rejects any host matching the production DATABASE_URL.
 *  3. The decisive one: the connection that will execute the drop is asked
 *     who it is. Neon exposes neon.branch_id / neon.project_id as GUCs, so
 *     the target identifies itself in band on the very session that runs the
 *     statement, rather than being inferred from a variable. Absent GUCs read
 *     as null and fail the comparison — it fails closed.
 */
async function resetPublicSchema(branch: TestBranch): Promise<void> {
  assertDisposableTestBranch(branch)

  neonConfig.webSocketConstructor = globalThis.WebSocket
  // A single Client rather than a Pool, so the session that answers the
  // identity question below is unambiguously the session that runs the drop.
  const client = new Client({ connectionString: branch.connectionUri })
  // Deleting a branch terminates its sessions with FATAL 57P01. Without a
  // listener the driver rethrows that on the process, which both crashes the
  // run and dumps the client — connection password included — to the log.
  client.on('error', () => {})
  await client.connect()
  try {
    const { rows } = await client.query(
      "select current_setting('neon.project_id', true) as project_id, " +
      "current_setting('neon.branch_id', true) as branch_id",
    )
    const onProject = rows[0]?.project_id ?? 'unknown'
    const onBranch = rows[0]?.branch_id ?? 'unknown'
    if (onProject !== PROJECT_ID || onBranch !== branch.id) {
      throw new Error(
        `Refusing to drop schema public: this connection reports branch ${onBranch} in ` +
        `project ${onProject}, but the harness created branch ${branch.id} in project ` +
        `${PROJECT_ID}.`,
      )
    }
    await client.query('drop schema public cascade; create schema public;')
  } finally {
    await client.end()
  }
}

/**
 * Deletes every branch this process created, and returns the ids it could not
 * delete. Never throws: it is called from an error path where the original
 * failure must survive.
 */
function cleanupCreatedBranches(): string[] {
  const orphans: string[] = []
  for (const id of createdBranchIds()) {
    try {
      deleteTestBranch(id)
      console.log(`Deleted test branch ${id}`)
    } catch {
      orphans.push(id)
      // Surface the id prominently rather than letting the branch vanish into
      // the noise of a stack trace — this is the one thing an operator needs
      // to clean up by hand if the automatic delete itself fails.
      console.error(
        `Failed to delete test branch ${id} — it is now orphaned.\n` +
        `Clean it up manually: neonctl branches delete ${id} --project-id ${PROJECT_ID}`,
      )
    }
  }
  return orphans
}

export async function setup(): Promise<void> {
  // pid + timestamp alone can repeat across two containers that start in the
  // same millisecond with the same pid; the random suffix makes the name a
  // reliable identity, which matters because createTestBranch() asserts that
  // neonctl echoed back this exact name.
  const name = `test-${process.pid}-${Date.now()}-${randomUUID().slice(0, 8)}`
  try {
    const branch = createTestBranch(name)
    // Logged before anything that could fail, so a crash mid-setup still
    // leaves a trail: `neonctl branches delete <id> --project-id <PROJECT_ID>`
    // finds and removes it even if no cleanup path runs.
    console.log(`Provisioned test branch ${branch.id} (${name}, project ${PROJECT_ID})`)
    process.env.TEST_DATABASE_URL = branch.connectionUri

    await resetPublicSchema(branch)

    // Migrate the now-empty branch — the runner's baseline guard no longer
    // fires, so every migration, including 027, is applied.
    // Node 24 strips TypeScript natively; no flag is needed.
    execFileSync('node', ['scripts/migrate.ts'], {
      env: { ...process.env, DATABASE_URL: branch.connectionUri },
      stdio: 'inherit',
    })
  } catch (err) {
    // Vitest registers globalSetup's teardown only once setup has resolved, so
    // a throw here would otherwise orphan the branch — and a throw here is the
    // expected outcome whenever a migration is broken. Clean up, then rethrow
    // the original failure.
    cleanupCreatedBranches()
    throw err
  }
}

export async function teardown(): Promise<void> {
  const orphans = cleanupCreatedBranches()
  if (orphans.length > 0) {
    throw new Error(`Could not delete test branch(es): ${orphans.join(', ')}`)
  }
}
