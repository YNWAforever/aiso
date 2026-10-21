import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import { config, messages, control, login, get, shot } from './support.mjs'
import { allowLocalUrl, evidenceMode, redactLocalAuth } from '../../scripts/ci/local-auth-safety.mjs'
import { reportDatabase, reportRows } from './report-support.mjs'

if (config.scenario !== 'report-list') throw new Error('LOCAL_AUTH_REPORT_TARGET')
for (const lang of ['en', 'zh-HK']) {
  test(`${lang} Reports list and back paths reopen the latest private draft after relogin`, async ({ page, context, request }, info) => {
    const project = info.project.name, prefix = `${project}-${lang}`
    const email = `${project.endsWith('mobile') ? 'mobile' : 'desktop'}-${lang.toLowerCase()}-${config.runId}@fixture-aiso.example`
    const copy = messages[lang].reports
    const audit = { mode: evidenceMode, lang, project, completed: false, step: 'login',
      saves: [], paths: [], external: [], forbidden: [], pageErrors: [], providerCalls: 0 }
    const secrets = [config.controlSecret, config.ownerPassword, config.appPassword,
      config.authPassword, config.engineSecret, config.cookieSecret, config.reportShareSecret]
    let pool
    page.on('pageerror', error => audit.pageErrors.push(error.message))
    await context.route('**/*', route => {
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
      const sessionsBefore = (await pool.query('select id from neon_auth.session where "userId"=$1', [fixture.userId])).rows
      expect(sessionsBefore).toHaveLength(1)
      audit.initialSessionIds = sessionsBefore.map(row => row.id)
      const listPath = `/${lang}/dashboard/${fixture.clientId}/reports`
      const input = page.getByLabel(copy.executive_summary, { exact: true })
      const ready = () => expect(page.getByRole('button', { name: copy.review_report, exact: true })).toBeEnabled()
      const summaryA = lang === 'en'
        ? 'SYNTHETIC private report A: check this saved scan evidence before making any changes to the site.'
        : '合成私人報告甲：修改網站內容之前，先核對這次已保存掃描的來源證據、適用範圍及需要人手確認的資料。'
      const summaryB = lang === 'en'
        ? 'SYNTHETIC updated report B: the Reports list and back navigation must reopen this newer private version.'
        : '合成更新報告乙：客戶報告列表及返回路徑必須重新開啟這份較新私人版本，並保留正確掃描來源及草稿內容。'
      const summaryC = lang === 'en'
        ? 'SYNTHETIC latest report C: verify this exact saved version after browser back, reload and signing in again.'
        : '合成最新報告丙：使用瀏覽器返回、重新載入及再次登入後，必須讀回這個確切已保存版本及原本的來源關聯。'
      const save = async (path, summary, versionNumber) => {
        await ready()
        await input.fill(summary)
        await expect(input).toHaveValue(summary)
        const sent = page.waitForResponse(response => response.request().method() === 'POST'
          && new URL(response.url()).pathname === path)
        await page.getByRole('button', { name: copy.save_draft, exact: true }).click()
        const response = await sent, data = await response.json()
        expect(response.status()).toBe(201)
        expect(data.reviewArtifact.versionNumber).toBe(versionNumber)
        expect(data.reviewArtifact.snapshot.executiveSummary).toBe(summary)
        const headers = response.request().headers()
        expect(headers['x-report-scan-id']).toBe(fixture.scanId)
        const requestId = headers['x-report-request-id']
        const receipt = await get(page, `/api/clients/${fixture.clientId}/report-save-requests/${requestId}`)
        expect(receipt.status).toBe(200)
        expect(receipt.body.receipt.result).toEqual(data)
        const rows = await reportRows(pool, fixture)
        expect(rows.reports).toHaveLength(1)
        expect(rows.versions).toHaveLength(versionNumber)
        expect(rows.receipts).toHaveLength(versionNumber)
        expect(rows.reports[0].latest_version_id).toBe(data.reviewArtifact.versionId)
        expect(rows.versions.at(-1).snapshot).toEqual(data.reviewArtifact.snapshot)
        audit.saves.push({ requestId, reportId: data.report.id, versionId: data.reviewArtifact.versionId,
          versionNumber, snapshot: data.reviewArtifact.snapshot,
          database: { reports: rows.reports.length, versions: rows.versions.length, receipts: rows.receipts.length } })
        await expect(page.locator('[data-notice-kind="success"]')).toHaveText(copy.saved)
        return data
      }
      const expectList = async (reportId, version) => {
        await expect(page).toHaveURL(new URL(listPath, config.appOrigin).href)
        await expect(page.getByRole('heading', { name: copy.list_title, exact: true })).toBeVisible()
        const row = page.locator('main li').filter({ has: page.locator(`a[href="${listPath}/${reportId}"]`) })
        await expect(row).toHaveCount(1)
        await expect(row).toContainText(copy.latest_version.replace('{version}', String(version)))
        await expect(row.getByRole('link', { name: copy.edit_report, exact: true })).toBeVisible()
        await expect(row.getByRole('button', { name: copy.open_report, exact: true })).toHaveCount(0)
        audit.paths.push({ step: audit.step, path: new URL(page.url()).pathname, reportId, version })
        return row
      }

      audit.step = 'empty-list'
      await page.goto(listPath)
      await expect(page.getByRole('heading', { name: copy.empty_title, exact: true })).toBeVisible()
      expect((await reportRows(pool, fixture)).reports).toHaveLength(0)

      audit.step = 'create-private-draft'
      await page.goto(`${listPath}/new?scanId=${fixture.scanId}`)
      const first = await save(`/api/clients/${fixture.clientId}/reports`, summaryA, 1)
      const editPath = `${listPath}/${first.report.id}`
      const versionPath = `/api/client-reports/${first.report.id}/versions`
      audit.step = 'return-list-version-one'
      await page.getByRole('link', { name: copy.back_to_reports, exact: true }).click()
      let row = await expectList(first.report.id, 1)
      await shot(page, `${prefix}-01-private-list.png`)
      await row.getByRole('link', { name: copy.edit_report, exact: true }).click()
      await ready()
      await expect(input).toHaveValue(summaryA)

      audit.step = 'save-version-two-return-list'
      await save(versionPath, summaryB, 2)
      await page.getByRole('link', { name: copy.back_to_reports, exact: true }).click()
      row = await expectList(first.report.id, 2)
      await row.getByRole('link', { name: copy.edit_report, exact: true }).click()
      await ready()
      await expect(input).toHaveValue(summaryB)
      audit.step = 'browser-back-forward'
      await page.goBack()
      row = await expectList(first.report.id, 2)
      await page.goForward()
      await ready()
      await expect(input).toHaveValue(summaryB)

      audit.step = 'save-version-three-browser-back'
      await save(versionPath, summaryC, 3)
      await page.goBack()
      row = await expectList(first.report.id, 3)
      await shot(page, `${prefix}-02-latest-private-list.png`)
      await row.getByRole('link', { name: copy.edit_report, exact: true }).click()
      await ready()
      await expect(input).toHaveValue(summaryC)
      await input.scrollIntoViewIfNeeded()
      await shot(page, `${prefix}-02-reopened-latest.png`)

      audit.step = 'reload-list-and-edit'
      await page.getByRole('link', { name: copy.back_to_reports, exact: true }).click()
      await expectList(first.report.id, 3)
      await page.reload()
      row = await expectList(first.report.id, 3)
      await row.getByRole('link', { name: copy.edit_report, exact: true }).click()
      await ready()
      await page.reload()
      await ready()
      await expect(input).toHaveValue(summaryC)
      const beforeLogout = await reportRows(pool, fixture)
      expect(beforeLogout.reports).toHaveLength(1)
      expect(beforeLogout.versions).toHaveLength(3)
      expect(beforeLogout.receipts).toHaveLength(3)
      expect(beforeLogout.versions.map(version => version.executive_summary)).toEqual([summaryA, summaryB, summaryC])
      expect(beforeLogout.versions.every(version => version.source_scan_id === fixture.scanId && version.locale === lang)).toBe(true)
      expect(beforeLogout.reports[0].status).toBe('draft')
      expect(beforeLogout.reports[0].published_version_id).toBeNull()
      const foreign = await get(page, `/api/clients/${fixture.foreignClientId}/reports`)
      expect(foreign.status).toBe(404)
      audit.foreignWorkspaceDenied = foreign.status

      audit.step = 'signout-relogin-list'
      const old = await context.browser().newContext({
        baseURL: config.appOrigin, ignoreHTTPSErrors: true,
        storageState: { cookies: await context.cookies(config.appOrigin), origins: [] },
      })
      await old.route('**/*', route => {
        try { allowLocalUrl(route.request().url(), config.allowedOrigins); return route.continue() }
        catch { audit.external.push(new URL(route.request().url()).pathname); return route.abort('blockedbyclient') }
      })
      try {
        const oldPage = await old.newPage()
        await oldPage.goto(`/${lang}`)
        await page.goto(`/${lang}/auth/logout`)
        await page.waitForURL(`**/${lang}/auth/login`)
        const denied = await get(oldPage, `/api/clients/${fixture.clientId}/reports`)
        expect(denied.status).toBe(401)
        audit.oldSessionDenied = true
      } finally { await old.close() }
      await login(page, request, lang, email, listPath)
      row = await expectList(first.report.id, 3)
      await row.getByRole('link', { name: copy.edit_report, exact: true }).click()
      await expect(page).toHaveURL(new URL(editPath, config.appOrigin).href)
      await ready()
      await expect(input).toHaveValue(summaryC)
      const sessionsAfter = (await pool.query('select id from neon_auth.session where "userId"=$1', [fixture.userId])).rows
      expect(sessionsAfter).toHaveLength(1)
      expect(sessionsAfter[0].id).not.toBe(sessionsBefore[0].id)
      audit.finalSessionIds = sessionsAfter.map(row => row.id)
      expect(await reportRows(pool, fixture)).toEqual(beforeLogout)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await input.scrollIntoViewIfNeeded()
      await shot(page, `${prefix}-03-relogin-latest.png`)
      audit.finalCounts = { reports: 1, versions: 3, receipts: 3 }
      audit.reloginConsistent = true
      expect(audit.forbidden).toEqual([])
      expect(audit.external).toEqual([])
      expect(audit.pageErrors).toEqual([])
      audit.completed = true
      audit.step = 'passed'
    } catch (error) {
      if (pool && audit.fixture) {
        try {
          audit.failureReadback = { rows: await reportRows(pool, audit.fixture),
            api: await get(page, `/api/clients/${audit.fixture.clientId}/reports`) }
        } catch {}
      }
      try { await shot(page, `${prefix}-FAILED-${audit.step}.png`) } catch {}
      throw new Error(redactLocalAuth(error.message, secrets))
    } finally {
      if (pool) await pool.end()
      writeFileSync(join(config.output, `${prefix}-REPORT-LIST.json`), redactLocalAuth(JSON.stringify(audit, null, 2), secrets))
    }
  })
}
