vi.mock('server-only', () => ({}))

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  profile: vi.fn(),
  submit: vi.fn(),
  list: vi.fn(),
  read: vi.fn(),
  decide: vi.fn(),
  liveSources: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getProfile: mocks.profile }))
vi.mock('@/lib/change-sets/store', () => ({
  submitVersion: mocks.submit,
  listVersions: mocks.list,
  readVersion: mocks.read,
}))
vi.mock('@/lib/approvals/decision-store', () => ({ decideVersion: mocks.decide }))
vi.mock('@/lib/work-items/sources', () => ({ listLiveSources: mocks.liveSources }))

import * as versionsRoute from '@/app/api/clients/[clientId]/work-items/[workItemId]/versions/route'
import * as versionRoute from '@/app/api/clients/[clientId]/work-items/[workItemId]/versions/[versionId]/route'
import * as decisionRoute from '@/app/api/clients/[clientId]/work-items/[workItemId]/versions/[versionId]/decision/route'

const clientId = '00000000-0000-4000-8000-000000000001'
const workItemId = '00000000-0000-4000-8000-000000000002'
const versionId = '00000000-0000-4000-8000-000000000003'
const profile = { id: '00000000-0000-4000-8000-000000000004', account_id: '00000000-0000-4000-8000-000000000005' }
const version = { id: versionId, versionNumber: 1 }
const params = Promise.resolve({ clientId, workItemId, versionId })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.profile.mockResolvedValue(profile)
  mocks.liveSources.mockResolvedValue([])
})

describe('change-set version route contracts', () => {
  it('exports only the specified immutable-record methods', () => {
    expect(Object.keys(versionsRoute).sort()).toEqual(['GET', 'POST'])
    expect(Object.keys(versionRoute)).toEqual(['GET'])
    expect(Object.keys(decisionRoute)).toEqual(['POST'])
  })

  it('authenticates independently before parsing or disclosing any object', async () => {
    mocks.profile.mockResolvedValue(null)
    const handlers = [
      versionsRoute.GET(new Request('http://localhost/api?limit=invalid'), { params }),
      versionsRoute.POST(new Request('http://localhost/api', { method: 'POST', body: '{' }), { params }),
      versionRoute.GET(new Request('http://localhost/api'), { params }),
      decisionRoute.POST(new Request('http://localhost/api', { method: 'POST', body: '{' }), { params }),
    ]
    for (const response of await Promise.all(handlers)) {
      expect(response.status).toBe(401)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(await response.json()).toEqual({ error: 'UNAUTHENTICATED' })
    }
    expect(mocks.submit).not.toHaveBeenCalled()
    expect(mocks.list).not.toHaveBeenCalled()
    expect(mocks.read).not.toHaveBeenCalled()
    expect(mocks.decide).not.toHaveBeenCalled()
  })

  it('awaits route params and forwards the request URL and body to the real service boundary', async () => {
    mocks.list.mockResolvedValue({ kind: 'created', value: { versions: [], nextCursor: null, latestVersionId: null } })
    mocks.read.mockResolvedValue({ kind: 'created', value: version })
    const listResponse = await versionsRoute.GET(new Request('http://localhost/api?limit=7'), { params })
    const readResponse = await versionRoute.GET(new Request('http://localhost/api'), { params })
    expect(listResponse.status).toBe(200)
    expect(await listResponse.json()).toEqual({ versions: [], nextCursor: null, latestVersionId: null })
    expect(mocks.list).toHaveBeenCalledWith(profile.account_id, clientId, workItemId, profile.id, { limit: 7, cursor: null })
    expect(readResponse.status).toBe(200)
    expect(await readResponse.json()).toEqual({ version })
    expect(mocks.read).toHaveBeenCalledWith(profile.account_id, clientId, workItemId, versionId, profile.id)
  })

  it('preserves 201 for new mutations, 200 for identical replays, and no-store on every success', async () => {
    mocks.submit.mockResolvedValueOnce({ kind: 'created', value: version }).mockResolvedValueOnce({ kind: 'replayed', value: version })
    mocks.decide.mockResolvedValueOnce({ kind: 'created', value: version }).mockResolvedValueOnce({ kind: 'replayed', value: version })
    const submission = () => versionsRoute.POST(new Request('http://localhost/api', { method: 'POST', body: JSON.stringify({ expectedRevision: 1 }) }), { params })
    const decision = () => decisionRoute.POST(new Request('http://localhost/api', { method: 'POST', body: JSON.stringify({ decision: 'approved', reason: 'Reviewed', requestId: versionId }) }), { params })
    const responses = [await submission(), await submission(), await decision(), await decision()]
    expect(responses.map(response => response.status)).toEqual([201, 200, 201, 200])
    for (const response of responses) expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('enforces streamed byte limits and stable failure codes through the route boundary', async () => {
    const oversizedSubmission = await versionsRoute.POST(new Request('http://localhost/api', { method: 'POST', body: 'x'.repeat(4097) }), { params })
    const oversizedDecision = await decisionRoute.POST(new Request('http://localhost/api', { method: 'POST', body: 'x'.repeat(16385) }), { params })
    expect(oversizedSubmission.status).toBe(413)
    expect(await oversizedSubmission.json()).toEqual({ error: 'CHANGE_SET_BODY_TOO_LARGE' })
    expect(oversizedDecision.status).toBe(413)
    expect(await oversizedDecision.json()).toEqual({ error: 'CHANGE_SET_BODY_TOO_LARGE' })
    expect(mocks.submit).not.toHaveBeenCalled()
    expect(mocks.decide).not.toHaveBeenCalled()

    mocks.read.mockResolvedValue({ kind: 'denied' })
    const denied = await versionRoute.GET(new Request('http://localhost/api'), { params })
    expect(denied.status).toBe(403)
    expect(denied.headers.get('cache-control')).toBe('no-store')
    expect(await denied.json()).toEqual({ error: 'CHANGE_SET_DENIED' })
  })
})
