import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
test.beforeEach(async ({ page, baseURL, browser }) => {
  if(!process.env.AISO_RUNTIME_IDENTITY_FILE)throw new Error('Verified runtime identity file is required')
  const identity=JSON.parse(readFileSync(process.env.AISO_RUNTIME_IDENTITY_FILE,'utf8'))
  if (!baseURL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(baseURL)
    || identity.origin!==baseURL || identity.runId!==process.env.AISO_RUNTIME_RUN_ID
    || identity.dbConfigured!==false || identity.providerConfigured!==false || identity.authIsTestOnly!==true
    || identity.outboundGuard!==true || identity.monitoringEnabled!==false || identity.stopped===true
    || identity.buildId!==readFileSync('.next/BUILD_ID','utf8').trim()) throw new Error('Verified owned runtime is required')
  test.info().annotations.push({type:'runtime-layer',description:'Real Next HTTP; no DB; unauthenticated fixture Auth; outbound denied'})
  test.info().annotations.push({type:'browser',description:`${browser.browserType().name()} ${browser.version()} ${JSON.stringify(page.viewportSize())}`})
  await page.route('**/*', route => new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort())
})
for (const lang of ['en', 'zh-HK']) {
  test(`real isolated runtime serves public content and denies private workspace without a session ${lang}`, async ({page,request,baseURL}) => {
    const publicPage = await page.goto(`/${lang}/sample-report`)
    expect(publicPage?.status()).toBe(200)
    await expect(page.locator('main')).toBeVisible()
    await page.screenshot({path:test.info().outputPath(`${lang}-sample-runtime.png`),fullPage:true})
    await page.goto(`/${lang}/dashboard/11111111-1111-4111-8111-111111111111?step=results&scanId=22222222-2222-4222-8222-222222222222`)
    await expect(page).toHaveURL(new RegExp(`/${lang}/auth/login`))
    for (const path of [
      '/api/clients/11111111-1111-4111-8111-111111111111/work-items',
      '/api/clients/11111111-1111-4111-8111-111111111111/work-items/44444444-4444-4444-8444-444444444444',
      '/api/clients/99999999-9999-4999-8999-999999999999/work-items',
    ]) {
      const response=await request.get(baseURL+path)
      expect(response.status()).toBe(401)
      expect(await response.json()).toEqual({error:'UNAUTHENTICATED'})
    }
  })
}
