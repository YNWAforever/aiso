import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import { config, messages, control, login, get, shot } from './support.mjs'
import { allowLocalUrl, evidenceMode, redactLocalAuth } from '../../scripts/ci/local-auth-safety.mjs'
import { reportDatabase, reportRows } from './report-support.mjs'

if (config.scenario !== 'report-conflict') throw new Error('LOCAL_AUTH_REPORT_TARGET')
for (const lang of ['en', 'zh-HK']) {
  test(`${lang} two tabs racing the same draft reject the stale save and preserve both edits`, async ({ page, context, request }, info) => {
    const project = info.project.name, prefix = `${project}-${lang}`
    const email = `${project.endsWith('mobile') ? 'mobile' : 'desktop'}-${lang.toLowerCase()}-${config.runId}@fixture-aiso.example`
    const copy = messages[lang].reports
    const audit = { mode: evidenceMode, lang, project, completed: false, step: 'login',
      requests: [], external: [], forbidden: [], pageErrors: [], providerCalls: 0 }
    const secrets = [config.controlSecret, config.ownerPassword, config.appPassword,
      config.authPassword, config.engineSecret, config.cookieSecret, config.reportShareSecret]
    let pool, pageB
    for (const candidate of [page]) candidate.on('pageerror', error => audit.pageErrors.push(error.message))
    try {
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
      await login(page, request, lang, email, `/${lang}/dashboard`)
      const fixture = await control(request, '/__local/report-fixture', { email })
      expect(fixture).toMatchObject({ fixtureOnly: true, providerCallsAllowed: false, monitoringEnabled: false })
      audit.fixture = fixture
      pool = await reportDatabase()
      audit.initialSessionIds = (await pool.query('select id from neon_auth.session where "userId"=$1', [fixture.userId])).rows.map(row => row.id)
      expect(audit.initialSessionIds).toHaveLength(1)
      const listPath = `/${lang}/dashboard/${fixture.clientId}/reports`
      const initial = lang === 'en'
        ? 'SYNTHETIC shared draft version one: both tabs loaded this evidence before either made a change.'
        : '合成共享草稿第一版：兩個分頁都在任何修改之前載入這份相同來源證據、適用範圍及需要人手確認的資料。'
      const editA = lang === 'en'
        ? 'SYNTHETIC tab A edit: keep this text if tab B wins the race, and do not save over the newer version.'
        : '合成甲分頁修改：如果乙分頁勝出，必須保留這段文字，並禁止再儲存而覆蓋較新版本，交由人手處理。'
      const editB = lang === 'en'
        ? 'SYNTHETIC tab B edit: exactly one concurrent save may become the new latest private version.'
        : '合成乙分頁修改：兩個同時提交只可以有一個成為最新私人版本，另一個必須明確衝突，交由人手處理。'
      const inputA = page.getByLabel(copy.executive_summary, { exact: true })
      const ready = target => expect(target.getByRole('button', { name: copy.review_report, exact: true })).toBeEnabled()
      audit.step = 'create-shared-draft'
      await page.goto(`${listPath}/new?scanId=${fixture.scanId}`)
      await ready(page)
      await inputA.fill(initial)
      await expect(inputA).toHaveValue(initial)
      const createdResponse = page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === `/api/clients/${fixture.clientId}/reports`)
      await page.getByRole('button', { name: copy.save_draft, exact: true }).click()
      const createdHttp = await createdResponse, created = await createdHttp.json()
      expect(createdHttp.status()).toBe(201)
      expect(created.reviewArtifact.versionNumber).toBe(1)
      const createRequestId = createdHttp.request().headers()['x-report-request-id']
      const reportId = created.report.id, editPath = `${listPath}/${reportId}`
      audit.reportId = reportId
      audit.created = { requestId: createRequestId, versionId: created.reviewArtifact.versionId, versionNumber: 1 }
      pageB = await context.newPage()
      pageB.on('pageerror', error => audit.pageErrors.push(error.message))
      audit.step = 'two-tabs-load-same-version'
      await page.goto(editPath)
      await pageB.goto(editPath)
      await ready(page)
      await ready(pageB)
      const inputB = pageB.getByLabel(copy.executive_summary, { exact: true })
      await expect(inputA).toHaveValue(initial)
      await expect(inputB).toHaveValue(initial)
      audit.loaded = { tabA: await inputA.inputValue(), tabB: await inputB.inputValue() }
      await inputA.fill(editA)
      await inputB.fill(editB)
      const responseFor = (target, tab) => target.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === `/api/client-reports/${reportId}/versions`)
        .then(response => ({
          tab, status: response.status(), requestId: response.request().headers()['x-report-request-id'],
        }))
      const responseA = responseFor(page, 'A'), responseB = responseFor(pageB, 'B')
      audit.step = 'simultaneous-save'
      await Promise.all([
        page.getByRole('button', { name: copy.save_draft, exact: true }).click(),
        pageB.getByRole('button', { name: copy.save_draft, exact: true }).click(),
      ])
      audit.requests = await Promise.all([responseA, responseB])
      const statuses = audit.requests.map(row => row.status).sort((left, right) => left - right)
      const covered = await reportRows(pool, fixture)
      audit.covered = { reports: covered.reports.length, versions: covered.versions.length, receipts: covered.receipts.length,
        latestVersionId: covered.reports[0]?.latest_version_id }
      await shot(page, `${prefix}-01-tab-a-after-race.png`)
      await shot(pageB, `${prefix}-02-tab-b-after-race.png`)
      expect(statuses).toEqual([201, 409])
      const winner = audit.requests.find(row => row.status === 201)
      const loser = audit.requests.find(row => row.status === 409)
      const winningText = winner.tab === 'A' ? editA : editB
      winner.versionId = covered.versions[1].id
      expect(covered.reports).toHaveLength(1)
      expect(covered.versions).toHaveLength(2)
      expect(covered.receipts).toHaveLength(2)
      expect(covered.reports[0].latest_version_id).toBe(winner.versionId)
      expect(covered.versions.map(version => version.executive_summary)).toEqual([
        initial, winningText,
      ])
      expect(covered.versions.every(version => version.source_scan_id === fixture.scanId && version.locale === lang)).toBe(true)
      expect(covered.receipts.map(receipt => receipt.request_id).sort()).toEqual([createRequestId, winner.requestId].sort())
      expect(covered.receipts.some(receipt => receipt.request_id === loser.requestId)).toBe(false)
      expect(covered.versions[1].version_number).toBe(2)
      const winnerPage = winner.tab === 'A' ? page : pageB
      const loserPage = loser.tab === 'A' ? page : pageB
      const loserInput = loserPage.getByLabel(copy.executive_summary, { exact: true })
      await expect(winnerPage.locator('[data-notice-kind="success"]')).toHaveText(copy.saved)
      await expect(loserPage.locator('[data-notice-kind="error"]')).toHaveText(copy.save_conflict)
      await expect(loserInput).toHaveValue(loser.tab === 'A' ? editA : editB)
      await expect(loserPage.getByRole('button', { name: copy.save_draft, exact: true })).toBeDisabled()
      await expect(loserPage.getByRole('heading', { name: copy.save_conflict_title, exact: true })).toBeVisible()
      const reloadLatest = loserPage.getByRole('button', { name: copy.reload_latest, exact: true })
      await expect(reloadLatest).toBeEnabled()
      audit.loserPreviewPreserved = true
      audit.winner = winner.tab
      audit.loser = loser.tab
      audit.step = 'reload-both-tabs'
      loserPage.once('dialog', dialog => dialog.accept())
      const loserReload = loserPage.waitForEvent('load')
      await Promise.all([page.reload(), loserReload, reloadLatest.click()])
      await ready(page)
      await ready(pageB)
      await expect(inputA).toHaveValue(winner.tab === 'A' ? editA : editB)
      await expect(pageB.getByLabel(copy.executive_summary, { exact: true })).toHaveValue(winner.tab === 'A' ? editA : editB)
      expect((await get(page, `/api/clients/${fixture.clientId}/reports`)).body.reports[0].latestVersionNumber).toBe(2)
      expect((await get(pageB, `/api/clients/${fixture.clientId}/reports`)).body.reports[0].latestVersionNumber).toBe(2)
      await shot(page, `${prefix}-03-winner-after-reload.png`)
      audit.step = 'relogin-canonical-latest'
      await pageB.close(); pageB = null
      await page.goto(`/${lang}/auth/logout`)
      await page.waitForURL(`**/${lang}/auth/login`)
      await login(page, request, lang, email, editPath)
      await ready(page)
      await expect(inputA).toHaveValue(winner.tab === 'A' ? editA : editB)
      const final = await reportRows(pool, fixture)
      expect(final).toEqual(covered)
      audit.finalSessionIds = (await pool.query('select id from neon_auth.session where "userId"=$1', [fixture.userId])).rows.map(row => row.id)
      expect(audit.finalSessionIds).toHaveLength(1)
      expect(audit.finalSessionIds[0]).not.toBe(audit.initialSessionIds[0])
      expect((await get(page, `/api/clients/${fixture.foreignClientId}/reports`)).status).toBe(404)
      audit.foreignWorkspaceDenied = true
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      expect(audit.pageErrors).toEqual([])
      expect(audit.external).toEqual([])
      expect(audit.forbidden).toEqual([])
      audit.finalCounts = { reports: 1, versions: 2, receipts: 2 }
      audit.completed = true
      audit.step = 'passed'
      await shot(page, `${prefix}-04-relogin-latest.png`)
    } catch (error) {
      if (pageB) {
        try { await shot(pageB, `${prefix}-FAILED-B-${audit.step}.png`) } catch {}
      }
      if (pool && audit.fixture) {
        try { audit.failureReadback = { rows: await reportRows(pool, audit.fixture),
          api: await get(page, `/api/clients/${audit.fixture.clientId}/reports`) } } catch {}
      }
      try { await shot(page, `${prefix}-FAILED-A-${audit.step}.png`) } catch {}
      throw new Error(redactLocalAuth(error.message, secrets))
    } finally {
      if (pageB) await pageB.close().catch(() => {})
      if (pool) await pool.end()
      writeFileSync(join(config.output, `${prefix}-REPORT-CONFLICT.json`), redactLocalAuth(JSON.stringify(audit, null, 2), secrets))
    }
  })
}
