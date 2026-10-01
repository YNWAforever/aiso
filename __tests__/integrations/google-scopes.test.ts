import { describe, expect, it } from 'vitest'
import {
  ANALYTICS_SCOPE, SEARCH_CONSOLE_SCOPE, hasScope, scopesFor,
} from '@/lib/integrations/google/scopes'
import { SEARCH_CONSOLE_SCOPE as REEXPORTED, buildConsentUrl } from '@/lib/integrations/google/oauth'

const cfg = { clientId: 'cid', clientSecret: 'secret', redirectUri: 'https://app.test/api/integrations/google/callback' }
const base = { state: 'state-value', challenge: 'challenge-value' }

describe('scope constants and helpers', () => {
  it('pins the two scope strings', () => {
    expect(ANALYTICS_SCOPE).toBe('https://www.googleapis.com/auth/analytics.readonly')
    expect(SEARCH_CONSOLE_SCOPE).toBe('https://www.googleapis.com/auth/webmasters.readonly')
  })

  it('keeps SEARCH_CONSOLE_SCOPE importable from oauth.ts', () => {
    expect(REEXPORTED).toBe(SEARCH_CONSOLE_SCOPE)
  })

  it('scopesFor returns Search Console alone, or Search Console plus Analytics', () => {
    expect(scopesFor('search_console')).toEqual([SEARCH_CONSOLE_SCOPE])
    expect(scopesFor('analytics')).toEqual([SEARCH_CONSOLE_SCOPE, ANALYTICS_SCOPE])
  })

  it('hasScope is an exact string match, not a prefix match', () => {
    expect(hasScope(['openid', ANALYTICS_SCOPE], ANALYTICS_SCOPE)).toBe(true)
    expect(hasScope(['openid', SEARCH_CONSOLE_SCOPE], ANALYTICS_SCOPE)).toBe(false)
    expect(hasScope([`${ANALYTICS_SCOPE}.edit`], ANALYTICS_SCOPE)).toBe(false)
    expect(hasScope([ANALYTICS_SCOPE], `${ANALYTICS_SCOPE}.edit`)).toBe(false)
    expect(hasScope([], ANALYTICS_SCOPE)).toBe(false)
  })
})

describe('buildConsentUrl with scopes', () => {
  it('sends openid, email and exactly the requested scopes', () => {
    const one = new URL(buildConsentUrl(cfg, { ...base, scopes: [SEARCH_CONSOLE_SCOPE] }))
    expect(one.searchParams.get('scope')).toBe(`openid email ${SEARCH_CONSOLE_SCOPE}`)
    const two = new URL(buildConsentUrl(cfg, { ...base, scopes: scopesFor('analytics') }))
    expect(two.searchParams.get('scope')).toBe(`openid email ${SEARCH_CONSOLE_SCOPE} ${ANALYTICS_SCOPE}`)
  })

  it('keeps earlier grants so a Search Console reconnect cannot drop Analytics', () => {
    const url = new URL(buildConsentUrl(cfg, { ...base, scopes: scopesFor('search_console') }))
    expect(url.searchParams.get('include_granted_scopes')).toBe('true')
  })

  it('still forces offline access and consent', () => {
    const url = new URL(buildConsentUrl(cfg, { ...base, scopes: [SEARCH_CONSOLE_SCOPE] }))
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('prompt')).toBe('consent')
  })

  it('adds login_hint only when given', () => {
    const without = new URL(buildConsentUrl(cfg, { ...base, scopes: [SEARCH_CONSOLE_SCOPE] }))
    expect(without.searchParams.has('login_hint')).toBe(false)
    const withHint = new URL(buildConsentUrl(cfg, { ...base, scopes: [SEARCH_CONSOLE_SCOPE], loginHint: 'a@b.test' }))
    expect(withHint.searchParams.get('login_hint')).toBe('a@b.test')
  })
})
