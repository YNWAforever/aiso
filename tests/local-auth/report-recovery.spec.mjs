import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import { config, messages, control, login, get, shot } from './support.mjs'
import { allowLocalUrl, evidenceMode, redactLocalAuth } from '../../scripts/ci/local-auth-safety.mjs'
import { reportDatabase, interruptCommittedSave, reportRows, concurrentReportRetry } from './report-support.mjs'

if (config.scenario !== 'report-recovery') throw new Error('LOCAL_AUTH_REPORT_TARGET')
for (const lang of ['en', 'zh-HK']) {
  test(`${lang} report recovery real Auth Postgres concurrent retry reload relogin`, async ({ page, context, request }, info) => {
    const project = info.project.name, prefix = `${project}-${lang}`
    const email = `${project.endsWith('mobile') ? 'mobile' : 'desktop'}-${lang.toLowerCase()}-${config.runId}@fixture-aiso.example`
    const copy = messages[lang].reports
    const audit = { mode: evidenceMode, requestedSha: '0774d5fd99ce2f35a8fa0f5a008c71e9f7c5e034',
      lang, project, completed: false, step: 'login', disruptions: [], forbidden: [], external: [],
      pageErrors: [], managedNeonAuthVerified: false, providerCalls: 0 }
    const secrets = [config.controlSecret, config.ownerPassword, config.appPassword,
      config.authPassword, config.engineSecret, config.cookieSecret, config.reportShareSecret]
    let pool, interrupted
    page.on('pageerror', error => audit.pageErrors.push(error.message))
    await context.route('**/*', async route => {
      const url = new URL(route.request().url()), path = url.pathname
      try { allowLocalUrl(url, config.allowedOrigins) }
      catch { audit.external.push(path); return route.abort('blockedbyclient') }
      if (/^\/api\/(?:scan(?:\/|$)|fix(?:\/|$)|cron\/|pulse\/run)/.test(path)
        || /\/(?:ai-summary|publish|revoke|rotate-link)$/.test(path)) {
        audit.forbidden.push({ path, method: route.request().method() })
        return route.abort('blockedbyclient')
      }
      return route.continue()
    })
    try {
      await login(page, request, lang, email, `/${lang}/dashboard`)
      const fixture = await control(request, '/__local/report-fixture', { email })
      expect(fixture).toMatchObject({ fixtureOnly: true, monitoringEnabled: false, providerCallsAllowed: false })
      audit.fixture = fixture
      pool = await reportDatabase()
      expect((await reportRows(pool, fixture)).reports).toHaveLength(0)
      const sessionsBefore = (await pool.query('select id from neon_auth.session where "userId"=$1', [fixture.userId])).rows
      expect(sessionsBefore).toHaveLength(1)
      audit.initialSessionIds = sessionsBefore.map(row => row.id)
      const createPath = `/api/clients/${fixture.clientId}/reports`
      await page.goto(`/${lang}/dashboard/${fixture.clientId}/reports/new?scanId=${fixture.scanId}`)
      const input = page.getByLabel(copy.executive_summary, { exact: true })
      // SSR renders the controls disabled until ReportBuilder's recovery
      // effect has run. Wait for that user-visible hydration signal first.
      await expect(page.getByRole('button', { name: copy.review_report, exact: true })).toBeEnabled()
      const summaryA = lang === 'en'
        ? 'SYNTHETIC saved summary A: review this scan evidence and crawler guidance before making any changes.'
        : '合成已儲存摘要甲：只根據這次測試掃描的來源證據核對爬蟲指引，並在任何修改前由人手確認內容。'
      const summaryB = lang === 'en'
        ? 'SYNTHETIC saved summary B: verify the selected scan sources before editing the page or crawler settings.'
        : '合成已儲存摘要乙：修改頁面或爬蟲設定前，先核對指定掃描的測試來源、相關內容及適用的限制。'
      const summaryC = lang === 'en'
        ? 'SYNTHETIC newer human summary C: these later edits must survive reconciliation and remain private.'
        : '合成較新的人手摘要丙：核對原本儲存結果時必須保留這段後來修改的文字，並維持私人草稿狀態。'
      audit.step = 'create-timeout'
      await input.fill(summaryA)
      await expect(input).toHaveValue(summaryA)
      interrupted = await interruptCommittedSave(page, createPath, 'timeout', audit)
      const start = Date.now()
      await page.getByRole('button', { name: copy.save_draft, exact: true }).dblclick()
      const first = await interrupted.captured()
      expect(first.status).toBe(201)
      expect(first.scanId).toBe(fixture.scanId)
      expect(first.requestId).toMatch(/^[a-f0-9-]{36}$/)
      const committed = await reportRows(pool, fixture)
      expect(committed.reports).toHaveLength(1)
      expect(committed.versions).toHaveLength(1)
      expect(committed.receipts[0]).toMatchObject({ request_id: first.requestId,
        report_id: first.result.report.id, version_id: first.result.reviewArtifact.versionId })
      await expect(page.locator('[data-notice-kind="warning"]')).toHaveText(copy.save_unknown, { timeout: 18000 })
      audit.timeoutMs = Date.now() - start
      expect(audit.timeoutMs).toBeGreaterThanOrEqual(14000)
      await expect(input).toHaveValue(summaryA)
      await expect(page.getByRole('button', { name: copy.retry_original_save, exact: true })).toBeDisabled()
      await shot(page, `${prefix}-01-committed-but-timeout.png`)
      await interrupted.close(); interrupted = null
      const receiptPath = `/api/clients/${fixture.clientId}/report-save-requests/${first.requestId}`
      await page.getByRole('button', { name: copy.check_saved_draft, exact: true }).click()
      await expect(page.locator('[data-notice-kind="success"]')).toHaveText(copy.saved)
      await expect(input).toHaveValue(summaryA)
      const readback = await get(page, receiptPath)
      expect(readback.status).toBe(200)
      expect(readback.body.receipt.result).toEqual(first.result)
      expect(readback.body.receipt.request).toMatchObject({ reportId: null, scanId: fixture.scanId,
        locale: lang, executiveSummary: summaryA })
      expect(audit.disruptions).toHaveLength(1)
      audit.createRecovery = { requestId: first.requestId, reportId: first.result.report.id,
        versionId: first.result.reviewArtifact.versionId, matchedOwnerReadback: true }
      audit.step = 'reload-after-recovered-create'
      await page.reload()
      await expect(page.getByRole('button', { name: copy.review_report, exact: true })).toBeEnabled()
      await expect(input).toHaveValue(summaryA)
      expect(new URL(page.url()).pathname).toBe(`/${lang}/dashboard/${fixture.clientId}/reports/${first.result.report.id}`)
      await shot(page, `${prefix}-02-create-reloaded.png`)

      audit.step = 'version-response-lost'
      const versionPath = `/api/client-reports/${first.result.report.id}/versions`
      await input.fill(summaryB)
      await expect(input).toHaveValue(summaryB)
      interrupted = await interruptCommittedSave(page, versionPath, 'lost', audit)
      await page.getByRole('button', { name: copy.save_draft, exact: true }).click()
      await input.fill(summaryC)
      await expect(input).toHaveValue(summaryC)
      const second = await interrupted.captured()
      expect(second.status).toBe(201)
      expect(second.result.reviewArtifact.versionNumber).toBe(2)
      await expect(page.locator('[data-notice-kind="warning"]')).toHaveText(copy.save_unknown)
      await expect(input).toHaveValue(summaryC)
      await interrupted.close(); interrupted = null
      await page.getByRole('button', { name: copy.check_saved_draft, exact: true }).click()
      await expect(page.locator('[data-notice-kind="warning"]')).toHaveText(copy.save_again)
      await expect(input).toHaveValue(summaryC)
      const storedB = await reportRows(pool, fixture)
      expect(storedB.versions).toHaveLength(2)
      expect(storedB.versions[1]).toMatchObject({ id: second.result.reviewArtifact.versionId,
        source_scan_id: fixture.scanId, locale: lang, executive_summary: summaryB })
      expect(storedB.versions[1].snapshot).toEqual(second.result.reviewArtifact.snapshot)
      expect(audit.disruptions).toHaveLength(2)
      const saveC = page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === versionPath)
      await page.getByRole('button', { name: copy.save_draft, exact: true }).click()
      const responseC = await saveC, third = await responseC.json()
      expect(responseC.status()).toBe(201)
      expect(third.reviewArtifact.versionNumber).toBe(3)
      expect(third.reviewArtifact.snapshot.executiveSummary).toBe(summaryC)
      await expect(page.locator('[data-notice-kind="success"]')).toHaveText(copy.saved)
      await page.reload()
      await expect(page.getByRole('button', { name: copy.review_report, exact: true })).toBeEnabled()
      await expect(input).toHaveValue(summaryC)
      audit.versionRecovery = { requestId: second.requestId, lostVersionId: second.result.reviewArtifact.versionId,
        preservedHumanEdit: true, finalVersionId: third.reviewArtifact.versionId }

      audit.step = 'two-real-blocked-connections'
      audit.concurrency = await concurrentReportRetry(page, pool, fixture, {
        reportId: first.result.report.id, versionNumber: 3, snapshot: third.reviewArtifact.snapshot,
      }, lang)
      await page.reload()
      await expect(page.getByRole('button', { name: copy.review_report, exact: true })).toBeEnabled()
      await expect(input).toHaveValue(audit.concurrency.summary)
      const finalRows = await reportRows(pool, fixture)
      expect(finalRows.reports).toHaveLength(1)
      expect(finalRows.versions).toHaveLength(4)
      expect(finalRows.receipts).toHaveLength(4)
      expect(finalRows.versions.map(row => row.executive_summary)).toEqual([summaryA, summaryB, summaryC, audit.concurrency.summary])
      expect(finalRows.versions.every(row => row.source_scan_id === fixture.scanId && row.locale === lang)).toBe(true)
      expect(finalRows.reports[0].published_version_id).toBeNull()
      const foreign = await get(page, `/api/clients/${fixture.foreignClientId}/report-save-requests/${first.requestId}`)
      expect(foreign.status).toBe(404)
      audit.foreignWorkspaceDenied = foreign.status
      await page.getByRole('button', { name: copy.review_report, exact: true }).click()
      await expect(page.getByRole('textbox')).toHaveCount(0)
      await expect(page.locator('main')).toContainText(audit.concurrency.summary)
      await expect(page.locator('main')).toContainText(fixture.brandName)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await shot(page, `${prefix}-03-concurrent-retry-one-version.png`)

      audit.step = 'signout-relogin'
      const savedPath = new URL(page.url()).pathname
      const oldCookies = await context.cookies(config.appOrigin)
      const old = await context.browser().newContext({
        baseURL: config.appOrigin, ignoreHTTPSErrors: true, storageState: { cookies: oldCookies, origins: [] },
      })
      await old.route('**/*', route => {
        try { allowLocalUrl(route.request().url(), config.allowedOrigins); return route.continue() }
        catch { return route.abort('blockedbyclient') }
      })
      try {
        const oldPage = await old.newPage()
        await oldPage.goto(`/${lang}`)
        await page.goto(`/${lang}/auth/logout`)
        await page.waitForURL(`**/${lang}/auth/login`)
        expect(await get(oldPage, receiptPath)).toEqual({ status: 401, body: { error: 'unauthorized' } })
        audit.oldSessionDenied = true
      } finally { await old.close() }
      await login(page, request, lang, email, savedPath)
      expect(new URL(page.url()).pathname).toBe(savedPath)
      await expect(page.getByRole('button', { name: copy.review_report, exact: true })).toBeEnabled()
      await expect(input).toHaveValue(audit.concurrency.summary)
      const finalRead = await get(page, `/api/clients/${fixture.clientId}/report-save-requests/${audit.concurrency.requestId}`)
      expect(finalRead.status).toBe(200)
      expect(finalRead.body.receipt.result.reviewArtifact.versionId).toBe(audit.concurrency.versionId)
      expect(finalRead.body.receipt.result.reviewArtifact.snapshot).toEqual(audit.concurrency.snapshot)
      const sessionIds = (await pool.query('select id from neon_auth.session where "userId"=$1', [fixture.userId])).rows.map(row => row.id)
      expect(sessionIds).toHaveLength(1)
      expect(sessionIds[0]).not.toBe(audit.initialSessionIds[0])
      audit.finalSessionIds = sessionIds
      const afterRelogin = await reportRows(pool, fixture)
      expect(afterRelogin).toEqual(finalRows)
      audit.finalCounts = { reports: finalRows.reports.length, versions: finalRows.versions.length, receipts: finalRows.receipts.length }
      audit.reloginConsistent = true
      await shot(page, `${prefix}-04-relogin-same-report.png`)
      expect(audit.forbidden).toEqual([])
      expect(audit.external).toEqual([])
      expect(audit.pageErrors).toEqual([])
      audit.completed = true
      audit.step = 'passed'
    } catch (error) {
      try { await shot(page, `${prefix}-FAILED-${audit.step}.png`) } catch {}
      throw new Error(redactLocalAuth(error.message, secrets))
    } finally {
      if (interrupted) await interrupted.close()
      if (pool) await pool.end()
      writeFileSync(join(config.output, `${prefix}-REPORT-RECOVERY.json`), redactLocalAuth(JSON.stringify(audit, null, 2), secrets))
    }
  })
}
