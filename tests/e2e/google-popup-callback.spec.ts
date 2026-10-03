import { test, expect } from '@playwright/test'

// Real proxy + installed SDK handshake; only the provider/session responses
// and final protected document are synthetic. This is not human-role UAT.
for (const lang of ['en', 'zh-HK']) for (const challenge of [false, true]) {
  test(`embedded Google popup completes in ${lang} (challenge=${challenge})`, async ({ page, context, baseURL }) => {
    test.setTimeout(25_000)
    const origin = new URL(baseURL!).origin
    const next = `/${lang}/dashboard`
    const verifier = 'synthetic-popup-verifier'
    let verifierExchanges = 0
    let openerHandoff = false
    let requestedCallback: URL | undefined
    if (challenge) await context.addCookies([{ name: '__Secure-neon-auth.session_challange', value: 'synthetic-challenge', domain: new URL(origin).hostname, path: '/', secure: true }])
    await context.route('**/api/auth/sign-in/social*', async route => {
      const body = route.request().postDataJSON()
      expect(body.provider).toBe('google')
      expect(body.disableRedirect).toBe(true)
      requestedCallback = new URL(body.callbackURL)
      expect(requestedCallback.pathname).toBe('/auth/callback')
      const callback = new URL(String(requestedCallback))
      callback.searchParams.set('neon_auth_session_verifier', verifier)
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ url: callback.href, redirect: false }) })
    })
    await context.route('**/api/auth/get-session*', async route => {
      if (new URL(route.request().url()).searchParams.get('neon_auth_session_verifier') === verifier) verifierExchanges++
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({
        session: { id: 'synthetic-session', token: 'synthetic-only', userId: 'synthetic-user', expiresAt: '2030-01-01T00:00:00.000Z', createdAt: '2026-10-03T00:00:00.000Z', updatedAt: '2026-10-03T00:00:00.000Z' },
        user: { id: 'synthetic-user', name: 'Synthetic callback test', email: 'callback@example.test', emailVerified: true, createdAt: '2026-10-03T00:00:00.000Z', updatedAt: '2026-10-03T00:00:00.000Z' },
      }) })
    })
    await context.route(`**/${lang}/dashboard*`, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><h1>Returned test destination</h1></body></html>' }))
    // The ordinary challenge exchange runs server-side. Stop those cases at
    // the actual opener document handoff; browser routes cannot mock it.
    if (challenge) await context.route(`**/${lang}/auth/complete*`, async route => {
      const url = new URL(route.request().url())
      expect(url.searchParams.get('neon_auth_session_verifier')).toBe(verifier)
      expect(url.searchParams.get('next')).toBe(next)
      openerHandoff = true
      await route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><h1>Opener callback received</h1></body></html>' })
    })
    await context.route('**/__popup-test-host', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body><iframe title="Embedded app" src="${origin}/${lang}/auth/login?next=${encodeURIComponent(next)}"></iframe></body></html>` }))
    await page.goto(`${origin}/__popup-test-host`)
    const frame = page.frameLocator('iframe')
    const popupPromise = page.waitForEvent('popup')
    await frame.getByRole('button', { name: lang === 'en' ? 'Continue with Google' : '使用 Google 繼續' }).click()
    const popup = await popupPromise
    await expect.poll(() => popup.isClosed(), { timeout: 10_000 }).toBe(true)
    if (challenge) {
      await expect.poll(() => openerHandoff).toBe(true)
      await expect(frame.getByRole('heading', { name: 'Opener callback received' })).toBeVisible()
    } else {
      await expect.poll(() => verifierExchanges).toBe(1)
      await expect(frame.getByRole('heading', { name: 'Returned test destination' })).toBeVisible()
    }
    const original = new URL(requestedCallback!.searchParams.get('neon_popup_callback')!)
    expect(original.pathname).toBe(`/${lang}/auth/complete`)
    expect(original.searchParams.get('next')).toBe(next)
    const appFrame = page.frames().find(candidate => candidate.parentFrame())!
    expect(new URL(appFrame.url()).pathname).toBe(challenge ? "/" + lang + "/auth/complete" : next)
    if (!challenge) expect(new URL(appFrame.url()).searchParams.has('neon_auth_session_verifier')).toBe(false)
  })
}