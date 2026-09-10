import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Every API route gates itself, or is declared public with a reason.
 *
 * There is no global gate: `proxy.ts`'s matcher skips `/api` entirely and layouts
 * never run for route handlers, so a new handler is unprotected unless it says
 * otherwise — and nothing failed when one shipped without a gate.
 *
 * The naive version of this test — grep each route file for `getProfile` —
 * reports 27 false positives, because most handlers are three lines that delegate
 * to a service which does the gating. CLAUDE.md says so explicitly: "Grep is not
 * a reliable gate check here … Read the callee before concluding a route is open."
 *
 * So this follows the delegation one level: a route counts as gated when the
 * handler OR a module it directly imports references a gate. One level fits the
 * shape this codebase actually uses (route -> service) and stops well short of a
 * whole-program analysis that would become its own maintenance problem.
 */

/**
 * Tokens meaning "this code decided who is calling". Deliberately broad — a false
 * negative here is a route that must then be declared public, which is a
 * conversation, whereas a false positive would silently bless an open route.
 */
const GATE_TOKENS = [
  'getProfile',            // session lookup; callers null-check
  'requireAuth',
  'requireAdmin',
  'requireApiAdmin',
  'localTrustGuard',
  'assertLocalTrustAccess',
  'CRON_SECRET',           // cron shared secret, either header shape
  'cronSecret',
  'constructEvent',        // Stripe signature verification
  'isAuthorizedScanClaim', // signed, scan-bound claim intent
  'consumePublicScanRateLimit',
  'consumeDurableRateLimit',
  'neon_auth',             // webhook payload verified against the auth table
  // Capability-based rather than session-based, and no less a gate: the share
  // link carries an HMAC verified with timingSafeEqual in lib/reports/share.ts.
  'resolvePublishedClientReport',
  'verifyReportShare',
  'authorize(',            // service-local gate helpers
  'authenticate(',
]

/**
 * Routes that are public BY DESIGN. Each needs a reason, and this list is the
 * whole conversation: adding to it is how a route becomes public, rather than
 * forgetting a gate being how it happens.
 */
const DECLARED_PUBLIC: Record<string, string> = {
  'app/api/auth/[...path]/route.ts':
    'The Neon Auth catch-all. It IS the authentication endpoint, so it cannot require a session.',
}

function routeFiles(): string[] {
  const found: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) walk(path)
      else if (entry === 'route.ts') found.push(path)
    }
  }
  walk(join(process.cwd(), 'app', 'api'))
  return found.map(p => relative(process.cwd(), p).split(sep).join('/')).sort()
}

/** `@/lib/x` and `./y`, resolved to a real file when one exists. */
function importedProjectFiles(file: string): string[] {
  const source = readFileSync(join(process.cwd(), file), 'utf8')
  const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map(match => match[1]!)
  const resolved: string[] = []
  for (const specifier of specifiers) {
    let base: string | null = null
    if (specifier.startsWith('@/')) base = join(process.cwd(), specifier.slice(2))
    else if (specifier.startsWith('.')) base = resolve(join(process.cwd(), dirname(file)), specifier)
    if (!base) continue
    for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
      if (existsSync(candidate) && statSync(candidate).isFile()) { resolved.push(candidate); break }
    }
  }
  return resolved
}

const hasGate = (source: string) => GATE_TOKENS.some(token => source.includes(token))

function gateEvidence(file: string): string | null {
  if (hasGate(readFileSync(join(process.cwd(), file), 'utf8'))) return file
  for (const dependency of importedProjectFiles(file)) {
    if (hasGate(readFileSync(dependency, 'utf8'))) {
      return relative(process.cwd(), dependency).split(sep).join('/')
    }
  }
  return null
}

const ROUTES = routeFiles()

describe('every API route is gated or declared public', () => {
  it('finds the route handlers', () => {
    // A broken walk would make this suite vacuous while still passing.
    expect(ROUTES.length).toBeGreaterThan(50)
    expect(ROUTES).toContain('app/api/scan/route.ts')
  })

  it.each(ROUTES)('%s', file => {
    if (DECLARED_PUBLIC[file]) {
      // A declared-public route must not quietly acquire a gate and stay listed,
      // or the list stops describing reality.
      expect(gateEvidence(file), `${file} is declared public but now gates itself; remove its entry.`).toBeNull()
      return
    }
    expect(
      gateEvidence(file),
      `${file} references no gate, and neither does anything it imports. Gate it, or declare it in DECLARED_PUBLIC with the reason it is safe.`,
    ).not.toBeNull()
  })

  it('declares nothing public that no longer exists', () => {
    for (const file of Object.keys(DECLARED_PUBLIC)) expect(ROUTES).toContain(file)
  })

  it('keeps the public list short enough to read', () => {
    // Not a style rule. This list is the entire public surface of the API, and a
    // long one means the exception has become the pattern.
    expect(Object.keys(DECLARED_PUBLIC).length).toBeLessThanOrEqual(5)
  })
})
