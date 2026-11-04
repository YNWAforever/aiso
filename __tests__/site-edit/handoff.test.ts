import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  HANDOFF_STALE_MS, executorRef, handoffBody, handoffConfig, handoffSignature, handoffState, outcomeFor, type HandoffEvent,
} from '@/lib/site-edit/handoff'
import type { EditSpecV1 } from '@/lib/site-edit/edit-spec'

const secret = 'x'.repeat(32)
const spec = { schemaVersion: 1, kind: 'jsonld', targetUrl: 'https://www.example.com/', schemaType: 'Organization',
  payload: { '@context': 'https://schema.org', '@type': 'Organization', name: 'Example' } } as unknown as EditSpecV1

describe('handoffConfig', () => {
  it('is connected only with an https URL and a secret of at least 32 characters', () => {
    expect(handoffConfig({ SITE_EDIT_EXECUTOR_URL: 'https://rick.example/jobs', SITE_EDIT_EXECUTOR_SECRET: secret })).toEqual({ url: 'https://rick.example/jobs', secret })
    for (const env of [
      {},
      { SITE_EDIT_EXECUTOR_URL: 'https://rick.example/jobs' },
      { SITE_EDIT_EXECUTOR_URL: 'https://rick.example/jobs', SITE_EDIT_EXECUTOR_SECRET: 'short' },
      { SITE_EDIT_EXECUTOR_URL: 'http://rick.example/jobs', SITE_EDIT_EXECUTOR_SECRET: secret },
      { SITE_EDIT_EXECUTOR_URL: 'not a url', SITE_EDIT_EXECUTOR_SECRET: secret },
    ]) expect(handoffConfig(env)).toBeNull()
  })
})

describe('the signed body', () => {
  const input = { receiptUrl: 'https://aiso.example/api/site-edit/receipts', approvedAt: '2026-11-04T00:00:00.000000Z', editSpec: spec,
    client: { verifiedDomain: 'example.com', name: 'Example', id: 'c' }, contentHash: 'a'.repeat(64), versionId: 'v', jobId: 'j' }

  it('serialises keys in the contract’s canonical order regardless of input order', () => {
    expect(Object.keys(JSON.parse(handoffBody(input)))).toEqual(['jobId', 'versionId', 'contentHash', 'client', 'editSpec', 'approvedAt', 'receiptUrl'])
    expect(Object.keys(JSON.parse(handoffBody(input)).client)).toEqual(['id', 'name', 'verifiedDomain'])
  })

  it('signs v1=HMAC-SHA256(secret, timestamp + "." + body)', () => {
    const body = handoffBody(input)
    const expected = createHmac('sha256', secret).update(`1793800000.${body}`).digest('hex')
    expect(handoffSignature(secret, 1793800000, body)).toBe(`v1=${expected}`)
    expect(handoffSignature(secret, 1793800001, body)).not.toBe(`v1=${expected}`)
  })
})

describe('outcomes', () => {
  it('maps 2xx to sent, 4xx/5xx to failed, and anything else to unknown', () => {
    expect(outcomeFor(202, 'R-1')).toEqual({ kind: 'sent', status: 202, ref: 'R-1' })
    expect(outcomeFor(409, null)).toEqual({ kind: 'failed', status: 409 })
    expect(outcomeFor(503, null)).toEqual({ kind: 'failed', status: 503 })
    expect(outcomeFor(302, null)).toEqual({ kind: 'unknown' })
  })

  it('keeps only a short, printable executor reference', () => {
    expect(executorRef({ reference: ' R-1 ' })).toBe('R-1')
    expect(executorRef({ jobReference: 'R-2' })).toBe('R-2')
    for (const bad of [null, 'R', { reference: '' }, { reference: 'x'.repeat(201) }, { reference: 'a\nb' }, { reference: 7 }]) expect(executorRef(bad)).toBeNull()
  })
})

describe('derived state', () => {
  const now = new Date('2026-11-04T12:00:00.000Z')
  const ev = (seq: number, kind: HandoffEvent['kind'], ageMs = 0): HandoffEvent => ({ seq, kind, at: new Date(now.getTime() - ageMs).toISOString(), executorStatus: null, executorRef: null })

  it('takes the newest event, and reads a claim with no outcome as sending until it goes stale', () => {
    expect(handoffState([], now)).toBe('none')
    expect(handoffState([ev(1, 'claim')], now)).toBe('sending')
    expect(handoffState([ev(1, 'claim', HANDOFF_STALE_MS + 1)], now)).toBe('unknown')
    expect(handoffState([ev(2, 'failed'), ev(1, 'claim')], now)).toBe('failed')
    expect(handoffState([ev(1, 'claim'), ev(2, 'unknown'), ev(3, 'claim'), ev(4, 'sent')], now)).toBe('sent')
  })
})
