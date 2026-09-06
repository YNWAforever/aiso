import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFileSync } from 'node:fs'
import type { ObservationCopy } from '@/components/observations/copy'

const clientId = '11111111-1111-4111-8111-111111111111'
const promptId = '22222222-2222-4222-8222-222222222222'
async function fixture(page: Page, lang: string): Promise<ObservationCopy> {
  const dir = process.env.C9B_HTML_DIR,
    css = process.env.C9B_CSS_PATH
  test.skip(!dir || !css, 'C9B fixture paths required')
  const copy = JSON.parse(readFileSync(`${dir}/${lang}-copy.json`, 'utf8'))
  const html = readFileSync(`${dir}/${lang}-default.html`, 'utf8')
  const style = readFileSync(css!, 'utf8'),
    js = readFileSync(`${dir}/observation-fixture.js`, 'utf8')
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route(`https://observation.fixture/${lang}`, (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>C9b observations</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${style}</style></head><body>${html}<script>${js}</script></body></html>`,
    }),
  )
  await page.goto(`https://observation.fixture/${lang}`)
  await page.waitForFunction(() =>
    Boolean(
      (window as Window & { observationFixtureReady?: boolean })
        .observationFixtureReady,
    ),
  )
  expect(errors).toEqual([])
  return copy
}
const response = (result: 'success' | 'incomplete' = 'success') => ({
  schemaVersion: 1,
  clientId,
  selectedWeek: '2026-09-01',
  weeks: ['2026-09-01', '2026-08-25'],
  questionsTruncated: false,
  questions: [],
  items: [
    {
      id: '33333333-3333-4333-8333-333333333333',
      sourceKind: 'pulse-metric',
      promptId: null,
      question: 'Response historical question',
      platform: 'ChatGPT',
      scanWeek: '2026-09-01',
      recordedAt: null,
      collectedAt: null,
      model: null,
      market: null,
      result,
      hasAnswer: result === 'success',
      brandMentioned: result === 'success' ? false : null,
      currentPrompt: null,
      limitations: [],
    },
  ],
  counts: { recordedRows: 3, successfulRows: 1, incompleteRows: 2 },
  nextCursor: null as string | null,
})

for (const lang of ['en', 'zh-HK']) {
  test(`C9b filters, preserves localized copy and reflows in ${lang}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 900 })
    const copy = await fixture(page, lang)
    await page.route('**/api/clients/*/observations?*', (route) =>
      route.fulfill({ json: response() }),
    )
    await page
      .getByRole('combobox', { name: copy.result, exact: true })
      .selectOption('success')
    await expect(
      page.getByRole('heading', {
        name: `${copy.historicalQuestion}: Response historical question`,
      }),
    ).toBeVisible()
    await expect(
      page.getByText(lang === 'en' ? '3 recorded rows' : '已記錄 3 列', {
        exact: true,
      }),
    ).toBeVisible()
    await expect(
      page.getByText(lang === 'en' ? '1 successful row' : '成功 1 列', {
        exact: true,
      }),
    ).toBeVisible()
    await expect(
      page.getByText(copy.unknownModel, { exact: true }),
    ).toBeVisible()
    await expect(page.getByText(copy.brandNotMentioned)).toBeVisible()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  })

  test(`C9b keyboard loading, failure and retry in ${lang}`, async ({
    page,
  }) => {
    const copy = await fixture(page, lang)
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let calls = 0
    await page.route('**/api/clients/*/observations?*', async (route) => {
      if (++calls === 1) {
        await gate
        await route.fulfill({
          status: 503,
          json: { error: 'OBSERVATIONS_UNAVAILABLE' },
        })
      } else await route.fulfill({ json: response() })
    })
    const result = page.getByRole('combobox', {
      name: copy.result,
      exact: true,
    })
    await result.focus()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Tab')
    await expect(result).toHaveValue('success')
    await expect(page.getByRole('status')).toHaveText(copy.loading)
    await result.focus()
    release()
    await expect(page.getByRole('alert')).toContainText(copy.loadError)
    await expect(result).toBeFocused()
    await page.getByRole('button', { name: copy.retry }).click()
    await expect(
      page.getByRole('heading', {
        name: `${copy.historicalQuestion}: Response historical question`,
      }),
    ).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)
  })

  test(`C9b later filter wins a response race in ${lang}`, async ({ page }) => {
    const copy = await fixture(page, lang)
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let calls = 0
    await page.route('**/api/clients/*/observations?*', async (route) => {
      if (++calls === 1) {
        await gate
        await route
          .fulfill({
            json: {
              ...response(),
              counts: {
                recordedRows: 99,
                successfulRows: 99,
                incompleteRows: 0,
              },
            },
          })
          .catch(() => {})
      } else await route.fulfill({ json: response('incomplete') })
    })
    const result = page.getByRole('combobox', {
      name: copy.result,
      exact: true,
    })
    await result.selectOption('success')
    await expect.poll(() => calls).toBe(1)
    await result.selectOption('incomplete')
    await expect(page.getByText(copy.noAnswer, { exact: true })).toBeVisible()
    release()
    await expect(
      page.getByText(copy.recordedRows.replace('{count}', '99'), {
        exact: true,
      }),
    ).toHaveCount(0)
    await expect(result).toHaveValue('incomplete')
  })

  test(`C9b accepts and clears an unlisted bounded platform in ${lang}`, async ({
    page,
  }) => {
    const copy = await fixture(page, lang)
    const requests: URLSearchParams[] = []
    await page.route('**/api/clients/*/observations?*', async (route) => {
      requests.push(new URL(route.request().url()).searchParams)
      await route.fulfill({ json: response() })
    })
    const platform = page.getByRole('combobox', {
      name: copy.platform,
      exact: true,
    })

    await platform.fill('DeepSeek')
    await platform.press('Enter')
    await expect.poll(() => requests.length).toBe(1)
    expect(requests[0].get('platform')).toBe('DeepSeek')

    await platform.fill('')
    await platform.press('Enter')
    await expect.poll(() => requests.length).toBe(2)
    expect(requests[1].has('platform')).toBe(false)

    const eighty = '😀'.repeat(80)
    await platform.fill(eighty)
    await platform.press('Enter')
    await expect.poll(() => requests.length).toBe(3)
    expect(requests[2].get('platform')).toBe(eighty)

    await platform.fill(`${eighty}😀`)
    await platform.press('Enter')
    await expect(page.getByRole('alert')).toHaveText(copy.platformInvalid)
    await expect.poll(() => requests.length).toBe(3)
    await expect(platform).toBeFocused()
  })
  test(`C9b pins filters, resets paging and retries the same page in ${lang}`, async ({
    page,
  }) => {
    const copy = await fixture(page, lang)
    const requests: URLSearchParams[] = []
    let failPage = true
    await page.route('**/api/clients/*/observations?*', async (route) => {
      const query = new URL(route.request().url()).searchParams
      requests.push(query)
      if (query.has('cursor') && failPage) {
        failPage = false
        await route.fulfill({
          status: 503,
          json: { error: 'OBSERVATIONS_UNAVAILABLE' },
        })
        return
      }
      const data = response()
      data.nextCursor = 'second-page'
      if (query.has('cursor')) data.items[0].question = 'Second page question'
      await route.fulfill({ json: data })
    })
    await page
      .getByRole('combobox', { name: copy.question, exact: true })
      .selectOption(promptId)
    await expect(
      page.getByRole('heading', {
        name: `${copy.historicalQuestion}: Response historical question`,
      }),
    ).toBeVisible()
    await expect(
      page.getByRole('combobox', { name: copy.question, exact: true }),
    ).toHaveValue(promptId)
    await expect(
      page.getByRole('option', { name: copy.archivedQuestion }),
    ).toHaveCount(1)
    await page
      .getByRole('combobox', { name: copy.platform, exact: true })
      .fill('ChatGPT')
    await page.getByRole('button', { name: copy.applyPlatform }).click()
    await expect.poll(() => requests.length).toBe(2)
    await expect(page.getByRole('status')).toBeEmpty()
    await page.getByRole('button', { name: copy.next }).click()
    await expect(page.getByRole('alert')).toContainText(copy.loadError)
    await page.getByRole('button', { name: copy.retry }).click()
    await expect(
      page.getByRole('heading', {
        name: `${copy.historicalQuestion}: Second page question`,
      }),
    ).toBeVisible()
    expect(requests[2].toString()).toBe(requests[3].toString())
    expect(requests[3].get('cursor')).toBe('second-page')
    expect(requests[3].get('promptId')).toBe(promptId)
    expect(requests[3].get('platform')).toBe('ChatGPT')
    expect(requests[3].get('week')).toBe('2026-09-01')
    await page
      .getByRole('combobox', { name: copy.week, exact: true })
      .selectOption('2026-08-25')
    await expect.poll(() => requests.length).toBe(5)
    expect(requests[4].has('cursor')).toBe(false)
    expect(requests[4].get('week')).toBe('2026-08-25')
    await expect(page.getByRole('status')).toBeEmpty()
    await page
      .getByRole('combobox', { name: copy.result, exact: true })
      .selectOption('success')
    await expect.poll(() => requests.length).toBe(6)
    expect(requests[5].has('cursor')).toBe(false)
    expect(requests[5].get('week')).toBe('2026-08-25')
  })
}
