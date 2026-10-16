import { beforeEach, describe, expect, it, vi } from 'vitest'
import { dispatchScanSummary } from '@/lib/n8n/dispatch'
import { createSummaryReceipt } from '@/lib/n8n/schema'

const mock = vi.hoisted(() => ({ begin: vi.fn(), record: vi.fn(), buildFetcher: vi.fn(), send: vi.fn() }))
vi.mock('@/lib/n8n/store', () => ({ beginSummaryDispatch: mock.begin, recordSummaryDispatch: mock.record }))
vi.mock('@/lib/security/public-url', () => ({ createPublicUrlFetcher: mock.buildFetcher }))
const scope = { scanId: '7d7948df-84d1-4891-a77a-21a46b602bea', accountId: null, clientId: null }
const prepared = createSummaryReceipt({ domain: 'example.test', score: 20, grade: 'F', results: {} })
beforeEach(() => {
  vi.clearAllMocks()
  mock.begin.mockResolvedValue(true)
  mock.record.mockResolvedValue(undefined)
  mock.buildFetcher.mockReturnValue(mock.send)
})
const dispatch = () => dispatchScanSummary(scope, prepared.token, prepared.receipt, 'https://n8n.example.test/webhook/scan')

describe('n8n dispatch acknowledgements', () => {
  it('requires a public HTTPS target with redirects disabled before sending the capability', async () => {
    mock.send.mockResolvedValue(Response.json({ accepted: true, ...scope, dispatchId: prepared.receipt.id, executionId: '1', workflowId: 'wf' }, { status: 202 }))
    await dispatch()
    expect(mock.buildFetcher).toHaveBeenCalledWith({ maxRedirects: 0, maxResponseBytes: 4096, timeoutMs: 5000, allowedProtocols: ['https:'] })
    expect(mock.record).toHaveBeenCalledWith(scope, prepared.token, { state: 'accepted', httpStatus: 202 })
    const sent = JSON.parse(mock.send.mock.calls[0][1].body)
    expect(Object.keys(sent).sort()).toEqual(['accountId', 'clientId', 'dispatchId', 'scanId', 'token', 'version'])
  })
  it.each([401, 404, 429, 500, 503])('records HTTP %s as rejected instead of successful work', async status => {
    mock.send.mockResolvedValue(new Response('upstream refusal', { status }))
    await dispatch()
    expect(mock.record).toHaveBeenCalledWith(scope, prepared.token, { state: 'rejected', httpStatus: status })
    expect(mock.send).toHaveBeenCalledTimes(1)
  })
  it.each(['html', 'legacy', 'wrong-scan', 'wrong-dispatch', 'missing-execution'])('does not promote a 2xx %s acknowledgement to completion', async kind => {
    const valid = { accepted: true, scanId: scope.scanId, dispatchId: prepared.receipt.id, executionId: '1', workflowId: 'wf' }
    mock.send.mockResolvedValue(kind === 'html' ? new Response('<html>Sign in</html>', { status: 200 })
      : Response.json(kind === 'legacy' ? { ok: true, scanId: scope.scanId }
        : { ...valid, ...(kind === 'wrong-scan' ? { scanId: 'foreign' } : {}),
          ...(kind === 'wrong-dispatch' ? { dispatchId: 'foreign' } : {}),
          ...(kind === 'missing-execution' ? { executionId: null } : {}) }, { status: 202 }))
    await dispatch()
    expect(mock.record.mock.calls[0][2].state).toBe('outcome_unknown')
    expect(mock.send).toHaveBeenCalledTimes(1)
  })
  it('does not send again when the durable claim was already taken', async () => {
    mock.begin.mockResolvedValue(false)
    await dispatch()
    expect(mock.send).not.toHaveBeenCalled()
    expect(mock.record).not.toHaveBeenCalled()
  })
  it('retains an unknown transport outcome without logging secrets or retrying', async () => {
    const log = vi.spyOn(console, 'error')
    mock.send.mockRejectedValue(new Error('PRIVATE_UPSTREAM_TOKEN'))
    await dispatch()
    expect(mock.record).toHaveBeenCalledWith(scope, prepared.token, { state: 'outcome_unknown', httpStatus: null })
    expect(mock.send).toHaveBeenCalledTimes(1)
    expect(log).not.toHaveBeenCalled()
    log.mockRestore()
  })
  it('propagates failed receipt persistence rather than inventing an acknowledgement', async () => {
    mock.send.mockResolvedValue(new Response('refused', { status: 503 }))
    mock.record.mockRejectedValue(new Error('storage failure'))
    await expect(dispatch()).rejects.toThrow('storage failure')
  })
})
