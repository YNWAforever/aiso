import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import { allowLocalUrl, evidenceMode, redactLocalAuth } from '../../scripts/ci/local-auth-safety.mjs'
import { config, messages, control, login, get, shot } from './support.mjs'

for (const lang of ['en', 'zh-HK']) {
  test(`${lang} real local Auth result evidence draft save reload signout relogin`, async ({ page, context, request }, testInfo) => {
    const project = testInfo.project.name, prefix = `${project}-${lang}`
    const email = `${project.endsWith('mobile') ? 'mobile' : 'desktop'}-${lang.toLowerCase()}-${config.runId}@fixture-aiso.example`
    const copy = messages[lang].opportunities
    const audit = { mode: evidenceMode, lang, project, scanIntercepted: 0, blockedExternal: 0,
      realApiResponses: [], persisted: false, oldSessionDenied: false,
      controls: { ownedRead: 'not-run', foreignAccount: 'not-run', foreignWorkspaceWrite: 'not-run',
        foreignEvidence: 'not-run', duplicateCreate: 'not-run', staleCas: 'not-run',
        existingBrandReentry: 'not-run', brandUnchanged: false, sourceAssociationReadback: false } }
    let fixture, onboarding, onboardingPayload
    await context.route('**/*', async route => {
      const url = new URL(route.request().url())
      try { allowLocalUrl(url, config.allowedOrigins) }
      catch { audit.blockedExternal++; await route.abort('blockedbyclient'); return }
      if (url.pathname === '/api/scan' && route.request().method() === 'POST') {
        const input = route.request().postDataJSON()
        if (!input || typeof input.clientId !== 'string') throw new Error('LOCAL_AUTH_ONBOARDING_SCAN_SCOPE_REQUIRED')
        // The real onboarding response has already committed this client. The
        // control only verifies it and seeds declared scan data, never a brand.
        fixture ??= await control(request, '/__local/fixture', { email, clientId: input.clientId })
        if (input.clientId !== fixture.clientId) throw new Error('LOCAL_AUTH_SCAN_REBIND_DENIED')
        audit.scanIntercepted++
        audit.scanRequest = input
        await route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ id: fixture.scanId, localFixture: 'SYNTHETIC_SCAN_NO_EXTERNAL_COLLECTION' }) })
        return
      }
      await route.continue()
    })
    page.on('response', response => {
      const path = new URL(response.url()).pathname
      if (path.includes('/work-items') || path.includes('/opportunities') || path === '/api/onboarding/complete') {
        audit.realApiResponses.push({ path, method: response.request().method(), status: response.status() })
      }
    })
    try {
      const brandName = `SYNTHETIC first value ${lang} ${project}`
      await login(page, request, lang, email, `/${lang}/onboarding`)
      await expect(page.locator('#onboarding-brand')).toBeVisible()
      await page.locator('#onboarding-brand').fill(brandName)
      await page.locator('#onboarding-website').fill('https://fixture-aiso.example')
      const completed = page.waitForResponse(response => response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/onboarding/complete')
      await page.getByRole('button', { name: lang === 'en' ? 'Save and check my website' : '儲存並分析我的網站', exact: true }).click()
      const completedResponse = await completed
      expect(completedResponse.status()).toBe(200)
      onboardingPayload = completedResponse.request().postDataJSON()
      onboarding = await completedResponse.json()
      expect(onboardingPayload).toMatchObject({ brandName, domain: 'fixture-aiso.example', market: null })
      expect(onboardingPayload).not.toHaveProperty('language')
      expect(onboardingPayload).not.toHaveProperty('clientId')
      expect(onboardingPayload).not.toHaveProperty('scanId')
      expect(onboarding.progress).toMatchObject({ brand: 'ready', prompts: 'pending', promptCount: 0 })
      await page.waitForURL(url => url.pathname === `/${lang}/dashboard/${onboarding.clientId}` &&
        url.searchParams.get('step') === 'results' && Boolean(url.searchParams.get('scanId')))
      expect(fixture).toBeTruthy()
      expect(fixture.mode).toBe(evidenceMode)
      expect(fixture.clientId).toBe(onboarding.clientId)
      expect(new URL(page.url()).searchParams.get('scanId')).toBe(fixture.scanId)
      expect(audit.scanRequest).toMatchObject({ clientId: onboarding.clientId, url: 'https://fixture-aiso.example/' })
      expect(audit.scanRequest.requestKey).toMatch(/^[a-f0-9-]{36}$/)
      expect(audit.scanRequest).not.toHaveProperty('accountId')
      expect(audit.scanIntercepted).toBe(1)
      audit.onboarding = { request: onboardingPayload, response: onboarding, clientId: fixture.clientId }
      const brandBefore = await control(request, '/__local/brand', { email, clientId: fixture.clientId })
      expect(brandBefore.brand).toMatchObject({ id: fixture.clientId, account_id: fixture.accountId,
        brand_name: brandName, domain: 'fixture-aiso.example', industry: null, region: null, description: null })
      expect(brandBefore.clientCount).toBe(1)
      expect(brandBefore.promptCount).toBe(0)
      const retainedScan = await control(request, '/__local/scan', { id: fixture.scanId })
      expect(retainedScan.rows).toHaveLength(1)
      const storedScan = retainedScan.rows[0]
      expect(storedScan).toMatchObject({ id: fixture.scanId, account_id: fixture.accountId,
        client_id: fixture.clientId, url: audit.scanRequest.url, domain: 'fixture-aiso.example' })
      expect(storedScan.results.localFixture.collectedExternally).toBe(false)
      const findings = page.getByRole('region', { name: lang === 'en' ? 'Scan findings' : '掃描發現', exact: true })
      const firstAction = page.getByTestId('result-priority')
      const createDraft = firstAction.getByRole('button', { name: messages[lang].resultSummary.createDraft, exact: true })
      await expect(createDraft).toBeVisible()
      const actionBox = await createDraft.boundingBox()
      expect(actionBox.y).toBeGreaterThanOrEqual(0)
      expect(actionBox.y + actionBox.height).toBeLessThanOrEqual(page.viewportSize().height)
      await expect(firstAction).toContainText('fixture-aiso.example')
      await shot(page, `${prefix}-00-results-first-action.png`)
      await expect(findings).toBeVisible()
      await expect(findings.getByRole('heading', { name: brandName, exact: true })).toBeVisible()
      const evidence = page.getByTestId('owned-scan-evidence')
      await expect(evidence).toBeVisible()
      await evidence.locator('summary').click()
      await expect(evidence).toContainText('c1_robots')
      await expect(evidence).toContainText(storedScan.results.evidence.scannerVersion)
      // A newer all-clear scan is present. URL and findings must remain bound
      // to the scan selected by the onboarding request.
      expect(fixture.decoyScanId).not.toBe(fixture.scanId)
      await expect(findings).toContainText(String(Number(storedScan.score)))
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await shot(page, `${prefix}-01-result-evidence.png`)

      const create = page.waitForResponse(response => response.request().method() === 'POST' &&
        new URL(response.url()).pathname === `/api/clients/${fixture.clientId}/work-items`)
      await createDraft.click()
      const created = await create
      expect(created.status()).toBe(201)
      const sourcePayload = created.request().postDataJSON()
      expect(sourcePayload.source).toEqual({ kind: 'scan-check', id: fixture.scanId, checkKey: 'c1_robots' })
      expect(sourcePayload.ruleVersion).toBe('scan-check-gap.v1')
      expect(sourcePayload.locale).toBe(lang)
      expect(sourcePayload.fingerprint).toMatch(/^[a-f0-9]{64}$/)
      expect(Object.keys(sourcePayload).sort()).toEqual(['fingerprint', 'locale', 'ruleVersion', 'source'])
      audit.sourcePayload = sourcePayload
      const item = (await created.json()).item
      await page.waitForURL(url => url.pathname === `/${lang}/dashboard/${fixture.clientId}` &&
        url.searchParams.get('step') === 'improve' && url.searchParams.get('scanId') === fixture.scanId && url.searchParams.get('draft') === item.id)
      expect(item.clientId).toBe(fixture.clientId)
      expect(item.evidenceSnapshot.source).toEqual(sourcePayload.source)
      expect(item.evidenceSnapshot.ruleVersion).toBe(sourcePayload.ruleVersion)
      expect(item.evidenceSnapshot.evidence).toMatchObject({ kind: 'scan-check', scanId: fixture.scanId,
        checkKey: sourcePayload.source.checkKey, comparisonSignature: storedScan.results.evidence.comparisonSignature,
        scannerVersion: storedScan.results.evidence.scannerVersion })
      const duplicate = await get(page, `/api/clients/${fixture.clientId}/work-items`, 'POST', sourcePayload)
      audit.controls.duplicateCreate = duplicate.status
      expect(duplicate.status).toBe(200)
      expect(duplicate.body.item).toMatchObject({ id: item.id, revision: 1 })
      const duplicateRows = await get(page, `/api/clients/${fixture.clientId}/work-items`)
      expect(duplicateRows.status).toBe(200)
      expect(duplicateRows.body.items.filter(row => row.id === item.id)).toHaveLength(1)
      const editor = page.getByRole('region', { name: copy.savedDraft, exact: true })
      await expect(editor).toBeVisible()
      const title = `SYNTHETIC persisted ${lang} ${project}`
      await editor.getByLabel(copy.titleField, { exact: true }).fill(title)
      await editor.getByLabel(copy.action, { exact: true }).fill('SYNTHETIC manual review action. No provider or external publication.')
      await editor.getByLabel(copy.notes, { exact: true }).fill(`Owned disposable local test ${config.runId}`)
      const patch = page.waitForResponse(response => response.request().method() === 'PATCH' &&
        new URL(response.url()).pathname === `/api/clients/${fixture.clientId}/work-items/${item.id}`)
      await editor.getByRole('button', { name: copy.saveChanges, exact: true }).click()
      expect((await patch).status()).toBe(200)
      await expect(editor.getByRole('status', { name: copy.draftSaveStatus })).toHaveText(copy.changesSaved)
      await page.reload()
      await expect(page.getByLabel(copy.titleField, { exact: true })).toHaveValue(title)
      const persisted = await control(request, '/__local/persisted', { id: item.id })
      expect(persisted.rows).toHaveLength(1)
      expect(persisted.rows[0]).toMatchObject({ id: item.id, account_id: fixture.accountId,
        client_id: fixture.clientId, title, revision: 2, source_kind: 'scan-check', source_id: fixture.scanId,
        check_key: sourcePayload.source.checkKey, rule_version: sourcePayload.ruleVersion,
        evidence_fingerprint: sourcePayload.fingerprint, evidence_snapshot: item.evidenceSnapshot })
      expect(persisted.sources).toHaveLength(1)
      expect(persisted.sources[0]).toMatchObject({ account_id: fixture.accountId, client_id: fixture.clientId,
        work_item_id: item.id, source_kind: 'scan-check', source_id: fixture.scanId,
        check_key: sourcePayload.source.checkKey, rule_version: sourcePayload.ruleVersion,
        evidence_fingerprint: sourcePayload.fingerprint, evidence_snapshot: item.evidenceSnapshot })
      audit.controls.sourceAssociationReadback = true
      audit.persisted = true
      await shot(page, `${prefix}-02-saved-and-reloaded.png`)
      const createCount = audit.realApiResponses.filter(row => row.method === 'POST' && row.path === `/api/clients/${fixture.clientId}/work-items`).length
      await page.goto(`/${lang}/dashboard/${fixture.clientId}?step=results&scanId=${fixture.scanId}`)
      const reopen = page.getByTestId('result-priority').getByRole('link', { name: messages[lang].resultSummary.openDraft, exact: true })
      await expect(reopen).toHaveAttribute('href',
        `/${lang}/dashboard/${fixture.clientId}?step=improve&scanId=${fixture.scanId}&draft=${item.id}`)
      await reopen.click()
      await expect(page.getByLabel(copy.titleField, { exact: true })).toHaveValue(title)
      expect(audit.realApiResponses.filter(row => row.method === 'POST' && row.path === `/api/clients/${fixture.clientId}/work-items`).length).toBe(createCount)
      audit.reopenedFromResultsWithoutCreate = true

      const own = await get(page, `/api/clients/${fixture.clientId}/work-items/${item.id}`)
      audit.controls.ownedRead = own.status
      expect(own.status).toBe(200)
      expect(own.body.item.id).toBe(item.id)
      expect(own.body.item.sourceScanIds).toEqual([fixture.scanId])
      expect(own.body.item.evidenceSnapshot).toEqual(item.evidenceSnapshot)
      const staleCas = await get(page, `/api/clients/${fixture.clientId}/work-items/${item.id}`, 'PATCH', {
        title: 'SYNTHETIC stale overwrite must fail', action: 'Stale write', notes: '', expectedRevision: 1,
      })
      audit.controls.staleCas = staleCas.status
      expect(staleCas).toEqual({ status: 409, body: { error: 'WORK_ITEM_CONFLICT' } })
      const afterStale = await get(page, `/api/clients/${fixture.clientId}/work-items/${item.id}`)
      expect(afterStale.body.item).toMatchObject({ id: item.id, title, revision: 2 })
      const foreign = await get(page, `/api/clients/${fixture.foreignClientId}/work-items/${item.id}`)
      audit.controls.foreignAccount = foreign.status
      expect(foreign).toEqual({ status: 404, body: { error: 'CLIENT_NOT_FOUND' } })
      const foreignWrite = await get(page, `/api/clients/${fixture.foreignClientId}/work-items/${item.id}`, 'PATCH', {
        title: 'Foreign write must fail', action: 'Denied', notes: '', expectedRevision: 2,
      })
      audit.controls.foreignWorkspaceWrite = foreignWrite.status
      expect(foreignWrite).toEqual({ status: 404, body: { error: 'CLIENT_NOT_FOUND' } })
      const foreignScan = await get(page, `/api/clients/${fixture.clientId}/work-items`, 'POST', {
        source: { kind: 'scan-check', id: fixture.foreignScanId, checkKey: 'c1_robots' },
        ruleVersion: 'scan-check-gap.v1', fingerprint: 'a'.repeat(64), locale: lang,
      })
      audit.controls.foreignEvidence = foreignScan.status
      expect(foreignScan).toEqual({ status: 409, body: { error: 'EVIDENCE_CHANGED' } })
      const reentry = await get(page, '/api/onboarding/complete', 'POST', { ...onboardingPayload,
        intentKey: crypto.randomUUID(), industry: 'finance', region: 'TW',
        description: 'SYNTHETIC reentry must not overwrite the existing brand', competitors: ['SYNTHETIC alternative'] })
      audit.controls.existingBrandReentry = reentry.status
      expect(reentry.status).toBe(200)
      expect(reentry.body.clientId).toBe(fixture.clientId)
      const brandAfter = await control(request, '/__local/brand', { email, clientId: fixture.clientId })
      expect(brandAfter.brand).toEqual(brandBefore.brand)
      expect(brandAfter.clientCount).toBe(1)
      expect(brandAfter.promptCount).toBe(0)
      audit.controls.brandUnchanged = true
      audit.controls = { ownedRead: own.status, foreignAccount: foreign.status,
        foreignWorkspaceWrite: foreignWrite.status, foreignEvidence: foreignScan.status,
        duplicateCreate: duplicate.status, duplicateItemId: duplicate.body.item.id,
        staleCas: staleCas.status, existingBrandReentry: reentry.status, brandUnchanged: true,
        sourceAssociationReadback: true, selectedScanId: fixture.scanId, newerUnselectedScanId: fixture.decoyScanId }

      const savedPath = new URL(page.url()).pathname + new URL(page.url()).search
      const oldCookies = await context.cookies(config.appOrigin)
      const old = await page.context().browser().newContext({ baseURL: config.appOrigin,
        ignoreHTTPSErrors: true, storageState: { cookies: oldCookies, origins: [] } })
      await old.route('**/*', route => {
        try { allowLocalUrl(route.request().url(), config.allowedOrigins); return route.continue() }
        catch { return route.abort('blockedbyclient') }
      })
      try {
        const oldPage = await old.newPage()
        await oldPage.goto(`/${lang}`)
        await page.goto(`/${lang}/auth/logout`)
        await page.waitForURL(`**/${lang}/auth/login`)
        const denied = await get(oldPage, `/api/clients/${fixture.clientId}/work-items/${item.id}`)
        expect(denied).toEqual({ status: 401, body: { error: 'UNAUTHENTICATED' } })
        audit.oldSessionDenied = true
      } finally { await old.close() }
      await login(page, request, lang, email, savedPath)
      const returned = new URL(page.url()), requested = new URL(savedPath, config.appOrigin)
      audit.reloginReturn = { requested: savedPath, actual: returned.pathname + returned.search }
      expect(returned.pathname).toBe(requested.pathname)
      for (const key of ['step', 'scanId', 'draft']) expect(returned.searchParams.get(key)).toBe(requested.searchParams.get(key))
      await expect(page.getByLabel(copy.titleField, { exact: true })).toHaveValue(title)
      const restored = await get(page, `/api/clients/${fixture.clientId}/work-items/${item.id}`)
      expect(restored.status).toBe(200)
      expect(restored.body.item).toMatchObject({ id: item.id, title, revision: 2 })
      expect(restored.body.item.sourceScanIds).toEqual([fixture.scanId])
      expect(restored.body.item.evidenceSnapshot).toEqual(item.evidenceSnapshot)
      audit.restored = true
      await shot(page, `${prefix}-03-real-relogin-same-draft.png`)
    } catch (error) {
      // Playwright also writes its own failure context. Sanitize the error
      // before the runner receives it, not only in our JSON reporter.
      throw new Error(redactLocalAuth(error.message, [config.controlSecret, config.ownerPassword,
        config.appPassword, config.authPassword, config.engineSecret, config.cookieSecret]))
    } finally {
      writeFileSync(join(config.output, `${prefix}-JOURNEY.json`), JSON.stringify(audit, null, 2))
    }
  })
}
