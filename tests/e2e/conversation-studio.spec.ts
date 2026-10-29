import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFileSync } from 'node:fs'
import en from '../../messages/en.json'
import zh from '../../messages/zh-HK.json'

async function fixture(page: Page, lang: string, empty = false, scan = false, liveCap?: number, quotaError = false, free = false) {
  // Native smooth scrolling can keep a mobile target moving as replies grow.
  // Use supported reduced motion, without forced clicks or skipped assertions.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const directory = process.env.STUDIO_HTML_DIR ?? '.next/component-fixtures/STUDIO'
  const js = readFileSync(`${directory}/fixture.js`, 'utf8')
  const css = readFileSync(`${directory}/build.css`, 'utf8')
  const requests: string[] = []
  const liveRequests: { prompt: string; platforms: string[]; language: string }[] = []
  // Block and record ALL attempted outbound requests, including provider URLs,
  // unexpected same-origin calls and browser-triggered source prefetches.
  await page.route('**/*', route => { requests.push(route.request().url()); return route.abort() })
  await page.route('https://studio.fixture/api/dashboard/clients/*/studio/answer', route => {
    const body = route.request().postDataJSON()
    liveRequests.push(body)
    if (quotaError) return route.fulfill({ status: 429, json: { error: 'STUDIO_QUOTA_EXCEEDED' } })
    return route.fulfill({ json: { quota: { cap: 5, remaining: 3, scope: 'process' }, answers: body.platforms.map((platform: string) => ({
      platform, coverage: platform === 'gemini-flash' ? 'present' : 'missing',
      answer: platform === 'gemini-flash' ? 'MOCK LIVE ANSWER' : null,
      model: 'mock-live-model', startedAt: '2026-10-28T00:00:00Z', durationMs: 12, finishReason: 'stop', grounding: 'none',
      searchEvidence: { requested: 'none', execution: 'unknown', basis: 'request-only' },
      citations: [{ url: 'https://source.example/live', title: 'Live source' }, { url: 'http://127.0.0.1/private', title: 'Unsafe' }],
      error: platform === 'gemini-flash' ? null : 'PROVIDER_UNAVAILABLE',
    })) } })
  })
  const params = new URLSearchParams()
  if (empty) params.set('empty', '1')
  if (scan) params.set('scan', '1')
  if (liveCap !== undefined) params.set('live', String(liveCap))
  if (free) params.set('free', '1')
  const url = `https://studio.fixture/${lang}${params.size ? `?${params}` : ''}`
  await page.route(url, route => route.fulfill({
    contentType: 'text/html; charset=utf-8',
    body: `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Studio fixture</title><style>${css}</style></head><body><div id="root"></div><script>${js}</script></body></html>`,
  }))
  await page.goto(url)
  return { copy: (lang === 'en' ? en : zh).conversationStudio, requests, liveRequests }
}

for (const lang of ['en', 'zh-HK']) {
  test(`home tasks fill and focus, filters narrow cards, and start opens discussion in ${lang}`, async ({ page }) => {
    const { copy, requests } = await fixture(page, lang)
    const home = page.locator('#studio-home')
    await expect(home).toBeVisible()
    await expect(page.getByRole('log')).toHaveCount(0)
    await expect(home.locator('.as-template')).toHaveCount(6)
    await expect(home.locator('.as-filter')).toHaveCount(5)
    const composer = page.locator('#studio-composer')
    await expect(page.getByRole('heading', { name: copy.heroTitle, exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: copy.chooseDocuments, exact: true })).toBeDisabled()
    await expect(page.getByText(copy.sources.unavailable, { exact: true })).toBeVisible()
    for (const [category, keys] of [
      ['discover', ['opportunity', 'competitors']], ['improve', ['improve', 'brief']],
      ['monitor', ['pulse']], ['report', ['report']],
    ] as const) {
      const chip = page.getByRole('button', { name: copy.filters[category], exact: true })
      await chip.click()
      await expect(chip).toHaveAttribute('aria-pressed', 'true')
      await expect(home.locator('.as-template')).toHaveCount(keys.length)
      for (const key of keys) await expect(home.getByRole('button', { name: copy.templates[key].label, exact: true })).toBeVisible()
    }
    await page.getByRole('button', { name: copy.filters.all, exact: true }).click()
    for (const key of ['opportunity', 'improve', 'brief', 'competitors', 'pulse', 'report'] as const) {
      await page.getByRole('button', { name: copy.templates[key].label, exact: true }).click()
      await expect(composer).toHaveValue(copy.templates[key].prompt)
      await expect(composer).toBeFocused()
    }
    await page.getByRole('button', { name: copy.templates.brief.label, exact: true }).click()
    await expect(composer).toHaveValue(copy.templates.brief.prompt)
    await expect(composer).toBeFocused()
    await page.locator('button[type="submit"]').click()
    await expect(home).toHaveCount(0)
    await expect(page.getByRole('log')).toBeVisible()
    await expect(page.locator('.as-template')).toHaveCount(0)
    expect(requests).toEqual([])
  })
  test(`live Send shows separate unverified output, safe sources and partial failure in ${lang}`, async ({ page }) => {
    const { copy, requests, liveRequests } = await fixture(page, lang, false, false, 5)
    await expect(page.getByText(copy.live.badge, { exact: true })).toHaveCount(0)
    await page.getByText(copy.scopeNote, { exact: true }).click()
    await expect(page.getByText(copy.live.notice, { exact: true })).toBeVisible()
    await expect(page.getByText(copy.live.temporaryCap, { exact: true })).toBeVisible()
    await page.locator('.as-platform-picker > summary').click()
    await page.getByRole('checkbox', { name: 'gpt-4o', exact: true }).check()
    await page.getByRole('button', { name: copy.templates.brief.label, exact: true }).click()
    await page.locator('button[type="submit"]').click()
    const panel = page.getByRole('region', { name: copy.live.replyLabel.replace('{number}', '1'), exact: true })
    await expect(panel).toContainText(copy.live.unverified)
    await expect(panel).toContainText('MOCK LIVE ANSWER')
    await expect(panel).toContainText(copy.live.missing)
    await expect(panel).toContainText(copy.live.searchUnknown)
    await expect(panel).toContainText('mock-live-model')
    await expect(panel).toContainText('2026-10-28T00:00:00Z')
    await expect(panel.getByRole('link', { name: 'Live source' }).first()).toHaveAttribute('href', 'https://source.example/live')
    await expect(panel.getByRole('link', { name: 'Unsafe' })).toHaveCount(0)
    await expect(page.getByRole('log')).toContainText(copy.evidence.savedSummary)
    expect(liveRequests).toEqual([{ prompt: copy.templates.brief.prompt, platforms: ['gemini-flash', 'gpt-4o'], language: lang }])
    await page.locator('#studio-composer').fill('Second question only')
    await page.locator('button[type="submit"]').click()
    await expect(page.getByText('MOCK LIVE ANSWER', { exact: true })).toHaveCount(2)
    expect(liveRequests[1]).toEqual({ prompt: 'Second question only', platforms: ['gemini-flash', 'gpt-4o'], language: lang })
    expect(requests).toEqual([])
    for (const dark of [false, true]) {
      await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), dark)
      for (const width of [320, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      }
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
    }
    await page.reload()
    await expect(page.getByText(copy.threadsEmpty, { exact: true })).toBeVisible()
    expect(requests).toEqual([])
  })

  test(`page improvement uses only owned saved scans and held outcomes stay explicit in ${lang}`, async ({ page }) => {
    const { copy, requests } = await fixture(page, lang, false, true)
    await page.getByRole('button', { name: copy.templates.improve.label, exact: true }).click()
    await page.locator('button[type="submit"]').click()
    const log = page.getByRole('log')
    await expect(log.getByTestId('owned-scan-evidence')).toBeVisible()
    await expect(log).not.toContainText('offers sourdough')
    await expect(log).toContainText(copy.templates.improve.limit)
    for (const task of ['opportunity', 'report'] as const) {
      await page.getByRole('button', { name: copy.title, exact: true }).click()
      await page.getByRole('button', { name: copy.templates[task].label, exact: true }).click()
      await page.locator('button[type="submit"]').click()
      await expect(log).toContainText(copy.templates[task].limit)
      const destination = task === 'opportunity' ? 'opportunities' : 'reports'
      await expect(log.getByRole('link', { name: copy.destinations[destination] })).toHaveAttribute('href', `/${lang}/dashboard/11111111-1111-4111-8111-111111111111/${destination}`)
    }
    expect(requests).toEqual([])
  })

  test(`cap zero Send stays saved-only with no transport in ${lang}`, async ({ page }) => {
    const { copy, requests, liveRequests } = await fixture(page, lang, false, false, 0)
    await expect(page.getByText(copy.live.disabled, { exact: true })).toBeVisible()
    await page.getByRole('button', { name: copy.templates.brief.label, exact: true }).click()
    await page.locator('button[type="submit"]').click()
    await expect(page.getByRole('log')).toContainText(copy.evidence.savedSummary)
    expect(liveRequests).toEqual([])
    expect(requests).toEqual([])
  })

  test(`a plan with no platforms stays saved-only in ${lang}`, async ({ page }) => {
    const { copy, requests, liveRequests } = await fixture(page, lang, false, false, 5, false, true)
    await expect(page.getByText(copy.live.upgrade, { exact: true })).toBeVisible()
    await expect(page.getByRole('checkbox')).toHaveCount(0)
    await page.getByRole('button', { name: copy.templates.brief.label, exact: true }).click()
    await page.locator('button[type="submit"]').click()
    await expect(page.getByRole('log')).toContainText(copy.evidence.savedSummary)
    expect(liveRequests).toEqual([])
    expect(requests).toEqual([])
  })

  test(`quota rejection preserves saved evidence in ${lang}`, async ({ page }) => {
    const { copy, requests, liveRequests } = await fixture(page, lang, false, false, 5, true)
    await page.getByRole('button', { name: copy.templates.brief.label, exact: true }).click()
    await page.locator('button[type="submit"]').click()
    await expect(page.getByRole('alert')).toHaveText(copy.live.exhausted)
    await expect(page.getByRole('log')).toContainText(copy.evidence.savedSummary)
    expect(liveRequests).toHaveLength(1)
    expect(requests).toEqual([])
  })

  test(`saved evidence, citations and temporary threads without outbound HTTP in ${lang}`, async ({ page }) => {
    const { copy, requests } = await fixture(page, lang)
    await expect(page.getByText(copy.savedBadge, { exact: true })).toHaveCount(0)
    await page.getByText(copy.scopeNote, { exact: true }).click()
    await expect(page.getByText(copy.savedNotice, { exact: true })).toBeVisible()
    const composer = page.locator('#studio-composer')
    const send = page.locator('button[type="submit"]')
    const log = page.getByRole('log')
    await expect(send).toBeDisabled()
    await composer.fill('   ')
    await expect(send).toBeDisabled()
    await page.getByRole('button', { name: copy.templates.brief.label, exact: true }).click()
    await expect(composer).toHaveValue(copy.templates.brief.prompt)
    await expect(composer).toBeFocused()
    await send.click()
    await expect(log).toContainText(copy.evidence.savedSummary)
    await expect(log).toContainText('Example Brand offers sourdough.')
    await expect(log).toContainText(copy.evidence.historicalQuote)
    await log.getByText(copy.evidence.panelTitle, { exact: true }).click()
    await log.getByText(copy.evidence.sourcesTitle, { exact: true }).click()
    await expect(log.getByRole('link', { name: 'Bread', exact: true })).toHaveAttribute('href', 'https://example.com/bread')
    await expect(log).toContainText('30000000-0000-4000-8000-000000000001')
    await expect(log).toContainText('2026-10-27T03:00:00Z')
    await expect(log).toContainText(copy.evidence.searchUnknown)
    await expect(log).toContainText(copy.evidence.status.missing)
    await expect(log).toContainText(copy.evidence.status.unsupported)
    await expect(composer).toHaveValue('')
    await composer.fill('Keep this draft')
    await page.getByRole('button', { name: copy.title, exact: true }).click()
    await expect(log).toHaveCount(0)
    await composer.fill('unrelated helicopters')
    await send.click()
    await expect(log).toContainText(copy.evidence.insufficient)
    await expect(log).not.toContainText('offers sourdough')
    await page.getByRole('button', { name: copy.title, exact: true }).click()
    await page.locator('.as-thread').filter({ hasText: copy.templates.brief.prompt }).click()
    await expect(composer).toHaveValue('Keep this draft')
    await expect(log).not.toContainText('unrelated helicopters')
    // Editing a template drops its structured intent; no confident generic reply.
    await page.getByRole('button', { name: copy.title, exact: true }).click()
    await page.getByRole('button', { name: copy.templates.pulse.label, exact: true }).click()
    await composer.fill('Is sourdough gluten free today?')
    await send.click()
    await expect(log).toContainText(copy.evidence.questionLimit)
    expect(requests).toEqual([])
    await page.reload()
    await expect(page.getByText(copy.threadsEmpty, { exact: true })).toBeVisible()
    await expect(log).toHaveCount(0)
    expect(requests).toEqual([])
  })

  test(`all saved-data templates and insufficient competitor comparison in ${lang}`, async ({ page }) => {
    const { copy, requests } = await fixture(page, lang)
    for (const key of ['pulse', 'report', 'competitors'] as const) {
      if (await page.locator('#studio-discussion').count()) await page.getByRole('button', { name: copy.title, exact: true }).click()
      await page.getByRole('button', { name: copy.templates[key].label, exact: true }).click()
      await page.locator('button[type="submit"]').click()
      await expect(page.getByRole('log')).toContainText(key === 'competitors' ? copy.evidence.comparisonLimit : copy.evidence.savedSummary)
      await expect(page.getByRole('log')).toContainText('Example Brand offers sourdough.')
    }
    expect(requests).toEqual([])
  })

  test(`empty evidence stays insufficient and has no invented sources in ${lang}`, async ({ page }) => {
    const { copy, requests } = await fixture(page, lang, true)
    await page.getByRole('button', { name: copy.templates.brief.label, exact: true }).click()
    await page.locator('button[type="submit"]').click()
    const log = page.getByRole('log')
    await expect(log).toContainText(copy.evidence.insufficient)
    await expect(log).toContainText(copy.evidence.noSources)
    await expect(log.getByRole('link')).toHaveCount(0)
    expect(requests).toEqual([])
  })

  test(`IME, accessibility and reflow in ${lang}`, async ({ page }) => {
    const { copy, requests } = await fixture(page, lang, false, true)
    const composer = page.locator('#studio-composer')
    await composer.fill('廣東話測試')
    await composer.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, keyCode: 229 })
    await expect(page.getByRole('log')).toHaveCount(0)
    await expect(composer).toHaveValue('廣東話測試')
    await page.locator('button[type="submit"]').click()
    await expect(page.getByRole('log')).toContainText(copy.evidence.insufficient)
    await page.getByRole('button', { name: copy.title, exact: true }).click()
    await page.getByRole('button', { name: copy.templates.brief.label, exact: true }).click()
    await page.locator('button[type="submit"]').click()
    await composer.fill('Follow-up question')
    await page.locator('button[type="submit"]').click()
    await page.getByRole('log').getByText(copy.evidence.panelTitle).last().click()
    await page.getByRole('log').getByText(copy.evidence.sourcesTitle).last().click()
    await composer.fill('x'.repeat(300))
    for (const dark of [false, true]) {
      await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), dark)
      for (const width of [320, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      }
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
    }
    expect(requests).toEqual([])
    await page.screenshot({ path: `artifacts/studio/${lang}-${test.info().project.name}.png`, fullPage: true })
  })
}
