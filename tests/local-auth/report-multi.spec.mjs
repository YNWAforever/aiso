import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import { config, messages, control, login, get, shot } from './support.mjs'
import { allowLocalUrl, evidenceMode, redactLocalAuth } from '../../scripts/ci/local-auth-safety.mjs'
import { reportDatabase, reportRows } from './report-support.mjs'

if (config.scenario !== 'report-multi') throw new Error('LOCAL_AUTH_REPORT_TARGET')
for (const lang of ['en', 'zh-HK']) {
  test(`${lang} multiple private reports retain saved order and isolated versions after back reload relogin`, async ({ page, context, request }, info) => {
    const project = info.project.name, prefix = `${project}-${lang}`
    const email = `${project.endsWith('mobile') ? 'mobile' : 'desktop'}-${lang.toLowerCase()}-${config.runId}@fixture-aiso.example`
    const copy = messages[lang].reports
    const audit = { mode: evidenceMode, lang, project, completed: false, step: 'login',
      saves: [], orders: [], opened: [], external: [], forbidden: [], pageErrors: [], providerCalls: 0 }
    const secrets = [config.controlSecret, config.ownerPassword, config.appPassword,
      config.authPassword, config.engineSecret, config.cookieSecret, config.reportShareSecret]
    let pool
    page.on('pageerror', error => audit.pageErrors.push(error.message))
    await context.route('**/*', route => {
      const path = new URL(route.request().url()).pathname
      try { allowLocalUrl(route.request().url(), config.allowedOrigins) }
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
      expect(fixture).toMatchObject({ fixtureOnly: true, providerCallsAllowed: false, monitoringEnabled: false })
      audit.fixture = fixture
      pool = await reportDatabase()
      audit.initialSessionIds = (await pool.query('select id from neon_auth.session where "userId"=$1', [fixture.userId])).rows.map(row => row.id)
      expect(audit.initialSessionIds).toHaveLength(1)
      const listPath = `/${lang}/dashboard/${fixture.clientId}/reports`
      const input = page.getByLabel(copy.executive_summary, { exact: true })
      const ready = () => expect(page.getByRole('button', { name: copy.review_report, exact: true })).toBeEnabled()
      const text = lang === 'en' ? {
        a1: 'SYNTHETIC ALPHA version one: review this selected scan evidence before changing crawler guidance.',
        b1: 'SYNTHETIC BETA version one: review these selected sources before editing the frequently asked questions.',
        c1: 'SYNTHETIC GAMMA version one: check this saved scan evidence before updating the brand introduction.',
        a2: 'SYNTHETIC ALPHA version two: this older report is now the most recently saved private draft.',
        b2: 'SYNTHETIC BETA version two: this latest private FAQ draft must remain separate from ALPHA and GAMMA.',
      } : {
        a1: '合成甲報告第一版：修改爬蟲指引之前，先核對這次指定掃描的來源證據、適用範圍及需要確認的資料。',
        b1: '合成乙報告第一版：修改常見問題之前，先核對這次指定掃描的來源、相關內容及需要人手確認的資料。',
        c1: '合成丙報告第一版：更新品牌介紹之前，先核對這次指定掃描的來源證據、適用範圍及實際內容。',
        a2: '合成甲報告第二版：這份較早建立的報告剛剛保存更新，現在應是最近儲存的私人草稿，內容不可混用。',
        b2: '合成乙報告第二版：這份最新私人常見問題草稿必須與甲報告及丙報告分開，保留自己的版本及來源關聯。',
      }
      const expected = new Map(), originals = new Map()
      const save = async (reportId, summary, versionNumber) => {
        await ready()
        await input.fill(summary)
        await expect(input).toHaveValue(summary)
        const path = reportId ? `/api/client-reports/${reportId}/versions` : `/api/clients/${fixture.clientId}/reports`
        const sent = page.waitForResponse(response => response.request().method() === 'POST'
          && new URL(response.url()).pathname === path)
        await page.getByRole('button', { name: copy.save_draft, exact: true }).click()
        const response = await sent, data = await response.json()
        expect(response.status()).toBe(201)
        expect(data.reviewArtifact.versionNumber).toBe(versionNumber)
        expect(data.reviewArtifact.snapshot.executiveSummary).toBe(summary)
        if (reportId) expect(data.report.id).toBe(reportId)
        const requestId = response.request().headers()['x-report-request-id']
        const receipt = await get(page, `/api/clients/${fixture.clientId}/report-save-requests/${requestId}`)
        expect(receipt.status).toBe(200)
        expect(receipt.body.receipt.result).toEqual(data)
        const rows = await reportRows(pool, fixture)
        const version = rows.versions.find(row => row.id === data.reviewArtifact.versionId)
        expect(version).toMatchObject({ report_id: data.report.id, source_scan_id: fixture.scanId,
          locale: lang, version_number: versionNumber, executive_summary: summary })
        expect(version.snapshot).toEqual(data.reviewArtifact.snapshot)
        expected.set(data.report.id, { summary, versionId: version.id, versionNumber, snapshot: version.snapshot })
        if (versionNumber === 1) originals.set(version.id, version)
        audit.saves.push({ requestId, reportId: data.report.id, versionId: version.id, versionNumber, summary,
          snapshot: version.snapshot, counts: { reports: rows.reports.length, versions: rows.versions.length, receipts: rows.receipts.length } })
        await expect(page.locator('[data-notice-kind="success"]')).toHaveText(copy.saved)
        return data.report.id
      }
      const rowFor = id => page.locator('main li').filter({ has: page.locator(`a[href="${listPath}/${id}"]`) })
      const expectList = async ids => {
        await expect(page).toHaveURL(new URL(listPath, config.appOrigin).href)
        await expect(page.getByRole('heading', { name: copy.list_title, exact: true })).toBeVisible()
        const links = page.locator('main li a').filter({ hasText: copy.edit_report })
        await expect(links).toHaveCount(ids.length)
        for (let index = 0; index < ids.length; index++) {
          await expect(links.nth(index)).toHaveAttribute('href', `${listPath}/${ids[index]}`)
        }
        const hrefs = await links.evaluateAll(items => items.map(item => item.getAttribute('href')))
        const api = await get(page, `/api/clients/${fixture.clientId}/reports`)
        expect(api.status).toBe(200)
        audit.orders.push({ step: audit.step, expected: ids, ui: hrefs, api: api.body.reports.map(report => report.id) })
        expect(hrefs).toEqual(ids.map(id => `${listPath}/${id}`))
        expect(api.body.reports.map(report => report.id)).toEqual(ids)
        for (const id of ids) {
          const saved = expected.get(id), row = rowFor(id)
          await expect(row).toContainText(copy.latest_version.replace('{version}', String(saved.versionNumber)))
          const dto = api.body.reports.find(report => report.id === id)
          expect(dto).toMatchObject({ id, clientId: fixture.clientId, status: 'draft',
            latestVersionNumber: saved.versionNumber, publishedVersionNumber: null,
            latestVersion: { id: saved.versionId, sourceScanId: fixture.scanId, executiveSummary: saved.summary, locale: lang } })
          await expect(row).toContainText(saved.summary.slice(0, 180))
          await expect(row.locator('time')).toHaveAttribute('datetime', dto.latestVersion.createdAt)
          for (const other of ids.filter(otherId => otherId !== id)) {
            await expect(row).not.toContainText(expected.get(other).summary)
          }
          await expect(row.getByRole('button', { name: copy.open_report, exact: true })).toHaveCount(0)
        }
      }
      const back = async ids => {
        await page.getByRole('link', { name: copy.back_to_reports, exact: true }).click()
        await expectList(ids)
      }
      const open = async id => {
        await rowFor(id).getByRole('link', { name: copy.edit_report, exact: true }).click()
        await expect(page).toHaveURL(new URL(`${listPath}/${id}`, config.appOrigin).href)
        await ready()
        await expect(input).toHaveValue(expected.get(id).summary)
        audit.opened.push({ step: audit.step, reportId: id, versionId: expected.get(id).versionId, summary: await input.inputValue() })
      }
      const assertAllSaved = async () => {
        const rows = await reportRows(pool, fixture)
        expect(rows.reports).toHaveLength(3)
        expect(rows.versions).toHaveLength(5)
        expect(rows.receipts).toHaveLength(5)
        expect(rows.reports.every(row => row.status === 'draft' && row.published_version_id === null)).toBe(true)
        for (const [id, saved] of expected) {
          expect(rows.reports.find(row => row.id === id).latest_version_id).toBe(saved.versionId)
          expect(rows.versions.find(row => row.id === saved.versionId).snapshot).toEqual(saved.snapshot)
          expect(rows.versions.filter(row => row.report_id === id)).toHaveLength(saved.versionNumber)
        }
        for (const [versionId, original] of originals) expect(rows.versions.find(row => row.id === versionId)).toEqual(original)
        return rows
      }
      audit.step = 'create-three-private-reports'
      await page.goto(listPath)
      await expect(page.getByRole('heading', { name: copy.empty_title, exact: true })).toBeVisible()
      const ids = []
      for (const summary of [text.a1, text.b1, text.c1]) {
        await page.goto(`${listPath}/new?scanId=${fixture.scanId}`)
        ids.push(await save(null, summary, 1))
        await back([...ids].reverse())
      }
      const [a, b, c] = ids
      expect(new Set(ids).size).toBe(3)
      audit.reportIds = { a, b, c }
      await shot(page, `${prefix}-01-three-private-reports.png`)
      audit.step = 'resave-older-report-first'
      await open(a)
      await save(a, text.a2, 2)
      await back([a, c, b])
      await shot(page, `${prefix}-02-older-report-saved-first.png`)
      audit.step = 'reopen-another-report-without-mixing'
      await open(b)
      await save(b, text.b2, 2)
      await back([b, a, c])
      await page.goBack()
      await ready()
      await expect(input).toHaveValue(text.b2)
      await page.goForward()
      await expectList([b, a, c])
      for (const id of [a, c, b]) {
        await open(id)
        await page.reload()
        await ready()
        await expect(input).toHaveValue(expected.get(id).summary)
        await back([b, a, c])
      }
      audit.step = 'reload-latest-list'
      await page.reload()
      await expectList([b, a, c])
      await shot(page, `${prefix}-03-latest-list.png`)
      const beforeLogout = await assertAllSaved()
      expect((await get(page, `/api/clients/${fixture.foreignClientId}/reports`)).status).toBe(404)
      audit.foreignWorkspaceDenied = true
      audit.step = 'logout-relogin-latest-report'
      const old = await context.browser().newContext({ baseURL: config.appOrigin, ignoreHTTPSErrors: true,
        storageState: { cookies: await context.cookies(config.appOrigin), origins: [] } })
      await old.route('**/*', route => {
        try { allowLocalUrl(route.request().url(), config.allowedOrigins); return route.continue() }
        catch { audit.external.push(new URL(route.request().url()).pathname); return route.abort('blockedbyclient') }
      })
      try {
        const oldPage = await old.newPage()
        await oldPage.goto(`/${lang}`)
        await page.goto(`/${lang}/auth/logout`)
        await page.waitForURL(`**/${lang}/auth/login`)
        expect((await get(oldPage, `/api/clients/${fixture.clientId}/reports`)).status).toBe(401)
        audit.oldSessionDenied = true
      } finally { await old.close() }
      await login(page, request, lang, email, listPath)
      await expectList([b, a, c])
      await open(b)
      await input.scrollIntoViewIfNeeded()
      await shot(page, `${prefix}-04-relogin-latest-content.png`)
      audit.finalSessionIds = (await pool.query('select id from neon_auth.session where "userId"=$1', [fixture.userId])).rows.map(row => row.id)
      expect(audit.finalSessionIds).toHaveLength(1)
      expect(audit.finalSessionIds[0]).not.toBe(audit.initialSessionIds[0])
      expect(await assertAllSaved()).toEqual(beforeLogout)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      expect(audit.pageErrors).toEqual([])
      expect(audit.external).toEqual([])
      expect(audit.forbidden).toEqual([])
      audit.finalCounts = { reports: 3, versions: 5, receipts: 5 }
      audit.reloginConsistent = true
      audit.originalVersionsUnchanged = true
      audit.completed = true
      audit.step = 'passed'
    } catch (error) {
      if (pool && audit.fixture) {
        try { audit.failureReadback = { rows: await reportRows(pool, audit.fixture),
          api: await get(page, `/api/clients/${audit.fixture.clientId}/reports`) } } catch {}
      }
      try { await shot(page, `${prefix}-FAILED-${audit.step}.png`) } catch {}
      throw new Error(redactLocalAuth(error.message, secrets))
    } finally {
      if (pool) await pool.end()
      writeFileSync(join(config.output, `${prefix}-REPORT-MULTI.json`), redactLocalAuth(JSON.stringify(audit, null, 2), secrets))
    }
  })
}
