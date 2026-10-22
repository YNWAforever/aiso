/**
 * First-use scan idempotency:
 * one client request key must map to one saved scan, including reloads while a
 * scan is still running. The claim row makes the in-progress scan visible so a
 * returning user sees a processing state instead of paying for a second scan.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'

type ExistingScan = {
  id: string
  score: number | string | null
  grade: string | null
  created_at: string
  results: Record<string, unknown>
}

const state = vi.hoisted(() => ({
  profile: {
    account_id: 'acct-1',
    accounts: {
      plan: 'pro' as 'pro' | 'basic' | 'free',
      status: 'active' as const,
      stripe_subscription_id: 'sub_pro',
      trial_ends_at: null,
    },
  },
  existing: [] as ExistingScan[],
  claimInserts: 0,
  finalUpdates: [] as unknown[][],
  failedMarks: [] as unknown[][],
  takeover: true,
}))

const checkRobots = vi.hoisted(() => vi.fn())
const quotaDecision = vi.hoisted(() => ({ allowed: true, remaining: 2, resetAt: 1_788_192_000 }))
const consumeQuota = vi.hoisted(() => vi.fn(async () => quotaDecision))
const releaseQuota = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock('@/lib/auth', () => ({ getProfile: async () => state.profile }))
vi.mock('@/lib/scans/request-claim', () => ({
  claimOwnedScan: async (input: { results: Record<string, unknown> }) => {
    const existing = state.existing[0]
    if (existing) return { row: existing, created: false }
    state.claimInserts++
    return { row: { id: 'scan-claim', results: input.results, created_at: new Date().toISOString(), score: null, grade: null }, created: true }
  },
}))
vi.mock('next/server', async importOriginal => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: () => {},
}))
vi.mock('@/lib/security/authenticated-scan-quota', () => ({
  consumeAuthenticatedScanQuota: consumeQuota,
  releaseAuthenticatedScanQuota: releaseQuota,
  authenticatedScanQuotaHeaders: () => new Headers(),
}))
vi.mock('@/lib/security/public-scan-rate-limit', () => ({
  consumePublicScanRateLimit: async () => ({ allowed: true, remaining: 4, resetAt: 1_788_192_000 }),
  rateLimitHeaders: () => new Headers(),
}))
vi.mock('@/lib/security/public-url', () => ({
  PublicUrlError: class PublicUrlError extends Error {},
  fetchPublicUrl: (input: string | URL | Request, init?: RequestInit) => fetch(input, init),
}))

const passing = { status: 'pass', message: 'ok' }
vi.mock('@/lib/checks/robots', () => ({ checkRobots }))
vi.mock('@/lib/checks/llmsTxt', () => ({ checkLlmsTxt: vi.fn().mockResolvedValue(passing) }))
vi.mock('@/lib/checks/botAccess', () => ({ checkBotAccess: vi.fn().mockResolvedValue(passing) }))
vi.mock('@/lib/checks/structuredData', () => ({ checkStructuredData: vi.fn().mockResolvedValue(passing) }))
vi.mock('@/lib/checks/extractability', () => ({ checkExtractability: vi.fn().mockResolvedValue(passing) }))
vi.mock('@/lib/checks/llmsFullTxt', () => ({ checkLlmsFullTxt: vi.fn().mockResolvedValue(passing) }))
vi.mock('@/lib/checks/mcpCard', () => ({ checkMcpCard: vi.fn().mockResolvedValue(passing) }))
vi.mock('@/lib/checks/sitemap', () => ({ checkSitemap: vi.fn().mockResolvedValue(passing) }))
vi.mock('@/lib/checks/metaDescription', () => ({ checkMetaDescription: vi.fn().mockReturnValue(passing) }))
vi.mock('@/lib/checks/headingStructure', () => ({ checkHeadingStructure: vi.fn().mockReturnValue(passing) }))
vi.mock('@/lib/checks/faqDetection', () => ({ checkFaqDetection: vi.fn().mockReturnValue(passing) }))
vi.mock('@/lib/checks/canonical', () => ({ checkCanonical: vi.fn().mockReturnValue(passing) }))
vi.mock('@/lib/checks/serverText', () => ({ checkServerText: vi.fn().mockReturnValue(passing) }))
vi.mock('@/lib/checks/internalLinks', () => ({ checkInternalLinks: vi.fn().mockReturnValue(passing) }))
vi.mock('@/lib/checks/entitySignals', () => ({ checkEntitySignals: vi.fn().mockReturnValue(passing) }))
vi.mock('@/lib/checks/contentFreshness', () => ({ checkContentFreshness: vi.fn().mockReturnValue(passing) }))
vi.mock('@/lib/checks/citationDensity', () => ({ checkCitationDensity: vi.fn().mockResolvedValue(passing) }))
vi.mock('@/lib/checks/factualDensity', () => ({ checkFactualDensity: vi.fn().mockResolvedValue(passing) }))
vi.mock('@/lib/checks/topicalAuthority', () => ({ checkTopicalAuthority: vi.fn().mockResolvedValue(passing) }))
vi.mock('@/lib/checks/chunkability', () => ({ checkChunkability: vi.fn().mockResolvedValue(passing) }))

vi.mock('@/lib/db', () => {
  const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const q = Array.from(strings).join(' ')
    if (/from clients/i.test(q)) {
      return [{ id: 'client-1', account_id: 'acct-1', webhook_url: null, brand_name: 'Synthetic' }]
    }
    if (/from scans/i.test(q) && /results @>/i.test(q)) {
      return state.existing
    }
    if (/update scans/i.test(q) && /jsonb_set/i.test(q) && /returning id/i.test(q)) {
      return state.takeover ? [{ id: 'scan-claim' }] : []
    }
    if (/update scans/i.test(q) && /jsonb_set/i.test(q)) {
      state.failedMarks.push(values)
      return []
    }
    if (/insert into scans/i.test(q)) {
      state.claimInserts += 1
      return [{ id: 'scan-claim' }]
    }
    if (/update scans/i.test(q) && /returning id/i.test(q)) {
      state.finalUpdates.push(values)
      return [{ id: 'scan-claim' }]
    }
    return []
  }
  return { db: () => sql }
})

const fetchMock = vi.fn(async () => new Response('<html><body>ok</body></html>', {
  status: 200,
  headers: { 'content-type': 'text/html' },
}))
vi.stubGlobal('fetch', fetchMock)

function request(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/scan', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const body = {
  url: 'https://example.com',
  clientId: 'client-1',
  industry: 'technology',
  region: 'global',
  requestKey: '11111111-1111-4111-8111-111111111111',
}

describe('POST /api/scan — first-use request idempotency', () => {
  beforeEach(() => {
    delete process.env.N8N_SCAN_WEBHOOK_URL
    state.profile.accounts.plan = 'pro'
    consumeQuota.mockClear()
    releaseQuota.mockClear()
    state.existing = []
    state.claimInserts = 0
    state.finalUpdates = []
    state.failedMarks = []
    state.takeover = true
    checkRobots.mockReset()
    checkRobots.mockResolvedValue(passing)
    fetchMock.mockClear()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('claims one scan row before checks and finalises the same row', async () => {
    const { POST } = await import('@/app/api/scan/route')
    const res = await POST(request(body))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ id: 'scan-claim' })
    expect(state.claimInserts).toBe(1)
    expect(state.finalUpdates).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalled()
  })

  it('returns the completed scan for a replayed request without running checks', async () => {
    state.existing = [{
      id: 'scan-done', score: '42.00', grade: 'F', created_at: new Date().toISOString(),
      results: { _scan_request: { key: body.requestKey, state: 'processing', startedAt: new Date().toISOString() } },
    }]
    const { POST } = await import('@/app/api/scan/route')
    const res = await POST(request(body))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ id: 'scan-done', score: 42, reused: true })
    expect(checkRobots).not.toHaveBeenCalled()
    expect(state.claimInserts).toBe(0)
  })

  it('returns a visible processing state while the original request runs', async () => {
    state.existing = [{
      id: 'scan-claim', score: null, grade: null, created_at: new Date().toISOString(),
      results: { _scan_request: { key: body.requestKey, state: 'processing', startedAt: new Date().toISOString() } },
    }]
    const { POST } = await import('@/app/api/scan/route')
    const res = await POST(request(body))
    expect(res.status).toBe(202)
    expect(await res.json()).toMatchObject({ id: 'scan-claim', state: 'processing', reused: true })
    expect(checkRobots).not.toHaveBeenCalled()
    expect(state.claimInserts).toBe(0)
  })

  it('returns the stored failure with its scan id instead of rerunning the scan', async () => {
    state.existing = [{
      id: 'scan-failed', score: null, grade: null, created_at: new Date().toISOString(),
      results: { _scan_request: { key: body.requestKey, state: 'failed', error: 'SCAN_UNREACHABLE', status: 422 } },
    }]
    const { POST } = await import('@/app/api/scan/route')
    const res = await POST(request(body))
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ error: 'SCAN_UNREACHABLE', scanId: 'scan-failed' })
    expect(checkRobots).not.toHaveBeenCalled()
    expect(state.claimInserts).toBe(0)
  })

  it('retains a refused Basic claim and refunds its reservation once across replay', async () => {
    state.profile.accounts.plan = 'basic'
    const { PublicUrlError } = await import('@/lib/security/public-url')
    fetchMock.mockRejectedValueOnce(new PublicUrlError('Blocked destination', 'UNSAFE_URL'))
    const { POST } = await import('@/app/api/scan/route')

    const first = await POST(request(body))
    expect(first.status).toBe(400)
    expect(state.failedMarks).toHaveLength(1)
    const [savedFailure, scanId, accountId] = state.failedMarks[0]
    expect([scanId, accountId]).toEqual(['scan-claim', 'acct-1'])
    const receipt = JSON.parse(String(savedFailure))
    expect(receipt).toMatchObject({
      key: body.requestKey, state: 'failed', status: 400,
      error: 'URL must resolve to a public HTTP or HTTPS address',
    })
    expect(releaseQuota).toHaveBeenCalledExactlyOnceWith('acct-1', quotaDecision)

    state.existing = [{
      id: 'scan-claim', score: null, grade: null, created_at: new Date().toISOString(),
      results: { _scan_request: receipt },
    }]
    const replay = await POST(request(body))
    expect(replay.status).toBe(400)
    expect(await replay.json()).toMatchObject({ scanId: 'scan-claim', error: receipt.error })
    expect(consumeQuota).toHaveBeenCalledExactlyOnceWith('acct-1')
    expect(releaseQuota).toHaveBeenCalledExactlyOnceWith('acct-1', quotaDecision)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(state.claimInserts).toBe(1)
    expect(state.finalUpdates).toHaveLength(0)
    expect(checkRobots).not.toHaveBeenCalled()
  })

  it('retains an upgrade refusal so a free-plan replay never appears to be processing', async () => {
    state.profile.accounts.plan = 'free'
    const { POST } = await import('@/app/api/scan/route')
    const first = await POST(request(body))
    expect(first.status).toBe(403)
    expect(state.failedMarks).toHaveLength(1)
    const [savedFailure, scanId, accountId] = state.failedMarks[0]
    expect([scanId, accountId]).toEqual(['scan-claim', 'acct-1'])
    const receipt = JSON.parse(String(savedFailure))
    expect(receipt).toMatchObject({
      key: body.requestKey, state: 'failed', status: 403,
      error: 'AUTHENTICATED_SCAN_UPGRADE_REQUIRED',
    })
    state.existing = [{
      id: 'scan-claim', score: null, grade: null, created_at: new Date().toISOString(),
      results: { _scan_request: receipt },
    }]
    const replay = await POST(request(body))
    expect(replay.status).toBe(403)
    expect(await replay.json()).toMatchObject({
      scanId: 'scan-claim', state: 'failed', reused: true,
      error: 'AUTHENTICATED_SCAN_UPGRADE_REQUIRED',
    })
    expect(consumeQuota).not.toHaveBeenCalled()
    expect(releaseQuota).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(checkRobots).not.toHaveBeenCalled()
    expect(state.claimInserts).toBe(1)
    expect(state.finalUpdates).toHaveLength(0)
  })

  it('stops an expired claim without repeating checks or potentially charged work', async () => {
    state.existing = [{
      id: 'scan-claim', score: null, grade: null, created_at: new Date(Date.now() - 10 * 60_000).toISOString(),
      results: { _scan_request: { key: body.requestKey, state: 'processing', startedAt: new Date(Date.now() - 10 * 60_000).toISOString() } },
    }]
    const { POST } = await import('@/app/api/scan/route')
    const res = await POST(request(body))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ scanId: 'scan-claim', state: 'failed', error: 'SCAN_OUTCOME_UNKNOWN' })
    expect(checkRobots).not.toHaveBeenCalled()
    expect(state.claimInserts).toBe(0)
    expect(state.finalUpdates).toHaveLength(0)
  })

  it('keeps anonymous scans non-idempotent: a replay still inserts another row', async () => {
    const { POST } = await import('@/app/api/scan/route')
    const res1 = await POST(request({ url: 'https://example.com', requestKey: body.requestKey }))
    const res2 = await POST(request({ url: 'https://example.com', requestKey: body.requestKey }))
    expect(res1.status).toBe(200)
    expect(res2.status).toBe(200)
    expect(state.claimInserts).toBe(2)
    expect(checkRobots).toHaveBeenCalledTimes(2)
  })
})
