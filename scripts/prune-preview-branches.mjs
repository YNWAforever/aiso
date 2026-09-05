#!/usr/bin/env node
/**
 * Deletes preview branches that outlived their TTL.
 *
 * This extends rather than replaces what the integration harness already does.
 * `__tests__/helpers/neon-branch.ts` sets a Neon-native `expires-at` on every
 * branch it creates, deletes them in teardown, and prints the ids it could not
 * delete; Neon removes an expired branch on its own, so a branch lost to a hard
 * crash cannot linger. This sweep is for what those miss — branches created by
 * something other than that harness, or whose expiry was never set.
 *
 * Usage:
 *   node scripts/prune-preview-branches.mjs --dry-run   # read this first
 *   node scripts/prune-preview-branches.mjs
 *
 * Selection is an ALLOW-LIST — see selectPrunableBranches. Written the other way
 * round, as "delete anything that is not production", a naming change would
 * silently make every branch eligible.
 *
 * On output safety: `scripts/neon` exists because neonctl prints connection URIs
 * with passwords in them, and a branch role inherits the parent's credential.
 * This script never prints neonctl's stdout — it parses the JSON and emits only
 * ids, names and timestamps — and every error detail goes through redactSecrets,
 * the same treatment neon-branch.ts gives its own failures.
 */

import { execFileSync } from 'node:child_process'

// Relative with the explicit extension, as scripts/schema-equivalence.mjs does:
// this runs under plain node, which resolves neither tsconfig path aliases nor
// extensionless .ts files.
import { neonctlCommand, PRODUCTION_BRANCH_ID, PROJECT_ID } from '../__tests__/helpers/neon-branch.ts'
import { redactSecrets } from '../lib/security/redact-secrets.ts'

/** Branch names this sweep may consider. Anything else is left alone. */
const PREVIEW_NAME = /^preview-/

/** Two hours, matching BRANCH_TTL_MS in the harness that creates these. */
const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000

/**
 * The branches that may be deleted, given a listing and a moment in time.
 *
 * Pure, and exported separately from anything that calls Neon, so the rules can
 * be exercised without a network or a clock.
 *
 * A branch qualifies only if ALL of these hold:
 *   - its name matches the preview prefix
 *   - its id is not the production branch
 *   - its created_at parses, and is older than the TTL
 *
 * The production check is its own condition rather than something implied by the
 * name, because it is the one mistake in this script that cannot be undone. An
 * unparseable timestamp fails closed: unreadable must never read as "infinitely
 * old".
 *
 * The JSDoc types are load-bearing, not decoration: tsconfig covers __tests__,
 * and without them tsc infers the options bag from its `= {}` default alone,
 * which makes `now` an unknown property at every call site.
 *
 * `productionBranchId` is optional in the type precisely so the "refuses to run
 * without it" case can be expressed — the guard is a runtime one, and a type
 * that forbade omitting it would make that guard untestable.
 *
 * @typedef {{ id: string, name: string, created_at: string }} NeonBranch
 * @param {NeonBranch[]} branches
 * @param {{ now?: number, productionBranchId?: string, ttlMs?: number }} [options]
 * @returns {NeonBranch[]}
 */
export function selectPrunableBranches(branches, { now, productionBranchId, ttlMs = DEFAULT_TTL_MS } = {}) {
  if (!productionBranchId) {
    throw new Error(
      'Refusing to select branches: productionBranchId was not supplied, so the one branch '
      + 'that must never be deleted cannot be identified.',
    )
  }
  if (typeof now !== 'number' || !Number.isFinite(now)) {
    throw new Error('Refusing to select branches: `now` must be a finite timestamp.')
  }

  const cutoff = now - ttlMs
  return branches.filter((branch) => {
    if (branch.id === productionBranchId) return false
    if (typeof branch.name !== 'string' || !PREVIEW_NAME.test(branch.name)) return false
    const createdAt = Date.parse(branch.created_at)
    if (Number.isNaN(createdAt)) return false
    return createdAt < cutoff
  })
}

function neonctl(args) {
  const [command, leadingArgs] = neonctlCommand()
  try {
    return execFileSync(command, [...leadingArgs, ...args, '--output', 'json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
    })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(`neonctl ${args.slice(0, 2).join(' ')} failed: ${redactSecrets(detail)}`)
  }
}

function listBranches() {
  const parsed = JSON.parse(neonctl(['branches', 'list', '--project-id', PROJECT_ID]))
  return Array.isArray(parsed) ? parsed : (parsed.branches ?? [])
}

function main() {
  const dryRun = process.argv.includes('--dry-run')
  const prunable = selectPrunableBranches(listBranches(), {
    now: Date.now(),
    productionBranchId: PRODUCTION_BRANCH_ID,
  })

  if (prunable.length === 0) {
    process.stdout.write(`Nothing to prune in ${PROJECT_ID}.\n`)
    return
  }

  process.stdout.write(
    `${dryRun ? 'Would delete' : 'Deleting'} ${prunable.length} branch(es) in ${PROJECT_ID}:\n`,
  )
  for (const branch of prunable) {
    // Printed BEFORE the delete, so an interrupted run still leaves a record of
    // what it was working on rather than a branch that vanished silently.
    process.stdout.write(`  ${branch.id}  ${branch.name}  created ${branch.created_at}\n`)
    if (dryRun) continue
    try {
      neonctl(['branches', 'delete', branch.id, '--project-id', PROJECT_ID])
    } catch (err) {
      process.stderr.write(
        `  failed to delete ${branch.id}: ${err instanceof Error ? err.message : String(err)}\n`
        + `  remove it by hand: neonctl branches delete ${branch.id} --project-id ${PROJECT_ID}\n`,
      )
      process.exitCode = 1
    }
  }
}

// Only when run directly, so importing this module for its pure function never
// touches Neon.
if (process.argv[1] && process.argv[1].endsWith('prune-preview-branches.mjs')) {
  main()
}
