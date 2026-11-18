import { describe, expect, it, vi } from 'vitest'
import { requestStudioAction, studioActionHref, type ActionScope } from '@/lib/conversation-studio/action-outcomes'
const clientId = '11111111-1111-4111-8111-111111111111', scanA = '22222222-2222-4222-8222-222222222222', scanB = '33333333-3333-4333-8333-333333333333'
const scan: ActionScope = { skillId: 'scan_brand', clientId, domain: 'example.test' }
const improve: ActionScope = { skillId: 'improve_page', clientId, scanId: scanA }
const month: ActionScope = { skillId: 'monthly_report', clientId, month: '2026-11' }
const request = (data: unknown, status = 200) => vi.fn<typeof fetch>().mockResolvedValue(Response.json(data, { status }))

describe('Studio action outcome boundary', () => {
  it('uses returned scan B, never page evidence A or a future latest record', async () => {
    const post = request({ id: scanB }), result = await requestStudioAction(scan, post)
    expect(result.phase).toBe('done')
    expect(studioActionHref(result.scope, 'zh-HK')).toBe(`/zh-HK/dashboard/${clientId}?step=results&scanId=${scanB}`)
    expect(post).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(post.mock.calls[0][1]?.body))).toEqual({ url: 'https://example.test', clientId })
  })
  it('binds Improve to exact submitted A and rejects wrong success scope', async () => {
    const post = request({ scanId: scanA, state: 'complete' })
    expect((await requestStudioAction(improve, post)).phase).toBe('done')
    expect(JSON.parse(String(post.mock.calls[0][1]?.body))).toEqual({ scanId: scanA })
    expect((await requestStudioAction(improve, request({ scanId: scanB, state: 'complete' }))).phase).toBe('unknown')
  })
  it('keeps 202 pending even with a finished-looking body', async () => {
    expect((await requestStudioAction(improve, request({ scanId: scanA, state: 'complete' }, 202))).phase).toBe('pending')
  })
  it('keeps the frozen month in the endpoint and link', async () => {
    const post = request({ recorded: [] }, 201), result = await requestStudioAction(month, post)
    expect(result.phase).toBe('done')
    expect(post.mock.calls[0][0]).toBe(`/api/clients/${clientId}/months/2026-11`)
    expect(studioActionHref(result.scope, 'en')).toBe(`/en/dashboard/${clientId}/month?m=2026-11`)
  })
  it('never repeats a write after a lost acknowledgement', async () => {
    const post = vi.fn<typeof fetch>().mockRejectedValue(new Error('response lost'))
    expect((await requestStudioAction(scan, post)).phase).toBe('unknown')
    expect(post).toHaveBeenCalledTimes(1)
  })
  it.each([{}, null, { id: 'not-a-scan' }])('does not fabricate a result for malformed 2xx %j', async data => {
    expect((await requestStudioAction(scan, request(data))).phase).toBe('unknown')
  })
  it('separates access rejection from unknown server-side failure', async () => {
    expect((await requestStudioAction(scan, request({}, 403))).phase).toBe('rejected')
    expect((await requestStudioAction(scan, request({}, 503))).phase).toBe('unknown')
  })
})

describe('definite refusals are told apart from unknown outcomes', () => {
  it.each([
    [scan, 429, { error: 'AUTHENTICATED_SCAN_LIMIT_REACHED' }, 'limit'],
    [improve, 404, { error: 'NOT_FOUND' }, 'notFound'],
    [improve, 400, { error: 'Valid scanId required' }, 'notFound'],
    [improve, 409, { error: 'EXTERNAL_AGENT_CONFIGURED' }, 'external'],
    [month, 403, { error: 'UPGRADE_REQUIRED' }, 'notAllowed'],
  ] as const)('%s %i is rejected as %s, never "may already have run"', async (scope, status, body, reason) => {
    const result = await requestStudioAction(scope, request(body, status))
    expect(result).toMatchObject({ phase: 'rejected', reason })
  })
  it.each(['GENERATION_FAILED', 'GENERATION_OUTCOME_UNKNOWN'])('keeps a generation 409 %s unknown: a model call may have started', async error => {
    expect((await requestStudioAction(improve, request({ error }, 409))).phase).toBe('unknown')
  })
  it('keeps 5xx unknown', async () => {
    expect((await requestStudioAction(scan, request({ error: 'boom' }, 503))).phase).toBe('unknown')
  })
})
