import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * Write before setup continues: buffered stdout disappears when a CI job is
 * cancelled. This receipt is metadata only, never a credential or authority
 * to reset/delete a branch. The private in-process creation registry remains
 * the only authorization used by the destructive harness.
 *
 * @param {{ projectId: string, parentBranchId: string, branchId: string, branchName: string }} input
 * @param {{ env?: Record<string,string|undefined>, directory?: string }} options
 */
export function recordBranchProvenance(input, options = {}) {
  const env = options.env ?? process.env
  if (env.AISO_RECORD_BRANCH_PROVENANCE !== '1') return null

  const valid = env.GITHUB_ACTIONS === 'true'
    && /^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID ?? '')
    && /^[1-9][0-9]*$/.test(env.GITHUB_RUN_ATTEMPT ?? '')
    && /^[a-zA-Z0-9_-]{1,100}$/.test(env.GITHUB_JOB ?? '')
    && /^[a-f0-9]{40}$/.test(env.AISO_TEST_CHECKOUT_SHA ?? '')
    && /^[a-z0-9-]+$/.test(input.projectId)
    && /^br-[a-z0-9-]+$/.test(input.branchId)
    && /^br-[a-z0-9-]+$/.test(input.parentBranchId)
    && input.branchId !== input.parentBranchId
    && /^test-[0-9]+-[0-9]+-[a-f0-9]{8}$/.test(input.branchName)
  if (!valid) throw new Error('Invalid branch provenance: expected verified child identity and trusted CI context')

  const record = {
    event: 'created',
    projectId: input.projectId,
    parentBranchId: input.parentBranchId,
    branchId: input.branchId,
    branchName: input.branchName,
    checkoutSha: env.AISO_TEST_CHECKOUT_SHA,
    runId: env.GITHUB_RUN_ID,
    runAttempt: Number(env.GITHUB_RUN_ATTEMPT),
    job: env.GITHUB_JOB,
    recordedAt: new Date().toISOString(),
  }
  const directory = resolve(options.directory ?? 'artifacts/integration/branch-provenance')
  mkdirSync(directory, { recursive: true })
  // Fail before schema reset on write failure; never replace an earlier receipt.
  writeFileSync(join(directory, `${record.branchId}.json`), JSON.stringify(record, null, 2) + '\n', { flag: 'wx' })
  return record
}
