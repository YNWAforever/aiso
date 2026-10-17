import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { buildScanEvidence } from '../../lib/scan-evidence'

const clientId = '11111111-1111-4111-8111-111111111111'
const scanId = '22222222-2222-4222-8222-222222222222'
const result = {
  id: scanId, domain: 'example.com', url: 'https://example.com/', score: 10, grade: 'F',
  created_at: '2026-10-16T00:00:00.000Z',
  results: {
    c3_bot_access: { status: 'pass', message: 'bots_all_accessible', detail: 'Synthetic source: https://example.com/robots.txt' },
    evidence: buildScanEvidence({
      requestedUrl: 'https://example.com/', evaluatedUrl: 'https://example.com/',
      industry: 'general_b2c', region: 'global', sitemapSource: 'unknown',
      checks: { c3_bot_access: { collection: 'complete', assessment: 'pass' } },
      observations: [{ check: 'page', collection: 'complete', httpStatus: 200, target: { origin: 'https://example.com' } }],
    }),
  },
}
async function open(page: Page, lang: string) {
  const dir = resolve(process.env.AISO_FIRST_RESULT_DIR || 'artifacts/onboarding-20261016/browser')
  const script = readFileSync(`${dir}/fixture.js`, 'utf8')
  const css = readFileSync(`${dir}/build.css`, 'utf8')
  await page.route('**/*', route => route.abort())
  await page.route('https://onboarding.fixture/**', route => route.request().resourceType() === 'document'
    ? route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic onboarding acceptance</title><style>${css}</style></head><body><div id="root"></div><script>${script}</script></body></html>` })
    : route.abort())
  await page.goto(`https://onboarding.fixture/${lang}/onboarding`)
  await page.waitForFunction(() => Boolean((window as Window & { aisoFixtureReady?: boolean }).aisoFixtureReady))
}
const quick = (page: Page, lang: string) => page.getByRole('button', {
  name: lang === 'en' ? 'Save and check my website' : '儲存並分析我的網站', exact: true,
})
async function details(page: Page) {
  await page.locator('#onboarding-brand').fill('Synthetic First Result')
  await page.locator('#onboarding-website').fill('https://www.example.com/path')
}
async function successfulScan(page: Page, requests: unknown[]) {
  await page.route('**/api/scan', async route => {
    requests.push(route.request().postDataJSON())
    await page.evaluate(value => localStorage.setItem('synthetic:first-result', JSON.stringify(value)), result)
    await route.fulfill({ json: result })
  })
}
for (const lang of ['en', 'zh-HK']) {
  test(`minimal setup reaches a saved first result and survives reload ${lang}`, async ({ page }) => {
    await open(page, lang)
    // This is the real new-user screen, before expanding any optional controls.
    await expect(quick(page, lang)).toHaveCount(1)
    await expect(quick(page, lang)).toBeDisabled()
    await details(page)
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', await page.evaluate(() => document.documentElement.clientWidth))
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([])
    await page.screenshot({ path: test.info().outputPath(`${lang}-minimal-setup.png`), fullPage: true })
    const setups: Record<string, unknown>[] = [], scans: unknown[] = []
    await page.route('**/api/onboarding/complete', async route => {
      const payload = route.request().postDataJSON(); setups.push(payload)
      await page.evaluate(value => localStorage.setItem('synthetic:brand', JSON.stringify(value)), payload)
      await route.fulfill({ json: { clientId, progress: { brand: 'ready', prompts: 'pending', promptCount: 0 } } })
    })
    await successfulScan(page, scans)
    await quick(page, lang).click()
    await expect(page).toHaveURL(new RegExp(`step=results&scanId=${scanId}`))
    await expect(page.getByText(lang === 'en' ? 'Latest Scan' : '最新掃描', { exact: true })).toBeVisible()
    await expect(page.getByText('example.com', { exact: true })).toBeVisible()
    expect(setups).toHaveLength(1)
    expect(setups[0]).toMatchObject({ brandName: 'Synthetic First Result', domain: 'example.com' })
    expect(setups[0].language).toBeUndefined()
    expect(scans).toHaveLength(1)
    expect(scans[0]).toMatchObject({ url: 'https://example.com/', clientId })
    expect(typeof (scans[0] as Record<string, unknown>).requestKey).toBe('string')
    await page.reload()
    await expect(page.getByText('example.com', { exact: true })).toBeVisible()
    expect(scans).toHaveLength(1)
    expect(setups).toHaveLength(1)
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('synthetic:first-result')!))
    expect(saved.score).toBe(10)
    expect(saved.results.evidence.observations[0]).toMatchObject({ collection: 'complete', httpStatus: 200 })
    await page.screenshot({ path: test.info().outputPath(`${lang}-first-result.png`), fullPage: true })
  })
  test(`invalid website stays editable and never submits ${lang}`, async ({ page }) => {
    await open(page, lang); await page.locator('#onboarding-brand').fill('Synthetic')
    let calls = 0
    await page.route('**/api/onboarding/complete', route => { calls++; return route.abort() })
    for (const invalid of ['', 'not a website', 'javascript:alert(1)', 'https://user:password@example.com', 'http://127.0.0.1']) {
      await page.locator('#onboarding-website').fill(invalid)
      await expect(quick(page, lang)).toBeDisabled()
    }
    expect(calls).toBe(0)
    await page.locator('#onboarding-website').fill('example.com')
    await page.locator('#onboarding-brand').fill('   ')
    await expect(quick(page, lang)).toBeDisabled()
    await page.locator('#onboarding-brand').fill('Synthetic')
    await expect(quick(page, lang)).toBeEnabled()
  })
  test(`setup failure retains the draft and retry reuses the request identity ${lang}`, async ({ page }) => {
    await open(page, lang); await details(page)
    const requests: Record<string, unknown>[] = [], scans: unknown[] = []
    await page.route('**/api/onboarding/complete', route => {
      const body = route.request().postDataJSON(); requests.push(body)
      return requests.length === 1 ? route.abort() : route.fulfill({ json: { clientId, progress: { brand: 'ready', prompts: 'pending' } } })
    })
    await successfulScan(page, scans)
    await quick(page, lang).click()
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(quick(page, lang)).toBeEnabled()
    await page.reload()
    await expect(page.locator('#onboarding-brand')).toHaveValue('Synthetic First Result')
    await expect(page.locator('#onboarding-website')).toHaveValue('https://www.example.com/path')
    await quick(page, lang).click()
    await expect(page).toHaveURL(/step=results/)
    expect(requests).toHaveLength(2)
    expect(requests[1]).toEqual(requests[0])
  })
  test(`double activation creates one brand and scan ${lang}`, async ({ page }) => {
    await open(page, lang); await details(page)
    let setups = 0
    const scans: unknown[] = []
    let release!: () => void
    const response = new Promise<void>(resolve => { release = resolve })
    await page.route('**/api/onboarding/complete', async route => {
      setups++; await response
      await route.fulfill({ json: { clientId, progress: { brand: 'ready', prompts: 'pending' } } })
    })
    await successfulScan(page, scans)
    await quick(page, lang).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click() })
    await expect(page.getByRole('button', { name: lang === 'en' ? 'Setting up…' : '設定中…', exact: true })).toBeDisabled()
    await expect(page.locator('#onboarding-brand')).toBeDisabled()
    await expect(page.locator('#onboarding-website')).toBeDisabled()
    release()
    await expect(page).toHaveURL(/step=results/)
    expect(setups).toBe(1); expect(scans).toHaveLength(1)
  })
  test(`scan failure supports retry without repeating brand setup ${lang}`, async ({ page }) => {
    await open(page, lang); await details(page)
    let setups = 0, scans = 0
    await page.route('**/api/onboarding/complete', route => {
      setups++
      return route.fulfill({ json: { clientId, progress: { brand: 'ready', prompts: 'pending' } } })
    })
    await page.route('**/api/scan', async route => {
      scans++
      if (scans === 1) return route.fulfill({ status: 422, json: { error: 'SCAN_UNREACHABLE' } })
      await page.evaluate(value => localStorage.setItem('synthetic:first-result', JSON.stringify(value)), result)
      await route.fulfill({ json: result })
    })
    await quick(page, lang).click()
    await expect(page.getByRole('button', { name: lang === 'en' ? 'Run Scan' : '執行掃描', exact: true })).toBeEnabled()
    await page.locator('form').evaluate(form => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await expect(page).toHaveURL(/step=results/)
    expect(setups).toBe(1); expect(scans).toBe(2)
  })
  test(`malformed scan success is not presented as an effective result ${lang}`, async ({ page }) => {
    await open(page, lang); await details(page)
    await page.route('**/api/onboarding/complete', route => route.fulfill({
      json: { clientId, progress: { brand: 'ready', prompts: 'pending' } },
    }))
    await page.route('**/api/scan', route => route.fulfill({ json: {} }))
    await quick(page, lang).click()
    await expect(page.getByRole('button', { name: lang === 'en' ? 'Run Scan' : '執行掃描', exact: true })).toBeEnabled()
    expect(new URL(page.url()).searchParams.get('step')).toBe('scan')
    expect(new URL(page.url()).searchParams.get('scanId')).toBeNull()
    await expect(page.getByText(lang === 'en' ? 'Latest Scan' : '最新掃描', { exact: true })).toHaveCount(0)
  })
}

const runStateScan = (state: 'processing' | 'failed') => ({
  id: scanId, url: 'https://example.com/', domain: 'example.com', score: null, grade: null,
  created_at: '2026-10-17T00:00:00.000Z',
  results: {
    _scan_request: {
      key: '11111111-1111-4111-8111-111111111111', state,
      startedAt: new Date().toISOString(), ...(state === 'failed' ? { error: 'SCAN_UNREACHABLE', status: 422 } : {}),
    },
  },
})
async function openResult(page: Page, lang: string, value: unknown) {
  await open(page, lang)
  await page.evaluate(saved => localStorage.setItem('synthetic:first-result', JSON.stringify(saved)), value)
  await page.goto(`https://onboarding.fixture/${lang}/dashboard/${clientId}?step=results&scanId=${scanId}`)
  await page.waitForFunction(() => Boolean((window as Window & { aisoFixtureReady?: boolean }).aisoFixtureReady))
}

for (const lang of ['en', 'zh-HK']) {
  test(`a running claim shows progress without a second scan ${lang}`, async ({ page }) => {
    let scans = 0
    await page.route('**/api/scan', route => { scans++; return route.abort() })
    await openResult(page, lang, runStateScan('processing'))
    await expect(page.getByText(lang === 'en' ? 'Your scan is still running' : '掃描仍在進行中', { exact: true })).toBeVisible()
    await page.screenshot({ path: test.info().outputPath(`${lang}-scan-processing.png`), fullPage: true })
    expect(scans).toBe(0)
  })
  test(`a failed claim explains the next step and offers retry ${lang}`, async ({ page }) => {
    await openResult(page, lang, runStateScan('failed'))
    await expect(page.getByText(lang === 'en' ? 'This scan could not finish' : '這次掃描未能完成', { exact: true })).toBeVisible()
    const retry = page.getByRole('link', { name: lang === 'en' ? 'Try this scan again' : '重新嘗試這次掃描', exact: true })
    await expect(retry).toBeVisible()
    expect(new URL((await retry.getAttribute('href'))!, 'https://onboarding.fixture').searchParams.get('step')).toBe('scan')
    await page.screenshot({ path: test.info().outputPath(`${lang}-scan-failed.png`), fullPage: true })
  })
}

test('a reload during the automatic scan reuses the same request key', async ({ page }) => {
  await open(page, 'en'); await details(page)
  await page.route('**/api/onboarding/complete', route => route.fulfill({
    json: { clientId, progress: { brand: 'ready', prompts: 'pending' } },
  }))
  const scans: Record<string, unknown>[] = []
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/scan', async route => {
    scans.push(route.request().postDataJSON())
    if (scans.length === 1) {
      await held
      try { await route.abort() } catch { /* the reload already cancelled it */ }
      return
    }
    await page.evaluate(value => localStorage.setItem('synthetic:first-result', JSON.stringify(value)), result)
    await route.fulfill({ json: result })
  })
  await quick(page, 'en').click()
  await expect.poll(() => scans.length).toBe(1)
  await page.reload()
  await expect.poll(() => scans.length).toBe(2)
  expect(typeof scans[0]!.requestKey).toBe('string')
  expect(scans[1]!.requestKey).toBe(scans[0]!.requestKey)
  release()
  await expect(page.getByText('Latest Scan', { exact: true })).toBeVisible()
})
