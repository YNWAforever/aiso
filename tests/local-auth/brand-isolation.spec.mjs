import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import { allowLocalUrl, evidenceMode, redactLocalAuth } from '../../scripts/ci/local-auth-safety.mjs'
import { config, messages, control, login, get, shot } from './support.mjs'

if (config.scenario !== 'brand-isolation') throw new Error('LOCAL_AUTH_MULTI_BRAND_TARGET')

async function openPortfolio(page, lang, copy) {
  await page.locator('aside').getByRole('link', { name: /Fimmick AISO/i }).click()
  await page.waitForURL(url => url.pathname === `/${lang}/dashboard`)
  await expect(page.getByRole('heading', { name: copy.portfolio.title, exact: true })).toBeVisible()
}

async function selectBrand(page, lang, brand, copy) {
  const card = page.locator('main a').filter({ hasText: brand.brandName }).first()
  await expect(card).toHaveCount(1)
  await card.click()
  await page.waitForURL(url => url.pathname === `/${lang}/dashboard/${brand.clientId}`)
  await expect(page.getByRole('heading', { name: brand.brandName, exact: true })).toBeVisible()
  const scan = page.getByRole('link').filter({ hasText: `${copy.workspaceHome.openScan}: ${brand.score}` }).first()
  await expect(scan).toBeVisible()
  await scan.click()
  await page.waitForURL(url => url.pathname === `/${lang}/dashboard/${brand.clientId}` &&
    url.searchParams.get('step') === 'results' && url.searchParams.get('scanId') === brand.scanId)
  await expect(page.getByTestId('result-priority')).toContainText(brand.brandName)
}

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
        const retained = await control(request, '/__local/scan', { id: fixture.scanId })
        const score = Number(retained.rows[0].score)
        audit.brands.push({ ...fixture, brandName, score, fingerprint: body.fingerprint, item: { id: item.id, title, action, notes,
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
      audit.uiSwitches = []
      for (const [brand, other] of [[a, b], [b, a]]) {
        await openPortfolio(page, lang, copy)
        for (const visible of [a, b]) {
          await expect(page.locator('main a').filter({ hasText: visible.brandName }).first()).toBeVisible()
        }
        await selectBrand(page, lang, brand, copy)
        await expect(page.getByTestId('result-priority')).not.toContainText(other.brandName)
        await expect(page.getByText(other.item.title, { exact: true })).toHaveCount(0)
        await page.getByTestId('result-priority').scrollIntoViewIfNeeded()
        await shot(page, `${prefix}-03-ui-results-${brand.brandName.includes(' A ') ? 'a' : 'b'}.png`)
        await page.getByRole('link', { name: copy.dashboard.next_improve, exact: true }).click()
        await page.waitForURL(url => url.pathname === `/${lang}/dashboard/${brand.clientId}` &&
          url.searchParams.get('step') === 'improve' && url.searchParams.get('scanId') === brand.scanId)
        await expect(page.getByText(`${copy.opportunities.sourceScan}: ${brand.scanId}`, { exact: true }).first()).toBeVisible()
        await expect(page.getByText(`${copy.opportunities.sourceScan}: ${other.scanId}`, { exact: true })).toHaveCount(0)
        await page.getByRole('button', { name: copy.opportunities.savedDrafts, exact: true }).click()
        const savedDrafts = page.getByRole('region', { name: copy.opportunities.savedDrafts, exact: true })
        await expect(savedDrafts.getByRole('button', { name: brand.item.title, exact: true })).toBeVisible()
        await expect(savedDrafts.getByRole('button', { name: other.item.title, exact: true })).toHaveCount(0)
        await savedDrafts.getByRole('button', { name: brand.item.title, exact: true }).click()
        await expect(page.getByLabel(copy.opportunities.titleField, { exact: true })).toHaveValue(brand.item.title)
        await expect(page.getByLabel(copy.opportunities.notes, { exact: true })).toHaveValue(brand.item.notes)
        await expect(page.getByText(other.item.notes, { exact: true })).toHaveCount(0)
        audit.uiSwitches.push({ clientId: brand.clientId, brandName: brand.brandName, scanId: brand.scanId,
          draftId: brand.item.id, selectedVia: 'portfolio-card-and-scan-history', improveSourceVerified: true })
        await page.getByLabel(copy.opportunities.titleField, { exact: true })
          .evaluate(element => element.scrollIntoView({ block: 'center' }))
        await shot(page, `${prefix}-03-ui-switch-${brand.brandName.includes(' A ') ? 'a' : 'b'}.png`)
      }
      await page.goto(`/${lang}/auth/logout`)
      await page.waitForURL(`**/${lang}/auth/login`)
      await login(page, request, lang, email, draftPath(b))
      await expect(page.getByLabel(copy.opportunities.titleField, { exact: true })).toHaveValue(b.item.title)
      const restored = await get(page, `/api/clients/${b.clientId}/work-items/${b.item.id}`)
      expect(restored.status).toBe(200)
      expect(restored.body.item).toMatchObject({ ...b.item, clientId: b.clientId })
      await page.getByLabel(copy.opportunities.titleField, { exact: true })
        .evaluate(element => element.scrollIntoView({ block: 'center' }))
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
