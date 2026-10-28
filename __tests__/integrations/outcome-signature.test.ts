import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { signOutcomeBody, verifyOutcomeSignature } from '@/lib/outcome-integrations/signature'
import { sealToken, openToken } from '@/lib/integrations/google/vault'

describe('signed outcome events', () => {
  const secret = 'synthetic-signing-secret-'.repeat(3), timestamp = '1793016000', body = '{"events":[]}'
  it('signs exact UTF-8 bytes with a versioned timestamp', () => {
    expect(signOutcomeBody(secret, timestamp, body)).toBe('v1=' + createHmac('sha256', secret).update(timestamp + '.' + body).digest('hex'))
    expect(verifyOutcomeSignature(secret, timestamp, body, signOutcomeBody(secret, timestamp, body), 1793016000000)).toBe(true)
  })
  it('rejects stale/future timestamps, changed bytes and invalid signatures', () => {
    const signature = signOutcomeBody(secret, timestamp, body)
    for (const [time, payload, value, now] of [[timestamp, body + ' ', signature, 1793016000000], [timestamp, body, 'v1=aa', 1793016000000], [timestamp, body, signature, 1793016600000], ['1793016600', body, signature, 1793016000000]] as const) expect(verifyOutcomeSignature(secret, time, payload, value, now)).toBe(false)
  })
  it('purpose-binds new connector secrets without changing old Google-token envelopes', () => {
    const env = { GOOGLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString('base64') }
    const context = { accountId: 'account-a', purpose: 'outcome-key:synthetic' }
    const token = sealToken(secret, context, env)
    expect(openToken(token, context, env)).toBe(secret)
    expect(() => openToken(token, { ...context, accountId: 'account-b' }, env)).toThrow()
    expect(() => openToken(token, { ...context, purpose: 'webhook:synthetic' }, env)).toThrow()
    expect(() => openToken(token, { accountId: 'account-a' }, env)).toThrow()
    const legacy = sealToken('google-refresh', { accountId: 'account-a' }, env)
    expect(openToken(legacy, { accountId: 'account-a' }, env)).toBe('google-refresh')
  })
})
