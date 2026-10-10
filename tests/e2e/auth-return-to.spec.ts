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


const sdkCases = [
  { name: 'valid session', status: 200, payload: 'valid', historyError: null, completes: true },
  { name: 'valid session despite SecurityError housekeeping', status: 200, payload: 'valid', historyError: 'SecurityError', completes: true },
  { name: 'valid session despite DataCloneError housekeeping', status: 200, payload: 'valid', historyError: 'DataCloneError', completes: true },
  { name: 'missing user fails closed', status: 200, payload: 'missing-user', historyError: null, completes: false },
  { name: 'empty verifier cannot reuse prior session', status: 200, payload: 'valid', historyError: null, completes: false, verifier: '', expectedCalls: 0 },
  { name: 'null session fails closed', status: 200, payload: 'null', historyError: null, completes: false },
  { name: 'unauthorized fails closed', status: 401, payload: 'error', historyError: null, completes: false },
  { name: 'invalid JSON fails closed', status: 200, payload: 'invalid', historyError: null, completes: false },
] as const
for (const lang of ['en', 'zh-HK']) for (const scenario of sdkCases) test(`SDK completion ${lang}: ${scenario.name}`, async ({ page }) => {
  const dir = process.env.AUTH_RETURN_HTML_DIR
  if (!dir) throw new Error('Installed-SDK Auth component fixtures required; no skip is acceptance')
  const bundle = readFileSync(`${dir}/sdk-fixture.js`, 'utf8')
  const destination = `/${lang}/dashboard/${client}/sources`
  const valid = {
    session: { id: 'fixture-session', userId: 'fixture-user', token: 'synthetic-not-a-real-token', expiresAt: '2027-01-01T00:00:00Z', createdAt: '2026-10-05T00:00:00Z', updatedAt: '2026-10-05T00:00:00Z' },
    user: { id: 'fixture-user', name: 'Synthetic SDK fixture', email: 'fixture@example.test', emailVerified: true, createdAt: '2026-10-05T00:00:00Z', updatedAt: '2026-10-05T00:00:00Z' },
  }
  const verifier = 'verifier' in scenario ? scenario.verifier : 'synthetic-verifier'
  if (!verifier) await page.context().addCookies([{ name: 'neon-auth.session_token', value: 'synthetic-prior-session', url: 'https://auth.fixture' }])
  let sessionCalls = 0
  if (scenario.historyError) await page.addInitScript(name => {
    history.replaceState = () => { throw new DOMException('Synthetic browser history failure', name) }
  }, scenario.historyError)
  await page.route('**/*', route => route.abort())
  await page.route('https://auth.fixture/**', route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/auth/get-session') {
      sessionCalls++
      expect(url.searchParams.get('neon_auth_session_verifier')).toBe(verifier || null)
      const body = scenario.payload === 'valid' ? JSON.stringify(valid) : scenario.payload === 'missing-user' ? JSON.stringify({ ...valid, user: null }) : scenario.payload === 'null' ? 'null' : scenario.payload === 'invalid' ? 'not JSON' : '{"message":"Unauthorized","code":"UNAUTHORIZED"}'
      return route.fulfill({ status: scenario.status, contentType: 'application/json', body })
    }
    if (url.pathname === destination) return route.fulfill({ contentType: 'text/html', body: '<html><body><h1>Authorized fixture destination</h1></body></html>' })
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html lang="${lang}"><body><div id="root"></div><script>${bundle}</script></body></html>` })
  })
  await page.goto(`https://auth.fixture/${lang}/auth/complete?next=${encodeURIComponent(destination)}&neon_auth_session_verifier=${encodeURIComponent(verifier)}`)
  if (scenario.completes) {
    await expect(page.getByRole('heading', { name: 'Authorized fixture destination' })).toBeVisible()
    expect(new URL(page.url()).pathname).toBe(destination)
    expect(new URL(page.url()).search).toBe('')
  } else {
    await expect(page.getByRole('link', { name: lang === 'en' ? 'Back to login' : '返回登入頁' })).toHaveAttribute('href', `/${lang}/auth/login?next=${encodeURIComponent(destination)}`)
    expect(new URL(page.url()).pathname).toBe(`/${lang}/auth/complete`)
  }
  expect(sessionCalls).toBe('expectedCalls' in scenario ? scenario.expectedCalls : 1)
})
