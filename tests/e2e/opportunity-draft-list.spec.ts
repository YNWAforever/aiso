import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { draft } from '../../__tests__/components/c9c-fixtures'
import AxeBuilder from '@axe-core/playwright'
const A = { ...draft, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: 'Existing draft A' }
const B = { ...draft, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', title: 'New draft B' }
async function fixture(page: Page, lang: string, saved = false, sme = false) {
  const dir = process.env.C9C_HTML_DIR, css = process.env.C9C_CSS_PATH
  if (!dir || !css) throw new Error('T20 fixture paths required; skipped tests are not acceptance')
  const copy = JSON.parse(readFileSync(`${dir}/${lang}-copy.json`, 'utf8')) as Record<string, string>
  const variant = saved ? (sme ? 'smeSaved' : 'saved') : (sme ? 'sme' : 'default')
  const html = readFileSync(`${dir}/${lang}-${variant}.html`, 'utf8')
  const js = readFileSync(`${dir}/fixture.js`, 'utf8'), style = readFileSync(css, 'utf8')
  await page.route('**/*', route => route.abort())
  await page.route(`https://opportunity.fixture/${lang}*`, route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html lang="${lang}"><head><title>Draft list acceptance</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${style}</style></head><body>${html}<script>${js}</script></body></html>` }))
  await page.goto(`https://opportunity.fixture/${lang}`)
  await page.waitForFunction(() => Boolean((window as Window & { c9cFixtureReady?: boolean }).c9cFixtureReady))
  return copy
}
for (const lang of ['en', 'zh-HK']) for (const sme of [false,true]) {
  test(`saving B loads existing A without overwriting B editor in ${lang} ${sme?'SME':'legacy'}`, async ({ page }) => {
    const copy = await fixture(page, lang, false, sme)
    let reads = 0, release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    await page.route('**/api/clients/*/work-items', async route => {
      if (route.request().method() === 'POST') return route.fulfill({ status: 201, json: { item: B } })
      reads++; await gate
      return route.fulfill({ json: { items: [B, A], nextCursor: null } })
    })
    await page.getByRole('button', { name: copy.saveDraft, exact: true }).click()
    await expect(page.getByLabel(copy.titleField, { exact: true })).toHaveValue(B.title)
    await expect(page.getByRole('button', { name: copy.loadingDrafts, exact: true })).toBeVisible()
    await page.getByLabel(copy.titleField, { exact: true }).fill('Unsaved B edit')
    release()
    await expect(page.getByRole('button', { name: A.title, exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: B.title, exact: true })).toBeVisible()
    await expect(page.getByLabel(copy.titleField, { exact: true })).toHaveValue('Unsaved B edit')
    await page.getByRole('button', { name: copy.suggestions, exact: true }).click()
    await page.getByRole('button', { name: copy.savedDrafts, exact: true }).click()
    expect(reads).toBe(1)
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
    await page.screenshot({ path: `artifacts/aiso/T20/${lang}-${test.info().project.name}-${sme?'sme':'legacy'}-drafts.png`, fullPage: true })
  })
  test(`list failure and third-page duplicates preserve selected B in ${lang} ${sme?'SME':'legacy'}`, async ({ page }) => {
    const copy = await fixture(page, lang, false, sme)
    let reads = 0
    const C = { ...draft, id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', title: 'Third draft C' }
    const D = { ...draft, id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', title: 'Fourth draft D' }
    await page.route('**/api/clients/*/work-items*', route => {
      if (route.request().method() === 'POST') return route.fulfill({ status: 201, json: { item: B } })
      reads++
      return route.fulfill(reads === 1 ? { status: 503, json: {} } : { json: reads === 2 ? { items: [B, A], nextCursor: 'page2' } : reads === 3 ? { items: [A, C, C], nextCursor: 'page3' } : { items: [C, D], nextCursor: null } })
    })
    await page.getByRole('button', { name: copy.saveDraft, exact: true }).click()
    await page.getByLabel(copy.titleField, { exact: true }).fill('Unsaved B edit')
    await expect(page.getByRole('alert')).toHaveText(copy.listError)
    await page.getByRole('button', { name: copy.refreshDrafts, exact: true }).click()
    await expect(page.getByRole('button', { name: A.title, exact: true })).toBeVisible()
    await page.getByRole('button', { name: copy.loadMore, exact: true }).click()
    await expect(page.getByRole('button', { name: C.title, exact: true })).toHaveCount(1)
    await page.getByRole('button', { name: copy.loadMore, exact: true }).click()
    await expect(page.getByRole('button', { name: D.title, exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: C.title, exact: true })).toHaveCount(1)
    await expect(page.getByLabel(copy.titleField, { exact: true })).toHaveValue('Unsaved B edit')
  })
  test(`opening B loads first page and reload restores selected B in ${lang} ${sme?'SME':'legacy'}`, async ({ page }) => {
    const copy = await fixture(page, lang, true, sme)
    let reads = 0
    await page.route('**/api/clients/*/work-items', route => { reads++; return route.fulfill({ json: { items: [B, A], nextCursor: null } }) })
    await page.route('**/api/clients/*/work-items/*', route => route.fulfill({ json: { item: B } }))
    await page.getByRole('button', { name: copy.openDraft, exact: true }).click()
    await expect(page.getByRole('button', { name: A.title, exact: true })).toBeVisible()
    await expect(page.getByLabel(copy.titleField, { exact: true })).toHaveValue(B.title)
    expect(reads).toBe(1)
    await page.reload()
    await expect(page.getByRole('button', { name: A.title, exact: true })).toBeVisible()
    await expect(page.getByLabel(copy.titleField, { exact: true })).toHaveValue(B.title)
    expect(reads).toBe(2)
  })
}
