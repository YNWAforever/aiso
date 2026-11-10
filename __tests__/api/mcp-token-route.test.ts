import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({
  enabled: vi.fn(),
  configured: vi.fn(),
  mint: vi.fn(),
  authorize: vi.fn(),
}))
vi.mock('@/lib/flags', () => ({ isStudioMcpEnabled: mocks.enabled }))
vi.mock('@/lib/conversation-studio/mcp/token', () => ({ isStudioMcpConfigured: mocks.configured, mintStudioMcpToken: mocks.mint }))
vi.mock('@/lib/conversation-studio/threads', () => ({ authorizeStudioBrand: mocks.authorize }))
import { POST } from '@/app/api/dashboard/clients/[clientId]/studio/mcp-token/route'

const clientId = '20000000-0000-4000-8000-000000000002'
const accountId = '10000000-0000-4000-8000-000000000001'
const profileId = '30000000-0000-4000-8000-000000000003'
const context = { params: Promise.resolve({ clientId }) } as never

async function call() {
  const response = await POST(new Request('https://aiso.example/api/dashboard/clients/x/studio/mcp-token', { method: 'POST' }), context)
  const text = await response.text()
  return { status: response.status, json: text ? JSON.parse(text) : null, headers: response.headers }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mocks.enabled.mockReturnValue(true)
  mocks.configured.mockReturnValue(true)
  mocks.authorize.mockResolvedValue({ accountId, clientId, profileId, staffGrantId: null })
  mocks.mint.mockReturnValue({ token: 'v1.payload.signature', expiresAt: Date.now() + 3_600_000 })
})

describe('Studio MCP token mint', () => {
  it('is invisible when MCP or Studio is not enabled for the brand', async () => {
    mocks.enabled.mockReturnValue(false)
    expect(await call()).toMatchObject({ status: 404, json: { error: 'NOT_FOUND' } })
    expect(mocks.authorize).not.toHaveBeenCalled()
  })

  it('says the deployment is not configured instead of minting a token that cannot verify', async () => {
    mocks.configured.mockReturnValue(false)
    expect(await call()).toMatchObject({ status: 503, json: { error: 'STUDIO_MCP_UNCONFIGURED' } })
    expect(mocks.mint).not.toHaveBeenCalled()
  })

  it('passes a session guard response through unchanged', async () => {
    mocks.authorize.mockResolvedValue(new Response(JSON.stringify({ error: 'UNAUTHENTICATED' }), { status: 401 }))
    expect(await call()).toMatchObject({ status: 401, json: { error: 'UNAUTHENTICATED' } })
    expect(mocks.mint).not.toHaveBeenCalled()
  })

  it('mints a no-store token scoped to the brand account the session proved', async () => {
    const result = await call()
    expect(mocks.mint).toHaveBeenCalledWith({ accountId, clientId, profileId })
    expect(result).toMatchObject({ status: 200, json: { token: 'v1.payload.signature', endpoint: '/api/mcp/studio' } })
    expect(result.headers.get('cache-control')).toBe('no-store')
  })

  it('fails closed when minting throws', async () => {
    mocks.mint.mockImplementation(() => { throw new Error('STUDIO_MCP_UNCONFIGURED') })
    expect(await call()).toMatchObject({ status: 503, json: { error: 'STUDIO_MCP_UNAVAILABLE' } })
  })
})
