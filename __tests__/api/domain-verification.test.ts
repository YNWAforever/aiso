import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Domain-ownership verification (AC-03), the acting half.
 *
 * The property this file exists to pin is the fetcher's configuration.
 * Following redirects is right for scanning and wrong for proving ownership:
 * a site that redirects `/.well-known/*` to shared user-content hosting would
 * let a file somebody else uploaded there stand as proof of owning the
 * redirecting domain. That is a one-word difference in a call nobody would
 * look at twice, so it is asserted directly.
 */

const mocks = vi.hoisted(() => ({
  getProfile: vi.fn(),
  loadVerification: vi.fn(),
  ensureVerificationToken: vi.fn(),
  recordVerificationResult: vi.fn(),
  fetcher: vi.fn(),
  createPublicUrlFetcher: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth', () => ({ getProfile: mocks.getProfile }))
vi.mock('@/lib/domain-verification/store', () => ({
  loadVerification: mocks.loadVerification,
  ensureVerificationToken: mocks.ensureVerificationToken,
  recordVerificationResult: mocks.recordVerificationResult,
}))
vi.mock('@/lib/security/public-url', async importOriginal => {
  // PublicUrlError must stay the real class: the service maps outcomes with
  // `instanceof`, and a stand-in would make every branch fall through to
  // `unreachable` while the tests still looked green.
  const actual = await importOriginal<typeof import('@/lib/security/public-url')>()
  return {
    ...actual,
    createPublicUrlFetcher: mocks.createPublicUrlFetcher.mockReturnValue(mocks.fetcher),
  }
})

const ACCOUNT = '11111111-1111-4111-8111-111111111111'
const PROFILE = '22222222-2222-4222-8222-222222222222'
const CLIENT = '33333333-3333-4333-8333-333333333333'
const TOKEN = 'aiso-site-verification=0123456789abcdef0123456789abcdef'

function signedIn() {
  mocks.getProfile.mockResolvedValue({ id: PROFILE, account_id: ACCOUNT })
}

const row = (overrides: Record<string, unknown> = {}) => ({
  currentDomain: 'example.com',
  verifiedDomain: 'example.com',
  verifiedAt: null,
  token: TOKEN,
  lastCheckedAt: null,
  lastOutcome: null,
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getProfile.mockResolvedValue(null)
  mocks.loadVerification.mockResolvedValue(row())
  mocks.ensureVerificationToken.mockResolvedValue(TOKEN)
  mocks.recordVerificationResult.mockResolvedValue(undefined)
  mocks.createPublicUrlFetcher.mockReturnValue(mocks.fetcher)
})

const check = async (clientId = CLIENT) => {
  const { checkDomainVerification } = await import('@/lib/domain-verification/service')
  return checkDomainVerification(clientId)
}

describe('the verification fetcher', () => {
  // One test on purpose: the fetcher is constructed once at module load, and
  // vi.clearAllMocks() in beforeEach erases that record before any later test
  // can read it. Splitting these made the second assert on an empty array.
  it('refuses redirects entirely, and caps the response', async () => {
    await import('@/lib/domain-verification/service')

    expect(mocks.createPublicUrlFetcher).toHaveBeenCalledWith(
      expect.objectContaining({ maxRedirects: 0 }),
    )
    const [options] = mocks.createPublicUrlFetcher.mock.calls[0]
    // The file is one short line; anything willing to stream at us is not it.
    expect(options.maxResponseBytes).toBeGreaterThan(0)
    expect(options.maxResponseBytes).toBeLessThanOrEqual(64 * 1024)
  })
})

describe('POST domain-verification', () => {
  it('records a verified proof when the token is the file', async () => {
    signedIn()
    mocks.fetcher.mockResolvedValue(new Response(TOKEN, { status: 200 }))

    const response = await check()

    expect(response.status).toBe(200)
    expect(mocks.recordVerificationResult).toHaveBeenCalledWith(ACCOUNT, CLIENT, 'example.com', 'verified')
    // The well-known path, on the claimed origin, over https.
    expect(String(mocks.fetcher.mock.calls[0][0]))
      .toBe('https://example.com/.well-known/aiso-site-verification.txt')
  })

  /**
   * The redirect refusal, end to end. A hop is not a hop here — it is a
   * different origin answering, and a different origin cannot prove this one.
   */
  it('records `redirected` rather than following the hop', async () => {
    signedIn()
    const { PublicUrlError } = await import('@/lib/security/public-url')
    mocks.fetcher.mockRejectedValue(new PublicUrlError('Too many redirects', 'TOO_MANY_REDIRECTS'))

    await check()

    expect(mocks.recordVerificationResult).toHaveBeenCalledWith(ACCOUNT, CLIENT, 'example.com', 'redirected')
  })

  it('records `too_large` for a response that will not stop', async () => {
    signedIn()
    const { PublicUrlError } = await import('@/lib/security/public-url')
    mocks.fetcher.mockRejectedValue(new PublicUrlError('Response is too large', 'RESPONSE_TOO_LARGE'))

    await check()

    expect(mocks.recordVerificationResult).toHaveBeenCalledWith(ACCOUNT, CLIENT, 'example.com', 'too_large')
  })

  /**
   * A site that does not answer is not our outage. Reporting 5xx here would
   * blame the product for the owner's DNS.
   */
  it('records `unreachable` and still answers 200 when the site does not respond', async () => {
    signedIn()
    mocks.fetcher.mockRejectedValue(new Error('getaddrinfo ENOTFOUND'))

    const response = await check()

    expect(response.status).toBe(200)
    expect(mocks.recordVerificationResult).toHaveBeenCalledWith(ACCOUNT, CLIENT, 'example.com', 'unreachable')
  })

  it.each([
    ['a non-200', () => new Response('nope', { status: 404 })],
    ['a body that merely mentions the token', () => new Response(`<p>${TOKEN}</p>`, { status: 200 })],
  ])('records `token_absent` for %s', async (_label, make) => {
    signedIn()
    mocks.fetcher.mockResolvedValue(make())

    await check()

    expect(mocks.recordVerificationResult).toHaveBeenCalledWith(ACCOUNT, CLIENT, 'example.com', 'token_absent')
  })

  it('refuses an anonymous caller without fetching anything', async () => {
    const response = await check()

    expect(response.status).toBe(401)
    expect(mocks.fetcher).not.toHaveBeenCalled()
  })

  it('answers 404 for a client that is not this account, never 403', async () => {
    signedIn()
    mocks.loadVerification.mockResolvedValue(null)

    expect((await check()).status).toBe(404)
    expect(mocks.fetcher).not.toHaveBeenCalled()
  })

  /**
   * A client with no domain has nothing to prove, so it gets a distinct
   * answer rather than an unverified badge no action could ever clear.
   */
  it('answers 409 when the client names no domain', async () => {
    signedIn()
    mocks.loadVerification.mockResolvedValue(row({ currentDomain: null }))

    expect((await check()).status).toBe(409)
    expect(mocks.fetcher).not.toHaveBeenCalled()
  })

  /**
   * A session-store outage is a dependency failure, so it answers 503 — the
   * thing that must never happen is 401, which would tell a signed-in owner
   * they are signed out because an unrelated service is down.
   */
  it('answers 503 for a session-store outage, never 401', async () => {
    mocks.getProfile.mockRejectedValue(new Error('session store unreachable'))

    const response = await check()

    expect(response.status).toBe(503)
    expect((await response.json()).error).toBe('VERIFICATION_UNAVAILABLE')
  })
})

describe('GET domain-verification', () => {
  it('hands back the token and where to publish it, without checking', async () => {
    signedIn()
    const { readDomainVerification } = await import('@/lib/domain-verification/service')

    const body = await (await readDomainVerification(CLIENT)).json()

    expect(body).toMatchObject({
      token: TOKEN,
      path: '/.well-known/aiso-site-verification.txt',
      domain: 'example.com',
      state: 'unverified',
    })
    expect(mocks.fetcher).not.toHaveBeenCalled()
  })
})
