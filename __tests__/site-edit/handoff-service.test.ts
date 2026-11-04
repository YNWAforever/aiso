import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Site-edit S2 route + service. The store is mocked (its SQL is proven in
 * handoff-sql.test.ts); what this proves is the gate order, that "not
 * connected" makes no request, the exact signed request, the outcome mapping,
 * and that a lost outcome write is never reported as success.
 */

const m = vi.hoisted(() => ({
  getProfile: vi.fn(), readHandoff: vi.fn(), claimHandoff: vi.fn(), recordHandoffOutcome: vi.fn(),
  checkEditSpecDomain: vi.fn(), loadVerification: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth', () => ({ getProfile: m.getProfile }))
vi.mock('@/lib/site-edit/handoff-store', () => ({ readHandoff: m.readHandoff, claimHandoff: m.claimHandoff, recordHandoffOutcome: m.recordHandoffOutcome }))
vi.mock('@/lib/site-edit/domain', () => ({ checkEditSpecDomain: m.checkEditSpecDomain }))
vi.mock('@/lib/domain-verification/store', () => ({ loadVerification: m.loadVerification }))
vi.mock('@/lib/app-origin', () => ({ appOrigin: () => 'https://aiso.example' }))

import { GET, POST } from '@/app/api/clients/[clientId]/work-items/[workItemId]/versions/[versionId]/handoff/route'

const ACCOUNT = '10000000-0000-4000-8000-000000000001'
const PROFILE = '20000000-0000-4000-8000-000000000001'
const CLIENT = '30000000-0000-4000-8000-000000000001'
const ITEM = '40000000-0000-4000-8000-000000000001'
const VERSION = '50000000-0000-4000-8000-000000000001'
const JOB = '60000000-0000-4000-8000-000000000001'
const HASH = 'a'.repeat(64)
const SECRET = 's'.repeat(32)
const spec = { schemaVersion: 1, kind: 'jsonld', targetUrl: 'https://www.bakery.hk/', schemaType: 'Organization', payload: { '@type': 'Organization' } }
const ctx = { params: Promise.resolve({ clientId: CLIENT, workItemId: ITEM, versionId: VERSION }) }
const post = (body: unknown = { contentHash: HASH }) => POST(new Request('https://x/handoff', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), ctx)
const read = (over: Record<string, unknown> = {}, events: unknown[] = []) => ({
  kind: 'ok', latestId: VERSION, clientName: 'Bakery', job: events.length ? { id: JOB } : null, events,
  version: { id: VERSION, contentHash: HASH, editSpec: spec, decision: { decision: 'approved', decidedAt: '2026-11-04T00:00:00.000000Z' }, ...over },
})
const fetchMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('SITE_EDIT_EXECUTOR_URL', 'https://rick.example/jobs')
  vi.stubEnv('SITE_EDIT_EXECUTOR_SECRET', SECRET)
  m.getProfile.mockResolvedValue({ id: PROFILE, account_id: ACCOUNT })
  m.readHandoff.mockResolvedValue(read())
  m.checkEditSpecDomain.mockResolvedValue('ok')
  m.loadVerification.mockResolvedValue({ currentDomain: 'bakery.hk' })
  m.claimHandoff.mockResolvedValue({ kind: 'claimed', jobId: JOB, seq: 1 })
  m.recordHandoffOutcome.mockResolvedValue(undefined)
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('site-edit hand-off', () => {
  it('refuses an anonymous caller, and does not turn a session outage into "signed out"', async () => {
    m.getProfile.mockResolvedValueOnce(null)
    expect((await post()).status).toBe(401)
    m.getProfile.mockRejectedValueOnce(new Error('down'))
    expect((await post()).status).toBe(503)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('scopes every read to the session account, never the request', async () => {
    await GET(new Request('https://x/handoff?account_id=other'), ctx)
    expect(m.readHandoff).toHaveBeenCalledWith({ accountId: ACCOUNT, actorId: PROFILE, clientId: CLIENT, itemId: ITEM, versionId: VERSION })
  })

  it('makes no request when the executor is not configured, and says so', async () => {
    vi.stubEnv('SITE_EDIT_EXECUTOR_SECRET', '')
    const response = await post()
    expect([response.status, (await response.json()).error]).toEqual([409, 'HANDOFF_NOT_CONNECTED'])
    const view = await (await GET(new Request('https://x/handoff'), ctx)).json()
    expect(view.handoff).toMatchObject({ state: 'none', canSend: false, block: 'not_connected' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(m.claimHandoff).not.toHaveBeenCalled()
  })

  it('refuses bad input, unapproved, superseded, spec-less, wrong-hash and off-domain sends before claiming', async () => {
    for (const body of [{}, { contentHash: 'x' }, { contentHash: HASH, extra: 1 }]) expect((await post(body)).status).toBe(400)
    const cases: [Record<string, unknown>, string][] = [
      [{ decision: null }, 'HANDOFF_NOT_APPROVED'],
      [{ decision: { decision: 'changes_requested', decidedAt: 'x' } }, 'HANDOFF_NOT_APPROVED'],
      [{ editSpec: undefined }, 'HANDOFF_NO_EDIT_SPEC'],
      [{ contentHash: 'b'.repeat(64) }, 'HANDOFF_CONFLICT'],
    ]
    for (const [over, code] of cases) {
      m.readHandoff.mockResolvedValueOnce(read(over))
      const response = await post()
      expect([response.status, (await response.json()).error]).toEqual([409, code])
    }
    m.readHandoff.mockResolvedValueOnce({ ...read(), latestId: '50000000-0000-4000-8000-000000000009' })
    expect((await (await post()).json()).error).toBe('HANDOFF_SUPERSEDED')
    m.checkEditSpecDomain.mockResolvedValueOnce('mismatch')
    expect((await (await post()).json()).error).toBe('HANDOFF_DOMAIN_UNVERIFIED')
    expect(m.claimHandoff).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends exactly one signed request and records `sent` with the executor reference', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ reference: 'R-1' }), { status: 202 }))
    m.readHandoff.mockResolvedValueOnce(read()).mockResolvedValueOnce(read({}, [
      { seq: 1, kind: 'claim', at: new Date().toISOString(), executorStatus: null, executorRef: null },
      { seq: 2, kind: 'sent', at: new Date().toISOString(), executorStatus: 202, executorRef: 'R-1' },
    ]))
    const response = await post()
    expect(response.status).toBe(201)
    expect((await response.json()).handoff).toMatchObject({ state: 'sent', jobId: JOB, executorRef: 'R-1', canSend: false, block: 'already_sent' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://rick.example/jobs')
    expect(init.redirect).toBe('error')
    const body = init.body as string
    expect(JSON.parse(body)).toEqual({ jobId: JOB, versionId: VERSION, contentHash: HASH,
      client: { id: CLIENT, name: 'Bakery', verifiedDomain: 'bakery.hk' }, editSpec: spec,
      approvedAt: '2026-11-04T00:00:00.000000Z', receiptUrl: 'https://aiso.example/api/site-edit/receipts' })
    const ts = init.headers['X-AISO-Timestamp']
    expect(init.headers['X-AISO-Signature']).toBe('v1=' + createHmac('sha256', SECRET).update(`${ts}.${body}`).digest('hex'))
    expect(init.headers['X-AISO-Job-Id']).toBe(JOB)
    expect(m.recordHandoffOutcome).toHaveBeenCalledWith({ accountId: ACCOUNT, jobId: JOB, claimSeq: 1, actorId: PROFILE, kind: 'sent', status: 202, ref: 'R-1' })
  })

  it('records failed for 4xx/5xx and unknown for a transport error, with no retry', async () => {
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 503 }))
    expect((await post()).status).toBe(200)
    expect(m.recordHandoffOutcome).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'failed', status: 503, ref: null }))
    fetchMock.mockRejectedValueOnce(new Error('timeout'))
    expect((await post()).status).toBe(200)
    expect(m.recordHandoffOutcome).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'unknown', status: null }))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('never reports success when the outcome could not be recorded', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }))
    m.recordHandoffOutcome.mockRejectedValueOnce(new Error('db down'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await post()
    expect([response.status, (await response.json()).error]).toEqual([503, 'HANDOFF_UNAVAILABLE'])
    spy.mockRestore()
  })

  it('returns the existing job for an already-sent version, and refuses a send already in flight, without calling out', async () => {
    m.readHandoff.mockResolvedValueOnce(read({}, [{ seq: 2, kind: 'sent', at: new Date().toISOString(), executorStatus: 200, executorRef: null }]))
    const sent = await post()
    expect([sent.status, (await sent.json()).handoff.state]).toEqual([200, 'sent'])
    m.readHandoff.mockResolvedValueOnce(read({}, [{ seq: 1, kind: 'claim', at: new Date().toISOString(), executorStatus: null, executorRef: null }]))
    expect((await (await post()).json()).error).toBe('HANDOFF_IN_FLIGHT')
    m.claimHandoff.mockResolvedValueOnce({ kind: 'busy' })
    expect((await (await post()).json()).error).toBe('HANDOFF_IN_FLIGHT')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
