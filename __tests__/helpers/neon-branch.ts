import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { redactSecrets } from '@/lib/security/redact-secrets'

export const PROJECT_ID = 'red-firefly-93523049'

/**
 * The project's default branch. Production data lives on it. It is named here
 * so the guards below can reject it by identity rather than merely avoiding it
 * by construction.
 */
export const PRODUCTION_BRANCH_ID = 'br-rough-butterfly-aojtgi92'

/**
 * A hard crash (SIGKILL, closed laptop, CI runner reaped) runs neither
 * teardown() nor setup()'s cleanup path. Neon deletes an expired branch on its
 * own, so a branch lost that way cannot linger.
 */
const BRANCH_TTL_MS = 2 * 60 * 60 * 1000

const BRANCH_ID = /^br-[a-z0-9-]+$/

function neonctl(args: string[]): string {
  try {
    return execFileSync('neonctl', [...args, '--output', 'json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      // An unauthenticated neonctl tries to start an interactive browser
      // login. stdin is closed, so it would otherwise sit there indefinitely —
      // and a synchronous child blocks the event loop, so Vitest's hookTimeout
      // cannot interrupt it. Fail instead of hanging.
      timeout: 120_000,
    })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    const hint =
      (err as { code?: string }).code === 'ENOENT'
        ? 'neonctl is not on PATH. Install it (`npm i -g neonctl`) and run `neonctl auth`.'
        : 'Integration tests need an authenticated neonctl. Run `neonctl auth` (or set ' +
          'NEON_API_KEY) and retry.'
    throw new Error(`neonctl ${args.slice(0, 2).join(' ')} failed: ${redactSecrets(detail)}\n${hint}`)
  }
}

export type TestBranch = { id: string; connectionUri: string }

/**
 * Branches this process created: id -> the exact connection uri neonctl
 * returned for it.
 *
 * This map is the only provenance the destructive path trusts. It is
 * module-private and never populated from configuration, the environment or a
 * caller — only by a `neonctl branches create` that succeeded in this very
 * process. globalSetup runs in Vitest's main process, so setup() and teardown()
 * share this instance; test workers get their own empty copy and therefore
 * cannot satisfy assertDisposableTestBranch() at all.
 */
const created = new Map<string, string>()

export function createdBranchIds(): string[] {
  return [...created.keys()]
}

/** Normalises a connection uri to its endpoint host, pooled or direct. */
function hostOf(uri: string): string | null {
  try {
    return new URL(uri).hostname.replace('-pooler.', '.')
  } catch {
    return null
  }
}

/**
 * Every host this machine believes is production, so the guard can refuse a
 * match. `.env.local` is read as well as the environment because
 * `npm run test:integration` does not load it — the leak this defends against
 * is exactly the case where the production url reaches the harness by a route
 * nobody expected.
 */
function productionHosts(): string[] {
  const urls: string[] = []
  if (process.env.DATABASE_URL) urls.push(process.env.DATABASE_URL)
  try {
    const envFile = readFileSync(join(process.cwd(), '.env.local'), 'utf8')
    const match = /^\s*DATABASE_URL\s*=\s*(.+)$/m.exec(envFile)
    if (match) urls.push(match[1].trim().replace(/^["']|["']$/g, ''))
  } catch {
    // No readable .env.local; the environment check above still applies.
  }
  return urls.map(hostOf).filter((host): host is string => host !== null)
}

export function createTestBranch(name: string): TestBranch {
  const expiresAt = new Date(Date.now() + BRANCH_TTL_MS).toISOString()
  const out = neonctl([
    'branches', 'create',
    '--project-id', PROJECT_ID,
    '--name', name,
    '--expires-at', expiresAt,
  ])

  let parsed: {
    branch?: Record<string, unknown>
    endpoints?: { host?: string; branch_id?: string }[]
    connection_uris?: { connection_uri?: string }[]
  }
  try {
    parsed = JSON.parse(out)
  } catch {
    throw new Error(
      'neonctl branches create did not return JSON. A branch may still have been created: ' +
      `check \`neonctl branches list --project-id ${PROJECT_ID}\`.`,
    )
  }

  const branch = parsed.branch ?? {}
  const id = branch.id
  if (typeof id !== 'string' || !BRANCH_ID.test(id)) {
    throw new Error(
      'neonctl branches create returned no usable branch id — refusing to continue. ' +
      `A branch may still exist: check \`neonctl branches list --project-id ${PROJECT_ID}\`.`,
    )
  }
  // Register before validating the rest, so a branch rejected below is still
  // deleted by the caller's cleanup rather than orphaned.
  created.set(id, '')

  // Everything the destructive path later relies on is asserted here rather
  // than inferred, so a change to neonctl's JSON shape fails loudly instead of
  // quietly handing back another branch's identity or connection uri.
  //
  // As of 2026-08 this key is reliably absent: the production branch acquired
  // a second Postgres role, `aeo_app`, created out-of-band on 2026-08-16
  // (likely early least-privilege work — see docs/runbooks/verify-pulse-rollup.md
  // for the neonctl hazards this file already routes around). Every branch
  // created off production inherits both roles, and `branches create` omits
  // `connection_uris` from its response whenever it cannot disambiguate which
  // role to hand back a uri for — confirmed empirically (6/6 fresh branches:
  // the response has exactly `{branch, endpoints}`, no `connection_uris` key).
  // `branches create` is the only neonctl command that would have put a uri
  // here for free, so when it doesn't, fetch one explicitly rather than fail —
  // pinned to `neondb_owner`, the role every other piece of this codebase's
  // tooling already uses (DATABASE_URL, scripts/verify-db-connection.mjs, …).
  // Deleting the new `aeo_app` role instead would remove the ambiguity too,
  // but deleting a production role is out of scope for this harness fix.
  // Checked as "missing" rather than assumed absent, so this keeps working
  // unmodified if Neon ever starts populating the field again.
  let uri = parsed.connection_uris?.[0]?.connection_uri
  let fetchFailure: string | undefined
  if (typeof uri !== 'string' || !uri) {
    const fetched = fetchConnectionUriByRole(id)
    uri = fetched.uri
    fetchFailure = fetched.error
  }
  const uriHost = typeof uri === 'string' ? hostOf(uri) : null
  const problems: string[] = []
  if (branch.project_id !== PROJECT_ID) problems.push(`project_id is ${String(branch.project_id)}`)
  if (branch.name !== name) problems.push(`name is ${String(branch.name)}, expected ${name}`)
  if (typeof branch.parent_id !== 'string' || !branch.parent_id) {
    problems.push('it has no parent_id, so it is a root branch rather than a child')
  }
  if (branch.default === true || branch.primary === true) problems.push('it is the default branch')
  if (id === PRODUCTION_BRANCH_ID) problems.push('it is the production branch')
  if (!uriHost) {
    problems.push(
      fetchFailure
        ? 'it has no usable connection uri (branches create omitted connection_uris, and the ' +
          `fallback neonctl connection-string fetch failed: ${fetchFailure})`
        : 'it has no usable connection uri',
    )
  }
  // The uri must belong to an endpoint of this same branch — proof that the
  // connection uri and the branch id in the response describe one thing. This
  // is also what would catch a `--branch-id` regression in
  // fetchConnectionUriByRole below: that flag is silently dropped by yargs and
  // falls back to the project's default (production) branch, whose host does
  // not match any endpoint returned for this branch.
  const endpointMatches = parsed.endpoints?.some(
    (e) => e.branch_id === id && typeof e.host === 'string' && hostOf(`postgresql://x@${e.host}/d`) === uriHost,
  )
  if (uriHost && !endpointMatches) {
    problems.push('its connection uri does not match any endpoint of this branch')
  }
  if (problems.length > 0) {
    throw new Error(
      `neonctl branches create returned a branch this harness will not use (${problems.join('; ')}). ` +
      `Branch ${id} must be removed: neonctl branches delete ${id} --project-id ${PROJECT_ID}`,
    )
  }

  created.set(id, uri as string)
  return { id, connectionUri: uri as string }
}

/**
 * Fetches an existing branch's connection uri by role, for the now-default
 * case where `branches create`'s response omits `connection_uris` outright
 * (see the comment above this function's call site).
 *
 * The branch identifier is a POSITIONAL argument to `neonctl connection-string`,
 * never `--branch-id` — that flag is not declared on this command, so yargs
 * silently drops it and the command falls back to the project's DEFAULT
 * branch, which here is production. That is exactly the hazard every guard in
 * this file exists to catch, so getting this one call wrong would defeat the
 * entire point of this function. Verified against `neonctl connection-string
 * --help` before writing this call (its only positional is `[branch]`, with
 * no `--branch-id` among its options) — do not "simplify" this into the
 * `--branch-id` form.
 */
function fetchConnectionUriByRole(id: string): { uri?: string; error?: string } {
  let out: string
  try {
    out = neonctl([
      'connection-string', id,
      '--project-id', PROJECT_ID,
      '--role-name', 'neondb_owner',
      '--database-name', 'neondb',
    ])
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }

  // `--output json` on this command does not reliably emit JSON — observed
  // empirically: it printed the bare uri as plain text, not even
  // quoted. Try JSON first (a string, or an object carrying the uri under a
  // plausible key) and fall back to the trimmed raw text when it looks like a
  // postgres uri, rather than assuming either shape.
  const trimmed = out.trim()
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (typeof parsed === 'string' && parsed) return { uri: parsed }
    if (parsed && typeof parsed === 'object') {
      const candidate =
        (parsed as Record<string, unknown>).connection_uri ?? (parsed as Record<string, unknown>).uri
      if (typeof candidate === 'string' && candidate) return { uri: candidate }
    }
  } catch {
    // Not JSON — fall through to the plain-text case below.
  }
  if (trimmed.startsWith('postgres://') || trimmed.startsWith('postgresql://')) {
    return { uri: trimmed }
  }
  return { error: 'neonctl connection-string returned no usable uri' }
}

/**
 * Positive proof that `branch` is an ephemeral branch this process created and
 * may therefore be dropped and rebuilt. Throws otherwise; it returns nothing,
 * so a caller cannot accidentally ignore the answer.
 *
 * This is deliberately not "is it probably not production" — it is "did this
 * process create exactly this branch, with exactly this connection uri". A
 * hand-built TestBranch, a branch id from a previous run, or a uri swapped for
 * DATABASE_URL all fail here.
 */
export function assertDisposableTestBranch(branch: TestBranch): void {
  const registeredUri = created.get(branch.id)
  if (registeredUri === undefined) {
    throw new Error(
      `Refusing to modify branch ${branch.id}: this process did not create it. Only a branch ` +
      'returned by createTestBranch() in this same process may be reset.',
    )
  }
  if (registeredUri !== branch.connectionUri) {
    throw new Error(
      `Refusing to modify branch ${branch.id}: the supplied connection uri is not the one ` +
      'neonctl returned when this process created the branch.',
    )
  }
  if (branch.id === PRODUCTION_BRANCH_ID) {
    throw new Error(`Refusing to modify ${PRODUCTION_BRANCH_ID}: that is the production branch.`)
  }
  const target = hostOf(branch.connectionUri)
  if (!target) {
    throw new Error(`Refusing to modify branch ${branch.id}: its connection uri has no host.`)
  }
  if (productionHosts().includes(target)) {
    throw new Error(
      `Refusing to modify branch ${branch.id}: its host is the production DATABASE_URL host.`,
    )
  }
}

export function deleteTestBranch(id: string): void {
  neonctl(['branches', 'delete', id, '--project-id', PROJECT_ID])
  created.delete(id)
}
