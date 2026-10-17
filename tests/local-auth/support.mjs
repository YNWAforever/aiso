import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect } from '@playwright/test'
import { allowLocalUrl } from '../../scripts/ci/local-auth-safety.mjs'

export const config = JSON.parse(readFileSync(process.env.AISO_LOCAL_AUTH_CONFIG, 'utf8'))
export const messages = {
  en: JSON.parse(readFileSync('messages/en.json', 'utf8')),
  'zh-HK': JSON.parse(readFileSync('messages/zh-HK.json', 'utf8')),
}
export const control = async (request, path, params) => {
  const url = new URL(path, config.authOrigin)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  allowLocalUrl(url, config.allowedOrigins)
  const response = await request.get(url.href, { headers: { Authorization: `Bearer ${config.controlSecret}` } })
  if (response.status() !== 200) throw new Error(`LOCAL_AUTH_CONTROL_${response.status()}`)
  return response.json()
}
export async function login(page, request, lang, email, next) {
  // Keep the installed limiter unchanged, including its required quiet window.
  // Timers are bounded chunks so the supervising process remains responsive.
  const slot = await control(request, '/__local/login-slot', {})
  if (!Number.isInteger(slot.delayMs) || slot.delayMs < 0 || slot.delayMs > 61000) throw new Error('LOCAL_AUTH_LOGIN_SLOT_OUT_OF_BOUNDS')
  const until = Date.now() + slot.delayMs
  while (Date.now() < until) await new Promise(done => setTimeout(done, Math.min(30000, until - Date.now())))
  await page.goto(`/${lang}/auth/login?next=${encodeURIComponent(next)}`)
  await page.locator('#login-email').fill(email)
  const sent = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/sign-in/magic-link')
  await page.locator('form').filter({ has: page.locator('#login-email') }).getByRole('button', { name: /.+/ }).click()
  expect((await sent).status()).toBe(200)
  let link
  await expect.poll(async () => {
    const mail = await control(request, '/__local/mailbox', { email })
    link = mail.link
    return Boolean(link)
  }).toBe(true)
  allowLocalUrl(link, [config.authOrigin])
  await page.goto(link)
  await page.waitForURL(url => !url.pathname.includes('/auth/') && !url.searchParams.has('token'))
}
export async function get(page, path, method = 'GET', body) {
  return page.evaluate(async ({ path, method, body }) => {
    const response = await fetch(path, { method, cache: 'no-store',
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) })
    return { status: response.status, body: await response.json() }
  }, { path, method, body })
}
export async function shot(page, filename, evidenceLabel = 'LOCAL REAL BETTER AUTH + POSTGRES | SYNTHETIC SCAN | NOT MANAGED NEON / PROVIDER UAT') {
  await page.evaluate(label => {
    let element = document.getElementById('local-evidence-label')
    if (!element) { element = document.createElement('div'); element.id = 'local-evidence-label'; document.body.append(element) }
    element.textContent = label
    element.style.cssText = 'position:fixed;left:0;bottom:0;right:0;z-index:2147483647;padding:6px;background:#082f49;color:#fff;font:11px monospace;pointer-events:none'
  }, evidenceLabel)
  await page.screenshot({ path: join(config.output, filename), fullPage: true })
}
