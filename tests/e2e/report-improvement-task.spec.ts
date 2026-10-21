import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import en from '../../messages/en.json'
import zh from '../../messages/zh-HK.json'

const clientId = '55555555-5555-4555-8555-555555555555'
const reportId = '11111111-1111-4111-8111-111111111111'
const base = `/api/clients/${clientId}`
const taskId = '66666666-6666-4666-8666-666666666666'
test.skip(!process.env.AISO_REPORT_TASK_HTML_DIR, 'AISO report-task fixture bundle is not configured')

type Locale = 'en' | 'zh-HK'
type Task = {
  id: string
  clientId: string
  status: 'draft'
  title: string
  action: string
  notes: string
  locale: Locale
  revision: number
  createdAt: string
  updatedAt: string
  evidenceSnapshot: {
    source: { kind: 'scan-check'; id: string; checkKey: string }
    reportProvenance?: {
      reportId: string
      reportVersionId: string
      reportVersionNumber: number
      findingTitle: string
    }
  }
  sourceScanIds: string[]
}
type Operations = {
  targetUrl: string | null
  ownerId: string | null
  dueAt: string | null
  acceptanceCriteria: string
  operationStatus: 'todo' | 'in_progress' | 'done'
  workNotes: string
  updatedAt: string
  expectedRevision: number
  groupScope: null
  owners: []
  evidence: unknown[]
}

function fixtureData(lang: Locale) {
  const dir = process.env.AISO_REPORT_TASK_HTML_DIR
  if (!dir) throw new Error('AISO_REPORT_TASK_HTML_DIR required')
  const html = readFileSync(join(dir, `${lang}-new.html`), 'utf8')
  const match = html.match(/<script id="fixture-props" type="application\/json">([\s\S]*?)<\/script>/)
  if (!match) throw new Error('fixture props missing')
  return JSON.parse(match[1]) as {
    props: {
      findings: Array<{
        checkKey: string
        source: { kind: 'scan-check'; id: string; checkKey: string }
        fingerprints?: string
        fingerprint: string
        ruleVersion: 'scan-check-gap.v1'
      }>
      task: Task
      verificationObservations: unknown[]
    }
    messages: typeof en
    lang: Locale
  }
}

async function ensureOperationsOpen(page: Page, label: string) {
  const details = page.locator('details').filter({ hasText: label }).first()
  const open = await details.evaluate(element => (element as HTMLDetailsElement).open)
  if (!open) await details.locator('summary').click()
}

async function pageWithMockApi(page: Page, lang: Locale, projectName: string) {
  const properties = fixtureData(lang)
  const dir = process.env.AISO_REPORT_TASK_HTML_DIR!
  const createMode = projectName === 'mobile' ? 'drop' : 'http'
  const state = {
    task: null as Task | null,
    createRequests: [] as Array<Record<string, unknown>>,
    itemPatches: 0,
    itemPatchRequests: 0,
    operationPatches: 0,
    operationsReads: 0,
    operations: {
      targetUrl: 'https://example.test',
      ownerId: null,
      dueAt: null,
      acceptanceCriteria: 'The robots.txt response must allow the reviewed crawler.',
      operationStatus: 'todo',
      workNotes: '',
      updatedAt: '2026-10-18T09:03:00.000Z',
      expectedRevision: 1,
      groupScope: null,
      owners: [],
      evidence: [],
    } as Operations,
    unexpected: [] as string[],
    pageErrors: [] as string[],
  }
  page.on('pageerror', error => state.pageErrors.push(error.message))
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.hostname === 'report-task.fixture' && !url.pathname.startsWith('/api/')) {
      if (url.pathname === '/fixture.js') {
        return route.fulfill({ contentType: 'text/javascript', body: readFileSync(join(dir, 'fixture.js')) })
      }
      const variant = state.task ? 'resumed-improved' : 'new'
      const html = readFileSync(join(dir, `${lang}-${variant}.html`), 'utf8')
      const css = readFileSync(join(dir, 'build.css'), 'utf8')
      return route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic report improvement task</title><style>${css}</style></head><body>${html}<script src="/fixture.js"></script></body></html>`,
      })
    }
    if (url.pathname === `${base}/reports` && request.method() === 'GET') {
      return route.fulfill({
        json: { reports: [{ id: reportId, latestVersionNumber: 3 }] },
      })
    }
    if (url.pathname === `${base}/work-items` && request.method() === 'POST') {
      const body = request.postDataJSON() as Record<string, unknown>
      state.createRequests.push(body)
      if (state.createRequests.length === 1 && createMode === 'http') {
        return route.fulfill({ status: 503, json: { error: 'WORK_ITEMS_UNAVAILABLE' } })
      }
      if (!state.task) {
        state.task = structuredClone(properties.props.task)
        state.task.createdAt = '2026-10-20T08:00:00.000Z'
      }
      if (state.createRequests.length === 1 && createMode === 'drop') {
        return route.abort('failed')
      }
      return route.fulfill({ status: 200, json: { item: state.task } })
    }
    if (url.pathname === `${base}/work-items/${taskId}/operations` && request.method() === 'GET') {
      state.operationsReads++
      return state.task
        ? route.fulfill({ json: state.operations })
        : route.fulfill({ status: 404, json: { error: 'WORK_ITEM_NOT_FOUND' } })
    }
    if (url.pathname === `${base}/work-items/${taskId}` && request.method() === 'GET') {
      return state.task
        ? route.fulfill({ json: { item: state.task } })
        : route.fulfill({ status: 404, json: { error: 'WORK_ITEM_NOT_FOUND' } })
    }
    if (url.pathname === `${base}/work-items/${taskId}` && request.method() === 'PATCH') {
      const body = request.postDataJSON() as { notes: string; expectedRevision: number }
      state.itemPatchRequests++
      if (state.itemPatchRequests === 1) {
        return route.fulfill({ status: 503, json: { error: 'WORK_ITEMS_UNAVAILABLE' } })
      }
      if (!state.task || body.expectedRevision !== state.task.revision) {
        return route.fulfill({ status: 409, json: { error: 'WORK_ITEM_CONFLICT' } })
      }
      state.itemPatches++
      state.task = {
        ...state.task,
        notes: body.notes,
        revision: state.task.revision + 1,
        updatedAt: '2026-10-20T09:00:00.000Z',
      }
      state.operations = {
        ...state.operations,
        workNotes: body.notes,
        expectedRevision: state.task.revision,
        updatedAt: state.task.updatedAt,
      }
      return route.fulfill({ json: { item: state.task } })
    }
    if (url.pathname === `${base}/work-items/${taskId}/operations` && request.method() === 'PATCH') {
      const body = request.postDataJSON() as Partial<Operations>
      if (!state.task || body.expectedRevision !== state.task.revision) {
        return route.fulfill({ status: 409, json: { error: 'WORK_OPERATIONS_CONFLICT' } })
      }
      state.operationPatches++
      state.task = {
        ...state.task,
        revision: state.task.revision + 1,
        updatedAt: '2026-10-21T09:00:00.000Z',
      }
      state.operations = {
        ...state.operations,
        ...body,
        workNotes: state.task.notes,
        expectedRevision: state.task.revision,
        updatedAt: state.task.updatedAt,
      } as Operations
      return route.fulfill({ json: state.operations })
    }
    state.unexpected.push(`${request.method()} ${url.pathname}`)
    return route.abort()
  })
  const startUrl = `https://report-task.fixture/${lang}/new`
  await page.goto(startUrl)
  await page.waitForFunction(() => Boolean((window as Window & { reportTaskFixtureReady?: boolean }).reportTaskFixtureReady))
  return { state, properties, startUrl }
}

for (const lang of ['en', 'zh-HK'] as const) {
  test(`report finding creates one task, records a human change and reloads ${lang}`, async ({ page }, info) => {
    const copy = (lang === 'en' ? en : zh).reports
    const opportunityCopy = (lang === 'en' ? en : zh).opportunities
    const { state, properties } = await pageWithMockApi(page, lang, info.project.name)
    await expect(page.getByText(copy.findings_newer_title, { exact: true })).toBeVisible()
    const create = page.getByRole('button', { name: copy.findings_create_task, exact: true })
    await create.dblclick()
    await expect(page.locator('[role="alert"]').filter({ hasText: copy.findings_task_error })).toBeVisible()
    expect(state.createRequests).toHaveLength(1)
    if (info.project.name === 'mobile') expect(state.task).not.toBeNull()
    else expect(state.task).toBeNull()
    await create.dblclick()
    await expect(page.getByRole('button', { name: copy.findings_open_task, exact: true })).toBeVisible()
    expect(state.createRequests).toHaveLength(2)
    expect(state.createRequests.every(body => body.reportVersionId === properties.props.task.evidenceSnapshot.reportProvenance?.reportVersionId)).toBe(true)
    expect(state.task?.evidenceSnapshot.reportProvenance?.reportVersionId)
      .toBe(properties.props.task.evidenceSnapshot.reportProvenance?.reportVersionId)

    await ensureOperationsOpen(page, opportunityCopy.operationsTitle)
    const notes = page.getByRole('textbox', { name: opportunityCopy.notes, exact: true })
    const target = page.getByRole('textbox', { name: opportunityCopy.targetUrl, exact: true })
    const dueAt = page.getByRole('textbox', { name: opportunityCopy.dueAt, exact: true })
    const status = page.locator('select').filter({ has: page.locator('option[value="done"]') })
    const changedNotes = lang === 'en'
      ? 'Updated robots.txt for the reviewed crawler. Human-reported change only.'
      : '已更新供審閱爬蟲使用的 robots.txt；此為人手回報修改。'
    const changedTarget = 'https://example.test/robots.txt'
    const changedDueAt = '2026-10-30'
    await target.fill(changedTarget)
    await dueAt.fill(changedDueAt)
    await notes.fill(changedNotes)
    await page.getByRole('button', { name: opportunityCopy.saveChanges, exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: opportunityCopy.editError })).toBeVisible()
    await expect(notes).toHaveValue(changedNotes)
    await page.getByRole('button', { name: opportunityCopy.saveChanges, exact: true }).click()
    await expect(notes).toHaveValue(changedNotes)
    await expect(target).toHaveValue(changedTarget)
    await expect(dueAt).toHaveValue(changedDueAt)
    await expect(page.locator('[data-operation-revision="2"]')).toBeVisible()
    await expect(status).toHaveValue('todo')

    // Simulate another tab advancing the task after this page loaded its operations record.
    await expect.poll(() => state.operationsReads).toBeGreaterThanOrEqual(2)
    state.task!.revision += 1
    state.operations.expectedRevision += 1
    await status.selectOption('done')
    await page.getByRole('button', { name: opportunityCopy.saveOperations, exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: opportunityCopy.operationsConflict })).toBeVisible()
    await expect(target).toHaveValue(changedTarget)
    await expect(dueAt).toHaveValue(changedDueAt)
    await expect(notes).toHaveValue(changedNotes)
    expect(state.operationPatches).toBe(0)

    await page.getByRole('button', { name: opportunityCopy.reloadOperations, exact: true }).click()
    await expect.poll(() => state.operationsReads).toBeGreaterThanOrEqual(3)
    await expect(page.locator('[data-operation-revision="3"]')).toBeVisible()
    await ensureOperationsOpen(page, opportunityCopy.operationsTitle)
    await target.fill(changedTarget)
    await dueAt.fill(changedDueAt)
    await expect(status).toHaveValue('todo')
    await status.selectOption('done')
    await page.getByRole('button', { name: opportunityCopy.saveOperations, exact: true }).click()
    await expect(page.locator('[data-operation-reported="pending-verification"]')).toBeVisible()
    await expect(page.locator('[data-verification-state="observed_improvement"]')).toBeVisible()
    await expect(page.getByText(opportunityCopy.reportSourceFrozen, { exact: true })).toBeVisible()
    await expect(target).toHaveValue(changedTarget)
    await expect(dueAt).toHaveValue(changedDueAt)
    expect(state.itemPatchRequests).toBe(2)
    expect(state.itemPatches).toBe(1)
    expect(state.operationPatches).toBe(1)
    await page.screenshot({ path: test.info().outputPath(`${lang}-${info.project.name}-pending.png`), fullPage: true })

    await page.reload()
    await page.waitForFunction(() => Boolean((window as Window & { reportTaskFixtureReady?: boolean }).reportTaskFixtureReady))
    await page.getByRole('button', { name: copy.findings_open_task, exact: true }).click()
    await ensureOperationsOpen(page, opportunityCopy.operationsTitle)
    await expect(notes).toHaveValue(/.+/)
    await expect(target).toHaveValue(changedTarget)
    await expect(dueAt).toHaveValue(changedDueAt)
    await expect(page.locator('[data-operation-reported="pending-verification"]')).toBeVisible()
    await expect(page.locator('[data-verification-state="observed_improvement"]')).toBeVisible()
    await expect(page.getByText(opportunityCopy.reportSourceFrozen, { exact: true })).toBeVisible()
    expect(state.task?.evidenceSnapshot.reportProvenance?.reportVersionId)
      .toBe(properties.props.task.evidenceSnapshot.reportProvenance?.reportVersionId)
    expect(state.unexpected).toEqual([])
    expect(state.pageErrors).toEqual([])
  })

  test(`synthetic verification distinguishes every outcome ${lang}`, async ({ page }) => {
    const dir = process.env.AISO_REPORT_TASK_HTML_DIR!
    const copy = (lang === 'en' ? en : zh).reports
    for (const [variant, expectedState] of [
      ['resumed-improved', 'observed_improvement'],
      ['resumed-unchanged', 'no_observed_improvement'],
      ['resumed-insufficient', 'insufficient_evidence'],
    ] as const) {
      await page.route('**/*', route => {
        const url = new URL(route.request().url())
        if (url.pathname.startsWith('/api/')) return route.fallback()
        if (url.hostname !== 'report-task.fixture') return route.abort()
        if (url.pathname === '/fixture.js') {
          return route.fulfill({ contentType: 'text/javascript', body: readFileSync(join(dir, 'fixture.js')) })
        }
        const html = readFileSync(join(dir, `${lang}-${variant}.html`), 'utf8')
        const css = readFileSync(join(dir, 'build.css'), 'utf8')
        return route.fulfill({ contentType: 'text/html; charset=utf-8',
          body: `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><style>${css}</style></head><body>${html}<script src="/fixture.js"></script></body></html>` })
      })
      await page.route('**/api/clients/**/reports', route => route.fulfill({ json: { reports: [{ id: reportId, latestVersionNumber: 3 }] } }))
      await page.route('**/api/clients/**/work-items/*/operations', route => route.fulfill({ json: {
        targetUrl: 'https://example.test', ownerId: null, dueAt: null,
        acceptanceCriteria: 'The robots.txt response must allow the reviewed crawler.',
        operationStatus: 'done', workNotes: 'Human-reported change only.',
        updatedAt: '2026-10-21T09:00:00.000Z', expectedRevision: 3,
        groupScope: null, owners: [], evidence: [],
      } }))
      await page.goto(`https://report-task.fixture/${lang}/${variant}`)
      await page.waitForFunction(() => Boolean((window as Window & { reportTaskFixtureReady?: boolean }).reportTaskFixtureReady))
      await page.getByRole('button', { name: copy.findings_open_task, exact: true }).click()
      await expect(page.locator(`[data-verification-state="${expectedState}"]`)).toBeVisible()
      await expect(page.getByText((lang === 'en' ? en : zh).opportunities.verificationAttribution, { exact: true })).toBeVisible()
      await page.unrouteAll({ behavior: 'wait' })
    }
  })
}
