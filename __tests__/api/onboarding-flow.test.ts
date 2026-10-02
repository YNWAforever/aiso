import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { CLAIM_INTENT_COOKIE, signScanClaimIntent } from '@/lib/security/scan-claim-intent'
const mocks = vi.hoisted(() => ({ profile: vi.fn(), read: vi.fn(), ownedScan: vi.fn(), complete: vi.fn(), claim: vi.fn(), consume: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getProfile: mocks.profile }))
vi.mock('@/lib/onboarding/store', () => ({ readOnboardingProgress: mocks.read, ownedOnboardingScan: mocks.ownedScan }))
vi.mock('@/lib/onboarding/service', () => ({ completeOnboarding: mocks.complete }))
vi.mock('@/app/api/scans/[id]/claim/route', () => ({ claimScanForAccount: mocks.claim }))
vi.mock('@/lib/security/scan-claim-attempt', () => ({ consumeScanClaimAttempt: mocks.consume }))
import { POST } from '@/app/api/onboarding/complete/route'
const clientId = '11111111-1111-4111-8111-111111111111', scanId = '22222222-2222-4222-8222-222222222222'
const result = { clientId, scanId: null, trialEndsAt: '2026-10-10T00:00:00.000Z', intentKey: 'synthetic-intent', progress: {
  clientId, brand: 'ready', prompts: 'ready', promptCount: 24, scanId: null, retryable: false, errorCode: null,
} }
function request(body: unknown, intent?: string) {
  return new NextRequest('https://example.test/api/onboarding/complete', { method: 'POST', body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...(intent ? {Cookie: `${CLAIM_INTENT_COOKIE}=${intent}`} : {}) } })
}
function signed(id = scanId) {
  return signScanClaimIntent({scanId:id,lang:'en',returnPath:`/en/result/${id}?claim=1`,attemptId:'44444444-4444-4444-8444-444444444444'})!
}
beforeEach(() => {
  vi.clearAllMocks(); process.env.REPORT_SHARE_SECRET = 'x'.repeat(32)
  mocks.profile.mockResolvedValue({account_id:'synthetic-account'}); mocks.read.mockResolvedValue(null)
  mocks.complete.mockResolvedValue(result); mocks.claim.mockResolvedValue({status:'claimed'}); mocks.consume.mockResolvedValue('consumed')
  mocks.ownedScan.mockResolvedValue(false)
})
describe('resumable onboarding API boundary', () => {
  it('returns 401 before database effects for an anonymous user', async () => {
    mocks.profile.mockResolvedValue(null)
    expect((await POST(request({brandName:'Synthetic'}))).status).toBe(401)
    expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.complete).not.toHaveBeenCalled()
  })
  it.each([{},null,[],{brandName:' '},{brandName:42},{brandName:'x'.repeat(161)},
    {brandName:'Synthetic',description:'x'.repeat(4001)}, {brandName:'Synthetic',competitors:[42]},
    {brandName:'Synthetic',clientId:'invalid'}, {brandName:'Synthetic',scanId:'invalid'}])('rejects invalid input before effects: %j', async body => {
    expect((await POST(request(body))).status).toBe(400); expect(mocks.complete).not.toHaveBeenCalled()
  })
  it('rejects invalid JSON', async () => {
    expect((await POST(new NextRequest('https://example.test', {method:'POST',body:'{'}))).status).toBe(400)
  })
  it('denies a scan without a signed claim intent', async () => {
    expect((await POST(request({brandName:'Synthetic',scanId}))).status).toBe(403)
    expect(mocks.consume).not.toHaveBeenCalled(); expect(mocks.complete).not.toHaveBeenCalled()
  })
  it('denies an intent minted for another scan', async () => {
    expect((await POST(request({brandName:'Synthetic',scanId},signed(clientId)))).status).toBe(403)
  })
  it('rejects replay of a consumed claim attempt', async () => {
    mocks.consume.mockResolvedValue('already-consumed')
    expect((await POST(request({brandName:'Synthetic',scanId},signed()))).status).toBe(403)
    expect(mocks.claim).not.toHaveBeenCalled(); expect(mocks.complete).not.toHaveBeenCalled()
  })
  it('fails closed when claim attempt storage is unavailable', async () => {
    mocks.consume.mockRejectedValue(new Error('synthetic outage'))
    expect((await POST(request({brandName:'Synthetic',scanId},signed()))).status).toBe(503)
  })
  it.each([['not-found',404],['conflict',409],['error',500]] as const)('preserves %s scan claim denial', async (status,expected) => {
    mocks.claim.mockResolvedValue({status})
    expect((await POST(request({brandName:'Synthetic',scanId},signed()))).status).toBe(expected)
    expect(mocks.complete).not.toHaveBeenCalled()
  })
  it('claims only for the session account before creating persistent progress', async () => {
    expect((await POST(request({brandName:'Synthetic',scanId},signed()))).status).toBe(200)
    expect(mocks.claim).toHaveBeenCalledWith(scanId,'synthetic-account')
    expect(mocks.complete).toHaveBeenCalledWith({accountId:'synthetic-account'},expect.objectContaining({scanId}))
  })
  it('resumes a stored matching client/scan without spending another claim intent', async () => {
    mocks.read.mockResolvedValue({...result,scanId})
    expect((await POST(request({brandName:'Synthetic',scanId,clientId,intentKey:result.intentKey}))).status).toBe(200)
    expect(mocks.claim).not.toHaveBeenCalled(); expect(mocks.consume).not.toHaveBeenCalled()
  })
  it('resumes after a lost response when the caller has not received the client id', async () => {
    mocks.read.mockResolvedValue({...result,scanId})
    expect((await POST(request({brandName:'Synthetic',scanId,intentKey:result.intentKey}))).status).toBe(200)
    expect(mocks.consume).not.toHaveBeenCalled()
  })
  it('resumes an interruption after scan claim through signed intent and session-owned readback', async () => {
    mocks.ownedScan.mockResolvedValue(true)
    expect((await POST(request({brandName:'Synthetic',scanId},signed()))).status).toBe(200)
    expect(mocks.ownedScan).toHaveBeenCalledWith({accountId:'synthetic-account'},scanId)
    expect(mocks.consume).not.toHaveBeenCalled(); expect(mocks.claim).not.toHaveBeenCalled()
  })
  it('stored progress for a different client cannot bypass claim authorization', async () => {
    mocks.read.mockResolvedValue({...result,scanId})
    expect((await POST(request({brandName:'Synthetic',scanId,clientId:scanId,intentKey:result.intentKey}))).status).toBe(403)
  })
  it('seed_failure_resumes_same_client exposes persistent retryable progress instead of silent success', async () => {
    mocks.complete.mockResolvedValue({...result,progress:{...result.progress,prompts:'failed',promptCount:0,retryable:true,errorCode:'ONBOARDING_SEED_FAILED'}})
    const response=await POST(request({brandName:'Synthetic',intentKey:result.intentKey,clientId}))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({clientId,trialEndsAt:result.trialEndsAt,progress:{prompts:'failed',retryable:true,promptCount:0}})
  })
  it('distinguishes unavailable requested brand from dependency failure', async () => {
    mocks.complete.mockResolvedValue(null)
    expect((await POST(request({brandName:'Synthetic',clientId}))).status).toBe(404)
    mocks.complete.mockRejectedValue(new Error('synthetic outage'))
    expect((await POST(request({brandName:'Synthetic',clientId}))).status).toBe(503)
  })
  it('preserves the brand quota response', async () => {
    mocks.complete.mockRejectedValue(new Error('BRAND_LIMIT_REACHED'))
    expect((await POST(request({brandName:'Synthetic'}))).status).toBe(403)
  })
  it('does not disclose dependency errors', async () => {
    mocks.read.mockRejectedValue(new Error('synthetic-private-detail'))
    const response=await POST(request({brandName:'Synthetic'}))
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('synthetic-private-detail')
  })
})
