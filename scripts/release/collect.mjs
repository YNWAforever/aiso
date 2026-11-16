/**
 * Read-only command collection for the release receipt.
 *
 * Each helper shells out to a tool the operator already uses (git, gh, vercel,
 * node) and returns parsed output. Failures are raised as CollectError with a
 * bounded message; the receipt turns them into an `unknown` dependency instead
 * of guessing. No helper prints, logs or stores a credential: gh and vercel read
 * their own auth material, and the receipt never echoes process.env values.
 */

import { spawnSync } from 'node:child_process'

export class CollectError extends Error {}

function firstLine(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)[0] ?? ''
}

/**
 * Runs a command and returns `{ status, stdout, stderr }`. `allowFailure` is for
 * reads whose absence is itself evidence (a missing merge ref, an absent
 * Cloudflare token), not for commands whose failure should abort the receipt.
 */
export function run(command, args, { cwd, timeout = 180_000, allowFailure = false, env } = {}) {
  const shell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(command)
  const result = spawnSync(command ?? '', args ?? [], {
    cwd,
    encoding: 'utf8',
    timeout,
    maxBuffer: 64 * 1024 * 1024,
    shell,
    env: env ?? process.env,
  })
  if (result.error) {
    if (allowFailure) return { status: -1, stdout: '', stderr: result.error.message }
    throw new CollectError(`${command} ${args?.[0] ?? ''} could not start: ${result.error.message}`)
  }
  const status = typeof result.status === 'number' ? result.status : -1
  if (status !== 0 && !allowFailure) {
    const reason = firstLine(result.stderr) || firstLine(result.stdout) || 'no output'
    throw new CollectError(`${command} ${args?.[0] ?? ''} exited ${status}: ${reason}`)
  }
  return { status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

/* ---------------------------------------------------------------------- GitHub */

export function ghJson(apiPath, { cwd } = {}) {
  const result = run('gh', ['api', apiPath], { cwd })
  try {
    return JSON.parse(result.stdout)
  } catch {
    throw new CollectError(`gh api ${apiPath} did not return JSON`)
  }
}

/** `owner/repo` from the origin remote; the receipt never guesses a different repo. */
export function resolveRepoFromRemote(cwd) {
  const result = run('git', ['remote', 'get-url', 'origin'], { cwd })
  const match = /github\.com[:/]+([^/]+)\/([^/\s]+?)(?:\.git)?$/i.exec(result.stdout.trim())
  if (!match) throw new CollectError('the origin remote is not a github.com repository URL')
  return `${match[1]}/${match[2]}`
}

/** The merged PR associated with a commit, or null. */
export function findPullForCommit(repo, sha, cwd) {
  const pulls = ghJson(`repos/${repo}/commits/${sha}/pulls`, { cwd })
  const list = Array.isArray(pulls) ? pulls : []
  return (
    list
      .filter(entry => entry && typeof entry.number === 'number' && (entry.merged_at || entry.merge_commit_sha === sha))
      .sort((left, right) => right.number - left.number)[0] ?? null
  )
}

export function getPull(repo, number, cwd) {
  if (!Number.isInteger(number) || number <= 0) throw new CollectError(`invalid pull request number: ${number}`)
  return ghJson(`repos/${repo}/pulls/${number}`, { cwd })
}

export function checkRunsFor(repo, sha, cwd) {
  return ghJson(`repos/${repo}/commits/${sha}/check-runs?per_page=100`, { cwd })
}

/* ------------------------------------------------------------------------- git */

export function ensureCommit(cwd, sha) {
  const present = run('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd, allowFailure: true })
  if (present.status === 0) return
  run('git', ['fetch', 'origin', sha, '--quiet'], { cwd, allowFailure: true })
  const retry = run('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd, allowFailure: true })
  if (retry.status !== 0) throw new CollectError(`commit ${sha} is not available locally and could not be fetched`)
}

export function gitTree(cwd, ref) {
  const result = run('git', ['rev-parse', `${ref}^{tree}`], { cwd })
  const tree = result.stdout.trim()
  if (!/^[0-9a-f]{40}$/.test(tree)) throw new CollectError(`git rev-parse ${ref}^{tree} did not return a tree object`)
  return tree
}

/** Parent commits in order: `git rev-list --parents -n 1 <sha>` is one line. */
export function commitParents(cwd, sha) {
  const result = run('git', ['rev-list', '--parents', '-n', '1', sha], { cwd })
  const lineage = result.stdout.trim().split(/\s+/).filter(Boolean)
  return lineage.slice(1)
}

/**
 * Reconstructs the tree a merge of `baseSha` and `headSha` would produce.
 * GitHub deletes `refs/pull/<n>/merge` after the PR merges, so a post-merge
 * receipt replays the merge locally with the same ort strategy. Null means the
 * merge could not be reconstructed (conflict or unsupported git), never a pass.
 */
export function reconstructMergeTree(cwd, baseSha, headSha) {
  const result = run('git', ['merge-tree', '--write-tree', baseSha, headSha], { cwd, allowFailure: true })
  if (result.status !== 0) return null
  const tree = result.stdout.trim().split(/\r?\n/)[0]?.trim()
  return /^[0-9a-f]{40}$/.test(tree) ? tree : null
}

/** Fetches the PR's synthetic merge ref into FETCH_HEAD; null when GitHub no longer exposes it. */
export function fetchTestedMerge(cwd, prNumber) {
  const fetched = run('git', ['fetch', 'origin', `pull/${prNumber}/merge`, '--quiet'], { cwd, allowFailure: true })
  if (fetched.status !== 0) return null
  const resolved = run('git', ['rev-parse', 'FETCH_HEAD'], { cwd, allowFailure: true })
  if (resolved.status !== 0) return null
  const sha = resolved.stdout.trim()
  return /^[0-9a-f]{40}$/.test(sha) ? sha : null
}

export function listTreeFiles(cwd, ref) {
  const result = run('git', ['ls-tree', '-r', '--name-only', ref], { cwd })
  return result.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
}

/* ---------------------------------------------------------------------- Vercel */

function vercelCommand() {
  return process.platform === 'win32' ? 'vercel.cmd' : 'vercel'
}

function withScope(args, scope) {
  return scope ? [...args, '--scope', scope] : args
}

function vercelJson(args, { cwd, scope } = {}) {
  const finalArgs = withScope([...args, '--format', 'json', '--non-interactive'], scope)
  const result = run(vercelCommand(), finalArgs, { cwd, allowFailure: true })
  if (result.status !== 0) {
    const reason = firstLine(result.stderr) || firstLine(result.stdout) || 'unknown error'
    throw new CollectError(`vercel ${args[0] ?? ''} failed: ${reason}. Set VERCEL_TOKEN (and VERCEL_SCOPE) for an unattended run.`)
  }
  try {
    return JSON.parse(result.stdout)
  } catch {
    throw new CollectError(`vercel ${args[0] ?? ''} did not return JSON`)
  }
}

export function vercelDeploymentList({ project, scope, appSha, cwd }) {
  return vercelJson(['list', project, '--environment', 'production', '--meta', `githubCommitSha=${appSha}`], { cwd, scope })
}

export function vercelInspect({ target, scope, cwd }) {
  return vercelJson(['inspect', target], { cwd, scope })
}

/** Combined stdout+stderr: the CLI sends the "Fetching deployment" banner to stderr. */
export function vercelBuildLog({ target, scope, cwd }) {
  const args = withScope(['inspect', target, '--logs', '--non-interactive'], scope)
  const result = run(vercelCommand(), args, { cwd, allowFailure: true })
  if (result.status !== 0) {
    throw new CollectError(`vercel inspect --logs failed: ${firstLine(result.stderr) || firstLine(result.stdout) || 'unknown error'}`)
  }
  return `${result.stdout}\n${result.stderr}`
}

/* ------------------------------------------------------------- Cloudflare Worker */

/** Runs the existing schedule readback and parses its `--json` line. */
export function readWorkerScheduleReadback({ cwd }) {
  const result = run(process.execPath, ['scripts/worker-schedules.mjs', '--json'], { cwd, allowFailure: true })
  const lines = result.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const last = lines[lines.length - 1]
  if (last) {
    try {
      return { payload: JSON.parse(last), error: null }
    } catch {
      // fall through to the stderr reason
    }
  }
  const reason = firstLine(result.stderr) || 'the schedule readback did not return JSON'
  return { payload: null, error: reason }
}
