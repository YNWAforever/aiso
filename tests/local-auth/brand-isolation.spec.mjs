import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import { allowLocalUrl, evidenceMode, redactLocalAuth } from '../../scripts/ci/local-auth-safety.mjs'
import { config, messages, control, login, get, shot } from './support.mjs'

if (config.scenario !== 'brand-isolation') throw new Error('LOCAL_AUTH_MULTI_BRAND_TARGET')

for (const lang of ['en', 'zh-HK']) {
  test(`${lang} same-account brands isolate results sources and persisted drafts`, async ({ page, context, request }, testInfo) => {
    const project = testInfo.project.name, prefix = `${project}-${lang}`
    const email = `${project.endsWith('mobile') ? 'mobile' : 'desktop'}-${lang.toLowerCase()}-${config.runId}@fixture-aiso.example`
    const copy = messages[lang], audit = { mode: evidenceMode, scenario: config.scenario, lang, project,
      scannerRequests: 0, blockedExternal: 0, controls: {}, brands: [], completed: false }
    await context.route('**/*', async route => {
      try { allowLocalUrl(route.request().url(), config.allowedOrigins) }
      catch { audit.blockedExternal++; await route.abort('blockedbyclient'); return }
      if (new URL(route.request().url()).pathname === '/api/scan' && route.request().method() === 'POST') {
        audit.scannerRequests++
        await route.abort('blockedbyclient'); return
      }
      await route.continue()
    })
    const payload = (fixture, locale) => ({ source: { kind: 'scan-check', id: fixture.scanId, checkKey: 'c1_robots' },
      ruleVersion: 'scan-check-gap.v1', fingerprint: fixture.fingerprint, locale })
    const resultPath = brand => `/${lang}/dashboard/${brand.clientId}?step=results&scanId=${brand.scanId}`
    const draftPath = brand => `/${lang}/dashboard/${brand.clientId}?step=improve&scanId=${brand.scanId}&draft=${brand.item.id}`
    try {
      await login(page, request, lang, email, `/${lang}/onboarding`)
      const plan = await control(request, '/__local/multi-brand-account', { email })
      expect(plan).toMatchObject({ plan: 'pro', status: 'active', fixtureOnly: true,
        checkoutCalled: false, subscriptionConfigured: false })
      audit.planFixture = plan
      for (const name of ['A', 'B']) {
        const brandName = `SYNTHETIC SameAccount ${name} ${lang} ${project}`
        const created = await get(page, '/api/onboarding/complete', 'POST', {
          brandName, domain: 'fixture-aiso.example', market: null, intentKey: crypto.randomUUID(),
        })
        expect(created.status).toBe(200)
        expect(created.body.progress).toMatchObject({ brand: 'ready', prompts: 'pending', promptCount: 0 })
        const fixture = await control(request, '/__local/fixture', { email, clientId: created.body.clientId })
        expect(fixture.accountId).toBe(plan.accountId)
        expect(fixture.clientId).toBe(created.body.clientId)
        const before = await control(request, '/__local/brand', { email, clientId: fixture.clientId })
        expect(before.brand).toMatchObject({ id: fixture.clientId, account_id: plan.accountId,
          brand_name: brandName, domain: 'fixture-aiso.example' })
        await page.goto(resultPath(fixture))
        const first = page.getByTestId('result-priority')
        await expect(first).toContainText(brandName)
        const create = page.waitForResponse(response => response.request().method() === 'POST' &&
          new URL(response.url()).pathname === `/api/clients/${fixture.clientId}/work-items`)
        await first.getByRole('button', { name: copy.resultSummary.createDraft, exact: true }).click()
        const response = await create
        expect(response.status()).toBe(201)
        const body = response.request().postDataJSON()
        expect(body.source).toEqual({ kind: 'scan-check', id: fixture.scanId, checkKey: 'c1_robots' })
        expect(body.ruleVersion).toBe('scan-check-gap.v1')
        expect(body.locale).toBe(lang)
        const item = (await response.json()).item
        expect(item.clientId).toBe(fixture.clientId)
        expect(item.evidenceSnapshot.source).toEqual(body.source)
        const title = `SYNTHETIC saved ${name} ${lang} ${project}`
        const action = `SYNTHETIC ${name} manual review. Never applied or published.`
        const notes = `SYNTHETIC private note for brand ${name} in run ${config.runId}`
        await page.getByLabel(copy.opportunities.titleField, { exact: true }).fill(title)
        await page.getByLabel(copy.opportunities.action, { exact: true }).fill(action)
        await page.getByLabel(copy.opportunities.notes, { exact: true }).fill(notes)
        const saved = page.waitForResponse(r => r.request().method() === 'PATCH' &&
          new URL(r.url()).pathname === `/api/clients/${fixture.clientId}/work-items/${item.id}`)
        await page.getByRole('button', { name: copy.opportunities.saveChanges, exact: true }).click()
        expect((await saved).status()).toBe(200)
        await page.reload()
        await expect(page.getByLabel(copy.opportunities.titleField, { exact: true })).toHaveValue(title)
        const persisted = await control(request, '/__local/persisted', { id: item.id })
        expect(persisted.rows).toHaveLength(1)
        expect(persisted.sources).toHaveLength(1)
        expect(persisted.rows[0]).toMatchObject({ account_id: plan.accountId, client_id: fixture.clientId,
          id: item.id, title, action, notes, revision: 2, source_id: fixture.scanId })
        expect(persisted.sources[0]).toMatchObject({ account_id: plan.accountId, client_id: fixture.clientId,
          work_item_id: item.id, source_id: fixture.scanId, evidence_fingerprint: body.fingerprint })
        audit.brands.push({ ...fixture, fingerprint: body.fingerprint, item: { id: item.id, title, action, notes,
          revision: 2, evidenceSnapshot: item.evidenceSnapshot } })
      }
      const [a, b] = audit.brands
      expect(a.clientId).not.toBe(b.clientId)
      expect(a.scanId).not.toBe(b.scanId)
      expect(a.item.id).not.toBe(b.item.id)
      expect(a.accountId).toBe(b.accountId)
      const account = await control(request, '/__local/brand', { email, clientId: a.clientId })
      expect(account.clientCount).toBe(2)
      expect(account.promptCount).toBe(0)
      for (const [own, other] of [[a, b], [b, a]]) {
        const ownRead = await get(page, `/api/clients/${own.clientId}/work-items/${own.item.id}`)
        expect(ownRead.status).toBe(200)
        expect(ownRead.body.item).toMatchObject({ ...own.item, clientId: own.clientId })
        const crossRead = await get(page, `/api/clients/${own.clientId}/work-items/${other.item.id}`)
        expect(crossRead).toEqual({ status: 404, body: { error: 'WORK_ITEM_NOT_FOUND' } })
        const crossWrite = await get(page, `/api/clients/${own.clientId}/work-items/${other.item.id}`, 'PATCH', {
          title: 'SYNTHETIC cross-brand overwrite must fail', action: 'Denied', notes: '', expectedRevision: 2,
        })
        expect(crossWrite).toEqual({ status: 404, body: { error: 'WORK_ITEM_NOT_FOUND' } })
        const mixedSource = await get(page, `/api/clients/${own.clientId}/work-items`, 'POST', payload(other, lang))
        expect(mixedSource).toEqual({ status: 409, body: { error: 'EVIDENCE_CHANGED' } })
        const ownList = await get(page, `/api/clients/${own.clientId}/work-items`)
        expect(ownList.status).toBe(200)
        expect(ownList.body.items.map(row => row.id)).toEqual([own.item.id])
        const opportunities = await get(page, `/api/clients/${own.clientId}/opportunities?scanId=${other.scanId}`)
        expect(opportunities.status).toBe(200)
        expect(opportunities.body.suggestions).toEqual([])
        expect(opportunities.body.window.scanId).toBeNull()
        const unchanged = await get(page, `/api/clients/${other.clientId}/work-items/${other.item.id}`)
        expect(unchanged.status).toBe(200)
        expect(unchanged.body.item).toMatchObject({ ...other.item, clientId: other.clientId })
        audit.controls[own.clientId] = { ownedRead: 200, crossRead: crossRead.status, crossWrite: crossWrite.status,
          foreignSource: mixedSource.status, ownedList: ownList.body.items.map(row => row.id),
          crossScanSuggestions: opportunities.body.suggestions.length, otherDraftUnchanged: true }
      }
      await page.goto(`/${lang}/dashboard/${a.clientId}?step=results&scanId=${b.scanId}`)
      await expect(page.getByText(copy.dashboard.no_scan_selected, { exact: true })).toBeVisible()
      await expect(page.getByTestId('result-priority')).toHaveCount(0)
      await expect(page.getByTestId('owned-scan-evidence')).toHaveCount(0)
      await expect(page.getByText(b.item.title, { exact: true })).toHaveCount(0)
      await page.goto(`/${lang}/dashboard/${a.clientId}?step=improve&scanId=${a.scanId}&draft=${b.item.id}`)
      await expect(page.getByRole('alert').filter({ hasText: copy.opportunities.openError })).toHaveText(copy.opportunities.openError)
      await expect(page.getByLabel(copy.opportunities.titleField, { exact: true })).toHaveCount(0)
      await shot(page, `${prefix}-01-cross-brand-refused.png`)
      for (const brand of [a, b]) {
        await page.goto(resultPath(brand))
        const open = page.getByTestId('result-priority').getByRole('link', { name: copy.resultSummary.openDraft, exact: true })
        await expect(open).toHaveAttribute('href', draftPath(brand))
        await open.click()
        await expect(page.getByLabel(copy.opportunities.titleField, { exact: true })).toHaveValue(brand.item.title)
        await expect(page.getByLabel(copy.opportunities.notes, { exact: true })).toHaveValue(brand.item.notes)
      }
      await page.goto(`/${lang}/auth/logout`)
      await page.waitForURL(`**/${lang}/auth/login`)
      await login(page, request, lang, email, draftPath(b))
      await expect(page.getByLabel(copy.opportunities.titleField, { exact: true })).toHaveValue(b.item.title)
      const restored = await get(page, `/api/clients/${b.clientId}/work-items/${b.item.id}`)
      expect(restored.status).toBe(200)
      expect(restored.body.item).toMatchObject({ ...b.item, clientId: b.clientId })
      await shot(page, `${prefix}-02-brand-b-relogin.png`)
      audit.restored = true
      audit.completed = true
      expect(audit.scannerRequests).toBe(0)
      expect(audit.blockedExternal).toBe(0)
    } catch (error) {
      throw new Error(redactLocalAuth(error.message, [config.controlSecret, config.ownerPassword,
        config.appPassword, config.authPassword, config.engineSecret, config.cookieSecret]))
    } finally {
      writeFileSync(join(config.output, `${prefix}-BRAND-ISOLATION.json`), JSON.stringify(audit, null, 2))
    }
  })
}
