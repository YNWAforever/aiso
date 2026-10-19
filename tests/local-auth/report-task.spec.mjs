import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import { config, messages, control, login, get, shot } from './support.mjs'
import {
  allowLocalUrl,
  evidenceMode,
  redactLocalAuth,
} from '../../scripts/ci/local-auth-safety.mjs'
import { reportDatabase, reportRows } from './report-support.mjs'

if (config.scenario !== 'report-task') throw new Error('LOCAL_AUTH_REPORT_TARGET')

async function workItemRows(pool, fixture, itemId) {
  const items = (await pool.query(`select id,account_id,client_id,revision,target_url,
      due_at::text as due_at,acceptance_criteria,operation_status,notes,updated_at,evidence_snapshot
    from public.evidence_work_items
    where account_id=$1 and client_id=$2 and id=$3`, [fixture.accountId, fixture.clientId, itemId])).rows
  const sources = (await pool.query(`select source_kind,source_id,check_key,rule_version,
      evidence_fingerprint,evidence_snapshot,withdrawn_at
    from public.work_item_sources
    where account_id=$1 and client_id=$2 and work_item_id=$3`, [fixture.accountId, fixture.clientId, itemId])).rows
  return { items, sources }
}

async function ensureOperationsOpen(page, label) {
  const details = page.locator('details').filter({ hasText: label }).first()
  const open = await details.evaluate(element => element.open)
  if (!open) await details.locator('summary').click()
}

async function setVisibleDueDateWithoutInputEvent(page, dueAtValue) {
  await page.evaluate(({ dueAtValue }) => {
    const date = document.querySelector('input[type="date"]')
    if (!(date instanceof HTMLInputElement)) throw new Error('SYNTHETIC_DUE_DATE_CONTROL_NOT_FOUND')

    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    if (!setter) throw new Error('SYNTHETIC_NATIVE_VALUE_SETTER_NOT_FOUND')
    setter.call(date, dueAtValue)
  }, { dueAtValue })
}

for (const lang of ['en', 'zh-HK']) {
  test(`${lang} report finding v2 task provenance, v3 warning, report and reload`, async ({ page, context, request }, info) => {
    const project = info.project.name, prefix = `${project}-${lang}`
    const email = `${project.endsWith('mobile') ? 'mobile' : 'desktop'}-${lang.toLowerCase()}-${config.runId}@fixture-aiso.example`
    const reportCopy = messages[lang].reports
    const opportunityCopy = messages[lang].opportunities
    const audit = {
      mode: evidenceMode, lang, project, completed: false, step: 'login',
      reports: [], taskCreates: [], taskReplays: [], taskReads: [],
      external: [], forbidden: [], requestFailures: [], pageErrors: [], providerCalls: 0,
    }
    const secrets = [
      config.controlSecret, config.ownerPassword, config.appPassword,
      config.authPassword, config.engineSecret, config.cookieSecret,
      config.reportShareSecret,
    ]
    let pool, taskId
    page.on('pageerror', error => audit.pageErrors.push(error.message))
    page.on('requestfailed', request => audit.requestFailures.push({
      path: new URL(request.url()).pathname,
      method: request.method(),
      error: request.failure()?.errorText ?? 'unknown',
    }))
    await context.route('**/*', route => {
      const path = new URL(route.request().url()).pathname
      try {
        allowLocalUrl(route.request().url(), config.allowedOrigins)
      } catch {
        audit.external.push(path)
        return route.abort('blockedbyclient')
      }
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
      expect(fixture).toMatchObject({
        fixtureOnly: true,
        providerCallsAllowed: false,
        monitoringEnabled: false,
      })
      audit.fixture = fixture
      pool = await reportDatabase()
      const initialSessions = (await pool.query(
        'select id from neon_auth.session where "userId"=$1',
        [fixture.userId],
      )).rows
      expect(initialSessions).toHaveLength(1)
      audit.initialSessionIds = initialSessions.map(row => row.id)

      audit.step = 'create-report-v1'
      const listPath = `/${lang}/dashboard/${fixture.clientId}/reports`
      await page.goto(`${listPath}/new?scanId=${fixture.scanId}`)
      const summaryInput = page.getByLabel(reportCopy.executive_summary, { exact: true })
      const saveDraft = page.getByRole('button', { name: reportCopy.save_draft, exact: true })
      await expect(page.getByRole('button', { name: reportCopy.review_report, exact: true })).toBeEnabled()

      const summaries = lang === 'en' ? {
        v1: 'SYNTHETIC report version one: review the selected crawler evidence before preparing an improvement.',
        v2: 'SYNTHETIC report version two: preserve this exact version when the improvement task is created.',
        v3: 'SYNTHETIC report version three: this newer report must warn without rewriting the task evidence.',
      } : {
        v1: '合成報告第一版：準備改善前，請先核對指定掃描的爬蟲來源證據、適用範圍、可安全展示的資料及尚未確認的限制，再由人手審閱下一步。',
        v2: '合成報告第二版：建立改善任務時，必須凍結現正查看的報告版本、來源掃描、問題內容及引用；日後較新版本不得靜默改寫已保存的歷史證據。',
        v3: '合成報告第三版：較新報告只可提示版本差異及提供查看入口，不得自動遷移或改寫原任務的版本、問題、來源掃描及引用紀錄。',
      }
      const changedNotes = lang === 'en'
        ? 'SYNTHETIC human change: updated the reviewed robots guidance and recorded the limits.'
        : '合成人手修改：已更新經審閱的 robots 指引，並記錄適用範圍及限制。'
      const changedTarget = 'https://fixture-aiso.example/robots.txt'
      const changedDueAt = '2026-10-30'
      const changedAcceptance = lang === 'en'
        ? 'A reviewer confirms that the saved crawler guidance is present and reachable.'
        : '由審閱者確認已儲存的爬蟲指引存在並可存取。'

      const saveReportVersion = async ({ summary, versionNumber, create = false, reportId }) => {
        await expect(page.getByRole('button', { name: reportCopy.review_report, exact: true })).toBeEnabled()
        await summaryInput.fill(summary)
        await expect(summaryInput).toHaveValue(summary)
        const path = create
          ? `/api/clients/${fixture.clientId}/reports`
          : `/api/client-reports/${reportId}/versions`
        const sent = page.waitForResponse(response => response.request().method() === 'POST'
          && new URL(response.url()).pathname === path)
        await saveDraft.click()
        const response = await sent
        const body = await response.json()
        expect(response.status()).toBe(201)
        expect(body.reviewArtifact).toMatchObject({
          versionNumber,
          snapshot: expect.objectContaining({ executiveSummary: summary, locale: lang }),
        })
        audit.reports.push({
          reportId: body.report.id,
          versionId: body.reviewArtifact.versionId,
          versionNumber,
          summary,
        })
        return body
      }

      const v1 = await saveReportVersion({ summary: summaries.v1, versionNumber: 1, create: true })
      const reportId = v1.report.id
      const reportPath = `${listPath}/${reportId}`
      audit.reportId = reportId

      audit.step = 'create-report-v2'
      await page.goto(reportPath)
      const v2 = await saveReportVersion({ summary: summaries.v2, versionNumber: 2, reportId })
      const v2Id = v2.reviewArtifact.versionId
      await page.goto(reportPath)

      audit.step = 'create-task-from-v2'
      const finding = page.locator('[data-finding-key="c1_robots"]')
      await expect(finding).toBeVisible()
      await expect(finding).toContainText(reportCopy.findings_report_version.replace('{version}', '2'))
      const createTask = finding.getByRole('button', { name: reportCopy.findings_create_task, exact: true })
      const createResponse = page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === `/api/clients/${fixture.clientId}/work-items`)
      await createTask.click()
      const createdHttp = await createResponse
      const created = await createdHttp.json()
      const createPayload = createdHttp.request().postDataJSON()
      audit.taskCreateAttempt = {
        status: createdHttp.status(),
        body: created,
        payload: createPayload,
      }
      if (createdHttp.status() !== 201) {
        const { reportVersionId: ignoredReportVersionId, ...withoutReportVersion } = createPayload
        void ignoredReportVersionId
        audit.taskCreateWithoutReportProbe = await get(
          page,
          `/api/clients/${fixture.clientId}/work-items`,
          'POST',
          withoutReportVersion,
        )
      }
      expect(createdHttp.status(), JSON.stringify(created)).toBe(201)
      expect(createPayload.reportVersionId).toBe(v2Id)
      expect(created.item.evidenceSnapshot.reportProvenance).toMatchObject({
        reportId,
        reportVersionId: v2Id,
        reportVersionNumber: 2,
        findingKey: 'c1_robots',
        targetOrigin: 'https://fixture-aiso.example',
      })
      taskId = created.item.id
      audit.taskCreates.push({
        payload: createPayload,
        taskId,
        reportProvenance: created.item.evidenceSnapshot.reportProvenance,
      })

      const replay = await get(
        page,
        `/api/clients/${fixture.clientId}/work-items`,
        'POST',
        createPayload,
      )
      expect(replay.status).toBe(200)
      expect(replay.body.item.id).toBe(taskId)
      audit.taskReplays.push({ status: replay.status, taskId: replay.body.item.id })

      audit.step = 'create-report-v3'
      await page.goto(reportPath)
      const v3 = await saveReportVersion({ summary: summaries.v3, versionNumber: 3, reportId })
      await page.goto(reportPath)
      await expect(page.getByLabel(reportCopy.executive_summary, { exact: true }))
        .toHaveValue(summaries.v3)

      audit.step = 'reopen-task-with-v3-warning'
      await finding.getByRole('button', { name: reportCopy.findings_open_task, exact: true }).click()
      const provenanceVersion = page.locator('[data-report-provenance-version="2"]')
      await expect(provenanceVersion).toBeVisible()
      await expect(page.getByText(
        opportunityCopy.reportSourceNewer
          .replace('{latest}', '3')
          .replace('{original}', '2'),
        { exact: true },
      )).toBeVisible()

      audit.step = 'record-human-change'
      await ensureOperationsOpen(page, opportunityCopy.operationsTitle)
      const notes = page.getByRole('textbox', { name: opportunityCopy.notes, exact: true })
      const target = page.getByRole('textbox', { name: opportunityCopy.targetUrl, exact: true })
      const acceptance = page.getByRole('textbox', { name: opportunityCopy.acceptanceCriteria, exact: true })
      const dueAt = page.getByRole('textbox', { name: opportunityCopy.dueAt, exact: true })
      const status = page.locator('select').filter({ has: page.locator('option[value="done"]') })
      await notes.fill(changedNotes)
      const noteSave = page.waitForResponse(response => response.request().method() === 'PATCH'
        && new URL(response.url()).pathname === `/api/clients/${fixture.clientId}/work-items/${taskId}`)
      await page.getByRole('button', { name: opportunityCopy.saveChanges, exact: true }).click()
      expect((await noteSave).status()).toBe(200)
      await expect(page.locator('[data-operation-revision="2"]')).toBeVisible()
      await target.fill(changedTarget)
      await acceptance.fill(changedAcceptance)
      await status.selectOption('done')
      await setVisibleDueDateWithoutInputEvent(page, changedDueAt)
      await expect(dueAt).toHaveValue(changedDueAt)
      const operationSave = page.waitForResponse(response => response.request().method() === 'PATCH'
        && new URL(response.url()).pathname === `/api/clients/${fixture.clientId}/work-items/${taskId}/operations`)
      await page.getByRole('button', { name: opportunityCopy.saveOperations, exact: true }).click()
      const operationResponse = await operationSave
      expect(operationResponse.status()).toBe(200)
      const operationBody = operationResponse.request().postDataJSON()
      expect(operationBody).toMatchObject({
        dueAt: changedDueAt,
        operationStatus: 'done',
      })
      await expect(page.locator('[data-operation-reported="pending-verification"]')).toBeVisible()
      await expect(page.locator('[data-verification-state="insufficient_evidence"]')).toBeVisible()
      await expect(page.getByText(opportunityCopy.verificationInsufficient, { exact: true })).toBeVisible()

      const databaseAfterReport = await workItemRows(pool, fixture, taskId)
      expect(databaseAfterReport.items).toHaveLength(1)
      expect(databaseAfterReport.items[0]).toMatchObject({
        id: taskId,
        account_id: fixture.accountId,
        client_id: fixture.clientId,
        revision: 3,
        target_url: changedTarget,
        due_at: changedDueAt,
        acceptance_criteria: changedAcceptance,
        operation_status: 'done',
        notes: changedNotes,
      })
      audit.dueAtPersistence = {
        requestDueAt: operationBody.dueAt,
        databaseDueAt: databaseAfterReport.items[0].due_at,
        reloadVerified: false,
        reloginVerified: false,
      }
      expect(databaseAfterReport.items[0].evidence_snapshot.reportProvenance).toMatchObject({
        reportVersionId: v2Id,
        reportVersionNumber: 2,
      })
      expect(databaseAfterReport.sources).toHaveLength(1)
      expect(databaseAfterReport.sources[0]).toMatchObject({
        source_kind: 'scan-check',
        source_id: fixture.scanId,
        check_key: 'c1_robots',
        withdrawn_at: null,
      })
      expect(databaseAfterReport.sources[0].evidence_snapshot)
        .toEqual(databaseAfterReport.items[0].evidence_snapshot)
      const reportData = await reportRows(pool, fixture)
      expect(reportData.reports).toHaveLength(1)
      expect(reportData.versions.map(row => row.version_number)).toEqual([1, 2, 3])
      expect(reportData.reports[0].published_version_id).toBeNull()
      expect(reportData.versions.every(row => row.source_scan_id === fixture.scanId && row.locale === lang))
        .toBe(true)
      const listed = await get(page, `/api/clients/${fixture.clientId}/work-items`)
      expect(listed.status).toBe(200)
      expect(listed.body.items.filter(item => item.id === taskId)).toHaveLength(1)
      const foreign = await get(page, `/api/clients/${fixture.foreignClientId}/work-items/${taskId}`)
      expect(foreign.status).toBe(404)
      audit.foreignWorkspaceDenied = foreign.status
      await shot(page, `${prefix}-01-v2-provenance-v3-warning-pending.png`)

      audit.step = 'reload-task'
      await page.reload()
      await finding.getByRole('button', { name: reportCopy.findings_open_task, exact: true }).click()
      await expect(page.locator('[data-report-provenance-version="2"]')).toBeVisible()
      await ensureOperationsOpen(page, opportunityCopy.operationsTitle)
      await expect(notes).toHaveValue(changedNotes)
      await expect(target).toHaveValue(changedTarget)
      await expect(acceptance).toHaveValue(changedAcceptance)
      await expect(dueAt).toHaveValue(changedDueAt)
      audit.dueAtPersistence.reloadVerified = true
      await expect(page.locator('[data-operation-reported="pending-verification"]')).toBeVisible()

      audit.step = 'relogin-task'
      const savedPath = new URL(page.url()).pathname
      const oldCookies = await context.cookies(config.appOrigin)
      const old = await context.browser().newContext({
        baseURL: config.appOrigin,
        ignoreHTTPSErrors: true,
        storageState: { cookies: oldCookies, origins: [] },
      })
      await old.route('**/*', route => {
        try {
          allowLocalUrl(route.request().url(), config.allowedOrigins)
          return route.continue()
        } catch {
          return route.abort('blockedbyclient')
        }
      })
      try {
        const oldPage = await old.newPage()
        await oldPage.goto(`/${lang}`)
        await page.goto(`/${lang}/auth/logout`)
        await page.waitForURL(`**/${lang}/auth/login`)
        expect(await get(oldPage, `/api/clients/${fixture.clientId}/work-items/${taskId}`))
          .toEqual({ status: 401, body: { error: 'UNAUTHENTICATED' } })
        audit.oldSessionDenied = true
      } finally {
        await old.close()
      }
      await login(page, request, lang, email, savedPath)
      expect(new URL(page.url()).pathname).toBe(savedPath)
      await finding.getByRole('button', { name: reportCopy.findings_open_task, exact: true }).click()
      await expect(page.locator('[data-report-provenance-version="2"]')).toBeVisible()
      await ensureOperationsOpen(page, opportunityCopy.operationsTitle)
      await expect(notes).toHaveValue(changedNotes)
      await expect(target).toHaveValue(changedTarget)
      await expect(dueAt).toHaveValue(changedDueAt)
      audit.dueAtPersistence.reloginVerified = true
      await expect(page.locator('[data-operation-reported="pending-verification"]')).toBeVisible()
      await expect(page.locator('[data-verification-state="insufficient_evidence"]')).toBeVisible()

      const taskRead = await get(page, `/api/clients/${fixture.clientId}/work-items/${taskId}`)
      expect(taskRead.status).toBe(200)
      expect(taskRead.body.item).toMatchObject({
        id: taskId,
        clientId: fixture.clientId,
        revision: 3,
        notes: changedNotes,
      })
      expect(taskRead.body.item.evidenceSnapshot.reportProvenance).toMatchObject({
        reportVersionId: v2Id,
        reportVersionNumber: 2,
      })
      audit.taskReads.push({
        status: taskRead.status,
        revision: taskRead.body.item.revision,
        reportProvenance: taskRead.body.item.evidenceSnapshot.reportProvenance,
      })
      const finalRows = await workItemRows(pool, fixture, taskId)
      expect(finalRows.items).toHaveLength(1)
      expect(finalRows.sources).toHaveLength(1)
      expect((await reportRows(pool, fixture)).versions).toHaveLength(3)
      const finalSessions = (await pool.query(
        'select id from neon_auth.session where "userId"=$1',
        [fixture.userId],
      )).rows
      expect(finalSessions).toHaveLength(1)
      expect(finalSessions[0].id).not.toBe(audit.initialSessionIds[0])
      audit.finalSessionIds = finalSessions.map(row => row.id)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await shot(page, `${prefix}-02-relogin-v2-provenance-pending.png`)
      expect(audit.external).toEqual([])
      expect(audit.forbidden).toEqual([])
      expect(audit.pageErrors).toEqual([])
      audit.finalCounts = { reports: 1, versions: 3, tasks: 1, taskSources: 1 }
      audit.reportVersions = [v1.reviewArtifact.versionNumber, v2.reviewArtifact.versionNumber, v3.reviewArtifact.versionNumber]
      audit.v2ProvenanceRetained = true
      audit.v3WarningVisible = true
      audit.pendingVerificationOnly = true
      audit.reloadConsistent = true
      audit.reloginConsistent = true
      audit.completed = true
      audit.step = 'passed'
    } catch (error) {
      try {
        await shot(page, `${prefix}-FAILED-${audit.step}.png`)
      } catch {}
      throw new Error(redactLocalAuth(error.message, secrets))
    } finally {
      if (pool) await pool.end()
      writeFileSync(
        join(config.output, `${prefix}-REPORT-TASK.json`),
        redactLocalAuth(JSON.stringify(audit, null, 2), secrets),
      )
    }
  })
}
