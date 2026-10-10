import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'

/** Actual protected wizard component; no cookie, session or auth bypass. */
export async function openOnboardingComponent(page: Page, lang: string) {
  const dir=process.env.AISO_ONBOARDING_HTML_DIR
  if(!dir)throw new Error('Actual onboarding component fixtures required; no skipped acceptance')
  const js=readFileSync(`${dir}/fixture.js`,'utf8'),css=readFileSync(`${dir}/build.css`,'utf8')
  const theme=await page.evaluate(()=>matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')
  await page.route('**/*',route=>new URL(route.request().url()).pathname.startsWith('/api/')?route.fallback():route.abort())
  await page.route(`https://onboarding.fixture/${lang}/onboarding`,route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><html lang="${lang}" class="${theme}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Protected onboarding component acceptance</title><style>${css}</style></head><body><div id="root"></div><script>${js}</script></body></html>`}))
  await page.goto(`https://onboarding.fixture/${lang}/onboarding`)
  await page.waitForFunction(()=>Boolean((window as Window&{aisoFixtureReady?:boolean}).aisoFixtureReady))
}
