import { neonConfig } from '@neondatabase/serverless'
import { format, inspect } from 'node:util'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/fix/guard', () => ({ authorizeAiTool: async () => ({ ok: true, accountId: 'synthetic' }), consumeAiToolAllowance: vi.fn() }))

/**
 * The impure half of the binding guard: the Proxy lib/db.ts wraps around
 * NeonQueryFunction.
 *
 * These run against the REAL driver — only the HTTP transport is stubbed, via
 * neonConfig.fetchFunction — because the things most likely to break are the
 * driver's own invariants, not ours: transaction() rejects any query failing
 * `instanceof NeonQueryPromise`, so a wrapper that returns a plain Promise
 * typechecks, passes a mocked suite, and fails in production. Stubbing
 * `@neondatabase/serverless` itself would prove none of that.
 *
 * db() memoizes both the client and the guard promise at module scope, so every
 * test imports a fresh copy through vi.resetModules().
 */

const DSN = 'postgresql://aeo_app:pw@ep-test-pooler.example.neon.tech/neondb'

type SentRequest = { query?: string; params?: unknown[]; queries?: unknown[] }

let sent: SentRequest[]
let identity: { projectId: string; branchId: string; role: string; database: string }
let savedEnv: Record<string, string | undefined>

const ENV_KEYS = [
  'DATABASE_URL',
  'EXPECTED_NEON_PROJECT_ID',
  'EXPECTED_NEON_BRANCH_ID',
  'EXPECTED_DB_ROLE',
  'EXPECTED_DB_NAME',
  'FORBIDDEN_NEON_PROJECT_IDS',
  'FORBIDDEN_NEON_BRANCH_IDS',
  'FORBIDDEN_DB_HOSTS',
] as const

/** Neon's HTTP endpoint always answers with rows as arrays plus field metadata. */
function singleResult(body: SentRequest) {
  const isIdentity = (body.query ?? '').includes('neon.project_id')
  return isIdentity
    ? {
        command: 'SELECT',
        rowCount: 1,
        rowAsArray: true,
        fields: [
          { name: 'project_id', dataTypeID: 25 },
          { name: 'branch_id', dataTypeID: 25 },
          { name: 'role', dataTypeID: 19 },
          { name: 'database', dataTypeID: 19 },
        ],
        rows: [[identity.projectId, identity.branchId, identity.role, identity.database]],
      }
    : {
        command: 'SELECT',
        rowCount: 1,
        rowAsArray: true,
        fields: [{ name: 'ok', dataTypeID: 23 }],
        rows: [['1']],
      }
}

beforeEach(() => {
  vi.resetModules()
  sent = []
  identity = {
    projectId: 'weathered-wave-50814522',
    branchId: 'br-square-mountain-az6f82vi',
    role: 'aeo_app',
    database: 'neondb',
  }

  savedEnv = {}
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key]
    delete process.env[key]
  }
  process.env.DATABASE_URL = DSN
  process.env.EXPECTED_NEON_PROJECT_ID = identity.projectId

  neonConfig.fetchFunction = async (_url: string, opts: { body: string }) => {
    const body = JSON.parse(opts.body) as SentRequest
    sent.push(body)
    const payload = Array.isArray(body.queries)
      ? { results: body.queries.map(() => singleResult({})) }
      : singleResult(body)
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    }
  }
})

afterEach(() => {
  neonConfig.fetchFunction = undefined
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
})

async function loadDb() {
  const mod = await import('@/lib/db')
  return mod.db
}

/** Requests that were the guard's own identity probe. */
function identityProbes() {
  return sent.filter((r) => (r.query ?? '').includes('neon.project_id'))
}

describe('the guard runs before the first query', () => {
  it('proves the binding, then runs the caller query', async () => {
    const sql = (await loadDb())()
    const rows = await sql`select 1 as ok`

    expect(rows).toEqual([{ ok: 1 }])
    expect(identityProbes()).toHaveLength(1)
    expect(sent[0].query).toContain('neon.project_id')
    expect(sent[1].query).toBe('select 1 as ok')
  })

  it('forwards template values as parameters, unchanged', async () => {
    const sql = (await loadDb())()
    const id = 'acct-42'
    await sql`select 1 from accounts where id = ${id}`

    expect(sent[1].query).toBe('select 1 from accounts where id = $1')
    expect(sent[1].params).toEqual([id])
  })

  it('issues one identity probe for two concurrent first queries', async () => {
    const sql = (await loadDb())()
    await Promise.all([sql`select 1 as ok`, sql`select 1 as ok`])

    expect(identityProbes()).toHaveLength(1)
    expect(sent).toHaveLength(3)
  })

  it('does not re-probe on later queries', async () => {
    const sql = (await loadDb())()
    await sql`select 1 as ok`
    await sql`select 1 as ok`

    expect(identityProbes()).toHaveLength(1)
  })
})

describe('the guard fails closed', () => {
  it('rejects, naming both project ids, when the binding is wrong', async () => {
    identity.projectId = 'red-firefly-93523049'
    const sql = (await loadDb())()

    await expect(sql`select 1 as ok`).rejects.toThrow(/weathered-wave-50814522/)
    await expect(sql`select 1 as ok`).rejects.toThrow(/red-firefly-93523049/)
    // The caller's query never reached the wrong database.
    expect(sent.every((r) => (r.query ?? '').includes('neon.project_id'))).toBe(true)
  })

  it('refuses to connect at all when EXPECTED_NEON_PROJECT_ID is unset', async () => {
    delete process.env.EXPECTED_NEON_PROJECT_ID
    const sql = (await loadDb())()

    await expect(sql`select 1 as ok`).rejects.toThrow(/EXPECTED_NEON_PROJECT_ID/)
    expect(sent).toHaveLength(0)
  })

  it('fails closed, and redacted, when the identity query itself rejects', async () => {
    neonConfig.fetchFunction = async () => {
      // The driver puts the connection URL, password included, into its own
      // error text. This is the only query whose failure the guard reports.
      throw new Error(`connect ECONNREFUSED for ${DSN}`)
    }
    const sql = (await loadDb())()

    await expect(sql`select 1 as ok`).rejects.toThrow(/could not be identified/)
    // Only approved diagnostics survive, including Node's recursive formatter.
    const error = await sql`select 1 as ok`.catch(error => error)
    expect(format(error)).not.toContain(DSN)
    expect(inspect(error)).not.toContain(':pw@')
    expect(JSON.stringify(error)).not.toContain(':pw@')
    expect(error).not.toHaveProperty('cause')
    expect(error).not.toHaveProperty('sourceError')
    await expect(sql`select 1 as ok`).rejects.not.toThrow(/:pw@/)
  })

  it('rejects a forbidden host even though the project matches', async () => {
    process.env.FORBIDDEN_DB_HOSTS = 'ep-test-pooler.example.neon.tech'
    const sql = (await loadDb())()

    await expect(sql`select 1 as ok`).rejects.toThrow(/forbidden/i)
  })

  it('ignores the branch id when EXPECTED_NEON_BRANCH_ID is unset', async () => {
    identity.branchId = 'br-some-ephemeral-test-branch'
    const sql = (await loadDb())()

    await expect(sql`select 1 as ok`).resolves.toEqual([{ ok: 1 }])
  })

  it('checks the branch id when EXPECTED_NEON_BRANCH_ID is set', async () => {
    process.env.EXPECTED_NEON_BRANCH_ID = 'br-square-mountain-az6f82vi'
    identity.branchId = 'br-some-ephemeral-test-branch'
    const sql = (await loadDb())()

    await expect(sql`select 1 as ok`).rejects.toThrow(/branch/i)
  })

  it('rejects the owner role when EXPECTED_DB_ROLE pins aeo_app', async () => {
    // The 2026-09-05 incident exactly: right project, wrong role.
    process.env.EXPECTED_DB_ROLE = 'aeo_app'
    identity.role = 'neondb_owner'
    const sql = (await loadDb())()

    await expect(sql`select 1 as ok`).rejects.toThrow(/neondb_owner/)
  })
})

describe('database diagnostic boundary after binding', () => {
  it.each(['template', 'query', 'transaction'] as const)('sanitizes %s failures without retaining nested driver errors', async mode => {
    const sql = (await loadDb())()
    await sql`select 1 as ok`
    neonConfig.fetchFunction = async () => { throw Object.assign(new Error(`failed ${DSN} password=pw`), { cause: { secret: DSN }, sourceError: { password: 'pw' } }) }
    const pending = mode === 'template' ? sql`select 2` : mode === 'query' ? sql.query('select 2', []) : sql.transaction([sql`select 2`])
    const error = await pending.catch(error => error)
    expect(error.message).toBe('Database operation failed')
    for (const rendered of [format(error), inspect(error), JSON.stringify(error)]) {
      expect(rendered).not.toContain(DSN)
      expect(rendered).not.toContain('password=pw')
      expect(rendered).not.toContain('sourceError')
    }
    expect(error).not.toHaveProperty('cause')
  })

  it.each(['23505', '23503', '57014'])('preserves SQLSTATE %s for application handling without unsafe detail', async code => {
    const sql = (await loadDb())()
    await sql`select 1 as ok`
    neonConfig.fetchFunction = async () => ({ ok: false, status: 400, json: async () => ({ code, message: DSN, detail: DSN }) })
    await expect(sql`select 2`).rejects.toMatchObject({ code, message: 'Database operation failed' })
  })

  it.each(['BRAND_LIMIT_REACHED', 'ACCOUNT_ENTITLEMENT_INVALID', 'CLIENT_REPORT_NOT_FOUND', 'reviewed version is stale'])('retains the exact application signal %s', async message => {
    const sql = (await loadDb())()
    await sql`select 1 as ok`
    neonConfig.fetchFunction = async () => ({ ok: false, status: 400, json: async () => ({ code: 'P0001', message, detail: DSN }) })
    const error = await sql`select 2`.catch(error => error)
    expect(error.message).toBe(message)
    expect(format(error)).not.toContain(DSN)
  })

  it('keeps raw database failure credentials out of fix route logs and responses', async () => {
    const sql = (await loadDb())()
    await sql`select 1 as ok`
    neonConfig.fetchFunction = async () => { throw new Error(`connection refused ${DSN}`) }
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { POST } = await import('@/app/api/fix/route')
      const response = await POST(new NextRequest('http://localhost/api/fix', { method: 'POST', body: JSON.stringify({ scanId: 'synthetic' }) }))
      expect(response.status).toBe(500)
      expect(log).toHaveBeenCalled()
      expect(format(log.mock.calls)).not.toContain(DSN)
      expect(format(log.mock.calls)).not.toContain(':pw@')
      expect(await response.text()).not.toContain(DSN)
    } finally { log.mockRestore() }
  })
})

describe('the Proxy preserves the driver', () => {
  it('returns a real NeonQueryPromise, which is what transaction() demands', async () => {
    const sql = (await loadDb())()
    const query = sql`select 1 as ok`
    // The driver's own class, reached through the object rather than imported —
    // it is not part of the package's public export surface.
    const NeonQueryPromise = Object.getPrototypeOf(query).constructor

    expect(NeonQueryPromise.name).toBe('NeonQueryPromise')
    expect(query instanceof NeonQueryPromise).toBe(true)
    // transaction() reads these off each query without ever settling it.
    expect(query).toHaveProperty('queryData')
  })

  it('runs sql.transaction() as one guarded batch', async () => {
    const sql = (await loadDb())()
    const results = await sql.transaction([sql`select 1 as ok`, sql`select 1 as ok`])

    expect(results).toEqual([[{ ok: 1 }], [{ ok: 1 }]])
    expect(identityProbes()).toHaveLength(1)
    const batch = sent.find((r) => Array.isArray(r.queries))
    expect(batch?.queries).toHaveLength(2)
  })

  it('guards sql.transaction() even when it is the very first database call', async () => {
    identity.projectId = 'red-firefly-93523049'
    const sql = (await loadDb())()

    await expect(sql.transaction([sql`select 1 as ok`])).rejects.toThrow(/wrong Neon project/)
    expect(sent.some((r) => Array.isArray(r.queries))).toBe(false)
  })

  it('guards sql.query(), the parameterized entry point', async () => {
    identity.projectId = 'red-firefly-93523049'
    const sql = (await loadDb())()

    await expect(sql.query('select 1 as ok', [])).rejects.toThrow(/wrong Neon project/)
  })

  it('keeps db() synchronous and returns the same instance every call', async () => {
    const db = await loadDb()
    expect(db()).toBe(db())
  })
})
