import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Relative, with the explicit .ts extension, rather than the '@/' alias: this
// module is imported by scripts/schema-equivalence.mjs under plain node, which
// resolves neither tsconfig path aliases nor extensionless .ts files. Vitest
// resolves this form too, so the integration harness is unaffected. tsc rejects
// the extension under moduleResolution "bundler" without repo-wide
// allowImportingTsExtensions; suppress narrowly rather than widening it, exactly
// as scripts/migrate.ts does.
// @ts-expect-error -- see comment above; node requires the extension, tsc forbids it
import { redactSecrets } from '../../lib/security/redact-secrets.ts'

// `?.trim() || fallback` rather than `??`: nullish coalescing only falls back on
// null/undefined, not on '' — and GitHub Actions substitutes '' for a `${{ secrets.X }}`
// reference whose secret doesn't exist. An empty PRODUCTION_BRANCH_ID would otherwise
// silently disable this file's two identity comparisons against it (real branch ids never
// equal ''), rather than falling back to the real production id the guards exist to reject.
//
// The default is AISO, never the legacy project. createTestBranch() passes no
// --parent, so a branch's parent is whatever the project's default branch is,
// and a Neon branch is a copy-on-write snapshot of its parent rather than an
// empty database — resetPublicSchema() then drops and recreates public on that
// copy. Defaulting to a project whose default branch holds customer data
// therefore snapshots real data on every unconfigured run. This defaulted to
// red-firefly-93523049 until 2026-09-05; §16.1 of the integration plan is
// explicit that one must never create a preview or test branch from a branch
// that has held customer data. AISO's default branch has held only the
// synthetic seed.
export const PROJECT_ID = process.env.NEON_TEST_PROJECT_ID?.trim() || 'weathered-wave-50814522'

/**
 * The default branch of whichever project PROJECT_ID names — so the two must
 * always move together. It is named here so the guards below can reject it by
 * identity rather than merely avoiding it by construction.
 *
 * This is a blocklist entry, not a parent selector: nothing passes it to
 * `branches create`. createTestBranch() additionally rejects any branch
 * reporting `default` or `primary`, which catches the default branch
 * structurally even if this id were stale.
 */
export const PRODUCTION_BRANCH_ID = process.env.NEON_TEST_PRODUCTION_BRANCH_ID?.trim() || 'br-square-mountain-az6f82vi'

/**
 * The role migrations run as. Passed explicitly to `connection-string`
 * because every branch created off main now inherits two roles (this one and
 * `aeo_app`, since migration 037), and neonctl refuses to pick one on its own
 * once a branch has more than one.
 */
const OWNER_ROLE = process.env.NEON_TEST_OWNER_ROLE?.trim() || 'neondb_owner'

/**
 * A hard crash (SIGKILL, closed laptop, CI runner reaped) runs neither
 * teardown() nor setup()'s cleanup path. Neon deletes an expired branch on its
 * own, so a branch lost that way cannot linger.
 */
const BRANCH_TTL_MS = 2 * 60 * 60 * 1000

const BRANCH_ID = /^br-[a-z0-9-]+$/

/**
 * How to spawn neonctl on this platform. Returns [command, leadingArgs].
 *
 * On Linux — CI, and the only platform this harness ever ran on until now — the
 * global `neonctl` is a shell script and execFileSync spawns it directly. That
 * branch is byte-identical in behaviour to what this file did before, so CI is
 * unaffected.
 *
 * On Windows it is a `.cmd` shim, and Node deliberately refuses to spawn
 * `.cmd`/`.bat` from execFileSync without `shell: true` — a security change
 * guarding against argument injection through cmd.exe. Rather than re-open that
 * hole, resolve neonctl's own JS entry point and run it under this same node
 * binary: no shim, no shell, arguments still passed as an array.
 *
 * Exported because scripts/run-tests.mjs's integration preflight has to spawn
 * neonctl the same way: a bare execFileSync('neonctl') there reported "neonctl
 * is not on PATH" on every Windows machine, including ones where it was
 * installed and authenticated. Duplicating the resolution would let the two
 * copies drift on a decision that is about security, not convenience.
 */
export function neonctlCommand(): [string, string[]] {
  if (process.platform !== 'win32') return ['neonctl', []]

  const appData = process.env.APPDATA
  if (!appData) {
    throw new Error(
      'Cannot locate neonctl on Windows: APPDATA is unset, so the global npm prefix ' +
      'cannot be derived. Install neonctl (`npm i -g neonctl`).',
    )
  }
  return [process.execPath, [join(appData, 'npm', 'node_modules', 'neonctl', 'bin', 'cli.js')]]
}

function neonctl(args: string[]): string {
  const [command, leadingArgs] = neonctlCommand()
  try {
    return execFileSync(command, [...leadingArgs, ...args, '--output', 'json'], {
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
  // Only an identity matching this requested child is eligible for cleanup.
  // Rejected default/foreign responses must never become deletion candidates.
  const identityProblems: string[] = []
  if (branch.project_id !== PROJECT_ID) identityProblems.push('project_id does not match')
  if (branch.name !== name) identityProblems.push(`name is ${String(branch.name)}, expected ${name}`)
  if (typeof branch.parent_id !== 'string' || !branch.parent_id) identityProblems.push('it has no parent_id')
  if (branch.default === true || branch.primary === true) identityProblems.push('it is the default branch')
  if (id === PRODUCTION_BRANCH_ID) identityProblems.push('it is the production branch')
  if (identityProblems.length) {
    throw new Error(`Refusing unproven branch identity (${identityProblems.join('; ')}). No automatic cleanup is allowed; inspect the requested project.`)
  }
  // A safe child remains cleanable if retrieving its connection subsequently fails.
  created.set(id, '')

  // `branches create`'s response carries no connection string once a branch
  // has more than one role (ambiguous which role to hand back), which is now
  // every branch created off main. Fetched separately, naming the role, and
  // trimmed because the CLI's stdout ends in a newline.
  const uri = neonctl([
    'connection-string', id,
    '--project-id', PROJECT_ID,
    '--role-name', OWNER_ROLE,
  ]).trim()

  // Everything the destructive path later relies on is asserted here rather
  // than inferred, so a change to neonctl's output fails loudly instead of
  // quietly handing back another branch's identity or connection uri.
  const uriHost = uri ? hostOf(uri) : null
  const problems: string[] = []
  if (!uriHost) problems.push('it has no usable connection uri')
  // The uri must belong to an endpoint of this same branch — proof that the
  // connection uri and the branch id in the response describe one thing.
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

  created.set(id, uri)
  return { id, connectionUri: uri }
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
  if (!BRANCH_ID.test(id) || id === PRODUCTION_BRANCH_ID || !created.has(id)) {
    throw new Error('Refusing to delete a protected, invalid or unregistered branch.')
  }
  neonctl(['branches', 'delete', id, '--project-id', PROJECT_ID])
  created.delete(id)
}
