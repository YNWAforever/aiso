import { test, expect } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { createServer as createTcpServer } from 'node:net'
import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

// Real Next.js Server Components and the installed Neon SDK; only the upstream
// Auth service is a local controlled response. No DB, providers, or human state.
test.describe.configure({ mode: 'serial' })
let upstream: Server, app: ChildProcess, origin = '', status = 200, sessionReads = 0
let appOutput = ''
const client = '11111111-1111-4111-8111-111111111111'
const tools = ['entities', 'opportunities', 'observations', 'sources', 'prompts']
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function availablePort() {
  const server = createTcpServer()
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Local port unavailable')
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  return address.port
}

test.beforeAll(async () => {
  test.setTimeout(120_000)
  if (['.env', '.env.local', '.env.production', '.env.production.local'].some(file => existsSync(join(process.cwd(), file)))) throw new Error('Normal isolated Auth regression refuses auto-loaded environment files')
  if (!existsSync(join(process.cwd(), '.next', 'BUILD_ID'))) throw new Error('Production Next build required; no skip is acceptance')
  upstream = createServer((request, response) => {
    if (!new URL(request.url!, 'http://127.0.0.1').pathname.endsWith('/get-session')) {
      response.writeHead(404); response.end(); return
    }
    sessionReads++
    response.writeHead(status, { 'content-type': 'application/json', 'set-cookie': '__Secure-neon-auth.session_token=; Max-Age=0; Path=/; HttpOnly; Secure' })
    response.end(JSON.stringify(status === 401 ? { code: 'UNAUTHORIZED', message: 'Synthetic expired session' } : null))
  })
  await new Promise<void>((resolve, reject) => { upstream.once('error', reject); upstream.listen(0, '127.0.0.1', resolve) })
  const address = upstream.address()
  if (!address || typeof address === 'string') throw new Error('Controlled Auth origin unavailable')
  const port = await availablePort()
  origin = `http://127.0.0.1:${port}`
  const osEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|SYSTEMROOT|WINDIR|APPDATA|LOCALAPPDATA|TEMP|TMP|USERPROFILE|COMSPEC|PATHEXT|NUMBER_OF_PROCESSORS|OS)$/i.test(key)))
  app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: process.cwd(), shell: false, windowsHide: true,
    env: { ...osEnv, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', E2E_FIXTURE_MODE: '0', NEON_AUTH_BASE_URL: `http://127.0.0.1:${address.port}/auth`, NEON_AUTH_COOKIE_SECRET: 'synthetic-readonly-session-cookie-secret-not-real', NEXT_PUBLIC_APP_URL: origin },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  app.stdout?.on('data', value => { appOutput = (appOutput + value.toString()).slice(-6000) })
  app.stderr?.on('data', value => { appOutput = (appOutput + value.toString()).slice(-6000) })
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    if (app.exitCode !== null) throw new Error('Normal Next test server exited: ' + appOutput)
    try { const response = await fetch(origin + '/en/auth/login', { signal: AbortSignal.timeout(1500) }); if (response.ok) return } catch { /* Initial listen/readiness only. */ }
    await sleep(200)
  }
  throw new Error('Normal Next test server never became ready: ' + appOutput)
})
test.afterAll(async () => {
  if (app && app.exitCode === null && app.pid) {
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 10_000 })
    else app.kill('SIGTERM')
    const deadline = Date.now() + 15_000
    while (app.exitCode === null && app.signalCode === null && Date.now() < deadline) await sleep(100)
    if (app.exitCode === null && app.signalCode === null) throw new Error('Owned normal Next test server did not stop')
  }
  if (upstream?.listening) await new Promise<void>((resolve, reject) => upstream.close(error => error ? reject(error) : resolve()))
})

for (const locale of ['en', 'zh-HK']) for (const expiredStatus of [200, 401]) {
  test(`RSC expired session ${expiredStatus} keeps all five ${locale} tool destinations`, async ({ page }) => {
    status = expiredStatus
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.setExtraHTTPHeaders({ cookie: '__Secure-neon-auth.session_token=synthetic-expired-not-real' })
    const before = sessionReads
    for (const tool of tools) {
      const path = `/${locale}/dashboard/${client}/${tool}`
      const response = await page.goto(origin + path, { waitUntil: 'networkidle' })
      expect(response?.status()).toBe(200)
      await expect(page.getByRole('button', { name: /Google/ })).toBeVisible()
      const actual = new URL(page.url())
      expect(actual.pathname).toBe(`/${locale}/auth/login`)
      expect(actual.searchParams.get('next')).toBe(path)
      expect(await page.locator('[data-nextjs-dialog]').count()).toBe(0)
    }
    expect(sessionReads).toBeGreaterThan(before)
    expect(errors).toEqual([])
  })
}
