import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import { allowLocalUrl, evidenceMode, redactLocalAuth } from '../../scripts/ci/local-auth-safety.mjs'
import { config, messages, control, login, get, shot } from './support.mjs'

if (config.scenario !== 'account-unlock-rate-limit') throw new Error('LOCAL_AUTH_ACCOUNT_UNLOCK_RATE_TARGET')
const label = 'LOCAL REAL AUTH + POSTGRES | SYNTHETIC SCAN + EMAIL | NO EXTERNAL MAIL | NOT MANAGED NEON UAT'

for (const lang of ['en', 'zh-HK']) {
  test(`${lang} result-page magic-link throttle keeps email and waits for manual resend`, async ({ page, context, request }, testInfo) => {
    const prefix = `${testInfo.project.name}-${lang}`
    const ownerEmail = `unlock-owner-${prefix.toLowerCase()}-${config.runId}@fixture-aiso.example`
    const targetEmail = ownerEmail
    const copy = messages[lang].authRateLimit
    const endpoint = '/api/auth/sign-in/magic-link'
    const audit = { mode: evidenceMode, scenario: config.scenario, project: testInfo.project.name, lang,
      magicRequests: 0, scannerRequests: 0, blockedExternal: 0, completed: false }
    await context.route('**/*', async route => {
      try { allowLocalUrl(route.request().url(), config.allowedOrigins) }
      catch { audit.blockedExternal++; await route.abort('blockedbyclient'); return }
      const url = new URL(route.request().url())
      if (audit.fixture && url.pathname === `/api/scans/${audit.fixture.scanId}/claim-intent`) {
        // Public claim-intent uses deployment-only rate limiting in this local
        // runner. Keep Auth real while deterministically expressing the
        // already-owned result outcome that the existing card handles.
        audit.claimIntentFixture = true
        await route.fulfill({ status: 409, contentType: 'application/json',
          body: JSON.stringify({ error: 'Scan already belongs to an account' }) })
        return
      }
      if (url.pathname === endpoint && route.request().method() === 'POST') audit.magicRequests++
      if (url.pathname === '/api/scan' && route.request().method() === 'POST') {
        audit.scannerRequests++; await route.abort('blockedbyclient'); return
      }
      await route.continue()
    })
    try {
      await login(page, request, lang, ownerEmail, `/${lang}/onboarding`)
      const created = await get(page, '/api/onboarding/complete', 'POST', {
        brandName: `SYNTHETIC result unlock ${lang}`, domain: 'fixture-aiso.example', market: null,
        intentKey: crypto.randomUUID(),
      })
      expect(created.status).toBe(200)
      const fixture = await control(request, '/__local/fixture', { email: ownerEmail, clientId: created.body.clientId })
      audit.fixture = fixture
      await page.goto(`/${lang}/auth/logout`)
      await page.waitForURL(`**/${lang}/auth/login`)
      await page.goto(`/${lang}/result/${fixture.scanId}`)
      const card = page.getByTestId('save-report-cta')
      await expect(card).toBeVisible()
      const form = card.locator('form')
      const email = form.getByLabel(lang === 'en' ? 'Work email' : '工作電郵', { exact: true })
      await email.fill(targetEmail)
      await expect(form.getByTestId('create-account')).toBeEnabled()
      audit.beforeWarmup = audit.magicRequests
      audit.warmup = await page.evaluate(async ({ endpoint, ownerEmail, lang }) => {
        for (let count = 1; count <= 6; count++) {
          const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: `warm-${count}-${ownerEmail}`,
              callbackURL: `${location.origin}/${lang}/auth/complete?next=${encodeURIComponent(`/${lang}/dashboard`)}` }) })
          await response.arrayBuffer()
          if (response.status === 429) return { requests: count, status: 429 }
          if (response.status !== 200) return { requests: count, status: response.status }
        }
        return { requests: 6, status: 'not-limited' }
      }, { endpoint, ownerEmail, lang })
      expect(audit.warmup.status).toBe(429)
      const baseline = audit.magicRequests
      const denied = page.waitForResponse(response => response.request().method() === 'POST' &&
        new URL(response.url()).pathname === endpoint)
      await form.getByTestId('create-account').click()
      const limited = await denied
      audit.throttle = { status: limited.status(), retryAfter: limited.headers()['retry-after'], body: await limited.json() }
      await shot(page, `${prefix}-01-throttled.png`, label)
      expect(audit.throttle.status).toBe(429)
      const seconds = Number(audit.throttle.retryAfter)
      expect(Number.isInteger(seconds) && seconds >= 1 && seconds <= 60).toBe(true)
      await expect(card.getByRole('alert').filter({ hasText: copy.magicLinkMessage })).toBeVisible()
      await expect(email).toHaveValue(targetEmail)
      await expect(form.getByTestId('create-account')).toBeDisabled()
      audit.afterDenied = audit.magicRequests
      expect(audit.afterDenied).toBe(baseline + 1)
      await form.dispatchEvent('submit')
      await expect(card.getByText(copy.magicLinkReady, { exact: true })).toBeVisible({ timeout: 65000 })
      expect(audit.magicRequests).toBe(audit.afterDenied)
      await expect(email).toHaveValue(targetEmail)
      await shot(page, `${prefix}-02-ready.png`, label)

      const sent = page.waitForResponse(response => response.request().method() === 'POST' &&
        new URL(response.url()).pathname === endpoint)
      await form.getByTestId('create-account').click()
      expect((await sent).status()).toBe(200)
      expect(audit.magicRequests).toBe(audit.afterDenied + 1)
      await shot(page, `${prefix}-03-sent.png`, label)
      let link
      await expect.poll(async () => {
        const mail = await control(request, '/__local/mailbox', { email: targetEmail })
        link = mail.link
        return Boolean(link)
      }).toBe(true)
      allowLocalUrl(link, [config.authOrigin])
      await page.goto(link)
      await page.waitForURL(url => url.pathname === `/${lang}/result/${fixture.scanId}`)
      await expect(page.getByTestId('full-check-breakdown')).toBeVisible()
      await expect(page.getByTestId('save-report-cta')).toHaveCount(0)
      await page.reload()
      await expect(page.getByTestId('full-check-breakdown')).toBeVisible()
      const session = await get(page, '/api/auth/get-session?disableCookieCache=true&disableRefresh=true')
      expect(session.status).toBe(200)
      expect(session.body.user.email).toBe(targetEmail)
      expect(session.body.user.id).toBe(fixture.userId)
      const restoredUrl = new URL(page.url())
      expect(restoredUrl.searchParams.has('token') || restoredUrl.searchParams.has('neon_auth_session_verifier')).toBe(false)
      audit.userId = session.body.user.id
      audit.emailPreserved = true
      audit.manualResendOnly = true
      audit.reloaded = true
      audit.completed = true
      await shot(page, `${prefix}-04-owned-result-reload.png`, label)
      expect(audit.blockedExternal).toBe(0)
      expect(audit.scannerRequests).toBe(0)
    } catch (error) {
      throw new Error(redactLocalAuth(error.message, [config.controlSecret, config.ownerPassword,
        config.appPassword, config.authPassword, config.engineSecret, config.cookieSecret]))
    } finally {
      writeFileSync(join(config.output, `${prefix}-ACCOUNT-UNLOCK-RATE-LIMIT.json`), JSON.stringify(audit, null, 2))
    }
  })
}
