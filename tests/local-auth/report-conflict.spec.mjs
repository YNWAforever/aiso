import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import { config, messages, control, login, get, shot } from './support.mjs'
import { allowLocalUrl, evidenceMode, redactLocalAuth } from '../../scripts/ci/local-auth-safety.mjs'
import { interruptCommittedSave, reportDatabase, reportRows } from './report-support.mjs'

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

  test(`${lang} lost save acknowledgement preserves the later tab version while readback and retry replay once`, async ({ page, context, request }, info) => {
    const project = info.project.name, prefix = `${project}-${lang}-response-lost`
    const email = `${project.endsWith('mobile') ? 'mobile' : 'desktop'}-${lang.toLowerCase()}-response-lost-${config.runId}@fixture-aiso.example`
    const copy = messages[lang].reports
    const audit = { mode: evidenceMode, lang, project, completed: false, step: 'login',
      requests: [], disruptions: [], external: [], forbidden: [], pageErrors: [], providerCalls: 0 }
    const secrets = [config.controlSecret, config.ownerPassword, config.appPassword,
      config.authPassword, config.engineSecret, config.cookieSecret, config.reportShareSecret]
    let pool, pageB
    page.on('pageerror', error => audit.pageErrors.push(error.message))
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
      const originalText = lang === 'en'
        ? 'SYNTHETIC original edit: this response will be lost after the server commits and this exact request may be retried once.'
        : '合成原本修改：這個回應會在伺服器提交後遺失，而相同的原始請求只可以安全重試一次。'
      const laterText = lang === 'en'
        ? 'SYNTHETIC later tab edit: this newer version must remain latest after receipt readback and original retry.'
        : '合成較後分頁修改：讀回原本 receipt 及重試原請求後，這個較新版本仍必須保持為最新。'
      const input = page.getByLabel(copy.executive_summary, { exact: true })
      const ready = target => expect(target.getByRole('button', { name: copy.review_report, exact: true })).toBeEnabled()

      audit.step = 'create-shared-draft'
      await page.goto(`${listPath}/new?scanId=${fixture.scanId}`)
      await ready(page)
      await input.fill(initial)
      const createdResponse = page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === `/api/clients/${fixture.clientId}/reports`)
      await page.getByRole('button', { name: copy.save_draft, exact: true }).click()
      const createdHttp = await createdResponse, created = await createdHttp.json()
      expect(createdHttp.status()).toBe(201)
      expect(created.reviewArtifact.versionNumber).toBe(1)
      const reportId = created.report.id, editPath = `${listPath}/${reportId}`
      const versionPath = `/api/client-reports/${reportId}/versions`
      audit.reportId = reportId
      audit.created = {
        requestId: createdHttp.request().headers()['x-report-request-id'],
        versionId: created.reviewArtifact.versionId,
      }

      audit.step = 'original-request-commits-response-lost'
      await page.goto(editPath)
      await ready(page)
      await input.fill(originalText)
      const disruption = await interruptCommittedSave(page, versionPath, 'drop', audit)
      await page.getByRole('button', { name: copy.save_draft, exact: true }).click()
      await expect(page.locator('[data-notice-kind="warning"]')).toHaveText(copy.save_unknown)
      const committed = await disruption.captured()
      await disruption.close()
      expect(committed.status).toBe(201)
      expect(committed.result.reviewArtifact.versionNumber).toBe(2)
      expect(committed.expectedVersion).toBe(created.reviewArtifact.versionId)
      audit.original = {
        requestId: committed.requestId, expectedVersion: committed.expectedVersion,
        versionId: committed.result.reviewArtifact.versionId, versionNumber: 2,
      }

      audit.step = 'later-tab-saves-newer-version'
      pageB = await context.newPage()
      pageB.on('pageerror', error => audit.pageErrors.push(error.message))
      await pageB.goto(editPath)
      await ready(pageB)
      const inputB = pageB.getByLabel(copy.executive_summary, { exact: true })
      await expect(inputB).toHaveValue(originalText)
      await inputB.fill(laterText)
      const laterResponse = pageB.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === versionPath)
      await pageB.getByRole('button', { name: copy.save_draft, exact: true }).click()
      const laterHttp = await laterResponse, later = await laterHttp.json()
      expect(laterHttp.status()).toBe(201)
      expect(later.reviewArtifact.versionNumber).toBe(3)
      audit.later = {
        requestId: laterHttp.request().headers()['x-report-request-id'],
        expectedVersion: laterHttp.request().headers()['x-report-expected-version-id'],
        versionId: later.reviewArtifact.versionId, versionNumber: 3,
      }
      const afterLater = await reportRows(pool, fixture)
      expect(afterLater.reports).toHaveLength(1)
      expect(afterLater.versions).toHaveLength(3)
      expect(afterLater.receipts).toHaveLength(3)
      expect(afterLater.reports[0].latest_version_id).toBe(later.reviewArtifact.versionId)
      audit.afterLater = {
        reports: afterLater.reports.length, versions: afterLater.versions.length,
        receipts: afterLater.receipts.length, latestVersionId: afterLater.reports[0].latest_version_id,
      }

      audit.step = 'read-back-original-receipt'
      await page.getByRole('button', { name: copy.check_saved_draft, exact: true }).click()
      await expect(page.locator('[data-notice-kind="warning"]')).toHaveText(copy.save_recovered_superseded)
      await expect(page.getByRole('heading', { name: copy.save_recovered_superseded_title, exact: true })).toBeVisible()
      await expect(input).toHaveValue(originalText)
      await expect(page.getByRole('button', { name: copy.save_draft, exact: true })).toBeDisabled()
      await expect(page.getByRole('button', { name: copy.polish_ai, exact: true })).toBeDisabled()
      await expect(page.getByRole('button', { name: copy.review_report, exact: true })).toBeDisabled()
      const reloadLatest = page.getByRole('button', { name: copy.reload_latest, exact: true })
      await expect(reloadLatest).toBeEnabled()
      const readback = await get(page,
        `/api/clients/${fixture.clientId}/report-save-requests/${committed.requestId}`)
      expect(readback.status).toBe(200)
      expect(readback.body.receipt.result.reviewArtifact.versionId).toBe(committed.result.reviewArtifact.versionId)
      expect(readback.body.receipt.result.currentLatestVersionId).toBe(later.reviewArtifact.versionId)
      expect(readback.body.receipt.result.currentLatestVersionNumber).toBe(3)

      audit.step = 'retry-original-request'
      const retried = await context.request.post(new URL(versionPath, config.appOrigin).href, {
        headers: {
          'Content-Type': 'application/json',
          'X-Report-Request-Id': committed.requestId,
          'X-Report-Scan-Id': fixture.scanId,
          'X-Report-Expected-Version-Id': committed.expectedVersion,
        },
        data: committed.body,
        timeout: 30000,
      })
      const retriedBody = await retried.json()
      expect(retried.status()).toBe(201)
      expect(retriedBody.reviewArtifact.versionId).toBe(committed.result.reviewArtifact.versionId)
      expect(retriedBody.currentLatestVersionId).toBe(later.reviewArtifact.versionId)
      expect(retriedBody.currentLatestVersionNumber).toBe(3)
      const afterRetry = await reportRows(pool, fixture)
      expect(afterRetry).toEqual(afterLater)
      audit.retry = {
        status: retried.status(), requestId: committed.requestId,
        versionId: retriedBody.reviewArtifact.versionId,
        currentLatestVersionId: retriedBody.currentLatestVersionId,
        currentLatestVersionNumber: retriedBody.currentLatestVersionNumber,
      }
      audit.afterRetry = {
        reports: afterRetry.reports.length, versions: afterRetry.versions.length,
        receipts: afterRetry.receipts.length, latestVersionId: afterRetry.reports[0].latest_version_id,
      }
      await page.getByRole('heading', { name: copy.save_recovered_superseded_title, exact: true }).scrollIntoViewIfNeeded()
      await shot(page, `${prefix}-01-superseded-receipt.png`)

      audit.step = 'reload-later-version'
      page.once('dialog', dialog => dialog.accept())
      const pageReload = page.waitForEvent('load')
      await Promise.all([pageReload, reloadLatest.click()])
      await ready(page)
      await expect(input).toHaveValue(laterText)
      await shot(page, `${prefix}-02-later-after-reload.png`)
      expect(afterRetry.reports[0].latest_version_id).toBe(later.reviewArtifact.versionId)

      audit.step = 'relogin-canonical-latest'
      await pageB.close(); pageB = null
      await page.goto(`/${lang}/auth/logout`)
      await page.waitForURL(`**/${lang}/auth/login`)
      await login(page, request, lang, email, editPath)
      await ready(page)
      await expect(input).toHaveValue(laterText)
      expect(await reportRows(pool, fixture)).toEqual(afterRetry)
      audit.finalSessionIds = (await pool.query('select id from neon_auth.session where "userId"=$1', [fixture.userId])).rows.map(row => row.id)
      expect(audit.finalSessionIds).toHaveLength(1)
      expect(audit.finalSessionIds[0]).not.toBe(audit.initialSessionIds[0])
      expect((await get(page, `/api/clients/${fixture.foreignClientId}/reports`)).status).toBe(404)
      audit.foreignWorkspaceDenied = true
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      expect(audit.pageErrors).toEqual([])
      expect(audit.external).toEqual([])
      expect(audit.forbidden).toEqual([])
      audit.finalCounts = { reports: 1, versions: 3, receipts: 3 }
      audit.completed = true
      audit.step = 'passed'
      await shot(page, `${prefix}-03-relogin-later-version.png`)
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
      writeFileSync(join(config.output, `${prefix}-REPORT-CONFLICT-RECOVERY.json`),
        redactLocalAuth(JSON.stringify(audit, null, 2), secrets))
    }
  })
}
