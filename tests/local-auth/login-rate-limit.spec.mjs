import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import { allowLocalUrl, evidenceMode, redactLocalAuth } from '../../scripts/ci/local-auth-safety.mjs'
import { config, messages, control, get, shot } from './support.mjs'

if (config.scenario !== 'login-rate-limit') throw new Error('LOCAL_AUTH_LOGIN_RATE_TARGET')
const label = 'LOCAL REAL AUTH + POSTGRES | SYNTHETIC EMAIL | NO EXTERNAL MAIL | NOT MANAGED NEON UAT'

for (const lang of ['en', 'zh-HK']) {
  test(`${lang} magic-link throttling keeps email and waits for a manual resend`, async ({ page, context, request }, testInfo) => {
    const prefix = `${testInfo.project.name}-${lang}`
    const email = `login-${prefix.toLowerCase()}-${config.runId}@fixture-aiso.example`
    const copy = messages[lang].authRateLimit
    const endpoint = '/api/auth/sign-in/magic-link'
    const next = `/${lang}/onboarding`
    const audit = { mode: evidenceMode, scenario: config.scenario, project: testInfo.project.name, lang,
      magicRequests: 0, scannerRequests: 0, blockedExternal: 0, completed: false }
    await context.route('**/*', async route => {
      try { allowLocalUrl(route.request().url(), config.allowedOrigins) }
      catch { audit.blockedExternal++; await route.abort('blockedbyclient'); return }
      const url = new URL(route.request().url())
      if (url.pathname === endpoint && route.request().method() === 'POST') audit.magicRequests++
      if (url.pathname === '/api/scan' && route.request().method() === 'POST') {
        audit.scannerRequests++; await route.abort('blockedbyclient'); return
      }
      await route.continue()
    })
    try {
      await page.goto(`/${lang}/auth/login?next=${encodeURIComponent(next)}`)
      await page.locator('#login-email').fill(email)
      // The real unchanged magic-link rule is 5 requests / 60 seconds.
      // Warm-up messages go only to the disposable local fixture mailbox.
      audit.warmup = await page.evaluate(async ({ endpoint, email, next, lang }) => {
        for (let count = 1; count <= 6; count++) {
          const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: `warm-${email}`, callbackURL: `${location.origin}/${lang}/auth/complete?next=${encodeURIComponent(next)}` }) })
          await response.arrayBuffer()
          if (response.status === 429) return { requests: count, status: 429 }
          if (response.status !== 200) return { requests: count, status: response.status }
        }
        return { requests: 6, status: 'not-limited' }
      }, { endpoint, email, next, lang })
      expect(audit.warmup.status).toBe(429)
      const baseline = audit.magicRequests
      const form = page.locator('form').filter({ has: page.locator('#login-email') })
      const denied = page.waitForResponse(response => response.request().method() === 'POST' &&
        new URL(response.url()).pathname === endpoint)
      await form.getByRole('button').click()
      const limited = await denied
      audit.throttle = { status: limited.status(), retryAfter: limited.headers()['retry-after'], body: await limited.json() }
      await shot(page, `${prefix}-01-throttled.png`, label)
      expect(audit.throttle.status).toBe(429)
      const seconds = Number(audit.throttle.retryAfter)
      expect(Number.isInteger(seconds) && seconds >= 1 && seconds <= 60).toBe(true)
      expect(audit.throttle.body).toEqual({ error: 'AUTH_RATE_LIMITED', retryAfterSeconds: seconds })
      await expect(page.getByRole('alert').filter({ hasText: copy.magicLinkMessage })).toBeVisible()
      await expect(page.locator('#login-email')).toHaveValue(email)
      await expect(form.getByRole('button')).toBeDisabled()
      expect(await control(request, '/__local/mailbox', { email })).toEqual({ pending: true })
      audit.afterDenied = audit.magicRequests
      expect(audit.afterDenied).toBe(baseline + 1)
      await form.dispatchEvent('submit')
      await expect(page.getByText(copy.magicLinkReady, { exact: true })).toBeVisible({ timeout: 65000 })
      expect(audit.magicRequests).toBe(audit.afterDenied)
      await expect(page.locator('#login-email')).toHaveValue(email)
      await shot(page, `${prefix}-02-ready.png`, label)

      const sent = page.waitForResponse(response => response.request().method() === 'POST' &&
        new URL(response.url()).pathname === endpoint)
      await form.getByRole('button').click()
      expect((await sent).status()).toBe(200)
      expect(audit.magicRequests).toBe(audit.afterDenied + 1)
      await expect(page.getByRole('status').filter({ hasText: lang === 'en' ? 'Check your email' : '請查看你的電郵' })).toContainText(email)
      await shot(page, `${prefix}-03-sent.png`, label)
      let link
      await expect.poll(async () => {
        const mail = await control(request, '/__local/mailbox', { email })
        link = mail.link
        return Boolean(link)
      }).toBe(true)
      allowLocalUrl(link, [config.authOrigin])
      await page.goto(link)
      await page.waitForURL(url => url.pathname === next)
      await page.reload()
      await page.waitForURL(url => url.pathname === next)
      const session = await get(page, '/api/auth/get-session?disableCookieCache=true&disableRefresh=true')
      expect(session.status).toBe(200)
      expect(session.body.user.email).toBe(email)
      const url = new URL(page.url())
      expect(url.searchParams.has('token') || url.searchParams.has('neon_auth_session_verifier')).toBe(false)
      audit.userId = session.body.user.id
      audit.landing = url.pathname
      audit.emailPreserved = true
      audit.manualResendOnly = true
      audit.reloaded = true
      audit.completed = true
      await shot(page, `${prefix}-04-signed-in-reload.png`, label)
      expect(audit.blockedExternal).toBe(0)
      expect(audit.scannerRequests).toBe(0)
    } catch (error) {
      throw new Error(redactLocalAuth(error.message, [config.controlSecret, config.ownerPassword,
        config.appPassword, config.authPassword, config.engineSecret, config.cookieSecret]))
    } finally {
      writeFileSync(join(config.output, `${prefix}-LOGIN-RATE-LIMIT.json`), JSON.stringify(audit, null, 2))
    }
  })
}
