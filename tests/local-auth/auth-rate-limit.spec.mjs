import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import { allowLocalUrl, evidenceMode, redactLocalAuth } from '../../scripts/ci/local-auth-safety.mjs'
import { config, messages, control, login, get, shot } from './support.mjs'

if (config.scenario !== 'auth-rate-limit') throw new Error('LOCAL_AUTH_RATE_LIMIT_TARGET')

for (const lang of ['en', 'zh-HK']) {
  test(`${lang} Auth throttle preserves draft input and permits only a manual retry`, async ({ page, context, request }, testInfo) => {
    const prefix = `${testInfo.project.name}-${lang}`
    const email = `${prefix.toLowerCase()}-${config.runId}@fixture-aiso.example`
    const copy = messages[lang]
    const audit = { mode: evidenceMode, lang, project: testInfo.project.name, scannerRequests: 0,
      blockedExternal: 0, patchRequests: 0, completed: false }
    await context.route('**/*', async route => {
      try { allowLocalUrl(route.request().url(), config.allowedOrigins) }
      catch { audit.blockedExternal++; await route.abort('blockedbyclient'); return }
      const url = new URL(route.request().url())
      if (url.pathname === '/api/scan' && route.request().method() === 'POST') {
        audit.scannerRequests++; await route.abort('blockedbyclient'); return
      }
      if (url.pathname.includes('/work-items/') && route.request().method() === 'PATCH') audit.patchRequests++
      await route.continue()
    })
    try {
      await login(page, request, lang, email, `/${lang}/onboarding`)
      const created = await get(page, '/api/onboarding/complete', 'POST', {
        brandName: `SYNTHETIC Auth throttle ${lang}`, domain: 'fixture-aiso.example', market: null,
        intentKey: crypto.randomUUID(),
      })
      expect(created.status).toBe(200)
      const fixture = await control(request, '/__local/fixture', { email, clientId: created.body.clientId })
      audit.fixture = fixture
      await page.goto(`/${lang}/dashboard/${fixture.clientId}?step=results&scanId=${fixture.scanId}`)
      const insert = page.waitForResponse(response => response.request().method() === 'POST' &&
        new URL(response.url()).pathname === `/api/clients/${fixture.clientId}/work-items`)
      await page.getByTestId('result-priority').getByRole('button', { name: copy.resultSummary.createDraft, exact: true }).click()
      const inserted = await insert
      expect(inserted.status()).toBe(201)
      const item = (await inserted.json()).item
      const endpoint = `/api/clients/${fixture.clientId}/work-items/${item.id}`
      const notes = `SYNTHETIC unsaved 輸入 ${lang} ${config.runId}`
      await page.getByLabel(copy.opportunities.notes, { exact: true }).fill(notes)
      const before = await control(request, '/__local/persisted', { id: item.id })
      expect(before.rows[0].revision).toBe(1)
      audit.before = { revision: 1, notes: before.rows[0].notes }

      // Exercise the actual unchanged limiter, rather than mock an API 429,
      // lower its limit, alter the client identity, or retry a failed write.
      audit.burst = await page.evaluate(async () => {
        for (let count = 1; count <= 101; count++) {
          const response = await fetch('/api/auth/get-session?disableCookieCache=true&disableRefresh=true', { cache: 'no-store' })
          await response.arrayBuffer()
          if (response.status === 429) return { requests: count, status: 429 }
          if (response.status !== 200) return { requests: count, status: response.status }
        }
        return { requests: 101, status: 'not-limited' }
      })
      expect(audit.burst.status).toBe(429)
      const denied = page.waitForResponse(response => response.request().method() === 'PATCH' &&
        new URL(response.url()).pathname === endpoint)
      await page.getByRole('button', { name: copy.opportunities.saveChanges, exact: true }).click()
      const limited = await denied
      audit.throttle = { status: limited.status(), retryAfter: limited.headers()['retry-after'], body: await limited.json() }
      await shot(page, `${prefix}-01-throttled.png`)
      expect(audit.throttle.status).toBe(429)
      expect(audit.throttle.body.error).toBe('AUTH_RATE_LIMITED')
      const seconds = Number(audit.throttle.retryAfter)
      expect(Number.isInteger(seconds) && seconds >= 1 && seconds <= 10).toBe(true)
      expect(audit.throttle.body.retryAfterSeconds).toBe(seconds)
      await expect(page.getByRole('alert').filter({ hasText: copy.authRateLimit.message })).toBeVisible()
      await expect(page.getByRole('button', { name: copy.opportunities.saveChanges, exact: true })).toBeDisabled()
      await expect(page.getByLabel(copy.opportunities.notes, { exact: true })).toHaveValue(notes)
      await expect(page.getByRole('status', { name: copy.opportunities.draftSaveStatus, exact: true })).toHaveText('')
      const rejectedState = await control(request, '/__local/persisted', { id: item.id })
      expect(rejectedState.rows[0]).toMatchObject({ revision: 1, notes: before.rows[0].notes })
      audit.patchCountAfterDenied = audit.patchRequests
      await page.locator('form').filter({ has: page.getByLabel(copy.opportunities.notes, { exact: true }) }).dispatchEvent('submit')
      expect(audit.patchRequests).toBe(audit.patchCountAfterDenied)
      await expect(page.getByText(copy.authRateLimit.ready, { exact: true })).toBeVisible()
      expect(audit.patchRequests).toBe(audit.patchCountAfterDenied)
      await shot(page, `${prefix}-02-manual-retry-ready.png`)

      const retry = page.waitForResponse(response => response.request().method() === 'PATCH' &&
        new URL(response.url()).pathname === endpoint)
      await page.getByRole('button', { name: copy.opportunities.saveChanges, exact: true }).click()
      expect((await retry).status()).toBe(200)
      expect(audit.patchRequests).toBe(audit.patchCountAfterDenied + 1)
      const saved = await control(request, '/__local/persisted', { id: item.id })
      expect(saved.rows[0]).toMatchObject({ id: item.id, account_id: fixture.accountId,
        client_id: fixture.clientId, source_id: fixture.scanId, notes, revision: 2 })
      expect(saved.sources).toHaveLength(1)
      expect(saved.sources[0]).toMatchObject({ account_id: fixture.accountId, client_id: fixture.clientId,
        work_item_id: item.id, source_id: fixture.scanId })
      audit.saved = { id: item.id, notes, revision: 2, accountId: fixture.accountId,
        clientId: fixture.clientId, scanId: fixture.scanId }
      await page.reload()
      await expect(page.getByLabel(copy.opportunities.notes, { exact: true })).toHaveValue(notes)
      await expect(page.getByText(copy.authRateLimit.message, { exact: true })).toHaveCount(0)
      const draftPath = `/${lang}/dashboard/${fixture.clientId}?step=improve&scanId=${fixture.scanId}&draft=${item.id}`
      await page.goto(`/${lang}/auth/logout`)
      await page.waitForURL(`**/${lang}/auth/login`)
      await login(page, request, lang, email, draftPath)
      await expect(page.getByLabel(copy.opportunities.notes, { exact: true })).toHaveValue(notes)
      const readback = await get(page, endpoint)
      expect(readback.status).toBe(200)
      expect(readback.body.item).toMatchObject({ id: item.id, clientId: fixture.clientId, notes, revision: 2 })
      await page.getByLabel(copy.opportunities.notes, { exact: true }).evaluate(element => element.scrollIntoView({ block: 'center' }))
      await shot(page, `${prefix}-03-restored.png`)
      audit.restored = true
      audit.completed = true
      expect(audit.scannerRequests).toBe(0)
      expect(audit.blockedExternal).toBe(0)
    } catch (error) {
      throw new Error(redactLocalAuth(error.message, [config.controlSecret, config.ownerPassword,
        config.appPassword, config.authPassword, config.engineSecret, config.cookieSecret]))
    } finally {
      writeFileSync(join(config.output, `${prefix}-AUTH-RATE-LIMIT.json`), JSON.stringify(audit, null, 2))
    }
  })
}
