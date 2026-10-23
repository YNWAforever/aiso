import AxeBuilder from '@axe-core/playwright'
import { test, expect } from '@playwright/test'
import en from '../../messages/en.json'
import zh from '../../messages/zh-HK.json'
for(const lang of ['en','zh-HK'] as const) for(const width of [375,1440]) for(const colorScheme of ['light','dark'] as const){
  test(`C8e public sample ${lang} ${width} ${colorScheme}`,async({page,request})=>{
    const copy=(lang==='en'?en:zh).sampleReport
    const requests:string[]=[]
    page.on('request',req=>{if(req.url().includes('/api/'))requests.push(req.url())})
    await page.route('**/api/**',route=>route.abort())
    await page.setViewportSize({width,height:900})
    await page.emulateMedia({colorScheme,reducedMotion:'reduce'})
    expect((await page.goto(`/${lang}/sample-report`))?.status()).toBe(200)
    await expect(page.getByRole('heading',{level:1})).toHaveText(copy.title)
    await expect(page.getByRole('main')).toContainText(copy.eyebrow)
    await expect(page.getByRole('main')).toContainText(copy.draftOnly)
    await expect(page.getByRole('main')).toContainText('example.invalid')
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href',new RegExp(`/${lang}/sample-report$`))
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
    expect((await new AxeBuilder({page}).analyze()).violations).toEqual([])
    expect(requests).toEqual([])
    const redirect=await request.get(`/${lang}/r/demo?ref=sample`,{maxRedirects:0})
    expect(redirect.status()).toBe(307)
    expect(redirect.headers().location).toContain(`/${lang}/sample-report?ref=sample`)
  })
}

// "Download PDF" is the browser's print: the report must fit one A4 page, fully drawn and light.
for(const lang of ['en','zh-HK'] as const){
  test(`C8e sample report prints to one A4 page in ${lang}`,async({page,browserName})=>{
    test.skip(browserName!=='chromium','page.pdf is Chromium-only')
    await page.route('**/api/**',route=>route.abort())
    await page.emulateMedia({colorScheme:'dark'})
    await page.goto(`/${lang}/sample-report`,{waitUntil:'networkidle'})
    await expect(page.getByTestId('one-page-report')).toBeVisible()
    // page.pdf does not fire beforeprint; window.print() does, and that is what drops the dark theme.
    await page.evaluate(()=>window.dispatchEvent(new Event('beforeprint')))
    expect(await page.evaluate(()=>document.documentElement.classList.contains('dark'))).toBe(false)
    const pdf=(await page.pdf({format:'A4',printBackground:true,preferCSSPageSize:true})).toString('latin1')
    expect(pdf.match(/\/Type\s*\/Page(?!s)/g)?.length).toBe(1)
  })
}
