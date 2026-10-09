import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { resolveClientIdentity } from '@/lib/security/durable-rate-limit'

const production = { nodeEnv: 'production', vercel: '1', secret: 'x'.repeat(32) }
const identityOf = (address: string) => resolveClientIdentity(
  new NextRequest('https://app.example/api/scan', { headers: { 'x-vercel-forwarded-for': address } }),
  production,
)

describe('rate-limit identity', () => {
  // A single IPv6 subscriber is routinely handed a whole /64, so keying on the
  // full address let anyone rotate through addresses for an unlimited
  // allowance on the anonymous scan, claim-intent and funnel limiters.
  it('gives every address in one IPv6 /64 the same identity', () => {
    expect(identityOf('2001:db8:1:2::1')).toBe(identityOf('2001:db8:1:2:ffff:ffff:ffff:fffe'))
    expect(identityOf('2001:db8:1:2::1')).toBe(identityOf('2001:0db8:0001:0002:0000:0000:0000:0009'))
  })

  it('keeps different /64s apart', () => {
    expect(identityOf('2001:db8:1:2::1')).not.toBe(identityOf('2001:db8:1:3::1'))
  })

  it('leaves IPv4 identities exactly as before, so existing counters carry over', () => {
    expect(identityOf('203.0.113.9')).toBe('ip:203.0.113.9')
  })

  it('treats an IPv4-mapped IPv6 address as the IPv4 address', () => {
    expect(identityOf('::ffff:203.0.113.9')).toBe('ip:203.0.113.9')
  })
})
