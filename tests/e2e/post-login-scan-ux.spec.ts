import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
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
  test(`reviews, saves, reopens and rechecks the same dated finding in ${lang}`, async ({ page }) => {
    await fixture(page)
    const older = '00000000-0000-4000-8000-000000000002', later = '00000000-0000-4000-8000-000000000001'
    const check = 'c1_robots', scope = `scanId=${older}&check=${check}`
    const data = JSON.parse(readFileSync(join(process.env.AISO_SCAN_UX_HTML_DIR!, 'finding.json'),'utf8'))
    const evidenceSnapshot = data.snapshots[lang]
    const item = { id:'00000000-0000-4000-8000-000000000003', clientId:brand, status:'draft', title:evidenceSnapshot.initialTitle,
      action:evidenceSnapshot.initialAction, notes:'', locale:lang, revision:1, createdAt:'2026-10-01', updatedAt:'2026-10-01', evidenceSnapshot }
    const requests: string[] = []
    await page.route('**/opportunities?*', route => {
      if (route.request().resourceType() === 'document') return route.fallback()
      requests.push(new URL(route.request().url()).search)
      return route.fulfill({json:data.response})
    })
    const saves: unknown[] = []
    await page.route(`**/work-items`,route=>{
      if(route.request().method() === 'GET') return route.fulfill({json:{items:[item],nextCursor:null}})
      saves.push(route.request().postDataJSON())
      return saves.length === 1 ? route.fulfill({status:409,json:{error:'EVIDENCE_CHANGED'}}) : route.fulfill({json:{item}})
    })
    await page.route(`**/work-items/${item.id}`,route=>route.fulfill({json:{item}}))
    await page.goto(`${base}?step=improve&scanId=${older}`)
    await page.getByRole('listitem').filter({hasText:'Synthetic saved review action.'}).getByRole('link').click()
    await expect(page).toHaveURL(`${base}?step=results&${scope}#check-${check}`)
    await expect(page.locator(`#check-${check}`)).toContainText('Crawler blocked')
    await expect(page.locator(`#check-${check}`)).toHaveAttribute('aria-expanded','true')
    await page.getByRole('link',{name:copy.dashboard.finding_task}).click()
    await expect(page).toHaveURL(`${base}/opportunities?${scope}`)
    await expect(page.locator('main header')).toContainText(lang === 'en' ? '1 Oct 2026' : '2026年10月1日')
    await page.getByRole('button',{name:copy.opportunities.saveDraft}).click()
    await page.getByRole('alert').getByRole('button',{name:copy.opportunities.refresh}).click()
    expect(requests).toEqual([`?${scope}`])
    await page.getByRole('button',{name:copy.opportunities.saveDraft}).click()
    await expect(page.getByRole('textbox',{name:copy.opportunities.titleField,exact:true})).toHaveValue(item.title)
    expect(saves).toEqual(Array(2).fill({source:{kind:'scan-check',id:older,checkKey:check},ruleVersion:'scan-check-gap.v1',fingerprint:data.response.suggestions[0].fingerprint,locale:lang}))
    await page.getByRole('button',{name:copy.opportunities.suggestions,exact:true}).click()
    await page.getByRole('button',{name:copy.opportunities.openDraft}).click()
    await page.getByRole('link',{name:copy.opportunities.compareFinding}).click()
    await page.getByRole('combobox',{name:copy.dashboard.choose_saved_scan}).selectOption(later)
    await page.getByRole('button',{name:copy.dashboard.open_selected_scan}).click()
    await expect(page).toHaveURL(`${base}?step=results&scanId=${later}&check=${check}#check-${check}`)
    await expect(page.locator(`#check-${check}`)).toContainText('Crawler allowed')
    await expect(page.getByRole('link',{name:copy.dashboard.finding_task})).toHaveCount(0)
  })
  test(`improve keeps one frame, one scan control and no accessibility violations in ${lang}`, async ({ page }) => {
    await fixture(page)
    await page.goto(`${base}?step=improve&scanId=older-scan`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(page.getByRole('combobox', { name: copy.dashboard.choose_saved_scan })).toHaveValue('older-scan')
    await page.locator('summary').filter({ hasText: copy.generatedWork.basisShow }).click()
    await expect(page.getByText('c1_robots', { exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([])
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
