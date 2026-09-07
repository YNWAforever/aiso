import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ events: [], queries: [], mismatch: false, dryFailure: false, migrateFailure: false, deleted: vi.fn() }))
vi.mock('../helpers/neon-branch.ts', () => ({
  PROJECT_ID: 'test-project', createTestBranch: () => ({ id: 'br-disposable', connectionUri: 'postgresql://fixture:fixture@invalid/test' }),
  assertDisposableTestBranch: vi.fn(), createdBranchIds: () => ['br-disposable'], deleteTestBranch: h.deleted,
}))
vi.mock('@neondatabase/serverless', () => ({ neonConfig: {}, Client: class {
  on() {} async connect() {} async end() {}
  async query(sql) { h.queries.push(sql)
    if (sql.includes('neon.project_id')) return { rows: [{ project_id: h.mismatch ? 'wrong-project' : 'test-project', branch_id: 'br-disposable' }] }
    h.events.push(sql.includes('drop schema') ? 'reset' : sql.includes('create schema if not exists auth') ? 'auth-shim' : 'baseline')
    return { rows: [] }
  }
} }))
vi.mock('node:child_process', () => ({ execFileSync: (_cmd, args) => {
  if (args.includes('--dry-run')) {
    h.events.push('dry-run')
    if (h.dryFailure) throw Object.assign(new Error('failed'), { stdout: 'Nothing to apply', stderr: 'failed' })
    return 'Nothing to apply'
  }
  h.events.push('migrate')
  if (h.migrateFailure && h.events.includes('baseline')) throw new Error('migration failed')
  return ''
} }))
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal()
  return { ...actual, readFileSync: (path, ...args) => String(path).endsWith('000_baseline_2026-08-31.sql') ? 'BASELINE SQL' : actual.readFileSync(path, ...args) }
})
vi.mock('../../lib/schema/introspect.ts', () => ({ introspectSchema: async () => { h.events.push('inspect'); return {} } }))
vi.mock('../../lib/schema/diff.ts', () => ({ diffSchemas: () => { h.events.push('compare'); return { equivalent: true, classes: {} } } }))
const originalExit = process.exitCode
beforeEach(() => { vi.resetModules(); h.events=[]; h.queries=[]; h.mismatch=false; h.dryFailure=false; h.migrateFailure=false; h.deleted.mockClear(); process.exitCode=0; vi.spyOn(console,'log').mockImplementation(() => {}); vi.spyOn(console,'error').mockImplementation(() => {}) })
afterEach(() => { process.exitCode=originalExit; vi.restoreAllMocks() })
async function run() { await import('../../scripts/schema-equivalence.mjs'); await vi.waitFor(() => expect(h.deleted).toHaveBeenCalledOnce()); await new Promise(resolve => setTimeout(resolve,0)) }
describe('schema equivalence orchestration without provider operations', () => {
  it('advances both paths to head before comparing and prepares replay auth prerequisites', async () => {
    await run()
    expect(h.events).toEqual(['reset','auth-shim','migrate','inspect','reset','auth-shim','baseline','migrate','inspect','dry-run','compare'])
    const authSql = 'create schema if not exists auth; '
      + 'create table if not exists auth.users (id uuid primary key); '
      + 'create or replace function auth.uid() returns uuid language sql stable as '
      + "$$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;"
    expect(h.queries.filter(sql => sql.includes('create schema if not exists auth'))).toEqual([authSql, authSql])
    expect(process.exitCode).toBe(0)
  })
  it('does not report bootstrap success from a failed dry-run containing success text', async () => {
    h.dryFailure=true; await run(); expect(process.exitCode).toBe(1)
  })
  it('never resets a mismatched connection', async () => {
    h.mismatch=true; await run(); expect(h.events).toEqual([]); expect(process.exitCode).toBe(1)
  })
  it('does not compare after baseline-to-head migration fails', async () => {
    h.migrateFailure=true; await run(); expect(h.events).not.toContain('compare'); expect(process.exitCode).toBe(1)
  })
})
