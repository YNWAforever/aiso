import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

async function openFixture(page: Page, lang: string) {
  const dir = process.env.AISO_ONBOARDING_HTML_DIR
  if (!dir) throw new Error('AISO_ONBOARDING_HTML_DIR is required; generate the real component fixture first')
  const js = readFileSync(`${dir}/fixture.js`, 'utf8'),css=readFileSync(`${dir}/build.css`,'utf8')
  await page.route('**/*', route => route.abort())
  await page.route(`https://onboarding.fixture/${lang}`, route => route.fulfill({ contentType: 'text/html',
    body: `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>Onboarding recovery</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>${js}</script></body></html>` }))
  await page.goto(`https://onboarding.fixture/${lang}`)
  await page.waitForFunction(() => Boolean((window as Window & { aisoFixtureReady?: boolean }).aisoFixtureReady))
}
async function finalStep(page: Page, lang: string) {
  const next = lang === 'en' ? 'Continue' : '繼續'
  await page.getByRole('button', { name: next, exact: true }).click()
  await page.getByRole('textbox', { name: lang === 'en' ? 'Your website domain' : '你的網站域名' }).fill('synthetic.test')
  await page.getByRole('button', { name: next, exact: true }).click()
  await page.locator('#onboarding-language').selectOption(lang === 'en' ? 'zh-HK' : 'en')
  await page.locator('#onboarding-region').selectOption('TW')
  await page.getByRole('button', { name: next, exact: true }).click()
  await page.locator('#onboarding-description').fill('Persistent synthetic draft')
}
for (const lang of ['en', 'zh-HK']) {
  test(`partial seed resumes the same intent and brand after reload in ${lang}`, async ({ page }) => {
    await openFixture(page, lang); await finalStep(page, lang)
    const clientId = '11111111-1111-4111-8111-111111111111'
    const bodies: Array<Record<string, unknown>> = []
    await page.route('**/api/onboarding/complete', route => {
      const body = route.request().postDataJSON(); bodies.push(body)
      return route.fulfill({ json: { clientId, intentKey: body.intentKey, trialEndsAt: '2026-10-10T00:00:00.000Z',
        progress: { clientId, prompts: bodies.length === 1 ? 'failed' : 'ready', promptCount: bodies.length === 1 ? 0 : 24, retryable: bodies.length === 1 } } })
    })
    await page.getByRole('button', { name: lang === 'en' ? 'Go to my dashboard' : '前往我的儀表板', exact: true }).click()
    await expect(page.getByRole('button', { name: lang === 'en' ? 'Open workspace' : '開啟工作區', exact: true })).toBeVisible()
    await page.screenshot({ path: `${process.env.AISO_ONBOARDING_HTML_DIR}/${lang}-partial.png`, fullPage: true })
    await page.reload()
    await expect(page.locator('#onboarding-description')).toHaveValue('Persistent synthetic draft')
    await page.getByRole('button', { name: lang === 'en' ? 'Retry question setup' : '重試問題設定', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-navigation', /dashboard\/11111111/)
    expect(bodies).toHaveLength(2)
    expect(bodies[1].intentKey).toBe(bodies[0].intentKey)
    expect(bodies[1].clientId).toBe(clientId)
    expect(bodies[1].description).toBe('Persistent synthetic draft')
    expect(bodies[0]).toMatchObject({ language: lang === 'en' ? 'zh-HK' : 'en', market: 'TW' })
    expect(bodies[1]).toMatchObject({ language: bodies[0].language, market: 'TW' })
  })
  test(`network_rejection_releases_loading and preserves draft in ${lang}`, async ({ page }) => {
    await openFixture(page, lang); await finalStep(page, lang)
    await page.route('**/api/onboarding/complete', route => route.abort('failed'))
    const submit = page.getByRole('button', { name: lang === 'en' ? 'Go to my dashboard' : '前往我的儀表板', exact: true })
    await submit.click()
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(submit).toBeEnabled()
    await expect(page.locator('#onboarding-description')).toHaveValue('Persistent synthetic draft')
    await page.reload(); await expect(page.locator('#onboarding-description')).toHaveValue('Persistent synthetic draft')
  })
  test(`invalid JSON releases loading in ${lang}`, async ({ page }) => {
    await openFixture(page, lang); await finalStep(page, lang)
    await page.route('**/api/onboarding/complete', route => route.fulfill({ contentType: 'application/json', body: '{' }))
    const submit = page.getByRole('button', { name: lang === 'en' ? 'Go to my dashboard' : '前往我的儀表板', exact: true })
    await submit.click(); await expect(page.getByRole('alert')).toBeVisible(); await expect(submit).toBeEnabled()
  })
}

for(const lang of ['en','zh-HK'])test('skipped context is recovered with a new intent for the same brand '+lang,async({page})=>{await openFixture(page,lang);const next=lang==='en'?'Continue':'繼續';await page.getByRole('button',{name:next,exact:true}).click();await page.getByRole('button',{name:lang==='en'?"Skip — I don't have a website yet":'略過——我暫時未有網站',exact:true}).click();await page.getByRole('button',{name:lang==='en'?'Skip — set up later':'略過——稍後設定',exact:true}).click();const bodies:Record<string,unknown>[]=[];await page.route('**/api/onboarding/complete',route=>{const body=route.request().postDataJSON();bodies.push(body);return route.fulfill({json:{clientId:'11111111-1111-4111-8111-111111111111',intentKey:bodies[0].intentKey,progress:{prompts:body.language&&body.market?'ready':'pending',retryable:true}}})});await page.getByRole('button',{name:lang==='en'?'Go to my dashboard':'前往我的儀表板',exact:true}).click();await page.getByRole('button',{name:lang==='en'?'Back':'返回',exact:true}).click();await page.locator('#onboarding-language').selectOption('zh-HK');await page.locator('#onboarding-region').selectOption('HK');await page.getByRole('button',{name:next,exact:true}).click();await page.getByRole('button',{name:lang==='en'?'Retry question setup':'重試問題設定',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-navigation',/dashboard/);expect(bodies).toHaveLength(2);expect(bodies[1].intentKey).not.toBe(bodies[0].intentKey);expect(bodies[1].clientId).toBe('11111111-1111-4111-8111-111111111111')});

for(const lang of ['en','zh-HK'])test('changed draft after lost create response reconciles the original intent before rebinding '+lang,async({page})=>{await openFixture(page,lang);await finalStep(page,lang);const bodies:Record<string,unknown>[]=[];await page.route('**/api/onboarding/complete',route=>{const body=route.request().postDataJSON();bodies.push(body);if(bodies.length===1)return route.abort('failed');return route.fulfill({json:{clientId:'11111111-1111-4111-8111-111111111111',progress:{prompts:'ready'}}})});const submit=page.getByRole('button',{name:lang==='en'?'Go to my dashboard':'前往我的儀表板',exact:true});await submit.click();await expect(page.getByRole('alert')).toBeVisible();await page.locator('#onboarding-description').fill('Changed after unknown outcome');await page.reload();await expect(page.locator('#onboarding-description')).toHaveValue('Changed after unknown outcome');await submit.click();await expect(page.locator('html')).toHaveAttribute('data-navigation',/dashboard/);expect(bodies).toHaveLength(3);expect(bodies[1]).toEqual(bodies[0]);expect(bodies[2].intentKey).not.toBe(bodies[0].intentKey);expect(bodies[2].clientId).toBe('11111111-1111-4111-8111-111111111111');expect(bodies[2].description).toBe('Changed after unknown outcome')});
