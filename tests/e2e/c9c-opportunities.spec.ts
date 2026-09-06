import { scanSuggestion } from '../../__tests__/components/c9c-fixtures'
import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFileSync } from 'node:fs'
import type en from '@/messages/en.json'
import type { WorkItem } from '@/lib/work-items/schema'
import type { OpportunityResponse } from '@/lib/opportunities/types'
type Copy = typeof en.opportunities
const errors = new WeakMap<Page, string[]>()
async function fixture(page: Page, lang: string, slice = 'C9C') {
  const dir = process.env[`${slice}_HTML_DIR`],
    css = process.env[`${slice}_CSS_PATH`]
  if (!dir || !css) throw new Error('C9c fixture paths are required')
  const copy = JSON.parse(
    readFileSync(`${dir}/${lang}-copy.json`, 'utf8'),
  ) as Copy
  const data = JSON.parse(readFileSync(`${dir}/${lang}-data.json`, 'utf8')) as {
    clientId: string
    initial: OpportunityResponse
    item: WorkItem
  }
  const draftDir = process.env.C9C_DRAFT_HTML_DIR
  if (!draftDir) throw new Error('Draft fixture path required')
  const draft = JSON.parse(
    readFileSync(`${draftDir}/${lang}-data.json`, 'utf8'),
  ).item as WorkItem
  const html = readFileSync(`${dir}/${lang}-default.html`, 'utf8'),
    js = readFileSync(`${dir}/fixture.js`, 'utf8'),
    style = readFileSync(css, 'utf8')
  const pageErrors: string[] = []
  errors.set(page, pageErrors)
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.route('**/*', (route) => route.abort())
  await page.route(`https://opportunity.fixture/${lang}`, (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>Opportunities</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${style}</style></head><body>${html}<script>${js}</script></body></html>`,
    }),
  )
  await page.goto(`https://opportunity.fixture/${lang}`)
  await page.waitForFunction(() =>
    Boolean((window as Window & { c9cFixtureReady?: boolean }).c9cFixtureReady),
  )
  return { copy, data, draft }
}
test.afterEach(({ page }) => {
  expect(errors.get(page) ?? []).toEqual([])
})
for (const lang of ['en', 'zh-HK']) {
  test(`C9c selected save, duplicate protection, focus and retained source in ${lang}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 900 })
    const { copy, data, draft } = await fixture(page, lang)
    let posts = 0,
      release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route('**/api/clients/*/work-items', async (route) => {
      posts++
      expect(route.request().postDataJSON()).toEqual({
        source: data.initial.suggestions[0].source,
        ruleVersion: data.initial.suggestions[0].ruleVersion,
        fingerprint: data.initial.suggestions[0].fingerprint,
        locale: lang,
      })
      await gate
      await route.fulfill({ status: 201, json: { item: draft } })
    })
    const save = page.getByRole('button', { name: copy.saveDraft, exact: true })
    await save.focus()
    await page.keyboard.press('Enter')
    await expect(
      page.getByRole('button', { name: copy.saving, exact: true }),
    ).toBeDisabled()
    await page.keyboard.press('Enter')
    expect(posts).toBe(1)
    release()
    await expect(
      page.getByRole('heading', { name: copy.savedDraft, exact: true }),
    ).toBeVisible()
    await expect(page.locator('[tabindex="-1"]')).toBeFocused()
    await expect(
      page.getByRole('status').filter({ hasText: copy.draftSaved }),
    ).toBeVisible()
    await expect(
      page.getByText('Original title', { exact: true }),
    ).toBeVisible()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  })
  test(`C9c failed save, changed evidence and explicit refresh in ${lang}`, async ({
    page,
  }) => {
    const { copy, data } = await fixture(page, lang)
    let status = 503,
      gets = 0
    await page.route('**/api/clients/*/work-items', (route) =>
      route.fulfill({
        status,
        json: {
          error: status === 409 ? 'EVIDENCE_CHANGED' : 'WORK_ITEMS_UNAVAILABLE',
        },
      }),
    )
    await page.route('**/api/clients/*/opportunities', (route) => {
      gets++
      return route.fulfill({ json: data.initial })
    })
    const save = page.getByRole('button', { name: copy.saveDraft, exact: true })
    await save.click()
    await expect(page.getByRole('alert')).toHaveText(copy.saveError)
    await expect(page.getByText(copy.pulseWhy, { exact: true })).toBeVisible()
    status = 409
    await save.click()
    await expect(
      page.getByText(copy.evidenceChanged, { exact: true }),
    ).toBeVisible()
    await expect(save).toBeDisabled()
    expect(gets).toBe(0)
    await page
      .getByRole('alert')
      .getByRole('button', { name: copy.refresh })
      .click()
    await expect(save).toBeEnabled()
    expect(gets).toBe(1)
  })
  test(`C9c independent list failure, pagination and detail reads in ${lang}`, async ({
    page,
  }) => {
    const { copy, draft } = await fixture(page, lang)
    let status = 503,
      details = 0
    await page.route('**/api/clients/*/work-items*', (route) =>
      route.fulfill(
        status === 503
          ? { status, json: { error: 'WORK_ITEMS_UNAVAILABLE' } }
          : {
              json: route.request().url().includes('cursor=')
                ? {
                    items: [
                      {
                        ...draft,
                        id: '55555555-5555-4555-8555-555555555555',
                        title: 'Next page draft',
                      },
                    ],
                    nextCursor: null,
                  }
                : { items: [draft], nextCursor: 'opaque+cursor' },
            },
      ),
    )
    await page.route('**/api/clients/*/work-items/*', (route) => {
      details++
      return route.fulfill({
        json: { item: { ...draft, title: 'Loaded detail' } },
      })
    })
    await page
      .getByRole('button', { name: copy.savedDrafts, exact: true })
      .click()
    await expect(page.getByRole('alert')).toHaveText(copy.listError)
    await page
      .getByRole('button', { name: copy.suggestions, exact: true })
      .click()
    await expect(page.getByText(copy.pulseWhy, { exact: true })).toBeVisible()
    await page
      .getByRole('button', { name: copy.savedDrafts, exact: true })
      .click()
    status = 200
    await page.getByRole('button', { name: copy.refreshDrafts }).click()
    await page.getByRole('button', { name: copy.loadMore }).click()
    await expect(
      page.getByRole('button', { name: 'Next page draft' }),
    ).toBeVisible()
    await page
      .getByRole('button', { name: 'Recorded title', exact: true })
      .click()
    await expect(page.getByLabel(copy.titleField, { exact: true })).toHaveValue(
      'Loaded detail',
    )
    expect(details).toBe(1)
  })
  test(`C9c edits survive failures and conflicts; reload is explicit in ${lang}`, async ({
    page,
  }) => {
    const { copy, draft } = await fixture(page, lang, 'C9C_DRAFT')
    let status = 503,
      gets = 0
    await page.route('**/api/clients/*/work-items/*', (route) => {
      if (route.request().method() === 'GET') {
        gets++
        if (gets === 1)
          return route.fulfill({
            status: 503,
            json: { error: 'WORK_ITEMS_UNAVAILABLE' },
          })
        return route.fulfill({
          json: {
            item: {
              ...draft,
              revision: 3,
              title: 'Latest title',
              notes: 'Remote notes',
            },
          },
        })
      }
      return route.fulfill(
        status === 200
          ? {
              json: {
                item: {
                  ...draft,
                  ...route.request().postDataJSON(),
                  revision: 2,
                },
              },
            }
          : {
              status,
              json: {
                error:
                  status === 409
                    ? 'WORK_ITEM_CONFLICT'
                    : 'WORK_ITEMS_UNAVAILABLE',
              },
            },
      )
    })
    for (const [label, value] of [
      [copy.titleField, 'Keep title'],
      [copy.action, 'Keep action'],
      [copy.notes, 'Keep notes'],
    ])
      await page.getByLabel(label, { exact: true }).fill(value)
    const save = page.getByRole('button', {
      name: copy.saveChanges,
      exact: true,
    })
    await save.click()
    await expect(page.getByRole('alert')).toHaveText(copy.editError)
    status = 409
    await save.click()
    await expect(page.getByRole('alert')).toHaveText(copy.editConflict)
    for (const [label, value] of [
      [copy.titleField, 'Keep title'],
      [copy.action, 'Keep action'],
      [copy.notes, 'Keep notes'],
    ])
      await expect(page.getByLabel(label, { exact: true })).toHaveValue(value)
    expect(gets).toBe(0)
    await page.getByRole('button', { name: copy.reloadDraft }).click()
    await expect(page.getByRole('status')).toHaveText(copy.reloadError)
    await expect(page.getByLabel(copy.notes, { exact: true })).toHaveValue(
      'Keep notes',
    )
    await page.getByRole('button', { name: copy.reloadDraft }).click()
    await expect(page.getByLabel(copy.notes, { exact: true })).toHaveValue(
      'Remote notes',
    )
    expect(gets).toBe(2)
    await expect(
      page.getByText('Original title', { exact: true }),
    ).toBeVisible()
    status = 200
    await page.getByLabel(copy.notes, { exact: true }).fill('Retry notes')
    await save.click()
    await expect(page.getByRole('status')).toHaveText(copy.changesSaved)
    await expect(page.getByLabel(copy.notes, { exact: true })).toHaveValue(
      'Retry notes',
    )
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  })
  test(`C9c Unicode validation and normalized retry in ${lang}`, async ({
    page,
  }) => {
    const { copy, draft } = await fixture(page, lang, 'C9C_DRAFT')
    let writes = 0
    await page.route('**/api/clients/*/work-items/*', (route) => {
      writes++
      const body = route.request().postDataJSON()
      expect(body.title).toBe('é'.repeat(160))
      expect(Object.keys(body).sort()).toEqual([
        'action',
        'expectedRevision',
        'notes',
        'title',
      ])
      return route.fulfill({
        json: { item: { ...draft, ...body, revision: 2 } },
      })
    })
    await page
      .getByLabel(copy.titleField, { exact: true })
      .fill('😀'.repeat(161))
    await page.getByRole('button', { name: copy.saveChanges }).click()
    await expect(page.getByRole('alert')).toHaveText(copy.invalidEdit)
    expect(writes).toBe(0)
    await page
      .getByLabel(copy.titleField, { exact: true })
      .fill(' e\u0301'.replace(' ', '').repeat(160))
    await page.getByRole('button', { name: copy.saveChanges }).click()
    await expect(page.getByRole('status')).toHaveText(copy.changesSaved)
    expect(writes).toBe(1)
  })
  test(
    'C9c scan save uses exact check reference in ' + lang,
    async ({ page }) => {
      const { copy, data, draft } = await fixture(page, lang)
      await page.route('**/api/clients/*/opportunities', (route) =>
        route.fulfill({
          json: {
            ...data.initial,
            sourceStates: { pulse: 'empty', scan: 'ok' },
            suggestions: [scanSuggestion],
          },
        }),
      )
      await page.route('**/api/clients/*/work-items', (route) => {
        expect(route.request().postDataJSON()).toEqual({
          source: scanSuggestion.source,
          ruleVersion: scanSuggestion.ruleVersion,
          fingerprint: scanSuggestion.fingerprint,
          locale: lang,
        })
        return route.fulfill({
          json: {
            item: {
              ...draft,
              evidenceSnapshot: {
                ...draft.evidenceSnapshot,
                evidence: scanSuggestion.evidence,
              },
            },
          },
        })
      })
      await page
        .getByRole('button', { name: copy.refresh, exact: true })
        .click()
      await expect(page.getByText(copy.scanWhy, { exact: true })).toBeVisible()
      await expect(page.getByText(copy.redacted, { exact: true })).toBeVisible()
      await page
        .getByRole('button', { name: copy.saveDraft, exact: true })
        .click()
      await expect(
        page.getByRole('heading', { name: copy.savedDraft, exact: true }),
      ).toBeVisible()
    },
  )
  test(
    'C9c opens existing saved draft by id even when current evidence is limited in ' +
      lang,
    async ({ page }) => {
      const { copy, data, draft } = await fixture(page, lang)
      let posts = 0,
        reads = 0
      await page.route('**/api/clients/*/opportunities', (route) =>
        route.fulfill({
          json: {
            ...data.initial,
            suggestions: [
              {
                ...data.initial.suggestions[0],
                savedDraftId: draft.id,
                savedState: 'saved',
                saveAvailability: 'limited-evidence',
              },
            ],
          },
        }),
      )
      await page.route('**/api/clients/*/work-items', (route) => {
        posts++
        return route.abort()
      })
      await page.route('**/api/clients/*/work-items/*', (route) => {
        reads++
        expect(route.request().url()).toContain(draft.id)
        return route.fulfill({ json: { item: draft } })
      })
      await page
        .getByRole('button', { name: copy.refresh, exact: true })
        .click()
      await page.getByRole('button', { name: copy.openDraft }).click()
      await expect(page.getByLabel(copy.notes, { exact: true })).toBeVisible()
      expect(reads).toBe(1)
      expect(posts).toBe(0)
    },
  )
  test(
    'C9c late draft reads do not replace a later view selection in ' + lang,
    async ({ page }) => {
      const { copy, draft } = await fixture(page, lang)
      await page.route('**/api/clients/*/work-items', (route) =>
        route.fulfill({ json: { items: [draft], nextCursor: null } }),
      )
      let release!: () => void
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      await page.route('**/api/clients/*/work-items/*', async (route) => {
        await gate
        await route.fulfill({ json: { item: draft } })
      })
      await page
        .getByRole('button', { name: copy.savedDrafts, exact: true })
        .click()
      await page.getByRole('button', { name: draft.title, exact: true }).click()
      await expect(
        page.getByRole('status').filter({ hasText: copy.loadingDraft }),
      ).toBeVisible()
      await page
        .getByRole('button', { name: copy.suggestions, exact: true })
        .click()
      release()
      await expect(page.getByRole('status')).toHaveText('')
      await expect(
        page.getByRole('button', { name: copy.suggestions, exact: true }),
      ).toHaveAttribute('aria-pressed', 'true')
      await expect(page.getByText(copy.pulseWhy, { exact: true })).toBeVisible()
    },
  )
}
