import { expect } from '@playwright/test'
import { allowLocalUrl } from '../../scripts/ci/local-auth-safety.mjs'
import { config } from './support.mjs'

// Hold delivery of an actual browser fetch response without forwarding the
// request through a second HTTP client or changing its body/authentication.
export async function delayOwnedResponse(page, pathname, method = 'GET') {
  const marker = crypto.randomUUID()
  allowLocalUrl(new URL(pathname, config.appOrigin).href, config.allowedOrigins)
  await page.evaluate(({ marker, pathname, method }) => {
    const original = window.fetch
    const audit = window.__localResponseRace = { marker, parsed: false, settled: false, original }
    const gate = new Promise(done => { audit.release = done })
    window.fetch = async (...args) => {
      const input = args[0], options = args[1]
      const url = new URL(input instanceof Request ? input.url : String(input), location.href)
      const matched = url.pathname === pathname && (options?.method ?? (input instanceof Request ? input.method : 'GET')) === method
      const settled = () => setTimeout(() => { audit.settled = true }, 0)
      try {
        const response = await original(...args)
        if (matched) {
          audit.captured = { status: response.status, body: await response.clone().json(), capturedAt: Date.now() }
          await gate
          const json = response.json.bind(response)
          response.json = async () => {
            try { const body = await json(); audit.parsed = true; return body }
            finally { settled() }
          }
        }
        return response
      } catch (error) {
        if (matched) settled()
        throw error
      }
    }
  }, { marker, pathname, method })
  return {
    async captured() {
      await page.waitForFunction(() => Boolean(window.__localResponseRace?.captured))
      const captured = await page.evaluate(() => window.__localResponseRace.captured)
      expect(captured.status).toBe(200)
      return captured.body
    },
    async release() {
      expect(await page.evaluate(marker => window.__localResponseRace?.marker === marker, marker)).toBe(true)
      await page.evaluate(() => window.__localResponseRace.release())
      await page.waitForFunction(marker => window.__localResponseRace?.marker === marker &&
        window.__localResponseRace.settled, marker)
      // The observer's timer runs after the awaiting app continuation. Finish
      // the render frame before checking content and history side effects.
      await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))))
      const observation = await page.evaluate(() => {
        const audit = window.__localResponseRace
        return { marker: audit.marker, status: audit.captured.status, parsed: audit.parsed,
          heldMs: Date.now() - audit.captured.capturedAt }
      })
      expect(observation.parsed).toBe(true)
      return observation
    },
    async close() {
      await page.evaluate(marker => {
        const audit = window.__localResponseRace
        if (audit?.marker === marker) {
          audit.release()
          window.fetch = audit.original
          delete window.__localResponseRace
        }
      }, marker)
    },
  }
}
