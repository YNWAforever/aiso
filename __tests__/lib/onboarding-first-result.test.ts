import { describe, expect, it } from 'vitest'
import { onboardingDestination, onboardingWebsiteUrl } from '@/lib/onboarding/first-result'

describe('onboarding website syntax and first-result destination', () => {
  it.each(['', 'text with spaces', 'localhost', 'https://localhost', 'http://127.0.0.1',
    'https://[::1]', 'javascript:alert(1)', 'ftp://example.com', 'https://person@example.com'])(
    'keeps an invalid or local input from enabling first-result setup: %s', value => {
      expect(onboardingWebsiteUrl(value)).toBeNull()
    },
  )
  it.each([
    [' example.com ', 'https://example.com/'],
    ['https://www.example.com/path', 'https://www.example.com/path'],
    ['https://香港.com', 'https://xn--j6w193g.com/'],
  ])('accepts a public website syntax without fetching it: %s', (value, expected) => {
    expect(onboardingWebsiteUrl(value)).toBe(expected)
  })
  it.each(['en', 'zh-HK'])('sends a saved website brand to its first scan in %s', lang => {
    const destination = onboardingDestination(lang, 'client-1', { domain: 'example.com', industry: 'education', region: 'TW' })
    const url = new URL(destination, 'https://fixture.invalid')
    expect(url.pathname).toBe(`/${lang}/dashboard/client-1`)
    expect(Object.fromEntries(url.searchParams)).toEqual({
      step: 'scan', url: 'https://example.com/', industry: 'education', region: 'TW',
    })
  })
  it('returns an existing associated scan instead of collecting another one', () => {
    expect(onboardingDestination('en', 'client-1', { scanId: 'scan-1', domain: 'example.com' }))
      .toBe('/en/dashboard/client-1/result/scan-1')
  })
  it('keeps no-website setup available without claiming a website result', () => {
    expect(onboardingDestination('zh-HK', 'client-1', {})).toBe('/zh-HK/dashboard/client-1/prompts')
    expect(onboardingDestination('en', 'client-1', { domain: 'not a domain' })).toBe('/en/dashboard/client-1/prompts')
  })
})
