#!/usr/bin/env node
/**
 * Read-only release receipt.
 *
 * Given the commit that production runs, collect and verify the release
 * dependencies the project has always checked by hand:
 *
 *   1. the completed PR gate run and its aggregate artifact
 *   2. the tested merge tree equals the released merge tree
 *   3. a READY production Vercel deployment for that commit, carrying the
 *      canonical alias
 *   4. the real deployment build log reports every shipped migration recorded
 *   5. the deployed Cloudflare Worker schedules match the committed config
 *
 * Every dependency is `verified`, `failed` or `unknown`; a receipt is a pass
 * (exit 0) only when nothing failed and every unknown dependency was named with
 * `--allow-unknown`. The JSON is written to `.release-receipts/<sha>.json`
 * (gitignored) with a stable sha256 over its contents. Nothing here mutates
 * production: everything is a GET, `git fetch`, `git rev-parse` or a log read,
 * and no credential is ever printed.
 *
 * Usage:
 *   npm run release:receipt -- --app-sha <merge sha> --gate-run <run ID> [--pr <number>]
 *       [--allow-unknown worker_schedules] [--json]
 *       [--repo owner/repo] [--project aiso] [--scope <vercel team>]
 *       [--canonical-alias aiso-kappa.vercel.app] [--out path]
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import {
  DEPENDENCY_IDS,
  countShippedMigrations,
  dependency,
  evaluateGateRun,
  evaluateDeployment,
  evaluateSchemaGate,
  evaluateTestedMergeTree,
  evaluateWorkerSchedules,
  normalizeSha,
  overallStatus,
  parseSchemaGateLog,
  receiptHash,
  selectProductionDeployment,
  verifyExitCode,
} from './verify.mjs'
import {
  commitParents,
  ensureCommit,
  findPullForCommit,
  getPull,
  gitTree,
  listTreeFiles,
  readWorkerScheduleReadback,
  readGateRun,
  readGateSummary,
  resolveRepoFromRemote,
  vercelBuildLog,
  vercelDeploymentList,
  vercelInspect,
} from './collect.mjs'

const USAGE = `Read-only release receipt.

  npm run release:receipt -- --app-sha <40-char commit sha> [options]

Options:
  --app-sha <sha>          production commit to verify (required)
  --pr <number>            pull request to identify in the receipt (default: resolve from the commit)
  --gate-run <id>          successful GitHub PR gate workflow run for this tree
  --allow-unknown <ids>    comma-separated dependency ids allowed to be unknown
  --repo <owner/repo>      GitHub repository (default: the origin remote)
  --project <name>         Vercel project (default: aiso)
  --scope <team>           Vercel scope/team (or VERCEL_SCOPE)
  --canonical-alias <host> alias the deployment must carry (default: aiso-kappa.vercel.app)
  --out <path>             receipt path (default: .release-receipts/<sha>.json)
  --json                   print the receipt JSON instead of a summary
  --help                   show this help

Dependency ids: ${DEPENDENCY_IDS.join(', ')}
Exit codes: 0 verified (or all unknown dependencies allowed), 2 failed/unknown, 1 usage error.`

class UsageError extends Error {}

function parseArgs(argv) {
  const options = {
    allowUnknown: [],
    project: 'aiso',
    canonicalAlias: 'aiso-kappa.vercel.app',
    help: false,
    json: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--json') {
      options.json = true
      continue
    }
    if (!arg.startsWith('--')) throw new UsageError(`unexpected argument: ${arg}`)
    const key = arg.slice(2)
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new UsageError(`missing value for ${arg}`)
    index += 1
    switch (key) {
      case 'app-sha':
        options.appSha = value
        break
      case 'pr':
        options.pr = value
        break
      case 'gate-run':
        options.gateRun = value
        break
      case 'repo':
        options.repo = value
        break
      case 'project':
        options.project = value
        break
      case 'scope':
        options.scope = value
        break
      case 'canonical-alias':
        options.canonicalAlias = value
        break
      case 'out':
        options.out = value
        break
      case 'allow-unknown':
        options.allowUnknown.push(
          ...value
            .split(',')
            .map(entry => entry.trim())
            .filter(Boolean),
        )
        break
      case 'help':
        options.help = true
        break
      default:
        throw new UsageError(`unknown option: ${arg}`)
    }
  }
  return options
}

function printSummary(receipt, outPath) {
  const lines = []
  lines.push(`release receipt  ${receipt.status.toUpperCase()}`)
  lines.push(`  app commit   ${receipt.appSha}`)
  if (receipt.appTree) lines.push(`  app tree     ${receipt.appTree}`)
  if (receipt.pr) {
    lines.push(`  pull request #${receipt.pr.number}`)
  }
  if (receipt.evidence.ciRun) lines.push(`  CI run       ${receipt.evidence.ciRun.id}`)
  lines.push('  dependencies:')
  for (const entry of receipt.dependencies) {
    const marker = entry.status === 'verified' ? 'ok  ' : entry.status === 'failed' ? 'FAIL' : '??  '
    lines.push(`    ${marker} ${entry.id.padEnd(18)} ${entry.detail}`)
  }
  if (receipt.allowedUnknown.length) lines.push(`  allowed unknown: ${receipt.allowedUnknown.join(', ')}`)
  lines.push(`  receipt hash ${receipt.receiptHash}`)
  lines.push(`  written to   ${outPath}`)
  console.log(lines.join('\n'))
}

/**
 * Collects one dependency and converts a collection error into an `unknown`
 * dependency with the same bounded reason. This is what keeps a missing token
 * or an expired log from being mistaken for a passing release.
 */
function safely(id, fallbackDetail, collect) {
  try {
    return collect()
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message : String(error)
    return dependency(id, 'unknown', `${fallbackDetail}: ${reason}`)
  }
}

function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`release-receipt: ${error.message}\n\n${USAGE}`)
      return 1
    }
    throw error
  }
  if (options.help) {
    console.log(USAGE)
    return 0
  }

  const appSha = normalizeSha(options.appSha)
  if (!appSha) {
    console.error(`release-receipt: --app-sha must be a 40-character commit SHA\n\n${USAGE}`)
    return 1
  }
  if (options.gateRun && !/^[1-9]\d*$/.test(options.gateRun)) {
    console.error('release-receipt: --gate-run must be a positive numeric GitHub run ID')
    return 1
  }
  for (const id of options.allowUnknown) {
    if (id !== 'worker_schedules') {
      console.error(`release-receipt: only worker_schedules can be named in --allow-unknown, received ${id}\nDependency ids: ${DEPENDENCY_IDS.join(', ')}`)
      return 1
    }
  }

  const cwd = process.cwd()
  const scope = options.scope ?? process.env.VERCEL_SCOPE ?? undefined
  const receipt = {
    schemaVersion: 1,
    tool: 'release-receipt',
    generatedAt: new Date().toISOString(),
    appSha,
    appTree: null,
    repo: null,
    pr: null,
    dependencies: [],
    evidence: {
      deployment: null,
      schemaGate: null,
      workerSchedules: null,
    },
    status: 'unknown',
    allowedUnknown: options.allowUnknown,
    receiptHash: null,
  }

  const repo =
    options.repo ??
    (() => {
      try {
        return resolveRepoFromRemote(cwd)
      } catch {
        return null
      }
    })()
  receipt.repo = repo

  /* 1. Local commit, tree and parents ----------------------------------------- */
  let appTree = null
  let parents = []
  try {
    ensureCommit(cwd, appSha)
    appTree = gitTree(cwd, appSha)
    parents = commitParents(cwd, appSha)
  } catch {
    // Recorded as an `unknown` dependency below; never assumed.
  }
  receipt.appTree = appTree
  receipt.evidence.releaseParents = parents

  /* 2. GitHub workflow run and immutable checkout evidence ------------------ */
  if (repo) {
    try {
      const pr = options.pr ? getPull(repo, Number(options.pr), cwd) : findPullForCommit(repo, appSha, cwd)
      if (pr) receipt.pr = { number: pr.number, headSha: normalizeSha(pr.head?.sha), parents }
    } catch {
      // PR context is descriptive. The workflow and commit bind the evidence.
    }
  }

  let run = null
  let summary = null
  const runId = options.gateRun
  const ciDependency = safely('ci_checks', 'PR gate evidence could not be read', () => {
    if (!runId) return evaluateGateRun({ run: null })
    if (!repo) throw new Error('no GitHub repository could be resolved')
    run = readGateRun(repo, runId, cwd)
    const preliminary = evaluateGateRun({ run, runId, repo })
    if (preliminary.status === 'failed') return preliminary
    summary = readGateSummary(repo, runId, cwd)
    receipt.evidence.ciRun = {
      id: runId,
      attempt: run.run_attempt,
      testedSha: normalizeSha(summary?.commitSha),
      testedTree: normalizeSha(summary?.treeSha),
    }
    return evaluateGateRun({ run, summary, runId, repo })
  })
  receipt.dependencies.push(ciDependency)
  receipt.dependencies.push(safely('tested_merge_tree', 'the CI checkout could not be resolved', () => {
    const testedSha = normalizeSha(summary?.commitSha)
    if (ciDependency.status !== 'verified' || !testedSha) {
      return dependency('tested_merge_tree', 'unknown', 'a verified PR gate artifact is required to compare the release tree')
    }
    ensureCommit(cwd, testedSha)
    return evaluateTestedMergeTree({
      appSha, appTree, parents, run, summary,
      checkedTree: gitTree(cwd, testedSha),
      checkedParents: commitParents(cwd, testedSha),
    })
  }))

  /* 4. Production deployment and its build log -------------------------------- */
  let buildLog = null
  let deployedEvidence = null
  receipt.dependencies.push(
    safely('deployment', 'the production deployment could not be read', () => {
      const listPayload = vercelDeploymentList({ project: options.project, scope, appSha, cwd })
      const listed = selectProductionDeployment(listPayload, appSha)
      if (!listed) return evaluateDeployment({ appSha, listed: null, inspected: null, canonicalAlias: options.canonicalAlias })
      const inspected = vercelInspect({ target: listed.url, scope, cwd })
      deployedEvidence = {
        url: listed.url,
        id: inspected?.id ?? null,
        readyState: inspected?.readyState ?? null,
        target: inspected?.target ?? null,
        aliases: Array.isArray(inspected?.aliases) ? inspected.aliases : [],
        canonicalAlias: options.canonicalAlias,
      }
      receipt.evidence.deployment = deployedEvidence
      buildLog = vercelBuildLog({ target: inspected?.id ?? listed.url, scope, cwd })
      return evaluateDeployment({ appSha, listed, inspected, canonicalAlias: options.canonicalAlias })
    }),
  )

  /* 5. Schema gate from the real build log ------------------------------------ */
  receipt.dependencies.push(
    safely('schema_gate', 'the schema gate could not be read', () => {
      if (!buildLog) throw new Error('the deployment build log is unavailable')
      let shippedCount = 0
      try {
        shippedCount = countShippedMigrations(listTreeFiles(cwd, appSha))
      } catch {
        shippedCount = 0
      }
      receipt.evidence.schemaGate = { recorded: parseSchemaGateLog(buildLog), shippedCount }
      return evaluateSchemaGate({ logText: buildLog, shippedCount })
    }),
  )

  /* 6. Deployed Worker schedules ---------------------------------------------- */
  receipt.dependencies.push(
    safely('worker_schedules', 'the Cloudflare schedule readback failed', () => {
      const { payload, error } = readWorkerScheduleReadback({ cwd })
      if (payload) {
        receipt.evidence.workerSchedules = {
          script: typeof payload.script === 'string' ? payload.script : null,
          configured: Array.isArray(payload.configured) ? payload.configured : [],
          deployed: Array.isArray(payload.deployed) ? payload.deployed : [],
        }
      }
      return evaluateWorkerSchedules({ payload, error })
    }),
  )

  /* 7. Receipt ---------------------------------------------------------------- */
  receipt.status = overallStatus(receipt.dependencies)
  receipt.receiptHash = receiptHash(receipt)

  const outPath = resolve(cwd, options.out ?? `.release-receipts/${appSha}.json`)
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8')

  if (options.json) console.log(JSON.stringify(receipt))
  else printSummary(receipt, outPath)

  const exitCode = verifyExitCode({ dependencies: receipt.dependencies, allowUnknown: receipt.allowedUnknown })
  if (exitCode !== 0) {
    const blocked = receipt.dependencies.filter(entry => entry.status === 'failed')
    const unknown = receipt.dependencies.filter(entry => entry.status === 'unknown' && !receipt.allowedUnknown.includes(entry.id))
    if (blocked.length) console.error(`release-receipt: FAILED ${blocked.map(entry => entry.id).join(', ')}`)
    if (unknown.length) console.error(`release-receipt: UNKNOWN ${unknown.map(entry => entry.id).join(', ')} (name them in --allow-unknown only with a reason)`)
  }
  return exitCode
}

try {
  process.exitCode = main()
} catch (error) {
  console.error(`release-receipt: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
