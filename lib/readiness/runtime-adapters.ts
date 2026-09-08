import { createPublicKey, type JsonWebKey } from 'node:crypto'
import { neon, type NeonQueryFunctionInTransaction } from '@neondatabase/serverless'
import { checkBinding } from '@/lib/security/db-binding'
import { createPublicUrlFetcher, type PublicUrlFetch } from '@/lib/security/public-url'
import { validateConfiguration } from './config'
import { createReadinessLookup } from './dns'
import { toReleasePolicy, type RuntimePolicy } from './runtime-contract'
import type { AuthCheck, DatabaseCheck, DatabasePortOutput, ProbePorts } from './runtime'
import type { ObservedDatabaseIdentity } from './runtime-report'

export type RuntimeDependencies = {
  env: Readonly<Record<string, string | undefined>>
  now?: () => number
  neonFactory?: typeof neon
  publicFetcher?: PublicUrlFetch
}
type Row = Record<string, unknown>
type Tx = NeonQueryFunctionInTransaction<false, false>
const emptyDatabase = (): ObservedDatabaseIdentity => ({ project: null, branch: null, role: null, database: null })
const text = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : null
function identityQuery(tx: Tx) {
  return tx`select current_setting('transaction_read_only') as read_only,
    current_setting('neon.project_id', true) as project_id, current_setting('neon.branch_id', true) as branch_id,
    current_user as role, current_database() as database,
    r.rolsuper, r.rolbypassrls, r.rolcreatedb, r.rolcreaterole, r.rolreplication,
    (exists(select 1 from pg_database d where d.datname = current_database() and d.datdba = r.oid)
     or exists(select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relowner = r.oid)
     or exists(select 1 from pg_namespace n where n.nspname = 'public' and n.nspowner = r.oid)) as owner,
    exists(select 1 from pg_roles elevated where elevated.oid <> r.oid and pg_has_role(current_user, elevated.oid, 'MEMBER')
      and (elevated.rolsuper or elevated.rolcreatedb or elevated.rolcreaterole or elevated.rolreplication or elevated.rolbypassrls
       or exists(select 1 from pg_database d where d.datname = current_database() and d.datdba = elevated.oid)
       or exists(select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relowner = elevated.oid)
       or exists(select 1 from pg_namespace n where n.nspname = 'public' and n.nspowner = elevated.oid))) as elevated_membership
    from pg_roles r where r.rolname = current_user`
}

/** Construct only after readiness authentication. No environment loading or clients at module evaluation. */
export function createRuntimePorts(dependencies: RuntimeDependencies): ProbePorts {
  const env = { ...dependencies.env }
  const list = (name: string) => (env[name] ?? '').split(',').map(s => s.trim()).filter(Boolean)
  const candidateUrl = () => {
    const host = env.VERCEL_URL
    if (!host || !/^[a-z0-9-]+\.vercel\.app$/.test(host) || env.VERCEL !== '1') return null
    return new URL(`https://${host}`)
  }
  const configuredTeam = () => text(env.READINESS_EXPECTED_TEAM_ID)
  const runtimeIdentity = () => ({ teamId: null, projectId: text(env.VERCEL_PROJECT_ID), deploymentId: text(env.VERCEL_DEPLOYMENT_ID), commitSha: /^[a-f0-9]{40}$/.test(env.VERCEL_GIT_COMMIT_SHA ?? '') ? env.VERCEL_GIT_COMMIT_SHA! : null, environment: env.VERCEL_ENV === 'preview' || env.VERCEL_ENV === 'production' ? env.VERCEL_ENV : null })
  const runtimeAvailable = () => Boolean(configuredTeam() && candidateUrl() && Object.entries(runtimeIdentity()).every(([key, value]) => key === 'teamId' || value !== null))
  const configuration = (policy: RuntimePolicy) => validateConfiguration(env, toReleasePolicy(policy))
  const bound = (row: Row, policy: RuntimePolicy, host: string) => checkBinding({ projectId: text(row.project_id), branchId: text(row.branch_id), role: String(row.role ?? ''), database: String(row.database ?? ''), host }, { projectId: policy.expectedDatabase.project, branchId: policy.expectedDatabase.branch, role: policy.expectedDatabase.role, database: policy.expectedDatabase.database, forbiddenProjectIds: list('FORBIDDEN_NEON_PROJECT_IDS'), forbiddenBranchIds: list('FORBIDDEN_NEON_BRANCH_IDS'), forbiddenHosts: list('FORBIDDEN_DB_HOSTS') }).ok
  const posture = (row: Row) => row.role === 'aeo_app' && row.rolsuper === false && row.rolbypassrls === true && row.rolcreatedb === false && row.rolcreaterole === false && row.rolreplication === false && row.owner === false && row.elevated_membership === false
  const observe = (row: Row): ObservedDatabaseIdentity => ({ project: text(row.project_id), branch: text(row.branch_id), role: text(row.role), database: text(row.database) })
  const identityCheck = (row: Row, policy: RuntimePolicy, host: string): DatabaseCheck => {
    const observed = observe(row)
    const blocked = list('FORBIDDEN_NEON_PROJECT_IDS').includes(row.project_id == null ? 'unknown' : String(row.project_id)) || list('FORBIDDEN_NEON_BRANCH_IDS').includes(row.branch_id == null ? 'unknown' : String(row.branch_id)) || list('FORBIDDEN_DB_HOSTS').includes(host)
    const mismatch = Object.entries(policy.expectedDatabase).some(([key, expected]) => observed[key as keyof ObservedDatabaseIdentity] !== null && observed[key as keyof ObservedDatabaseIdentity] !== expected)
    const flags = { rolsuper: false, rolbypassrls: true, rolcreatedb: false, rolcreaterole: false, rolreplication: false, owner: false, elevated_membership: false }
    const elevated = Object.entries(flags).some(([key, expected]) => typeof row[key] === 'boolean' && row[key] !== expected)
    const valid = bound(row, policy, host) && posture(row)
    return { id: 'database.identity', status: blocked || mismatch || elevated ? 'fail' : valid ? 'pass' : 'unknown', code: blocked || mismatch || elevated ? 'identity_mismatch' : valid ? 'matched' : 'identity_unavailable' }
  }
  return {
    now: dependencies.now ?? Date.now,
    configuredTeam,
    identity() { const identity = runtimeIdentity(); return candidateUrl() ? identity : { ...identity, deploymentId: null } },
    configuration,
    async database(policy, parent): Promise<DatabasePortOutput> {
      const signal = AbortSignal.any([parent, AbortSignal.timeout(5000)])
      let observedDatabase = emptyDatabase()
      const result = (checks: DatabaseCheck[]) => ({ observedDatabase, checks })
      try {
        if (!runtimeAvailable() || configuration(policy).some(c => (c.id === 'config.DATABASE_URL' || c.id.startsWith('binding.')) && c.status !== 'pass')) return result([{ id: 'database.identity', status: 'unknown', code: 'dependency_failed' }])
        signal.throwIfAborted()
        const host = new URL(env.DATABASE_URL!).hostname
        const sql = (dependencies.neonFactory ?? neon)(env.DATABASE_URL!)
        const options = { readOnly: true, fetchOptions: { signal } }
        const first = await sql.transaction(tx => [tx`set local statement_timeout = '5s'`, identityQuery(tx)], options)
        signal.throwIfAborted()
        const row = first[1]?.[0] as Row | undefined
        if (!row) return result([{ id: 'database.identity', status: 'unknown', code: 'identity_unavailable' }])
        observedDatabase = observe(row)
        const firstIdentity = identityCheck(row, policy, host)
        if (firstIdentity.status !== 'pass') return result([firstIdentity])
        if (row.read_only !== 'on') return result([{ id: 'database.identity', status: 'pass', code: 'matched' }, { id: 'database.read_only', status: 'fail', code: 'read_only_unverified' }])
        const expected = policy.expectedDatabase
        const requirements = JSON.stringify(policy.relations.flatMap((relation, policy_index) => relation.privileges.map(privilege => ({ policy_index, schema: relation.schema, relation: relation.relation, privilege }))))
        const second = await sql.transaction(tx => [tx`set local statement_timeout = '5s'`, identityQuery(tx), tx`
          with binding as materialized (
            select current_setting('transaction_read_only') = 'on'
              and current_setting('neon.project_id', true) = ${expected.project}
              and current_setting('neon.branch_id', true) = ${expected.branch}
              and current_user = ${expected.role} and current_database() = ${expected.database}
              and not (current_setting('neon.project_id', true) = any(${list('FORBIDDEN_NEON_PROJECT_IDS')}::text[]))
              and not (current_setting('neon.branch_id', true) = any(${list('FORBIDDEN_NEON_BRANCH_IDS')}::text[]))
              and not (${host} = any(${list('FORBIDDEN_DB_HOSTS')}::text[]))
              and not r.rolsuper and r.rolbypassrls and not r.rolcreatedb and not r.rolcreaterole and not r.rolreplication
              and not exists(select 1 from pg_database d where d.datname = current_database() and d.datdba = r.oid)
              and not exists(select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relowner = r.oid)
              and not exists(select 1 from pg_namespace n where n.nspname = 'public' and n.nspowner = r.oid)
              and not exists(select 1 from pg_roles elevated where elevated.oid <> r.oid and pg_has_role(current_user, elevated.oid, 'MEMBER')
                and (elevated.rolsuper or elevated.rolcreatedb or elevated.rolcreaterole or elevated.rolreplication or elevated.rolbypassrls
                 or exists(select 1 from pg_database d where d.datname = current_database() and d.datdba = elevated.oid)
                 or exists(select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relowner = elevated.oid)
                 or exists(select 1 from pg_namespace n where n.nspname = 'public' and n.nspowner = elevated.oid))) as ok
            from pg_roles r where r.rolname = current_user
          )
          select requirement.policy_index, requirement.privilege,
            case when binding.ok then c.oid is not null else null end as present,
            case when binding.ok and c.oid is not null then has_table_privilege(current_user, c.oid, requirement.privilege) else null end as permitted
          from binding cross join jsonb_to_recordset(${requirements}::jsonb) as requirement(policy_index int, schema text, relation text, privilege text)
          left join pg_namespace n on binding.ok and n.nspname = requirement.schema
          left join pg_class c on binding.ok and c.relnamespace = n.oid and c.relname = requirement.relation and c.relkind in ('r', 'p', 'v', 'm', 'f')
        `], options)
        signal.throwIfAborted()
        const rechecked = second[1]?.[0] as Row | undefined
        if (!rechecked) return result([{ id: 'database.identity', status: 'unknown', code: 'identity_unavailable' }])
        observedDatabase = observe(rechecked)
        const secondIdentity = identityCheck(rechecked, policy, host)
        if (secondIdentity.status !== 'pass') return result([secondIdentity])
        if (rechecked.read_only !== 'on') return result([{ id: 'database.read_only', status: 'fail', code: 'read_only_unverified' }])
        const checks: DatabaseCheck[] = [{ id: 'database.identity', status: 'pass', code: 'matched' }, { id: 'database.read_only', status: 'pass', code: 'read_only' }]
        const metadata = second[2] as Row[]
        for (const [policyIndex, relation] of policy.relations.entries()) for (const privilege of relation.privileges) {
          const matches = metadata?.filter(r => r.policy_index === policyIndex && r.privilege === privilege) ?? []
          const value = matches.length === 1 ? matches[0] : undefined
          checks.push({ id: 'database.relation', policyIndex, privilege,
            status: value?.present === false || value?.permitted === false ? 'fail' : value?.present === true && value?.permitted === true ? 'pass' : 'unknown',
            code: value?.present === false ? 'relation_missing' : value?.permitted === false ? 'privilege_missing' : value?.present === true && value?.permitted === true ? 'privilege_present' : 'malformed_response' })
        }
        return result(checks)
      } catch (error) {
        const timeout = signal.aborted || typeof error === 'object' && error !== null && 'code' in error && error.code === '57014'
        return result([{ id: 'database.identity', status: 'unknown', code: timeout ? 'timeout' : 'connection_failed' }])
      }
    },
    async auth(_policy, parent): Promise<AuthCheck[]> {
      const signal = AbortSignal.any([parent, AbortSignal.timeout(5000)])
      if (!runtimeAvailable()) return [{ id: 'auth.jwks', status: 'unknown', code: 'dependency_failed' }]
      const fetcher = dependencies.publicFetcher ?? createPublicUrlFetcher({ lookup: createReadinessLookup(), allowedProtocols: ['https:'], maxRedirects: 0, maxResponseBytes: 65536, timeoutMs: 5000 })
      const checks: AuthCheck[] = []
      for (const id of ['auth.jwks', 'auth.anonymous_session'] as const) {
        let response: Response | undefined
        try {
          signal.throwIfAborted()
          const issuer = new URL(env.NEON_AUTH_BASE_URL ?? '')
          if (issuer.protocol !== 'https:' || issuer.username || issuer.password || issuer.search || issuer.hash || !/^\/[A-Za-z0-9_-]+\/auth\/?$/.test(issuer.pathname)) throw new Error('Invalid issuer')
          // Neon Auth exposes managed public signing keys at this canonical path: https://raw.githubusercontent.com/neondatabase/website/main/content/docs/auth/guides/plugins/jwt.md
          const url = id === 'auth.jwks' ? new URL(`${issuer.href.replace(/\/$/, '')}/.well-known/jwks.json`) : new URL('/api/auth/get-session', candidateUrl()!)
          const headers: Record<string, string> = { accept: 'application/json' }
          if (id === 'auth.anonymous_session' && env.VERCEL_AUTOMATION_BYPASS_SECRET) headers['x-vercel-protection-bypass'] = env.VERCEL_AUTOMATION_BYPASS_SECRET
          response = await fetcher(url, { method: 'GET', headers, credentials: 'omit', redirect: 'manual', signal })
          if (response.status !== 200) { checks.push({ id, status: 'fail', code: 'unavailable' }); continue }
          const body = await readJson(response, signal)
          if (id === 'auth.jwks') {
            const valid = typeof body === 'object' && body !== null && !Array.isArray(body) && 'keys' in body && Array.isArray(body.keys) && body.keys.length > 0 && body.keys.every(isPublicJwk)
            checks.push({ id, status: valid ? 'pass' : 'fail', code: valid ? 'available' : 'malformed_response' })
          } else checks.push({ id, status: body === null ? 'pass' : 'fail', code: body === null ? 'anonymous' : 'session_present' })
        } catch { checks.push({ id, status: signal.aborted ? 'unknown' : 'fail', code: signal.aborted ? 'timeout' : 'malformed_response' }) }
        finally { if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {}) }
      }
      return checks
    },
  }
}

async function readJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.body) throw new Error('Missing body')
  const reader = response.body.getReader()
  const cancel = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    const chunks: Uint8Array[] = []; let size = 0
    while (true) {
      signal.throwIfAborted()
      const chunk = await reader.read()
      signal.throwIfAborted()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > 65536) throw new Error('Oversize body')
      chunks.push(chunk.value)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } finally { signal.removeEventListener('abort', cancel); await reader.cancel().catch(() => {}); reader.releaseLock() }
}

/** Parse supported public material only; JSON shape alone does not establish usable signing keys. */
function isPublicJwk(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const key = value as Record<string, unknown>
  if (['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'].some(field => field in key)) return false
  const fields = key.kty === 'RSA' ? ['n', 'e'] : key.kty === 'EC' && ['P-256', 'P-384', 'P-521'].includes(String(key.crv)) ? ['x', 'y'] : key.kty === 'OKP' && ['Ed25519', 'Ed448'].includes(String(key.crv)) ? ['x'] : null
  if (!fields || fields.some(field => typeof key[field] !== 'string' || !/^[A-Za-z0-9_-]+$/.test(key[field] as string) || Buffer.from(key[field] as string, 'base64url').toString('base64url') !== key[field])) return false
  try { return createPublicKey({ key: key as JsonWebKey, format: 'jwk' }).type === 'public' } catch { return false }
}
