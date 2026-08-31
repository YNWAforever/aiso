import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const VALID_PRIORITIES = new Set(['P0', 'P1', 'P2'])
const SAFE_ARTIFACT_PATH = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/

function assertSafeArtifactPath(path) {
  if (!SAFE_ARTIFACT_PATH.test(path) || path.includes('..')) throw new Error(`Invalid artifact path: ${path}`)
}

/**
 * @param {{
 *   job: string,
 *   status: string,
 *   executed: number,
 *   skipped: number,
 *   priorities?: string[],
 *   artifacts?: string[],
 *   commitSha?: string,
 * }} params
 */
export function createJobSummary({ job, status, executed, skipped, priorities = [], artifacts = [], commitSha = '' }) {
  for (const artifact of artifacts) assertSafeArtifactPath(artifact)
  return {
    schemaVersion: 1,
    job,
    commitSha,
    status,
    executed: Number(executed),
    skipped: Number(skipped),
    failurePriorities: [...new Set(priorities.filter((priority) => VALID_PRIORITIES.has(priority)))],
    artifacts: [...artifacts],
  }
}

function parseArguments(args) {
  const values = { priorities: [], artifacts: [] }
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]
    const value = args[index + 1]
    if (!flag?.startsWith('--') || value === undefined) throw new Error(`Invalid argument: ${flag ?? ''}`)
    if (flag === '--priority') values.priorities.push(value)
    else if (flag === '--artifact') values.artifacts.push(value)
    else values[flag.slice(2)] = value
  }
  return values
}

export async function writeJobSummary({ output, ...input }) {
  const summary = createJobSummary(input)
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
  return summary
}

async function main() {
  const args = parseArguments(process.argv.slice(2))
  await writeJobSummary({
    job: args.job,
    status: args.status,
    executed: args.executed,
    skipped: args.skipped,
    priorities: args.priorities,
    artifacts: args.artifacts,
    commitSha: process.env.GITHUB_SHA ?? '',
    output: args.output ?? `artifacts/${args.job}-summary.json`,
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}
