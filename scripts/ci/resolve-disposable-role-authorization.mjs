import { appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** @param {{ eventName?: string, manualApproval?: string, repositoryApproval?: string }} input */
export function resolveDisposableRoleAuthorization(input = {}) {
  if (input.eventName === 'workflow_dispatch' && input.manualApproval === 'true') {
    return { allowed: '1', source: 'manual-run' }
  }
  if (input.repositoryApproval === '1') return { allowed: '1', source: 'repository' }
  return { allowed: '0', source: 'unapproved' }
}

function main() {
  if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required for the authorization step')
  const decision = resolveDisposableRoleAuthorization({
    eventName: process.env.GITHUB_EVENT_NAME,
    manualApproval: process.env.AISO_MANUAL_ROLE_APPROVAL,
    repositoryApproval: process.env.AISO_REPOSITORY_ROLE_APPROVAL,
  })
  appendFileSync(process.env.GITHUB_OUTPUT, `allowed=${decision.allowed}\nsource=${decision.source}\n`, 'utf8')
  process.stdout.write(`Disposable role authorization: ${decision.source}\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main() } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}
