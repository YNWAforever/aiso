/**
 * Proves the greenfield baseline is equivalent to replaying migrations 001-037.
 *
 *   npm run schema:equivalence
 *
 * Provisions ONE disposable Neon branch on the EXISTING project (the same thing
 * `npm run test:integration` does — no new project, nothing persistent, 2h TTL),
 * builds both schema paths on it, and diffs the application-owned result.
 *
 * Exit 0 = equivalent. Exit 1 = divergent, with a per-class report. While
 * authoring slices 1-5 a non-empty diff is the expected, useful signal.
 */
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Client, neonConfig } from '@neondatabase/serverless'

import {
  assertDisposableTestBranch,
  createTestBranch,
  createdBranchIds,
  deleteTestBranch,
  PROJECT_ID,
} from '../__tests__/helpers/neon-branch.ts'
import { introspectSchema } from '../lib/schema/introspect.ts'
import { diffSchemas } from '../lib/schema/diff.ts'
import { redactSecrets } from '../lib/security/redact-secrets.ts'

const BASELINE_FILE = join(process.cwd(), 'supabase', 'baseline', '000_baseline_2026-08-31.sql')

/**
 * Opens a session on a branch this process created, after the same three
 * independent proofs the integration harness requires.
 */
async function withBranchClient(branch, fn) {
  assertDisposableTestBranch(branch)
  neonConfig.webSocketConstructor = globalThis.WebSocket
  const client = new Client({ connectionString: branch.connectionUri })
  // Branch deletion terminates sessions with FATAL 57P01; without a listener the
  // driver rethrows and dumps the client — password included — to the log.
  client.on('error', () => {})
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

async function resetPublicSchema(branch) {
  await withBranchClient(branch, async (client) => {
    const { rows } = await client.query(
      "select current_setting('neon.project_id', true) as project_id, " +
      "current_setting('neon.branch_id', true) as branch_id",
    )
    const onProject = rows[0]?.project_id ?? 'unknown'
    const onBranch = rows[0]?.branch_id ?? 'unknown'
    if (onProject !== PROJECT_ID || onBranch !== branch.id) {
      throw new Error(
        `Refusing to drop schema public: connection reports branch ${onBranch} in project ` +
        `${onProject}, but this process created ${branch.id} in ${PROJECT_ID}.`,
      )
    }
    await client.query('drop schema public cascade; create schema public;')
  })
}

function reportClass(name, classDiff) {
  const { onlyInLegacy, onlyInBaseline, changed } = classDiff
  if (!onlyInLegacy.length && !onlyInBaseline.length && !changed.length) {
    console.log(`  ${name.padEnd(12)} ok`)
    return
  }
  console.log(`  ${name.padEnd(12)} ${onlyInLegacy.length} missing, ` +
    `${onlyInBaseline.length} extra, ${changed.length} changed`)
  for (const key of onlyInLegacy) console.log(`    - missing from baseline: ${key}`)
  for (const key of onlyInBaseline) console.log(`    + only in baseline:     ${key}`)
  for (const { key, legacy, baseline } of changed) {
    console.log(`    ~ ${key}\n        legacy:   ${legacy}\n        baseline: ${baseline}`)
  }
}

async function main() {
  const name = `equiv-${process.pid}-${Date.now()}-${randomUUID().slice(0, 8)}`
  try {
    const branch = createTestBranch(name)
    console.log(`Provisioned ${branch.id} (${name}) in project ${PROJECT_ID}`)

    // Path A — legacy-to-head, exactly what the integration harness builds.
    await resetPublicSchema(branch)
    execFileSync('node', ['scripts/migrate.ts'], {
      env: { ...process.env, MIGRATE_DATABASE_URL: branch.connectionUri },
      stdio: 'inherit',
    })
    const legacy = await withBranchClient(branch, introspectSchema)

    // Path B — baseline-to-head.
    await resetPublicSchema(branch)
    const rawBaseline = readFileSync(BASELINE_FILE, 'utf8')
    const checksum = createHash('sha256').update(rawBaseline).digest('hex')
    const baselineSql = rawBaseline.replaceAll(":'baseline_checksum'", `'${checksum}'`)
    await withBranchClient(branch, (client) => client.query(baselineSql))
    const baseline = await withBranchClient(branch, introspectSchema)

    const diff = diffSchemas(legacy, baseline)
    console.log('\nSchema equivalence (legacy 001-037 vs baseline):')
    for (const [className, classDiff] of Object.entries(diff.classes)) {
      reportClass(className, classDiff)
    }

    console.log(diff.equivalent ? '\nEQUIVALENT' : '\nDIVERGENT')
    process.exitCode = diff.equivalent ? 0 : 1
  } finally {
    for (const id of createdBranchIds()) {
      try {
        deleteTestBranch(id)
        console.log(`Deleted ${id}`)
      } catch {
        console.error(
          `Failed to delete ${id} — orphaned.\n` +
          `Clean up: neonctl branches delete ${id} --project-id ${PROJECT_ID}`,
        )
      }
    }
  }
}

main().catch((error) => {
  // The Neon driver echoes full connection urls, password included, in its error
  // messages — never print one raw.
  console.error(redactSecrets(error instanceof Error ? error.message : String(error)))
  process.exitCode = 1
})
