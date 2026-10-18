import { test, expect, type Page, type Route } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { reportClientId, reportScanId, reportSnapshot, reportSaveFixture } from '../../__tests__/components/report-builder-fixtures'
import en from '../../messages/en.json'
import zh from '../../messages/zh-HK.json'

type Locale = 'en' | 'zh-HK'
type Call = { method: string; path: string; body: unknown }
const createPath = `/api/clients/${reportClientId}/reports`
const versionPath = '/api/client-reports/synthetic-report/versions'

async function fixture(page: Page, lang: Locale, existing: boolean) {
  const dir = process.env.AISO_REPORT_HTML_DIR || '.next/component-fixtures/AISO_REPORT'
  const css = process.env.AISO_REPORT_CSS_PATH || '.next/component-fixtures/build.css'
  const copy = (lang === 'en' ? en : zh).reports
  const state = {
    calls: [] as Call[], errors: [] as string[], unexpected: [] as string[],
    hook: null as ((route: Route, call: Call) => Promise<void>) | null,
  }
  page.on('pageerror', error => state.errors.push(error.message))
  await page.route('**/*', route => {
    state.unexpected.push(route.request().url())
    return route.abort()
  })
  await page.route('**/api/**', async route => {
    const req = route.request()
    const call = { method: req.method(), path: new URL(req.url()).pathname, body: req.postDataJSON() }
    state.calls.push(call)
    if (![createPath, versionPath].includes(call.path) || call.method !== 'POST') {
      state.unexpected.push(call.path)
      return route.abort()
    }
    if (state.hook) return state.hook(route, call)
    return route.fulfill({ status: 503, json: { error: 'FIXTURE_SAVE_FAILURE' } })
  })
  await page.route(`https://report-save.fixture/${lang}`, route => route.fulfill({
    contentType: 'text/html; charset=utf-8',
    body: `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic report save</title><style>${readFileSync(css!, 'utf8')}</style></head><body><main><h1>${lang === 'en' ? 'Synthetic report fixture' : '合成報告測試'}</h1>${readFileSync(join(dir!, `${lang}-${existing ? 'existing' : 'new'}.html`), 'utf8')}</main><script>${readFileSync(join(dir!, 'fixture.js'), 'utf8')}</script></body></html>`,
  }))
  await page.goto(`https://report-save.fixture/${lang}`)
  try {
    await page.waitForFunction(() => Boolean((window as Window & { reportFixtureReady?: boolean }).reportFixtureReady))
  } catch (error) {
    throw new Error(`Report fixture did not hydrate: ${JSON.stringify(state.errors)}`, { cause: error })
  }
  const rail = page.getByRole('navigation', { name: copy.progress_label })
  const input = page.getByLabel(copy.executive_summary, { exact: true })
  const edited = lang === 'en'
    ? 'Edited synthetic summary: verify this scan evidence before changing crawler access.'
    : '已修改的合成摘要：修改爬蟲存取設定前，先核對本次掃描的測試證據及目標頁面。'
  if (existing) await input.fill(edited)
  return { state, copy, rail, input, edited, summary: existing ? edited : reportSnapshot(lang).executiveSummary }
}

function gatedSave() {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  return {
    release,
    handle: async (route: Route, payload: unknown) => {
      await gate
      try { await route.fulfill({ json: payload }) }
      catch { /* A deliberately failed RED assertion can close its page first. */ }
    },
  }
}

async function assertReview(page: Page, lang: Locale, summary: string) {
  const copy = (lang === 'en' ? en : zh).reports
  await expect(page.getByRole('navigation').locator('[aria-current="step"]')).toContainText(copy.step_review)
  await expect(page.getByRole('textbox')).toHaveCount(0)
  await expect(page.locator('main')).toContainText(summary)
  await expect(page.locator('main')).toContainText(reportSnapshot(lang).priorityFixes[0].rationale)
  await expect(page.locator('main')).toContainText('example.test')
}

async function assertIsolated(state: { calls: Call[]; errors: string[]; unexpected: string[] }) {
  expect(state.errors).toEqual([])
  expect(state.unexpected).toEqual([])
  expect(state.calls.every(call => [createPath, versionPath].includes(call.path))).toBe(true)
}

for (const lang of ['en', 'zh-HK'] as const) {
  for (const existing of [false, true]) {
    test(`Report prevents duplicate rail review ${existing ? 'existing' : 'new'} ${lang}`, async ({ page }) => {
      const f = await fixture(page, lang, existing)
      const gate = gatedSave()
      f.state.hook = route => gate.handle(route, reportSaveFixture(lang, f.summary, existing ? 2 : 1))
      try {
        await expect(f.rail.getByRole('button', { name: `3${f.copy.step_publish}`, exact: true })).toBeDisabled()
        await f.rail.getByRole('button', { name: `2${f.copy.step_review}`, exact: true }).dblclick()
        // An unguarded rail sends a second real POST while the first is unresolved.
        await expect.poll(() => f.state.calls.length).toBe(1)
        for (const button of await f.rail.getByRole('button').all()) {
          await expect(button).toBeDisabled()
          await expect(button).toHaveAttribute('aria-disabled', 'true')
        }
        expect(f.state.calls[0]).toEqual({
          method: 'POST', path: existing ? versionPath : createPath,
          body: existing ? { locale: lang, executiveSummary: f.summary }
            : { scanId: reportScanId, locale: lang, executiveSummary: f.summary },
        })
        await page.screenshot({ path: test.info().outputPath(`${lang}-pending.png`), fullPage: true })
        gate.release()
        await assertReview(page, lang, f.summary)
        await expect(f.rail.getByRole('button', { name: `3${f.copy.step_publish}`, exact: true })).toBeEnabled()
        await page.getByRole('button', { name: f.copy.back_to_compose, exact: true }).click()
        await expect(f.input).toHaveValue(f.summary)
        await page.getByRole('button', { name: f.copy.review_report, exact: true }).click()
        await assertReview(page, lang, f.summary)
        expect(f.state.calls).toHaveLength(1)
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await page.screenshot({ path: test.info().outputPath(`${lang}-review.png`), fullPage: true })
        await assertIsolated(f.state)
      } catch (error) {
        await page.screenshot({ path: test.info().outputPath(`${lang}-failure.png`), fullPage: true })
        throw error
      } finally { gate.release() }
    })

    test(`Report prevents duplicate main-save to rail ${existing ? 'existing' : 'new'} ${lang}`, async ({ page }) => {
      const f = await fixture(page, lang, existing), gate = gatedSave()
      f.state.hook = route => gate.handle(route, reportSaveFixture(lang, f.summary, existing ? 2 : 1))
      try {
        await page.getByRole('button', { name: f.copy.save_draft, exact: true }).click()
        await expect.poll(() => f.state.calls.length).toBe(1)
        const review = f.rail.getByRole('button', { name: `2${f.copy.step_review}`, exact: true })
        const box = await review.boundingBox()
        if (!box) throw new Error('Review rail has no bounds')
        // Native pointer click on a disabled button must not enter review/save again.
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
        await expect(review).toBeDisabled()
        expect(f.state.calls).toHaveLength(1)
        gate.release()
        await expect(page.locator('[data-notice-kind="success"]')).toHaveText(f.copy.saved)
        await expect(review).toBeEnabled()
        await review.click()
        await assertReview(page, lang, f.summary)
        expect(f.state.calls).toHaveLength(1)
        await assertIsolated(f.state)
      } finally { gate.release() }
    })
  }

  for (const failure of ['http', 'invalid-version'] as const) {
    test(`Report ${failure} preserves input and permits one explicit retry ${lang}`, async ({ page }) => {
      const f = await fixture(page, lang, true)
      if (failure === 'invalid-version') {
        const invalid = reportSaveFixture(lang, f.summary, 2)
        invalid.report.latestVersionNumber = 3
        f.state.hook = route => route.fulfill({ json: invalid })
      }
      await page.getByRole('button', { name: f.copy.review_report, exact: true }).click()
      await expect(page.locator('[data-notice-kind="error"]')).toHaveText(f.copy.save_error)
      await expect(f.input).toHaveValue(f.summary)
      await expect(f.rail.locator('[aria-current="step"]')).toContainText(f.copy.step_compose)
      await expect(f.rail.getByRole('button', { name: `3${f.copy.step_publish}`, exact: true })).toBeDisabled()
      expect(f.state.calls).toHaveLength(1)
      f.state.hook = route => route.fulfill({ json: reportSaveFixture(lang, f.summary, 2) })
      await f.rail.getByRole('button', { name: `2${f.copy.step_review}`, exact: true }).click()
      await assertReview(page, lang, f.summary)
      expect(f.state.calls).toHaveLength(2)
      expect(f.state.calls[1]).toEqual(f.state.calls[0])
      await assertIsolated(f.state)
    })
  }

  test(`Report late acknowledgement retains human edits until saved again ${lang}`, async ({ page }) => {
    const f = await fixture(page, lang, false), gate = gatedSave()
    f.state.hook = route => gate.handle(route, reportSaveFixture(lang, f.summary))
    try {
      await f.rail.getByRole('button', { name: `2${f.copy.step_review}`, exact: true }).click()
      await expect.poll(() => f.state.calls.length).toBe(1)
      await f.input.fill(f.edited)
      gate.release()
      await expect(page.locator('[data-notice-kind="warning"]')).toHaveText(f.copy.save_again)
      await expect(f.input).toHaveValue(f.edited)
      await expect(f.rail.locator('[aria-current="step"]')).toContainText(f.copy.step_compose)
      expect(f.state.calls).toHaveLength(1)
      f.state.hook = route => route.fulfill({ json: reportSaveFixture(lang, f.edited, 2) })
      await f.rail.getByRole('button', { name: `2${f.copy.step_review}`, exact: true }).click()
      await assertReview(page, lang, f.edited)
      expect(f.state.calls).toEqual([
        { method: 'POST', path: createPath, body: { scanId: reportScanId, locale: lang, executiveSummary: f.summary } },
        { method: 'POST', path: versionPath, body: { locale: lang, executiveSummary: f.edited } },
      ])
      await assertIsolated(f.state)
    } finally { gate.release() }
  })
}
