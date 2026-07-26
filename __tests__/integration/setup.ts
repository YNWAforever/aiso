import { execFileSync } from 'node:child_process'
import { Pool, neonConfig } from '@neondatabase/serverless'
import { createTestBranch, deleteTestBranch, PROJECT_ID } from '../helpers/neon-branch'

let branchId: string | null = null

/**
 * A Neon branch is a copy-on-write snapshot of its parent, not an empty
 * database — `neonctl branches create` has no "start with nothing" option.
 * Its parent defaults to the project's default branch (production), which
 * already carries every table but no `schema_migrations` ledger. Left as
 * is, migrate.ts's assertBaselined() guard (correctly) refuses to touch it.
 * Drop and recreate `public` so the branch is genuinely empty before
 * migrating. Safe: no migration under supabase/migrations creates a
 * Postgres extension, and Neon Auth's `neon_auth` schema — which migration
 * 022's FK into `profiles` depends on — lives outside `public` and survives.
 */
async function resetPublicSchema(connectionUri: string): Promise<void> {
  neonConfig.webSocketConstructor = globalThis.WebSocket
  const pool = new Pool({ connectionString: connectionUri })
  try {
    await pool.query('drop schema public cascade; create schema public;')
  } finally {
    await pool.end()
  }
}

export async function setup(): Promise<void> {
  const name = `test-${process.pid}-${Date.now()}`
  const branch = createTestBranch(name)
  branchId = branch.id
  // Logged before anything that could fail, so a crash mid-setup still
  // leaves a trail: `neonctl branches delete <id> --project-id <PROJECT_ID>`
  // finds and removes it even if teardown() never runs.
  console.log(`Provisioned test branch ${branch.id} (${name}, project ${PROJECT_ID})`)
  process.env.TEST_DATABASE_URL = branch.connectionUri

  await resetPublicSchema(branch.connectionUri)

  // Migrate the now-empty branch — the runner's baseline guard no longer
  // fires, so every migration, including 027, is applied.
  // Node 24 strips TypeScript natively; no flag is needed.
  execFileSync('node', ['scripts/migrate.ts'], {
    env: { ...process.env, DATABASE_URL: branch.connectionUri },
    stdio: 'inherit',
  })
}

export async function teardown(): Promise<void> {
  if (!branchId) return
  try {
    deleteTestBranch(branchId)
    console.log(`Deleted test branch ${branchId}`)
  } catch (err) {
    // Surface the id prominently rather than letting the branch vanish into
    // the noise of a stack trace — this is the one thing an operator needs
    // to clean up by hand if the automatic delete itself fails.
    console.error(
      `Failed to delete test branch ${branchId} — it is now orphaned.\n` +
      `Clean it up manually: neonctl branches delete ${branchId} --project-id ${PROJECT_ID}`,
    )
    throw err
  }
}
