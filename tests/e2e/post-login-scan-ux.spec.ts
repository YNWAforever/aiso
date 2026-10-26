import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

const brand = '11111111-1111-4111-8111-111111111111'
async function fixture(page: Page) {
  const dir = process.env.AISO_SCAN_UX_HTML_DIR
  if (!dir) throw new Error('Generate post-login component fixtures with AISO_SCAN_UX_HTML_DIR first')
  const js = readFileSync(join(dir, 'fixture.js'), 'utf8')
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.origin !== 'https://scan-ux.fixture' || route.request().resourceType() !== 'document') return route.abort('blockedbyclient')
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="${url.pathname.startsWith('/zh-HK/') ? 'zh-HK' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Scan UX fixture</title></head><body><div id="root"></div><script>${js}</script></body></html>` })
  })
}

for (const lang of ['en', 'zh-HK'] as const) {
  const copy = lang === 'en' ? en : zh
  const base = `https://scan-ux.fixture/${lang}/dashboard/${brand}`
  for (const scanQuery of ['', '&scanId=older-scan']) {
    test(`recovery scan preserves its URL through re-login in ${lang} (${scanQuery || 'latest scan'})`, async ({ page }) => {
      await fixture(page)
      const requests: unknown[] = []
      await page.route('**/api/scan', route => {
        requests.push(route.request().postDataJSON())
        return route.fulfill({ json: { id: 'recovered-scan' } })
      })
      const recovery = `/${lang}/dashboard/${brand}?step=scan${scanQuery}&url=https%3A%2F%2Fbrand.invalid%2Flanding%3Fcampaign%3Dreport%26source%3Dold%23section`
      await page.goto(`https://scan-ux.fixture${recovery}`)
      await page.getByRole('link', { name: 'Fixture sign out', exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`/${lang}/auth/login\\?next=`))
      expect(new URL(page.url()).searchParams.get('next')).toBe(recovery)
      await page.getByRole('link', { name: 'Synthetic sign-in continuation' }).click()
      await expect(page).toHaveURL(`https://scan-ux.fixture${recovery}`)
      await page.reload()
      await expect(page.getByRole('textbox', { name: copy.dashboard.scan_url })).toHaveValue('https://brand.invalid/landing?campaign=report&source=old#section')
      expect(requests).toHaveLength(0)
      await page.getByRole('button', { name: copy.dashboard.run_scan, exact: true }).click()
      await expect(page).toHaveURL(`${base}?step=results&scanId=recovered-scan`)
      expect(requests).toEqual([{ url: 'https://brand.invalid/landing?campaign=report&source=old#section', industry: 'technology', region: 'HK', clientId: brand }])
    })
  }
  test(`selected scan survives Results, Improve, Report and re-login in ${lang}`, async ({ page }) => {
    await fixture(page)
    await page.goto(`${base}?step=results`)
    await page.getByRole('combobox', { name: copy.dashboard.choose_saved_scan }).selectOption('older-scan')
    await page.getByRole('button', { name: copy.dashboard.open_selected_scan, exact: true }).click()
    await expect(page).toHaveURL(`${base}?step=results&scanId=older-scan`)
    await page.getByRole('link', { name: copy.dashboard.next_improve, exact: true }).click()
    await expect(page).toHaveURL(`${base}?step=improve&scanId=older-scan`)
    await page.getByRole('link', { name: copy.dashboard.nav_results, exact: true }).click()
    await page.getByRole('link', { name: copy.reports.create_share_report, exact: true }).click()
    await expect(page).toHaveURL(`${base}/reports/new?scanId=older-scan`)
    await page.getByRole('link', { name: 'Fixture sign out', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/${lang}/auth/login\\?next=`))
    expect(new URL(page.url()).searchParams.get('next')).toBe(`/${lang}/dashboard/${brand}/reports/new?scanId=older-scan`)
    await page.getByRole('link', { name: 'Synthetic sign-in continuation' }).click()
    await expect(page).toHaveURL(`${base}/reports/new?scanId=older-scan`)
    await page.getByRole('link', { name: copy.reports.back_to_source_scan, exact: true }).click()
    await expect(page).toHaveURL(`${base}?step=results&scanId=older-scan`)
    await page.reload()
    await expect(page.getByRole('combobox', { name: copy.dashboard.choose_saved_scan })).toHaveValue('older-scan')
  })
  test(`report creation without a scan offers saved history in ${lang}`, async ({ page }) => {
    await fixture(page)
    await page.goto(`${base}/reports/new`)
    await page.getByRole('combobox', { name: copy.dashboard.choose_saved_scan }).selectOption('older-scan')
    await page.getByRole('button', { name: copy.dashboard.open_selected_scan, exact: true }).click()
    await expect(page).toHaveURL(`${base}/reports/new?scanId=older-scan`)
    await expect(page.getByRole('link', { name: copy.reports.back_to_source_scan })).toHaveAttribute('href', `/${lang}/dashboard/${brand}?step=results&scanId=older-scan`)
  })
  test(`changing the report scan protects unsaved edits in ${lang}`, async ({ page }) => {
    await fixture(page)
    await page.goto(`${base}/reports/new?scanId=older-scan`)
    const summary = page.getByRole('textbox', { name: copy.reports.executive_summary, exact: true })
    await summary.fill('Unsaved synthetic report edits')
    await page.getByRole('combobox', { name: copy.dashboard.choose_saved_scan }).selectOption('latest-scan')
    const dialog = page.waitForEvent('dialog')
    await page.getByRole('button', { name: copy.dashboard.open_selected_scan, exact: true }).click({ noWaitAfter: true })
    await (await dialog).dismiss()
    await expect(page).toHaveURL(`${base}/reports/new?scanId=older-scan`)
    await expect(summary).toHaveValue('Unsaved synthetic report edits')
    page.once('dialog', prompt => prompt.accept())
    await page.getByRole('button', { name: copy.dashboard.open_selected_scan, exact: true }).click()
    await expect(page).toHaveURL(`${base}/reports/new?scanId=latest-scan`)
  })
  test(`rescan is ready, explicit, retryable and submits once in ${lang}`, async ({ page }) => {
    await fixture(page)
    const requests: unknown[] = []
    await page.route('**/api/scan', async route => {
      requests.push(route.request().postDataJSON())
      if (requests.length === 1) return route.fulfill({ status: 422, json: { error: 'SCAN_UNREACHABLE' } })
      return route.fulfill({ json: { id: 'rescanned' } })
    })
    await page.goto(`${base}?step=scan&scanId=older-scan&url=https%3A%2F%2Fexample.invalid%2Fguide`)
    const url = page.getByRole('textbox', { name: copy.dashboard.scan_url })
    await expect(url).toHaveValue('https://example.invalid/guide')
    await expect(page.getByRole('combobox', { name: copy.dashboard.industry_optional })).toHaveValue('technology')
    await expect(page.getByRole('combobox', { name: copy.dashboard.region_optional })).toHaveValue('HK')
    expect(requests).toHaveLength(0)
    const submit = page.getByRole('button', { name: copy.dashboard.run_scan, exact: true })
    await submit.click()
    await expect(page.getByText(copy.dashboard.scan_unreachable, { exact: true })).toBeVisible()
    await expect(url).toHaveValue('https://example.invalid/guide')
    await submit.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click() })
    await expect(page).toHaveURL(`${base}?step=results&scanId=rescanned`)
    expect(requests).toEqual(Array(2).fill({ url: 'https://example.invalid/guide', industry: 'technology', region: 'HK', clientId: brand }))
  })
}
