import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
const client = '11111111-1111-4111-8111-111111111111'
const tools = ['entities', 'sources', 'observations', 'opportunities', 'prompts']
for (const lang of ['en', 'zh-HK']) test(`real proxy/layout preserve all five deep links in ${lang}`, async ({ page }) => {
  const origin = process.env.AUTH_RETURN_APP_URL
  if (!origin) throw new Error('Real fixture app URL required; no skip is acceptance')
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  for (const tool of tools) {
    const path = `/${lang}/dashboard/${client}/${tool}`
    await page.goto(`${origin}${path}`, { waitUntil: 'networkidle' })
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(lang === 'en' ? 'Sign in to your dashboard' : '登入你的儀表板')
    const actual = new URL(page.url())
    expect(actual.pathname).toBe(`/${lang}/auth/login`)
    expect(actual.searchParams.get('next')).toBe(path)
    expect(await page.locator('[data-nextjs-dialog]').count()).toBe(0)
  }
  expect(errors).toEqual([])
  await page.screenshot({ path: `artifacts/aiso/T14/${lang}-real-login.png`, fullPage: true })
})
async function callbackFixture(page: Page, lang: string, next: string) {
  const dir = process.env.AUTH_RETURN_HTML_DIR
  if (!dir) throw new Error('Auth return component fixtures required')
  const js = readFileSync(`${dir}/fixture.js`, 'utf8')
  await page.route('**/*', route => route.abort())
  await page.route('https://auth.fixture/**', route => {
    const url = new URL(route.request().url()), mode = url.pathname.endsWith('/auth/complete') ? 'complete' : 'login'
    if (url.pathname.includes('/dashboard')) return route.fulfill({ contentType: 'text/html', body: '<html><body><main><h1>Returned to tool</h1></main></body></html>' })
    const html = readFileSync(`${dir}/${lang}-${mode}.html`, 'utf8')
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html lang="${lang}"><head><title>Auth return fixture</title></head><body>${html}<script>${js}</script></body></html>` })
  })
  await page.goto(`https://auth.fixture/${lang}/auth/login?next=${encodeURIComponent(next)}`)
  await page.waitForFunction(() => Boolean((window as Window & { authReturnReady?: boolean }).authReturnReady))
}
for (const [index, tool] of tools.entries()) for (const flow of ['google', 'magic-link']) test(`callback contract ${flow} returns to ${tool}`, async ({ page }) => {
  const lang = index % 2 ? 'zh-HK' : 'en', next = `/${lang}/dashboard/${client}/${tool}`
  await callbackFixture(page, lang, `${next}?neon_auth_session_verifier=private&access_token=private`)
  if (flow === 'google') await page.getByRole('button', { name: lang === 'en' ? 'Continue with Google' : '使用 Google 繼續' }).click()
  else {
    await page.getByLabel(lang === 'en' ? 'Work email' : '工作電郵').fill('fixture@example.test')
    await page.getByRole('button', { name: lang === 'en' ? 'Send Magic Link' : '發送登入連結' }).click()
  }
  const recorded = await page.evaluate(() => (window as Window & { lastAuth?: { callbackURL: string; flow: string } }).lastAuth!)
  expect(recorded.flow).toBe(flow)
  const callback = new URL(recorded.callbackURL)
  expect(callback.searchParams.get('next')).toBe(next)
  callback.searchParams.set('neon_auth_session_verifier', 'synthetic-verifier')
  await page.goto(callback.toString())
  await expect(page.getByRole('heading', { name: 'Returned to tool' })).toBeVisible()
  expect(new URL(page.url()).pathname).toBe(next)
  expect(new URL(page.url()).search).toBe('')
})
test('failed completion retains safe destination on retry', async ({ page }) => {
  const next = `/zh-HK/dashboard/${client}/sources`
  await callbackFixture(page, 'zh-HK', next)
  await page.goto(`https://auth.fixture/zh-HK/auth/complete?next=${encodeURIComponent(next)}&fixture-failed=1`)
  await expect(page.getByRole('link', { name: '返回登入頁' })).toHaveAttribute('href', `/zh-HK/auth/login?next=${encodeURIComponent(next)}`)
})
