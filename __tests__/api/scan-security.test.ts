import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'

const state = vi.hoisted(() => ({
  profile: null as null | {
    account_id: string
    accounts: {
      plan: 'basic'
      status: 'active'
      stripe_subscription_id: string
      trial_ends_at: null
    }
  },
  client: null as null | {
    id: string
    account_id: string
    webhook_url: string | null
    brand_name: string | null
  },
  rateCount: 0,
}))

const getProfileMock = vi.hoisted(() => vi.fn(async () => state.profile))
const clientLookupMock = vi.hoisted(() => vi.fn((id: string) => (state.client && state.client.id === id ? [state.client] : [])))

vi.mock('@/lib/auth', () => ({ getProfile: getProfileMock }))
vi.mock('@/lib/security/public-url', () => ({
  PublicUrlError: class PublicUrlError extends Error {},
  fetchPublicUrl: (input: string | URL | Request, init?: RequestInit) => fetch(input, init),
}))
vi.mock('@/lib/security/authenticated-scan-quota', () => ({
  consumeAuthenticatedScanQuota: vi.fn().mockResolvedValue({
    allowed: true,
    remaining: 2,
    resetAt: 2_000_000_000,
  }),
  authenticatedScanQuotaHeaders: () => new Headers({
    'RateLimit-Limit': '3',
    'RateLimit-Remaining': '2',
    'RateLimit-Reset': '1',
  }),
}))

const passing = { status: 'pass', message: 'ok' }
vi.mock('@/lib/checks/robots',          () => ({ checkRobots:          vi.fn().mockResolvedValue(passing) }))
vi.mock('@/lib/checks/llmsTxt',         () => ({ checkLlmsTxt:         vi.fn().mockResolvedValue(passing) }))
vi.mock('@/lib/checks/botAccess',       () => ({ checkBotAccess:       vi.fn().mockResolvedValue(passing) }))
vi.mock('@/lib/checks/structuredData',  () => ({ checkStructuredData:  vi.fn().mockResolvedValue(passing) }))
vi.mock('@/lib/checks/extractability',  () => ({ checkExtractability:  vi.fn().mockResolvedValue(passing) }))
vi.mock('@/lib/checks/llmsFullTxt',     () => ({ checkLlmsFullTxt:     vi.fn().mockResolvedValue(passing) }))
vi.mock('@/lib/checks/mcpCard',         () => ({ checkMcpCard:         vi.fn().mockResolvedValue(passing) }))
vi.mock('@/lib/checks/sitemap',         () => ({ checkSitemap:         vi.fn().mockResolvedValue(passing) }))
vi.mock('@/lib/checks/metaDescription', () => ({ checkMetaDescription: vi.fn().mockReturnValue(passing) }))
vi.mock('@/lib/checks/headingStructure',() => ({ checkHeadingStructure:vi.fn().mockReturnValue(passing) }))
vi.mock('@/lib/checks/faqDetection',    () => ({ checkFaqDetection:    vi.fn().mockReturnValue(passing) }))
vi.mock('@/lib/checks/canonical',       () => ({ checkCanonical:       vi.fn().mockReturnValue(passing) }))
vi.mock('@/lib/checks/serverText',      () => ({ checkServerText:      vi.fn().mockReturnValue(passing) }))
vi.mock('@/lib/checks/internalLinks',   () => ({ checkInternalLinks:   vi.fn().mockReturnValue(passing) }))
vi.mock('@/lib/checks/entitySignals',   () => ({ checkEntitySignals:  vi.fn().mockReturnValue(passing) }))
vi.mock('@/lib/checks/contentFreshness',() => ({ checkContentFreshness:vi.fn().mockReturnValue(passing) }))
vi.mock('@/lib/checks/citationDensity', () => ({ checkCitationDensity: vi.fn().mockResolvedValue(passing) }))
vi.mock('@/lib/checks/factualDensity',  () => ({ checkFactualDensity:  vi.fn().mockResolvedValue(passing) }))
vi.mock('@/lib/checks/topicalAuthority',() => ({ checkTopicalAuthority:vi.fn().mockResolvedValue(passing) }))
vi.mock('@/lib/checks/chunkability',    () => ({ checkChunkability:    vi.fn().mockResolvedValue(passing) }))

vi.mock('@/lib/db', () => {
  const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = Array.from(strings).join(' ')
    if (/public_scan_rate_limits/i.test(query)) {
      state.rateCount += 1
      return [{
        allowed: state.rateCount <= 5,
        remaining: Math.max(0, 5 - state.rateCount),
        reset_at: 2_000_000_000,
      }]
    }
    if (/insert into scans/i.test(query)) return [{ id: `scan-${state.rateCount}` }]
    if (/select plan from accounts/i.test(query)) return [{ plan: 'basic' }]
    if (/from clients/i.test(query)) return clientLookupMock(values[0] as string)
    return []
  }
  return { db: () => sql }
})

const fetchMock = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }))
vi.stubGlobal('fetch', fetchMock)

function scan(body: Record<string, unknown>) {
  return import('@/app/api/scan/route').then(({ POST }) => POST(new NextRequest('http://localhost/api/scan', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-vercel-forwarded-for': '203.0.113.9',
    },
    body: JSON.stringify(body),
  })))
}

describe('POST /api/scan security boundaries', () => {
  beforeEach(() => {
    state.profile = null
    state.client = null
    state.rateCount = 0
    fetchMock.mockClear()
    getProfileMock.mockClear()
    clientLookupMock.mockClear()
  })

  it.each([
    ['file protocol', 'file:///etc/passwd'],
    ['ftp protocol', 'ftp://example.com/resource'],
    ['URL credentials', 'https://user:password@example.com'],
  ])('returns 400 before auth or network work for %s', async (_case, url) => {
    const response = await scan({ url })

    expect(response.status).toBe(400)
    expect(getProfileMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(state.rateCount).toBe(0)
  })

  it('returns 401 before scanning when an anonymous caller supplies clientId', async () => {
    const response = await scan({ url: 'https://example.com', clientId: '11111111-1111-4111-8111-111111111111' })

    expect(response.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(clientLookupMock).not.toHaveBeenCalled()
  })

  it('returns 503 when a surfaced Neon session error rejects profile lookup', async () => {
    getProfileMock.mockRejectedValueOnce(new Error('Neon Auth unavailable'))

    const response = await scan({ url: 'https://example.com', clientId: '11111111-1111-4111-8111-111111111111' })

    expect(response.status).toBe(503)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(clientLookupMock).not.toHaveBeenCalled()
  })

  it('returns 404 before scanning when the requested client does not exist', async () => {
    state.profile = {
      account_id: 'account-a',
      accounts: {
        plan: 'basic',
        status: 'active',
        stripe_subscription_id: 'sub_basic',
        trial_ends_at: null,
      },
    }

    const response = await scan({ url: 'https://example.com', clientId: '11111111-1111-4111-8111-111111111111' })

    expect(response.status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 403 before scanning when the client belongs to another account', async () => {
    state.profile = {
      account_id: 'account-a',
      accounts: {
        plan: 'basic',
        status: 'active',
        stripe_subscription_id: 'sub_basic',
        trial_ends_at: null,
      },
    }
    state.client = {
      id: '11111111-1111-4111-8111-111111111111',
      account_id: 'account-b',
      webhook_url: null,
      brand_name: 'Victim',
    }

    const response = await scan({ url: 'https://example.com', clientId: state.client.id })

    expect(response.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('allows a dashboard scan only after db ownership verification', async () => {
    state.profile = {
      account_id: 'account-a',
      accounts: {
        plan: 'basic',
        status: 'active',
        stripe_subscription_id: 'sub_basic',
        trial_ends_at: null,
      },
    }
    state.client = {
      id: '11111111-1111-4111-8111-111111111111',
      account_id: 'account-a',
      webhook_url: null,
      brand_name: 'Owned',
    }

    const response = await scan({ url: 'https://example.com', clientId: state.client.id })

    expect(response.status).toBe(200)
    expect(clientLookupMock).toHaveBeenCalledTimes(1)
    expect(clientLookupMock).toHaveBeenCalledWith(state.client.id)
    await expect(response.json()).resolves.toEqual({
      id: 'scan-0',
      score: expect.any(Number),
      grade: expect.any(String),
    })
  })

  it('returns a deterministic 429 with standard headers after the anonymous allowance is exhausted', async () => {
    const responses = []
    for (let request = 0; request < 6; request += 1) {
      responses.push(await scan({ url: 'https://example.com' }))
    }

    expect(responses.slice(0, 5).map(response => response.status)).toEqual([200, 200, 200, 200, 200])
    const denied = responses[5]
    expect(denied.status).toBe(429)
    expect(denied.headers.get('ratelimit-limit')).toBe('5')
    expect(denied.headers.get('ratelimit-remaining')).toBe('0')
    const resetDelay = Number(denied.headers.get('ratelimit-reset'))
    expect(resetDelay).toBeGreaterThan(0)
    expect(denied.headers.get('retry-after')).toBe(String(resetDelay))
  })
})
