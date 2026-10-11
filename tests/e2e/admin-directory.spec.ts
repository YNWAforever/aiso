import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFileSync } from 'node:fs'
async function fixture(page: Page, lang: string) {
  const dir = process.env.AISO_ADMIN_HTML_DIR
  if (!dir) throw new Error('AISO_ADMIN_HTML_DIR is required')
  const js = readFileSync(`${dir}/fixture.js`, 'utf8'), css = readFileSync(`${dir}/build.css`, 'utf8')
  await page.route('**/*', route => route.abort())
  await page.route(`https://admin.fixture/${lang}`, route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="${lang}"><head><title>Admin component fixture</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><main><div id="root"></div></main><script>${js}</script></body></html>` }))
}
for (const lang of ['en', 'zh-HK']) {
  test(`admin sees a bounded page and account drilldowns (${lang})`, async ({ page }) => {
    await fixture(page, lang)
    await page.route('**/api/admin/directory?*', route => route.fulfill({ json: { view: 'users', page: 1, hasMore: true, rows: [{ id: 'synthetic-user', account_id: '11111111-1111-4111-8111-111111111111', name: 'Synthetic Owner', email: 'owner@example.test', role: 'member', status: 'active', created_at: '2026-10-11T00:00:00Z' }] } }))
    await page.goto(`https://admin.fixture/${lang}`)
    await expect(page.getByText('owner@example.test')).toBeVisible()
    await expect(page.getByRole('link', { name: lang === 'en' ? 'Next' : '下一頁', exact: true })).toHaveAttribute('href', /page=2/)
    await expect(page.getByRole('link', { name: /11111111/ })).toHaveAttribute('href', /accountId=11111111/)
    expect((await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa']).analyze()).violations).toEqual([])
    expect(await page.evaluate(() => document.body.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  })
  test(`admin data outage retries without showing an empty success (${lang})`, async ({ page }) => {
    await fixture(page, lang)
    let requests = 0
    await page.route('**/api/admin/directory?*', route => { requests++; return route.fulfill(requests === 1 ? { status: 503, json: { error: 'DIRECTORY_UNAVAILABLE' } } : { json: { view: 'users', page: 1, hasMore: false, rows: [] } }) })
    await page.goto(`https://admin.fixture/${lang}`)
    await expect(page.getByRole('alert')).toBeVisible()
    await page.getByRole('button', { name: lang === 'en' ? 'Retry' : '重試', exact: true }).click()
    await expect(page.getByText(lang === 'en' ? 'No records match this selection.' : '沒有符合此篩選的記錄。')).toBeVisible()
    expect(requests).toBe(2)
  })
}
