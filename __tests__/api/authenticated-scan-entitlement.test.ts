import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'

type TestAccount = {
  plan: 'basic' | 'pro' | 'enterprise'
  status: 'active' | 'past_due' | 'cancelled' | 'trialing'
  stripe_subscription_id: string | null
  trial_ends_at: string | null
}

const state = vi.hoisted(() => ({
  profile: null as null | { account_id: string; accounts: TestAccount },
  quota: { allowed: true, remaining: 2, resetAt: 1_788_192_000 },
}))

const getProfile = vi.hoisted(() => vi.fn(async () => state.profile))
const consumeAuthenticatedScanQuota = vi.hoisted(() => vi.fn(async () => state.quota))
const consumePublicScanRateLimit = vi.hoisted(() => vi.fn(async () => ({
  allowed: true,
  remaining: 4,
  resetAt: 1_788_192_000,
})))

vi.mock('@/lib/auth', () => ({ getProfile }))
vi.mock('@/lib/security/authenticated-scan-quota', () => ({
  consumeAuthenticatedScanQuota,
  authenticatedScanQuotaHeaders: (decision: typeof state.quota) => new Headers({
    'RateLimit-Limit': '3',
    'RateLimit-Remaining': String(decision.remaining),
    'RateLimit-Reset': '3600',
    ...(decision.allowed ? {} : { 'Retry-After': '3600' }),
  }),
}))
vi.mock('@/lib/security/public-scan-rate-limit', () => ({
  consumePublicScanRateLimit,
  rateLimitHeaders: () => new Headers({
    'RateLimit-Limit': '5',
    'RateLimit-Remaining': '4',
    'RateLimit-Reset': '600',
  }),
}))
vi.mock('@/lib/supabase-server', () => ({
  createServiceSupabaseClient: vi.fn(async () => ({
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    })),
  })),
}))
vi.mock('@/lib/security/public-url', () => ({
  PublicUrlError: class PublicUrlError extends Error {},
  fetchPublicUrl: (input: string | URL | Request, init?: RequestInit) => fetch(input, init),
}))

const passing = { status: 'pass', message: 'ok' }
vi.mock('@/lib/checks/robots', () => ({ checkRobots: vi.fn().mockResolvedValue(passing) }))
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

vi.mock('@/lib/db', () => ({
  db: () => async (strings: TemplateStringsArray) => (
    /insert into scans/i.test(Array.from(strings).join(' ')) ? [{ id: 'scan-entitled' }] : []
  ),
}))

const fetchMock = vi.fn().mockResolvedValue(new Response('<html>ok</html>', { status: 200 }))
vi.stubGlobal('fetch', fetchMock)

function paidAccount(plan: TestAccount['plan']): TestAccount {
  return {
    plan,
    status: 'active',
    stripe_subscription_id: `sub_${plan}`,
    trial_ends_at: null,
  }
}

async function scan() {
  const { POST } = await import('@/app/api/scan/route')
  return POST(new NextRequest('http://localhost/api/scan', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.com' }),
  }))
}

describe('authenticated scan commercial entitlement', () => {
  beforeEach(() => {
    delete process.env.N8N_SCAN_WEBHOOK_URL
    state.profile = null
    state.quota = { allowed: true, remaining: 2, resetAt: 1_788_192_000 }
    getProfile.mockClear()
    consumeAuthenticatedScanQuota.mockClear()
    consumePublicScanRateLimit.mockClear()
    fetchMock.mockClear()
  })

  it('fails closed when authentication lookup fails before choosing a limiter', async () => {
    getProfile.mockRejectedValueOnce(new Error('Neon Auth unavailable'))

    const response = await scan()

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ error: 'Authentication service unavailable' })
    expect(consumePublicScanRateLimit).not.toHaveBeenCalled()
    expect(consumeAuthenticatedScanQuota).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a free authenticated account before network work', async () => {
    state.profile = {
      account_id: 'account-free',
      accounts: { ...paidAccount('basic'), stripe_subscription_id: null },
    }

    const response = await scan()

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ error: 'AUTHENTICATED_SCAN_UPGRADE_REQUIRED' })
    expect(consumeAuthenticatedScanQuota).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('consumes quota for an active paid Basic account', async () => {
    state.profile = { account_id: 'account-basic', accounts: paidAccount('basic') }

    const response = await scan()

    expect(response.status).toBe(200)
    expect(consumeAuthenticatedScanQuota).toHaveBeenCalledWith('account-basic')
    expect(response.headers.get('ratelimit-limit')).toBe('3')
    expect(response.headers.get('ratelimit-remaining')).toBe('2')
  })

  it('returns 429 without network work when the Basic allowance is exhausted', async () => {
    state.profile = { account_id: 'account-basic', accounts: paidAccount('basic') }
    state.quota = { allowed: false, remaining: 0, resetAt: 1_788_192_000 }

    const response = await scan()

    expect(response.status).toBe(429)
    await expect(response.json()).resolves.toMatchObject({ error: 'AUTHENTICATED_SCAN_LIMIT_REACHED' })
    expect(response.headers.get('retry-after')).toBe('3600')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails closed when durable Basic quota persistence fails', async () => {
    state.profile = { account_id: 'account-basic', accounts: paidAccount('basic') }
    consumeAuthenticatedScanQuota.mockRejectedValueOnce(new Error('database unavailable'))

    const response = await scan()

    expect(response.status).toBe(503)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['pro', 'enterprise'] as const)('keeps active paid %s scans unlimited', async plan => {
    state.profile = { account_id: `account-${plan}`, accounts: paidAccount(plan) }

    expect((await scan()).status).toBe(200)
    expect(consumeAuthenticatedScanQuota).not.toHaveBeenCalled()
  })

  it('applies the Basic quota during an unexpired onboarding trial', async () => {
    state.profile = {
      account_id: 'account-trial',
      accounts: {
        ...paidAccount('basic'),
        stripe_subscription_id: null,
        trial_ends_at: '2999-01-01T00:00:00.000Z',
      },
    }

    expect((await scan()).status).toBe(200)
    expect(consumeAuthenticatedScanQuota).toHaveBeenCalledWith('account-trial')
  })

  it('leaves the anonymous pre-signup scan on the public limiter', async () => {
    expect((await scan()).status).toBe(200)
    expect(consumePublicScanRateLimit).toHaveBeenCalledTimes(1)
    expect(consumeAuthenticatedScanQuota).not.toHaveBeenCalled()
  })
})
