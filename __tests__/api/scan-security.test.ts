import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'

const state = vi.hoisted(() => ({
  profile: null as null | { account_id: string },
  client: null as null | {
    id: string
    account_id: string
    webhook_url: string | null
    brand_name: string | null
  },
  rateCount: 0,
}))

const getProfileMock = vi.hoisted(() => vi.fn(async () => state.profile))
const serviceBuilder = vi.hoisted(() => {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.maybeSingle = vi.fn(async () => ({ data: state.client, error: null }))
  return builder
})
const createServiceClientMock = vi.hoisted(() => vi.fn(async () => ({
  from: vi.fn(() => serviceBuilder),
})))

vi.mock('@/lib/auth', () => ({ getProfile: getProfileMock }))
vi.mock('@/lib/supabase-server', () => ({ createServiceSupabaseClient: createServiceClientMock }))
vi.mock('@/lib/security/public-url', () => ({
  PublicUrlError: class PublicUrlError extends Error {},
  fetchPublicUrl: (input: string | URL | Request, init?: RequestInit) => fetch(input, init),
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
  const sql = async (strings: TemplateStringsArray) => {
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
    if (/select webhook_url, brand_name from clients/i.test(query)) return state.client ? [state.client] : []
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
    createServiceClientMock.mockClear()
    serviceBuilder.select.mockClear()
    serviceBuilder.eq.mockClear()
    serviceBuilder.maybeSingle.mockClear()
  })

  it('returns 401 before scanning when an anonymous caller supplies clientId', async () => {
    const response = await scan({ url: 'https://example.com', clientId: '11111111-1111-4111-8111-111111111111' })

    expect(response.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(createServiceClientMock).not.toHaveBeenCalled()
  })

  it('returns 503 before scanning when client authentication cannot be checked', async () => {
    getProfileMock.mockRejectedValueOnce(new Error('Neon Auth unavailable'))

    const response = await scan({ url: 'https://example.com', clientId: '11111111-1111-4111-8111-111111111111' })

    expect(response.status).toBe(503)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(createServiceClientMock).not.toHaveBeenCalled()
  })

  it('returns 404 before scanning when the requested client does not exist', async () => {
    state.profile = { account_id: 'account-a' }

    const response = await scan({ url: 'https://example.com', clientId: '11111111-1111-4111-8111-111111111111' })

    expect(response.status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 403 before scanning when the client belongs to another account', async () => {
    state.profile = { account_id: 'account-a' }
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

  it('allows a dashboard scan only after service-client ownership verification', async () => {
    state.profile = { account_id: 'account-a' }
    state.client = {
      id: '11111111-1111-4111-8111-111111111111',
      account_id: 'account-a',
      webhook_url: null,
      brand_name: 'Owned',
    }

    const response = await scan({ url: 'https://example.com', clientId: state.client.id })

    expect(response.status).toBe(200)
    expect(createServiceClientMock).toHaveBeenCalledTimes(1)
    expect(serviceBuilder.eq).toHaveBeenCalledWith('id', state.client.id)
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
    expect(denied.headers.get('ratelimit-reset')).toBe('2000000000')
    expect(denied.headers.get('retry-after')).toBeTruthy()
  })
})
