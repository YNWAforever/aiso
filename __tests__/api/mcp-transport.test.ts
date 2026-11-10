import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  authorize: vi.fn(),
  execute: vi.fn(),
  audit: vi.fn(),
}))
vi.mock('@/lib/conversation-studio/mcp/token', () => ({ verifyStudioMcpToken: mocks.verify }))
vi.mock('@/lib/conversation-studio/mcp/authorize', () => ({ authorizeStudioMcp: mocks.authorize }))
vi.mock('@/lib/conversation-studio/mcp/execute', () => ({ executeStudioMcpTool: mocks.execute }))
vi.mock('@/lib/conversation-studio/mcp/audit', () => ({ recordStudioMcpCall: mocks.audit }))
import { GET, POST } from '@/app/api/mcp/studio/route'

const claims = {
  accountId: '10000000-0000-4000-8000-000000000001',
  clientId: '20000000-0000-4000-8000-000000000002',
  profileId: '30000000-0000-4000-8000-000000000003',
  expiresAt: Date.now() + 60_000,
}
const principal = {
  accountId: claims.accountId,
  clientId: claims.clientId,
  profileId: claims.profileId,
  entitlements: { search_console: true },
}

function request(body: unknown, token = 'v1.token') {
  return new Request('https://aiso.example/api/mcp/studio', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function call(body: unknown, token = 'v1.token') {
  const response = await POST(request(body, token))
  const text = await response.text()
  return { status: response.status, json: text ? JSON.parse(text) : null, text }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mocks.verify.mockImplementation(token => token === 'v1.token' ? claims : null)
  mocks.authorize.mockResolvedValue({ ok: true, principal })
  mocks.audit.mockResolvedValue(undefined)
  mocks.execute.mockResolvedValue({ ok: true, data: { state: 'available', week: '2026-10-26' } })
})

describe('internal Studio MCP transport', () => {
  it('is a POST-only bearer endpoint and discloses nothing without a token', async () => {
    const missing = await POST(new Request('https://aiso.example/api/mcp/studio', { method: 'POST', body: '{}' }))
    expect(missing.status).toBe(401)
    mocks.verify.mockReturnValue(null)
    expect((await call({ jsonrpc: '2.0', id: 1, method: 'initialize' })).status).toBe(401)
    expect((await GET()).status).toBe(405)
    expect(mocks.authorize).not.toHaveBeenCalled()
  })

  it('refuses a forbidden brand and audits nothing it did not read', async () => {
    mocks.authorize.mockResolvedValue({ ok: false, reason: 'forbidden' })
    const result = await call({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect(result.status).toBe(403)
    expect(mocks.audit).not.toHaveBeenCalled()
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('negotiates a supported protocol and names the server', async () => {
    const result = await call({ jsonrpc: '2.0', id: 7, method: 'initialize', params: { protocolVersion: '2025-03-26' } })
    expect(result.json).toMatchObject({
      jsonrpc: '2.0', id: 7,
      result: { protocolVersion: '2025-03-26', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'aiso-studio' } },
    })
    // An unknown version negotiates down to the latest we implement, not an error.
    expect((await call({ jsonrpc: '2.0', id: 8, method: 'initialize', params: { protocolVersion: '1999-01-01' } })).json.result.protocolVersion).toBe('2025-06-18')
  })

  it('accepts initialized notifications without a JSON-RPC response', async () => {
    const response = await POST(request({ jsonrpc: '2.0', method: 'notifications/initialized' }))
    expect(response.status).toBe(202)
    expect(await response.text()).toBe('')
  })

  it('publishes every registry tool as read-only', async () => {
    const result = await call({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    const names = result.json.result.tools.map((tool: { name: string }) => tool.name)
    expect(names).toEqual(['brand_evidence', 'scan_checks', 'content_opportunities', 'brand_sources', 'work_item_drafts', 'search_console_status'])
    for (const tool of result.json.result.tools) expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: false })
  })

  it('runs a tool with the authorized principal and audits the read', async () => {
    mocks.execute.mockResolvedValue({ ok: true, data: { state: 'available', week: '2026-10-26' } })
    const result = await call({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'brand_evidence', arguments: {} } })
    expect(mocks.execute).toHaveBeenCalledWith({ principal, name: 'brand_evidence', args: {} })
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ tool: 'brand_evidence', outcome: 'allowed', detail: null, rpcId: 3 }))
    expect(result.json.result).toMatchObject({ isError: false, structuredContent: { ok: true } })
    expect(JSON.parse(result.json.result.content[0].text)).toEqual({ ok: true, data: { state: 'available', week: '2026-10-26' } })
  })

  it('returns a tool failure as isError with the failure code, and audits it as failed', async () => {
    mocks.execute.mockResolvedValue({ ok: false, error: 'FEATURE_UNAVAILABLE', message: 'Not on this plan.' })
    const result = await call({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'search_console_status' } })
    expect(result.json.result.isError).toBe(true)
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ tool: 'search_console_status', outcome: 'failed', detail: 'FEATURE_UNAVAILABLE' }))
  })

  it('refuses an unknown tool without executing anything, and records the denial', async () => {
    const result = await call({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'save_work_item_draft', arguments: {} } })
    expect(result.json.error.code).toBe(-32602)
    expect(mocks.execute).not.toHaveBeenCalled()
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ tool: 'save_work_item_draft', outcome: 'denied', detail: 'UNKNOWN_TOOL', rpcId: 5 }))
  })

  it('fails closed when the call cannot be audited', async () => {
    mocks.audit.mockRejectedValue(new Error('relation studio_mcp_calls does not exist'))
    const result = await call({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'brand_evidence' } })
    expect(result.status).toBe(503)
    expect(result.json).toEqual({ error: 'AUDIT_UNAVAILABLE' })
    expect(console.error).toHaveBeenCalled()
  })

  it('maps protocol errors to the expected JSON-RPC codes', async () => {
    expect((await call({ jsonrpc: '2.0', id: 'x', method: 'nope' })).json).toMatchObject({ id: 'x', error: { code: -32601 } })
    expect((await call([{ jsonrpc: '2.0', id: 1, method: 'ping' }])).json.error.code).toBe(-32600)
    expect((await call({ id: 1, method: 'ping' })).json.error.code).toBe(-32600)
    const badJson = await POST(new Request('https://aiso.example/api/mcp/studio', { method: 'POST', headers: { authorization: 'Bearer v1.token' }, body: '{' }))
    expect((await badJson.json()).error.code).toBe(-32700)
    // An oversized body is refused before parsing.
    const huge = await POST(new Request('https://aiso.example/api/mcp/studio', {
      method: 'POST', headers: { authorization: 'Bearer v1.token' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', pad: 'x'.repeat(40 * 1024) }),
    }))
    expect(huge.status).toBe(413)
  })

  it('answers ping with an empty result', async () => {
    expect((await call({ jsonrpc: '2.0', id: 9, method: 'ping' })).json).toEqual({ jsonrpc: '2.0', id: 9, result: {} })
  })
})
