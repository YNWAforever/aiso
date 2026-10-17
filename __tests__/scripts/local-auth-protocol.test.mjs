import { describe, it, expect } from 'vitest'
import { betterAuth } from 'better-auth'
import { createNeonAuth } from '@neondatabase/auth/next/server'
import { engineOptions } from '../../scripts/ci/local-auth-service.mjs'
import { fixtureResults } from '../../scripts/ci/local-auth-fixture.mjs'

describe('installed real Better Auth local protocol contracts (unit, memory store only)', () => {
  it('delivers a real magic link whose redirect preserves the nested selected scan and draft', async () => {
    const config = { authOrigin: 'https://127.0.0.1:44451', appOrigin: 'https://127.0.0.1:44452',
      engineSecret: 'local-unit-nested-callback-'.repeat(4) }
    const mailbox = new Map()
    const engine = betterAuth(engineOptions(config, undefined, mailbox, async () => {}))
    const next = '/zh-HK/dashboard/11111111-1111-4111-8111-111111111111?step=improve&scanId=22222222-2222-4222-8222-222222222222&draft=33333333-3333-4333-8333-333333333333'
    const callbackURL = `${config.appOrigin}/zh-HK/auth/complete?next=${encodeURIComponent(next)}`
    const response = await engine.handler(new Request(`${config.authOrigin}/api/auth/sign-in/magic-link`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: config.appOrigin },
      body: JSON.stringify({ email: 'nested@fixture-aiso.example', callbackURL }),
    }))
    expect(response.status).toBe(200)
    const verified = await engine.handler(new Request(mailbox.get('nested@fixture-aiso.example'), {
      headers: { Origin: config.authOrigin },
    }))
    expect(verified.status).toBe(302)
    expect(verified.headers.getSetCookie().some(value => value.startsWith('__Secure-neon-auth.session_token='))).toBe(true)
    const location = new URL(verified.headers.get('location'))
    expect(location.origin).toBe(config.appOrigin)
    expect(location.pathname).toBe('/zh-HK/auth/complete')
    expect(location.searchParams.get('next')).toBe(next)
    expect([...location.searchParams.keys()]).toEqual(['next'])
  })

  it('issues an engine-signed Neon-named cookie and revokes its real session through sign-out', async () => {
    const config = { authOrigin: 'https://127.0.0.1:44441', appOrigin: 'https://127.0.0.1:44442',
      engineSecret: 'local-unit-engine-secret-'.repeat(4) }
    const mailbox = new Map(), events = []
    const engine = betterAuth(engineOptions(config, undefined, mailbox, async user => { events.push(user.id) }))
    const callbackURL = `${config.appOrigin}/en/auth/complete?next=%2Fen`
    const email = 'protocol@fixture-aiso.example'
    const response = await engine.handler(new Request(`${config.authOrigin}/api/auth/sign-in/magic-link`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: config.appOrigin },
      body: JSON.stringify({ email, callbackURL }),
    }))
    expect(response.status).toBe(200)
    const link = mailbox.get(email)
    expect(typeof link).toBe('string')
    const verified = await engine.handler(new Request(link, { headers: { Origin: config.authOrigin } }))
    expect(verified.status).toBe(302)
    const cookie = verified.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
    expect(cookie.startsWith('__Secure-neon-auth.session_token=')).toBe(true)
    const session = await engine.handler(new Request(`${config.authOrigin}/api/auth/get-session?disableCookieCache=true&disableRefresh=true`, {
      headers: { Cookie: cookie, Origin: config.appOrigin },
    }))
    expect(session.status).toBe(200)
    const data = await session.json()
    expect(data.user.email).toBe(email)
    expect(data.session.userId).toBe(data.user.id)
    expect(data.user.id).toMatch(/^[a-f0-9-]{36}$/)
    expect(events).toEqual([data.user.id])
    const sdk = createNeonAuth({ baseUrl: `${config.authOrigin}/api/auth`,
      cookies: { secret: 'local-unit-sdk-cache-secret-'.repeat(4) } })
    const nativeFetch = globalThis.fetch
    let sdkData
    try {
      globalThis.fetch = async (input, init) => {
        const target = new URL(input instanceof Request ? input.url : String(input))
        if (target.origin !== config.authOrigin) throw new Error('UNIT_EXTERNAL_AUTH_DENIED')
        return engine.handler(new Request(input, init))
      }
      const proxied = await sdk.handler().GET(new Request(
        `${config.appOrigin}/api/auth/get-session?disableCookieCache=true&disableRefresh=true`,
        { headers: { Cookie: cookie, Origin: config.appOrigin } },
      ), { params: Promise.resolve({ path: ['get-session'] }) })
      expect(proxied.status).toBe(200)
      sdkData = await proxied.json()
    } finally { globalThis.fetch = nativeFetch }
    expect(sdkData.user.id).toBe(data.user.id)
    expect(sdkData.session.id).toBe(data.session.id)
    const logout = await engine.handler(new Request(`${config.authOrigin}/api/auth/sign-out`, {
      method: 'POST', headers: { Cookie: cookie, Origin: config.appOrigin },
    }))
    expect(logout.status).toBe(200)
    const oldSession = await engine.handler(new Request(`${config.authOrigin}/api/auth/get-session?disableCookieCache=true`, {
      headers: { Cookie: cookie, Origin: config.appOrigin },
    }))
    expect(await oldSession.json()).toBeNull()
  })

  it('builds explicitly labelled fixture evidence through the current application builders', async () => {
    const value = await fixtureResults(process.cwd())
    expect(value.results.localFixture.collectedExternally).toBe(false)
    expect(value.results.evidence.collection).toBe('complete')
    expect(Object.keys(value.results.evidence.checks)).toHaveLength(20)
    expect(value.results.evidence.checks.c1_robots.assessment).toBe('fail')
    expect(value.results.evidence.checks.c2_llms_txt.assessment).toBe('fail')
    expect(value.grade).toBe('B')
    const decoy = await fixtureResults(process.cwd(), { clear: true })
    expect(decoy.score).toBe(100)
    expect(value.score).toBeLessThan(decoy.score)
    expect(decoy.results.evidence.checks.c1_robots.assessment).toBe('pass')
  })
})
