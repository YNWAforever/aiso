import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { reportClientId, reportScanId, reportSnapshot, reportSaveFixture } from '../../__tests__/components/report-builder-fixtures'
import en from '../../messages/en.json'
import zh from '../../messages/zh-HK.json'

type Locale = 'en' | 'zh-HK'
type Call = { method: string; path: string; id: string | undefined; scan: string | undefined; body: Record<string, string> | null }
const createPath = `/api/clients/${reportClientId}/reports`
const versionPath = '/api/client-reports/synthetic-report/versions'
const readBase = `/api/clients/${reportClientId}/report-save-requests/`
const copyFor = (lang: Locale) => ({
  ...(lang === 'en' ? en : zh).reports,
  check: lang === 'en' ? 'Check saved draft' : '核對已儲存草稿',
  retry: lang === 'en' ? 'Retry original save' : '重試原本儲存',
  unknown: lang === 'en'
    ? 'The save result is unconfirmed. Check the saved draft before retrying; the request may already have completed.'
    : '儲存結果尚未確認。請先核對已儲存草稿再重試；原本的請求可能已經完成。',
})

async function fixture(page: Page, lang: Locale, existing = false) {
  const dir = process.env.AISO_REPORT_HTML_DIR || '.next/component-fixtures/AISO_REPORT'
  const css = process.env.AISO_REPORT_CSS_PATH || '.next/component-fixtures/build.css'
  const copy = copyFor(lang)
  let releaseWrite!: () => void, releaseRead!: () => void
  const writeGate = new Promise<void>(resolve => { releaseWrite = resolve })
  const readGate = new Promise<void>(resolve => { releaseRead = resolve })
  const state = {
    calls: [] as Call[], errors: [] as string[], unexpected: [] as string[],
    receipts: new Map<string, unknown>(), writes: 0,
    commit: true, transport: 'success' as 'success' | 'hold' | 'drop',
    read: 'success' as 'success' | 'hold' | 'invalid' | 'wrong-scan' | 'forbidden',
    scope: 'synthetic-account:synthetic-owner',
  }
  page.on('pageerror', error => state.errors.push(error.message))
  await page.route('**/*', route => {
    state.unexpected.push(route.request().url())
    return route.abort()
  })
  await page.route('**/api/**', async route => {
    const req = route.request(), headers = req.headers()
    const call: Call = {
      method: req.method(), path: new URL(req.url()).pathname,
      id: headers['x-report-request-id'], scan: headers['x-report-scan-id'],
      body: req.postData() ? req.postDataJSON() : null,
    }
    state.calls.push(call)
    if (call.method === 'POST' && [createPath, versionPath].includes(call.path)) {
      const id = call.id ?? 'baseline-without-identity'
      if (state.commit && !state.receipts.has(id)) {
        state.writes++
        state.receipts.set(id, {
          requestId: id,
          request: {
            reportId: call.path === createPath ? null : 'synthetic-report',
            scanId: reportScanId, locale: lang, executiveSummary: call.body!.executiveSummary.trim(),
          },
          result: reportSaveFixture(lang, call.body!.executiveSummary.trim(), existing ? 2 : 1),
        })
      }
      if (state.transport === 'hold') {
        await writeGate
        try { await route.abort() } catch { /* Deadline may have cancelled transport. */ }
        return
      }
      if (state.transport === 'drop') return route.abort()
      const receipt = state.receipts.get(id) as { result: unknown } | undefined
      return route.fulfill({ json: receipt?.result ?? { error: 'SYNTHETIC_NO_COMMIT' }, status: receipt ? 201 : 503 })
    }
    if (call.method === 'GET' && call.path.startsWith(readBase)) {
      if (state.read === 'hold') {
        await readGate
        try { await route.abort() } catch { /* Deadline may have cancelled transport. */ }
        return
      }
      if (state.read === 'forbidden') return route.fulfill({ status: 404, json: { error: 'not_found' } })
      if (state.read === 'invalid') return route.fulfill({ json: { reports: [] } })
      const id = call.path.slice(readBase.length)
      const receipt = structuredClone(state.receipts.get(id) ?? null) as { request: { scanId: string } } | null
      if (receipt && state.read === 'wrong-scan') receipt.request.scanId = 'foreign-synthetic-scan'
      return route.fulfill({ json: { receipt } })
    }
    state.unexpected.push(call.path)
    return route.abort()
  })
  await page.route(`https://report-recovery.fixture/${lang}`, route => route.fulfill({
    contentType: 'text/html; charset=utf-8',
    body: `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic report recovery</title><style>${readFileSync(css, 'utf8')}</style></head><body><main><h1>${lang === 'en' ? 'Synthetic report fixture' : '合成報告測試'}</h1>${readFileSync(join(dir, `${lang}-${existing ? 'existing' : 'new'}.html`), 'utf8').replace('synthetic-account:synthetic-owner', state.scope)}</main><script>${readFileSync(join(dir, 'fixture.js'), 'utf8')}</script></body></html>`,
  }))
  const open = async () => {
    await page.goto(`https://report-recovery.fixture/${lang}`)
    await page.waitForFunction(() => Boolean((window as Window & { reportFixtureReady?: boolean }).reportFixtureReady))
  }
  await open()
  const input = page.getByLabel(copy.executive_summary, { exact: true })
  const original = lang === 'en'
    ? 'Synthetic recovery summary: verify only the selected scan evidence before making changes.'
    : '合成復原摘要：只核對指定掃描的測試證據，並在修改前由人手確認相關內容及目標頁面。'
  const edited = lang === 'en'
    ? 'Newer human edits must remain intact while the original save is reconciled or retried.'
    : '核對或重試原本儲存時，必須保留這段較新的人手修改，不可以被晚到的回應覆蓋。'
  await input.fill(original)
  return { state, copy, input, original, edited, open, releaseWrite, releaseRead,
    check: page.getByRole('button', { name: copy.check, exact: true }),
    retry: page.getByRole('button', { name: copy.retry, exact: true }),
  }
}

function writes(calls: Call[]) { return calls.filter(call => call.method === 'POST') }
function reads(calls: Call[]) { return calls.filter(call => call.method === 'GET') }
async function isolated(state: { errors: string[]; unexpected: string[] }) {
  expect(state.errors).toEqual([])
  expect(state.unexpected).toEqual([])
}
async function unconfirmed(page: Page, f: Awaited<ReturnType<typeof fixture>>, deadline = false) {
  await expect(page.locator('[data-notice-kind="warning"]')).toHaveText(f.copy.unknown, { timeout: deadline ? 17_000 : 5000 })
  await expect(f.input).toHaveValue(f.original)
  await expect(f.check).toBeEnabled()
  await expect(page.getByRole('button', { name: f.copy.review_report, exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: f.copy.polish_ai, exact: true })).toBeDisabled()
  expect(writes(f.state.calls)).toHaveLength(1)
  expect(f.state.calls[0].id).toMatch(/^[0-9a-f-]{36}$/)
  expect(f.state.calls[0].scan).toBe(reportScanId)
  expect(f.state.writes).toBe(f.state.commit ? 1 : 0)
}

for (const lang of ['en', 'zh-HK'] as const) {
  for (const existing of [false, true]) {
    for (const transport of ['hold', 'drop'] as const) {
      test(`Report ${transport === 'hold' ? 'stalled save' : 'lost response'} reads committed ${existing ? 'version' : 'report'} without another POST ${lang}`, async ({ page }) => {
        const f = await fixture(page, lang, existing)
        f.state.transport = transport
        try {
          await page.getByRole('button', { name: f.copy.review_report, exact: true }).dblclick()
          await unconfirmed(page, f, transport === 'hold')
          await page.screenshot({ path: test.info().outputPath(`${lang}-unconfirmed.png`), fullPage: true })
          await f.check.dblclick()
          await expect(page.locator('[data-notice-kind="success"]')).toBeVisible()
          await expect(f.input).toHaveValue(f.original)
          expect(writes(f.state.calls)).toHaveLength(1)
          expect(reads(f.state.calls)).toHaveLength(1)
          await page.getByRole('button', { name: f.copy.review_report, exact: true }).click()
          await expect(page.getByRole('textbox')).toHaveCount(0)
          await expect(page.locator('main')).toContainText(f.original)
          await expect(page.locator('main')).toContainText(reportSnapshot(lang).priorityFixes[0].rationale)
          expect(writes(f.state.calls)).toHaveLength(1)
          expect(f.state.writes).toBe(1)
          expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
          await page.screenshot({ path: test.info().outputPath(`${lang}-recovered.png`), fullPage: true })
          await isolated(f.state)
        } finally { f.releaseWrite() }
      })
    }
  }

  for (const lateCommit of [false, true]) {
    test(`Report explicit same-request retry retains frozen content and newer edits late-commit=${lateCommit} ${lang}`, async ({ page }) => {
      const f = await fixture(page, lang)
      f.state.commit = false
      f.state.transport = 'drop'
      await page.getByRole('button', { name: f.copy.save_draft, exact: true }).click()
      await unconfirmed(page, f)
      await f.input.fill(f.edited)
      await f.check.click()
      await expect(f.retry).toBeEnabled()
      expect(reads(f.state.calls)).toHaveLength(1)
      expect(writes(f.state.calls)).toHaveLength(1)
      if (lateCommit) {
        const first = writes(f.state.calls)[0]
        f.state.receipts.set(first.id!, {
          requestId: first.id,
          request: { reportId: null, scanId: reportScanId, locale: lang, executiveSummary: f.original },
          result: reportSaveFixture(lang, f.original),
        })
        f.state.writes = 1
      }
      f.state.commit = true
      f.state.transport = 'success'
      await f.retry.dblclick()
      await expect(f.input).toHaveValue(f.edited)
      await expect(page.locator('[data-notice-kind="warning"]')).toHaveText(f.copy.save_again)
      expect(writes(f.state.calls)).toHaveLength(2)
      expect(writes(f.state.calls)[1]).toEqual(writes(f.state.calls)[0])
      expect(f.state.writes).toBe(1)
      await isolated(f.state)
    })
  }

  test(`Report recovery GET deadline preserves the uncertain request for another read ${lang}`, async ({ page }) => {
    const f = await fixture(page, lang)
    f.state.transport = 'drop'
    await page.getByRole('button', { name: f.copy.save_draft, exact: true }).click()
    await unconfirmed(page, f)
    await f.input.fill(f.edited)
    f.state.read = 'hold'
    try {
      await f.check.dblclick()
      await expect(f.check).toBeEnabled({ timeout: 17_000 })
      await expect(page.locator('[data-notice-kind="error"]')).toBeVisible()
      await expect(f.input).toHaveValue(f.edited)
      await expect(f.retry).toBeDisabled()
      expect(writes(f.state.calls)).toHaveLength(1)
      expect(reads(f.state.calls)).toHaveLength(1)
      f.state.read = 'success'
      f.releaseRead()
      await f.check.click()
      await expect(page.locator('[data-notice-kind="warning"]')).toHaveText(f.copy.save_again)
      await expect(f.input).toHaveValue(f.edited)
      expect(writes(f.state.calls)).toHaveLength(1)
      expect(reads(f.state.calls)).toHaveLength(2)
      await isolated(f.state)
    } finally { f.releaseRead() }
  })

  for (const read of ['invalid', 'wrong-scan', 'forbidden'] as const) {
    test(`Report ${read} recovery never enables a new save or publication ${lang}`, async ({ page }) => {
      const f = await fixture(page, lang, true)
      f.state.transport = 'drop'
      await page.getByRole('button', { name: f.copy.save_draft, exact: true }).click()
      await unconfirmed(page, f)
      f.state.read = read
      await f.check.click()
      await expect(page.locator('[data-notice-kind="error"]')).toBeVisible()
      await expect(f.input).toHaveValue(f.original)
      await expect(f.retry).toBeDisabled()
      await expect(page.getByRole('button', { name: f.copy.review_report, exact: true })).toBeDisabled()
      expect(writes(f.state.calls)).toHaveLength(1)
      f.state.read = 'success'
      await f.check.click()
      await expect(page.locator('[data-notice-kind="success"]')).toBeVisible()
      await isolated(f.state)
    })
  }

  test(`Report reload restores only the same scoped request and reconciles without writing ${lang}`, async ({ page }) => {
    const f = await fixture(page, lang)
    f.state.transport = 'drop'
    await page.getByRole('button', { name: f.copy.save_draft, exact: true }).click()
    await unconfirmed(page, f)
    const first = writes(f.state.calls)[0]
    page.once('dialog', dialog => dialog.accept())
    await f.open()
    await expect(f.check).toBeEnabled()
    await expect(page.getByRole('button', { name: f.copy.save_draft, exact: true })).toBeDisabled()
    expect(writes(f.state.calls)).toHaveLength(1)
    await f.check.click()
    await expect(page.locator('[data-notice-kind="success"]')).toBeVisible()
    await expect(f.input).toHaveValue(f.original)
    expect(reads(f.state.calls)[0].path).toBe(readBase + first.id)
    expect(writes(f.state.calls)).toHaveLength(1)
    await isolated(f.state)
  })

  test(`Report another signed-in scope cannot restore the previous actor request ${lang}`, async ({ page }) => {
    const f = await fixture(page, lang)
    f.state.transport = 'drop'
    await page.getByRole('button', { name: f.copy.save_draft, exact: true }).click()
    await unconfirmed(page, f)
    f.state.scope = 'synthetic-account:different-owner'
    page.once('dialog', dialog => dialog.accept())
    await f.open()
    await expect(f.check).toHaveCount(0)
    await expect(f.input).toHaveValue(reportSnapshot(lang).executiveSummary)
    await expect(page.getByRole('button', { name: f.copy.save_draft, exact: true })).toBeEnabled()
    expect(reads(f.state.calls)).toHaveLength(0)
    expect(writes(f.state.calls)).toHaveLength(1)
    await isolated(f.state)
  })

  test(`Report unavailable recovery storage retains input and sends no POST ${lang}`, async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Storage.prototype, 'setItem', { value() { throw new Error('Synthetic storage denial') } })
    })
    const f = await fixture(page, lang)
    await page.getByRole('button', { name: f.copy.save_draft, exact: true }).click()
    await expect(page.locator('[data-notice-kind="error"]')).toBeVisible()
    await expect(f.input).toHaveValue(f.original)
    expect(f.state.calls).toEqual([])
    expect(f.state.writes).toBe(0)
    await isolated(f.state)
  })
  test(`Report whitespace normalization survives a lost response and saved readback ${lang}`, async ({ page }) => {
    const f = await fixture(page, lang)
    const raw = `  ${f.original}   fixture  `
    const canonical = `${f.original} fixture`
    await f.input.fill(raw)
    f.state.transport = 'drop'
    await page.getByRole('button', { name: f.copy.save_draft, exact: true }).click()
    await expect(page.locator('[data-notice-kind="warning"]')).toHaveText(f.copy.unknown)
    await expect(f.input).toHaveValue(raw)
    expect(writes(f.state.calls)[0].body?.executiveSummary).toBe(canonical)
    await f.check.click()
    await expect(page.locator('[data-notice-kind="success"]')).toBeVisible()
    await expect(f.input).toHaveValue(canonical)
    expect(writes(f.state.calls)).toHaveLength(1)
    expect(f.state.writes).toBe(1)
    await isolated(f.state)
  })
}
