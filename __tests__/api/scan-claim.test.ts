import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { signScanClaimIntent } from '@/lib/security/scan-claim-intent'

const getProfileMock = vi.hoisted(() => vi.fn())

const queries: string[] = []
let nextResults: unknown[][] = []

const mockSql = vi.fn((strings: TemplateStringsArray) => {
  queries.push(strings.join('?'))
  const result = nextResults.shift()
  if (result instanceof Error) throw result
  return Promise.resolve(result ?? [])
})

vi.mock('@/lib/auth', () => ({ getProfile: getProfileMock }))
vi.mock('@/lib/db', () => ({ db: () => mockSql }))

function claimIntent(scanId = 'scan-1', overrides: Partial<{ lang: 'en' | 'zh-HK'; returnPath: string }> = {}) {
  return signScanClaimIntent({
    scanId,
    lang: overrides.lang ?? 'en',
    returnPath: overrides.returnPath ?? `/en/result/${encodeURIComponent(scanId)}?claim=1`,
    attemptId: 'attempt-1',
  })
}

async function claim(scanId = 'scan-1', intent?: string) {
  const { POST } = await import('@/app/api/scans/[id]/claim/route')
  return POST(new NextRequest(`http://localhost/api/scans/${scanId}/claim`, {
    method: 'POST',
    headers: intent ? { Cookie: `fimmick_scan_claim_intent=${intent}` } : undefined,
  }), {
    params: Promise.resolve({ id: scanId }),
  })
}

describe('POST /api/scans/[id]/claim', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queries.length = 0
    nextResults = []
    getProfileMock.mockResolvedValue({ account_id: 'account-1' })
    process.env.REPORT_SHARE_SECRET = 'x'.repeat(32)
  })

  it('claims an unowned scan after authentication when the intent cookie is absent', async () => {
    nextResults = [[{ id: 'scan-1' }]]

    const response = await claim()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, alreadyOwned: false })
    expect(getProfileMock).toHaveBeenCalledOnce()
    expect(mockSql).toHaveBeenCalledOnce()
  })

  it('returns a fixed response without querying when the intent cookie is tampered', async () => {
    const response = await claim('scan-1', `${claimIntent()}x`)

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Claim unavailable' })
    expect(mockSql).not.toHaveBeenCalled()
  })

  it('rejects expired and mismatched claim intents before querying', async () => {
    const expired = signScanClaimIntent({
      scanId: 'scan-1', lang: 'en', returnPath: '/en/result/scan-1?claim=1', attemptId: 'attempt-1',
    }, Date.now() - (16 * 60 * 1000))

    const expiredResponse = await claim('scan-1', expired)
    const mismatchResponse = await claim('scan-1', claimIntent('scan-2'))

    expect(expiredResponse.status).toBe(403)
    expect(mismatchResponse.status).toBe(403)
    expect(mockSql).not.toHaveBeenCalled()
  })

  it('rejects an intent whose canonical return path does not match the scan', async () => {
    const mismatchedReturnPath = claimIntent('scan-1', { returnPath: '/en/result/scan-2?claim=1' })

    const response = await claim('scan-1', mismatchedReturnPath)

    expect(response.status).toBe(403)
    expect(mockSql).not.toHaveBeenCalled()
  })

  it('returns 401 when no profile exists after a valid intent', async () => {
    getProfileMock.mockResolvedValue(null)

    const response = await claim('scan-1', claimIntent())

    expect(response.status).toBe(401)
    expect(mockSql).not.toHaveBeenCalled()
  })

  it('claims an unowned scan for the authenticated account', async () => {
    nextResults = [[{ id: 'scan-1' }]]

    const response = await claim('scan-1', claimIntent())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, alreadyOwned: false })
    expect(queries[0]).toContain('account_id is null')
    expect(response.headers.get('set-cookie')).toContain('fimmick_scan_claim_intent=;')
  })

  it('returns ok when the scan already belongs to the same account', async () => {
    nextResults = [[], [{ account_id: 'account-1' }]]

    const response = await claim('scan-1', claimIntent())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, alreadyOwned: true })
    expect(queries).toHaveLength(2)
    expect(response.headers.get('set-cookie')).toContain('fimmick_scan_claim_intent=;')
  })

  it('returns 409 when the scan belongs to another account', async () => {
    nextResults = [[], [{ account_id: 'account-2' }]]

    const response = await claim('scan-1', claimIntent())

    expect(response.status).toBe(409)
    expect(response.headers.get('set-cookie')).toContain('fimmick_scan_claim_intent=;')
  })

  it('returns 404 when the scan does not exist', async () => {
    nextResults = [[], []]

    const response = await claim('scan-1', claimIntent())

    expect(response.status).toBe(404)
    expect(response.headers.get('set-cookie')).toContain('fimmick_scan_claim_intent=;')
  })

  it('returns 500 when the update query throws', async () => {
    nextResults = [new Error('connection terminated') as never]

    const response = await claim('scan-1', claimIntent())

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Failed to claim scan' })
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('returns 500 when the re-read after a no-op update throws', async () => {
    nextResults = [[], new Error('connection terminated') as never]

    const response = await claim('scan-1', claimIntent())

    expect(response.status).toBe(500)
  })
})
