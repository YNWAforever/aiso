import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFileSync } from 'node:fs'

// Offline presentation acceptance, never an authenticated route bypass.
// Generate HTML/copy by running portfolio-render.test.tsx with C8B_HTML_DIR set.
for(const lang of ['en','zh-HK']) for(const width of [375,1440]) for(const theme of ['light','dark'] as const){
  test(`C8b portfolio ${lang} ${width} ${theme}`,async({page})=>{
    const htmlDir=process.env.C8B_HTML_DIR
    const cssPath=process.env.C8B_CSS_PATH
    test.skip(!htmlDir||!cssPath,'Set C8B_HTML_DIR and C8B_CSS_PATH using sanitized component artifacts')
    const copy=JSON.parse(readFileSync(`${htmlDir}/${lang}-copy.json`,'utf8')) as Record<string,string>
    const css=readFileSync(cssPath!,'utf8')
    await page.route('**/*',route=>route.abort())
    await page.setViewportSize({width,height:900})
    await page.emulateMedia({colorScheme:theme,reducedMotion:'reduce'})
    for(const state of ['ready','empty','error','unknown','atLimit']){
      const html=readFileSync(`${htmlDir}/${lang}-${state}.html`,'utf8')
      await page.setContent(`<!doctype html><html lang="${lang}" class="${theme}"><head><title>Portfolio component acceptance</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body>${html}</body></html>`)
      await expect(page.getByRole('heading',{level:1})).toHaveText(copy.title)
      if(state==='unknown'){
        await expect(page.getByRole('main')).toContainText(copy.capacityUnknown)
        await expect(page.getByRole('main')).not.toContainText(copy.capacityLimit)
      }
      if(state==='unknown'||state==='atLimit')await expect(page.getByRole('button')).toHaveCount(0)
      if(state==='empty')await expect(page.getByRole('button',{name:'Create fixture brand'})).toBeVisible()
      if(state==='atLimit'){
        await expect(page.getByRole('main')).toContainText(copy.capacityLimit)
        await expect(page.getByRole('main')).toContainText(copy.emptyBrands)
      }
      if(state==='error'){
        await expect(page.getByRole('main')).toContainText(copy.historyError)
        await expect(page.getByRole('main')).toContainText(copy.visibilityError)
        await expect(page.getByRole('main')).not.toContainText('0%')
      }
      if(state==='ready'){
        await expect(page.locator(`a[href="/${lang}/dashboard/client-a"]`)).toBeVisible()
        await expect(page.locator(`a[href="/${lang}/result/scan-a"]`)).toBeVisible()
        await expect(page.getByRole('main')).toContainText('25%')
        await expect(page.getByRole('main')).toContainText(copy.dateZone)
      }
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
      expect((await new AxeBuilder({page}).analyze()).violations).toEqual([])
    }
  })
}
