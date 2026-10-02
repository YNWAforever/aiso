import { describe, it, expect, vi } from 'vitest'
const { sql, profile } = vi.hoisted(() => ({ sql: vi.fn(), profile: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ db: () => sql }))
vi.mock('@/lib/auth', () => ({ getProfile: profile }))
import { importSource } from '@/lib/sources/store'
import { approveClientSourceVersion } from '@/lib/sources/service'
import { buildSourceContent, hashSourceContent } from '@/lib/sources/schema'

describe('T04 existing source version approval', () => {
  it('source_v1_same_content_can_be_approved without a new version or agent permission', async () => {
    const entries = [{ question: 'What is this?', answer: 'An isolated synthetic fixture.' }]
    const content = buildSourceContent(entries)
    const hash = hashSourceContent(content)
    const row = { id: 'source-1', source_key: 'synthetic', kind: 'facts', label: 'Synthetic',
      agent_use_allowed: false, revoked_at: null, latest_version: 1, updated_at: '2026-10-03T00:00:00Z',
      version_id: 'version-1', version_number: 1, content_hash: hash, import_method: 'paste',
      origin_ref: null, imported_at: '2026-10-03T00:00:00Z', approved_at: null, approved_by: null, content }
    sql.mockReset()
    Object.assign(sql, { transaction: vi.fn().mockResolvedValue([[], [], [{ ...row,
      approved_at: '2026-10-03T01:00:00Z', approved_by: 'actor-1', result_kind: 'unchanged', approval_result: 'approved' }]]) })
    const result = await importSource({ accountId: 'account-1', clientId: 'client-1', actorId: 'actor-1' },
      { sourceKey: 'synthetic', kind: 'facts', label: 'Synthetic', entries, importMethod: 'paste', originRef: null, approve: true })
    expect('source' in result && result.source.latestVersion).toBe(1)
    expect('source' in result && result.source.current?.approvedAt).not.toBeNull()
    expect('source' in result && result.source.agentUseAllowed).toBe(false)
    expect('source' in result && result.source.current?.approvedBy).toBe('actor-1')
    expect('approval' in result && result.approval).toBe('approved')
  })
  const sourceId = '11111111-1111-4111-8111-111111111111'
  const versionId = '22222222-2222-4222-8222-222222222222'
  const request = (body: unknown) => new Request('https://example.test/approve', { method: 'POST', body: JSON.stringify(body) })
  it('refuses an anonymous approval', async () => {
    profile.mockResolvedValue(null)
    expect((await approveClientSourceVersion('client', sourceId, versionId, request({}))).status).toBe(401)
  })
  it('requires the reviewed version and content hash', async () => {
    profile.mockResolvedValue({ id: 'actor', account_id: 'account' })
    expect((await approveClientSourceVersion('client', sourceId, versionId, request({ expectedLatestVersion: 0 }))).status).toBe(400)
  })
  it.each([['conflict', 409], ['revoked', 409], ['not-found', 404]] as const)('returns %s honestly', async (kind, status) => {
    profile.mockResolvedValue({ id: 'actor', account_id: 'account' })
    Object.assign(sql, { transaction: vi.fn().mockResolvedValue([[], [{ kind }]]) })
    expect((await approveClientSourceVersion('client', sourceId, versionId,
      request({ expectedLatestVersion: 1, expectedContentHash: 'a'.repeat(64) }))).status).toBe(status)
  })
  it('returns dependency failure without a false approval', async () => {
    profile.mockResolvedValue({ id: 'actor', account_id: 'account' })
    Object.assign(sql, { transaction: vi.fn().mockRejectedValue(new Error('fixture write failed')) })
    expect((await approveClientSourceVersion('client', sourceId, versionId,
      request({ expectedLatestVersion: 1, expectedContentHash: 'a'.repeat(64) }))).status).toBe(503)
  })
})
