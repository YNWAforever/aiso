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
  rateAllowed: true,
  insertValues: [] as unknown[],
}))

const getProfileMock = vi.hoisted(() => vi.fn(async () => state.profile))
const consumePublicScanRateLimitMock = vi.hoisted(() => vi.fn(async () => ({
  allowed: state.rateAllowed,
  remaining: state.rateAllowed ? 4 : 0,
  resetAt: 2_000_000_000,
})))
const rateLimitHeadersMock = vi.hoisted(() => vi.fn(() => new Headers({
  'RateLimit-Limit': '5',
  'RateLimit-Remaining': state.rateAllowed ? '4' : '0',
  'RateLimit-Reset': '2000000000',
  'Retry-After': state.rateAllowed ? '0' : '30',
})))

const checkRobotsMock = vi.hoisted(() => vi.fn(async () => ({ status: 'pass' as const, message: 'ok' })))
const checkLlmsTxtMock = vi.hoisted(() => vi.fn(async () => ({ status: 'pass' as const, message: 'ok' })))
const checkBotAccessMock = vi.hoisted(() => vi.fn(async () => ({ status: 'pass' as const, message: 'ok' })))
const checkStructuredDataMock = vi.hoisted(() => vi.fn(async () => ({ status: 'pass' as const, message: 'ok' })))
const checkExtractabilityMock = vi.hoisted(() => vi.fn(async () => ({ status: 'pass' as const, message: 'ok' })))
const checkLlmsFullTxtMock = vi.hoisted(() => vi.fn(async () => ({ status: 'pass' as const, message: 'ok' })))
const checkMcpCardMock = vi.hoisted(() => vi.fn(async () => ({ status: 'pass' as const, message: 'ok' })))
const checkSitemapMock = vi.hoisted(() => vi.fn(async () => ({ status: 'pass' as const, message: 'ok' })))
const checkMetaDescriptionMock = vi.hoisted(() => vi.fn(() => ({ status: 'pass' as const, message: 'ok' })))
const checkHeadingStructureMock = vi.hoisted(() => vi.fn(() => ({ status: 'pass' as const, message: 'ok' })))
const checkFaqDetectionMock = vi.hoisted(() => vi.fn(() => ({ status: 'pass' as const, message: 'ok' })))
const checkCanonicalMock = vi.hoisted(() => vi.fn(() => ({ status: 'pass' as const, message: 'ok' })))
const checkServerTextMock = vi.hoisted(() => vi.fn(() => ({ status: 'pass' as const, message: 'ok' })))
const checkInternalLinksMock = vi.hoisted(() => vi.fn(() => ({ status: 'pass' as const, message: 'ok' })))
const checkEntitySignalsMock = vi.hoisted(() => vi.fn(() => ({ status: 'pass' as const, message: 'ok' })))
const checkContentFreshnessMock = vi.hoisted(() => vi.fn(() => ({ status: 'pass' as const, message: 'ok' })))
const checkCitationDensityMock = vi.hoisted(() => vi.fn(async () => ({ status: 'pass' as const, message: 'ok' })))
const checkFactualDensityMock = vi.hoisted(() => vi.fn(async () => ({ status: 'pass' as const, message: 'ok' })))
const checkTopicalAuthorityMock = vi.hoisted(() => vi.fn(async () => ({ status: 'pass' as const, message: 'ok' })))
const checkChunkabilityMock = vi.hoisted(() => vi.fn(async () => ({ status: 'pass' as const, message: 'ok' })))

const fetchPublicUrlMock = vi.hoisted(() => vi.fn(async () => new Response(
  '<!doctype html><html><head><title>Example</title></head><body>Example</body></html>',
  { status: 200 },
)))

const dbMock = vi.hoisted(() => vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
  state.insertValues = values
  return [{ id: 'scan-contract-1' }]
}))

vi.mock('@/lib/auth', () => ({ getProfile: getProfileMock }))
vi.mock('@/lib/db', () => ({ db: () => dbMock }))
vi.mock('@/lib/supabase-server', () => ({
  createServiceSupabaseClient: vi.fn(),
}))
vi.mock('@/lib/security/public-url', () => ({
  PublicUrlError: class PublicUrlError extends Error {},
  fetchPublicUrl: fetchPublicUrlMock,
}))
vi.mock('@/lib/security/public-scan-rate-limit', () => ({
  consumePublicScanRateLimit: consumePublicScanRateLimitMock,
  rateLimitHeaders: rateLimitHeadersMock,
}))

vi.mock('@/lib/checks/robots',          () => ({ checkRobots: checkRobotsMock }))
vi.mock('@/lib/checks/llmsTxt',         () => ({ checkLlmsTxt: checkLlmsTxtMock }))
vi.mock('@/lib/checks/botAccess',       () => ({ checkBotAccess: checkBotAccessMock }))
vi.mock('@/lib/checks/structuredData',  () => ({ checkStructuredData: checkStructuredDataMock }))
vi.mock('@/lib/checks/extractability',  () => ({ checkExtractability: checkExtractabilityMock }))
vi.mock('@/lib/checks/llmsFullTxt',     () => ({ checkLlmsFullTxt: checkLlmsFullTxtMock }))
vi.mock('@/lib/checks/mcpCard',         () => ({ checkMcpCard: checkMcpCardMock }))
vi.mock('@/lib/checks/sitemap',         () => ({ checkSitemap: checkSitemapMock }))
vi.mock('@/lib/checks/metaDescription', () => ({ checkMetaDescription: checkMetaDescriptionMock }))
vi.mock('@/lib/checks/headingStructure',() => ({ checkHeadingStructure: checkHeadingStructureMock }))
vi.mock('@/lib/checks/faqDetection',    () => ({ checkFaqDetection: checkFaqDetectionMock }))
vi.mock('@/lib/checks/canonical',       () => ({ checkCanonical: checkCanonicalMock }))
vi.mock('@/lib/checks/serverText',      () => ({ checkServerText: checkServerTextMock }))
vi.mock('@/lib/checks/internalLinks',   () => ({ checkInternalLinks: checkInternalLinksMock }))
vi.mock('@/lib/checks/entitySignals',   () => ({ checkEntitySignals: checkEntitySignalsMock }))
vi.mock('@/lib/checks/contentFreshness',() => ({ checkContentFreshness: checkContentFreshnessMock }))
vi.mock('@/lib/checks/citationDensity', () => ({ checkCitationDensity: checkCitationDensityMock }))
vi.mock('@/lib/checks/factualDensity',  () => ({ checkFactualDensity: checkFactualDensityMock }))
vi.mock('@/lib/checks/topicalAuthority',() => ({ checkTopicalAuthority: checkTopicalAuthorityMock }))
vi.mock('@/lib/checks/chunkability',    () => ({ checkChunkability: checkChunkabilityMock }))

function request(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/scan', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function post(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/scan/route')
  return POST(request(body))
}

describe('Homepage scan funnel contracts', () => {
  beforeEach(() => {
    state.profile = null
    state.rateAllowed = true
    state.insertValues = []
    getProfileMock.mockClear()
    consumePublicScanRateLimitMock.mockClear()
    rateLimitHeadersMock.mockClear()
    dbMock.mockClear()
    fetchPublicUrlMock.mockClear()
    checkRobotsMock.mockClear()
  })

  it.each([
    ['missing URL', {}],
    ['invalid URL', { url: 'ftp://example.com' }],
  ])('returns 400 for %s before scanning', async (_name, body) => {
    const response = await post(body)

    expect(response.status).toBe(400)
    expect(getProfileMock).not.toHaveBeenCalled()
    expect(fetchPublicUrlMock).not.toHaveBeenCalled()
  })

  it('returns 401 when an anonymous caller supplies a client ownership claim', async () => {
    const response = await post({
      url: 'https://example.com',
      clientId: 'client-not-owned',
    })

    expect(response.status).toBe(401)
    expect(fetchPublicUrlMock).not.toHaveBeenCalled()
    expect(dbMock).not.toHaveBeenCalled()
  })

  it('returns the scan continuation shape after a successful anonymous scan', async () => {
    const response = await post({ url: 'https://example.com' })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      id: 'scan-contract-1',
      score: expect.any(Number),
      grade: expect.any(String),
    })
  })

  it('returns 503 when the profile lookup is unavailable', async () => {
    getProfileMock.mockRejectedValueOnce(new Error('provider secret must not escape'))

    const response = await post({ url: 'https://example.com' })

    expect(response.status).toBe(503)
    expect(fetchPublicUrlMock).not.toHaveBeenCalled()
    expect(dbMock).not.toHaveBeenCalled()
  })

  it('returns the rate-limit boundary with retry headers', async () => {
    state.rateAllowed = false

    const response = await post({ url: 'https://example.com' })

    expect(response.status).toBe(429)
    await expect(response.json()).resolves.toEqual({
      error: 'Too many scan requests. Please try again later.',
    })
    expect(response.headers.get('ratelimit-limit')).toBe('5')
    expect(response.headers.get('ratelimit-remaining')).toBe('0')
    expect(response.headers.get('retry-after')).toBe('30')
    expect(fetchPublicUrlMock).not.toHaveBeenCalled()
  })

  it('persists a structured check_error result when one provider check rejects', async () => {
    const providerSecret = 'provider response must not be persisted'
    checkRobotsMock.mockRejectedValueOnce(new Error(providerSecret))

    const response = await post({ url: 'https://example.com' })

    expect(response.status).toBe(200)
    const serializedResults = state.insertValues.find(
      (value): value is string => typeof value === 'string' && value.includes('check_error'),
    )
    expect(serializedResults).toBeDefined()
    const persisted = JSON.parse(serializedResults!) as Record<string, unknown>
    expect(persisted.c1_robots).toEqual({ status: 'fail', message: 'check_error' })
    expect(serializedResults).not.toContain(providerSecret)
  })
})
