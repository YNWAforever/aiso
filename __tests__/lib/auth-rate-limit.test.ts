import { expect, it } from 'vitest'
import { AuthRateLimitError, authRateLimitResponse, authRetryAfter } from '@/lib/auth-rate-limit'

it.each(['Retry-After', 'X-Retry-After'])('reads trusted Auth %s seconds without changing the policy', key => {
  expect(authRetryAfter(new Headers({ [key]: '9' }))).toBe(9)
  expect(authRetryAfter(new Headers({ [key]: '0' }))).toBe(1)
})
it('supports an HTTP date without guessing when no valid wait was supplied', () => {
  const now = Date.parse('2026-10-17T12:00:00Z')
  expect(authRetryAfter(new Headers({ 'Retry-After': 'Sat, 17 Oct 2026 12:00:09 GMT' }), now)).toBe(9)
  for (const value of ['', '-1', 'Infinity', '1e3', '0.5', 'tomorrow', '86401', '9007199254740993']) {
    expect(authRetryAfter(new Headers({ 'Retry-After': value }), now)).toBeNull()
  }
  expect(authRetryAfter(new Headers())).toBeNull()
})
it('only maps the typed Auth error and never echoes upstream details', async () => {
  expect(authRateLimitResponse({ status: 429, message: 'PRIVATE provider failure' })).toBeNull()
  const response = authRateLimitResponse(new AuthRateLimitError(null))!
  expect(response.status).toBe(429)
  expect(response.headers.has('Retry-After')).toBe(false)
  expect(await response.json()).toEqual({ error: 'AUTH_RATE_LIMITED', retryAfterSeconds: null })
})
