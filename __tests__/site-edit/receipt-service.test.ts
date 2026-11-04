import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Site-edit S3 receipt route. The store is mocked (its SQL is proven in
 * receipt-sql.test.ts); the signature is real. What this proves: nothing
 * touches the database before the signature verifies, the order of every
 * refusal, replay vs conflict, and no 2xx over a failed write.
 */

const m = vi.hoisted(() => ({ loadReceiptJob: vi.fn(), recordReceipt: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/site-edit/receipt-store', () => ({ loadReceiptJob: m.loadReceiptJob, recordReceipt: m.recordReceipt }))

import { POST } from '@/app/api/site-edit/receipts/route'
import { parseReceipt, receiptSecrets, signReceipt, verifyReceiptSignature } from '@/lib/site-edit/receipt'

const SECRET = 'r'.repeat(32)
const PREVIOUS = 'p'.repeat(32)
const JOB = '60000000-0000-4000-8000-000000000001'
const ACCOUNT = '10000000-0000-4000-8000-000000000001'
const TARGET = 'https://www.bakery.hk/'
const payload = (over: Record<string, unknown> = {}) => JSON.stringify({ jobId: JOB, status: 'completed', url: TARGET, completedAt: '2026-11-04T10:00:00Z', ...over })
const now = () => String(Math.floor(Date.now() / 1000))
function post(body: string, { secret = SECRET, ts = now(), sig }: { secret?: string; ts?: string; sig?: string } = {}) {
  return POST(new Request('https://aiso.example/api/site-edit/receipts', {
    method: 'POST', body, headers: { 'Content-Type': 'application/json', 'X-Rick-Timestamp': ts, 'X-Rick-Signature': sig ?? signReceipt(secret, ts, body) },
  }))
}
const job = (over: Record<string, unknown> = {}) => ({ jobId: JOB, accountId: ACCOUNT, targetUrl: TARGET, lastEvent: 'sent', receipt: null, ...over })

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('SITE_EDIT_RECEIPT_SECRET', SECRET)
  vi.stubEnv('SITE_EDIT_RECEIPT_SECRET_PREVIOUS', '')
  m.loadReceiptJob.mockResolvedValue(job())
  m.recordReceipt.mockResolvedValue('created')
})
afterEach(() => vi.unstubAllEnvs())

describe('receipt contract', () => {
  it('accepts the current or previous secret within ±5 minutes, constant-time over the exact bytes', () => {
    const ts = '1793800000', body = payload()
    expect(verifyReceiptSignature([SECRET], ts, body, signReceipt(SECRET, ts, body), 1793800000_000)).toBe(true)
    expect(verifyReceiptSignature([SECRET, PREVIOUS], ts, body, signReceipt(PREVIOUS, ts, body), 1793800000_000)).toBe(true)
    expect(verifyReceiptSignature([SECRET], ts, body + ' ', signReceipt(SECRET, ts, body), 1793800000_000)).toBe(false)
    expect(verifyReceiptSignature([SECRET], ts, body, signReceipt(SECRET, ts, body), 1793800301_000)).toBe(false)
    expect(verifyReceiptSignature([], ts, body, signReceipt(SECRET, ts, body), 1793800000_000)).toBe(false)
    expect(verifyReceiptSignature([SECRET], ts, body, 'v1=zz', 1793800000_000)).toBe(false)
    expect(receiptSecrets({ SITE_EDIT_RECEIPT_SECRET: 'short', SITE_EDIT_RECEIPT_SECRET_PREVIOUS: PREVIOUS })).toEqual([PREVIOUS])
  })

  it('parses strictly', () => {
    expect(parseReceipt(JSON.parse(payload({ note: ' ' })))).toEqual({ jobId: JOB, status: 'completed', url: TARGET, completedAt: '2026-11-04T10:00:00Z', note: null })
    for (const bad of [payload({ extra: 1 }), payload({ status: 'done' }), payload({ jobId: 'x' }), payload({ completedAt: 'yesterday' }), payload({ note: 'x'.repeat(2001) }), '[]']) {
      expect(() => parseReceipt(JSON.parse(bad))).toThrow()
    }
  })
})

describe('POST /api/site-edit/receipts', () => {
  it('records nothing and touches no database when unconfigured, unsigned, mis-signed, stale or too large', async () => {
    vi.stubEnv('SITE_EDIT_RECEIPT_SECRET', '')
    expect((await post(payload())).status).toBe(503)
    vi.stubEnv('SITE_EDIT_RECEIPT_SECRET', SECRET)
    expect((await post(payload(), { sig: '' })).status).toBe(401)
    expect((await post(payload(), { secret: 'w'.repeat(32) })).status).toBe(401)
    expect((await post(payload(), { ts: String(Math.floor(Date.now() / 1000) - 600) })).status).toBe(401)
    expect((await post(payload({ note: 'x'.repeat(9000) }))).status).toBe(413)
    expect(m.loadReceiptJob).not.toHaveBeenCalled()
  })

  it('refuses bad JSON, an unknown job, a job never handed off or refused, and a URL other than the frozen target', async () => {
    expect((await post('{not json')).status).toBe(400)
    expect((await post(payload({ extra: 1 }))).status).toBe(400)
    m.loadReceiptJob.mockResolvedValueOnce(null)
    expect((await post(payload())).status).toBe(404)
    for (const lastEvent of [null, 'failed']) {
      m.loadReceiptJob.mockResolvedValueOnce(job({ lastEvent }))
      expect((await (await post(payload())).json()).error).toBe('RECEIPT_JOB_NOT_OPEN')
    }
    m.loadReceiptJob.mockResolvedValueOnce(job())
    const wrong = await post(payload({ url: 'https://www.bakery.hk/other' }))
    expect([wrong.status, (await wrong.json()).error]).toEqual([422, 'RECEIPT_URL_MISMATCH'])
    expect(m.recordReceipt).not.toHaveBeenCalled()
  })

  it('records a valid receipt against the job’s own account, and accepts one that beats the outcome write', async () => {
    const body = payload({ note: 'Deployed.' })
    const response = await post(body)
    expect(response.status).toBe(201)
    expect(m.recordReceipt).toHaveBeenCalledWith({ jobId: JOB, accountId: ACCOUNT, status: 'completed', url: TARGET,
      completedAt: '2026-11-04T10:00:00Z', note: 'Deployed.', bodySha256: createHash('sha256').update(body).digest('hex') })
    for (const lastEvent of ['claim', 'unknown']) {
      m.loadReceiptJob.mockResolvedValueOnce(job({ lastEvent }))
      expect((await post(payload())).status).toBe(201)
    }
  })

  it('replays an identical receipt without writing, refuses a different one for a closed job, and never 2xx over a failed write', async () => {
    const body = payload()
    const sha = createHash('sha256').update(body).digest('hex')
    m.loadReceiptJob.mockResolvedValueOnce(job({ receipt: { bodySha256: sha } }))
    const replay = await post(body)
    expect([replay.status, await replay.json()]).toEqual([200, { received: true, replayed: true }])
    m.loadReceiptJob.mockResolvedValueOnce(job({ receipt: { bodySha256: 'f'.repeat(64) } }))
    expect((await post(body)).status).toBe(409)
    expect(m.recordReceipt).not.toHaveBeenCalled()
    m.recordReceipt.mockResolvedValueOnce('conflict')
    expect((await post(body)).status).toBe(409)
    m.recordReceipt.mockRejectedValueOnce(new Error('db down'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await post(body)).status).toBe(503)
    spy.mockRestore()
  })
})
