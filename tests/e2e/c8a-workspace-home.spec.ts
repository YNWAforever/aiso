import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFileSync } from 'node:fs'
import en from '../../messages/en.json'
import zh from '../../messages/zh-HK.json'
import { MONITOR_VISIBLE } from '../../lib/dashboard-nav'

// Component acceptance only: no authenticated route or provider request is bypassed.
// Generate HTML by running workspace-home-render.test.tsx with C8A_HTML_DIR set.
// Supply the CSS emitted by the sanitized local build, never production credentials.
for (const lang of ['en', 'zh-HK'] as const) for (const width of [375,768,1440]) for (const theme of ['light','dark'] as const) {
  test(`C8a workspace component ${lang} ${width} ${theme}`, async ({ page }) => {
    const cssPath = process.env.C8A_CSS_PATH
    const htmlDir = process.env.C8A_HTML_DIR
    test.skip(!cssPath || !htmlDir, 'Set C8A_CSS_PATH and C8A_HTML_DIR after generating sanitized component fixtures')
    const css = readFileSync(cssPath!, 'utf8')
    const copy = JSON.parse(readFileSync(`${htmlDir}/${lang}-copy.json`, 'utf8')) as { freshnessUnknown: string; draft: string; states: Record<string, string> }
    await page.route('**/*', route => route.abort())
    await page.setViewportSize({ width, height: 900 })
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
    for (const state of ['empty','error','locked','ready'] as const) {
      const html = readFileSync(`${htmlDir}/${lang}-${state}.html`, 'utf8')
      await page.setContent(`<!doctype html><html lang="${lang}" class="${theme}"><head><title>Workspace component acceptance</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body>${html}</body></html>`)
      await expect(page.getByRole('heading',{level:1})).toHaveText('Example Brand')
      await expect(page.getByRole('main')).toContainText(copy.freshnessUnknown)
      if (state !== 'ready') {
        await expect(page.getByRole('main')).toContainText(copy.states[state])
        await expect(page.getByRole('main')).not.toContainText('0%')
      } else {
        await expect(page.getByRole('main')).toContainText(copy.draft)
        await expect(page.getByRole('main')).toContainText('25%')
        await expect(page.getByRole('main')).toContainText('2026-09-05')
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      for (const step of ['scan','results','improve','roi']) await expect(page.locator(`a[href="/${lang}/dashboard/fixture-client?step=${step}"]`).first()).toBeVisible()
      const violations = (await new AxeBuilder({page}).analyze()).violations
      expect(violations).toEqual([])
    }
    const dailyCopy=(lang==='en'?en:zh).workspaceHome.daily
    for(const state of ['partial','free','unknown','classification'] as const){
      const html=readFileSync(`${htmlDir}/${lang}-daily-${state}.html`,'utf8')
      await page.setContent(`<!doctype html><html lang="${lang}" class="${theme}"><head><title>Daily work acceptance</title><style>${css}</style></head><body>${html}</body></html>`)
      const section=page.getByRole('group',{name:dailyCopy.title})
      const summary=section.locator('summary')
      await summary.focus()
      await page.keyboard.press('Enter')
      await expect(section).toHaveAttribute('open','')
      await expect(section).toContainText(dailyCopy.states[state==='free'?'not_configured':state==='classification'?'partial':state])
      if(state==='partial')await expect(section).toContainText('13/15')
      await expect(section.locator('a[href*="/sources?source="][href*="&version="]')).toHaveCount(1)
      await expect(section.locator('a[href*="/opportunities?draft="]')).toHaveCount(1)
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
      expect((await new AxeBuilder({page}).analyze()).violations).toEqual([])
      if(state==='partial'&&width===375&&theme==='light')await page.screenshot({path:`${htmlDir}/${lang}-daily-mobile.png`,fullPage:true})
    }
  })
}

for(const lang of ['en','zh-HK'] as const)for(const width of [375,768,1440])for(const theme of ['light','dark'])test('T33 one useful header action '+lang+' '+width+' '+theme,async({page})=>{
 const dir=process.env.C8A_HTML_DIR,css=process.env.C8A_CSS_PATH;if(!dir||!css)throw Error('Generate actual workspace fixtures')
 await page.route('**/*',r=>r.abort());await page.setViewportSize({width,height:900})
 const copy=(lang==='en'?en:zh).workspaceHome
 // Monitor is hidden until Pulse is scheduled (MONITOR_VISIBLE): steps that would open it become a new scan.
 const monitor=(label:'status'|'start')=>MONITOR_VISIBLE?[label,'?step=monitor#first-monitoring'] as const:['scan','?step=scan'] as const
 const cases={unknown:monitor('status'),paused:monitor('status'),active:monitor('start'),missing:['configure','/prompts'],pending:['review','/observations?run=saved#run-status'],partial:['repair','/observations?run=saved#run-status'],source:['work','/sources?source=s&version=v'],draft:['work','/opportunities?draft=d'],complete:['results','/observations']} as const
 for(const [state,[label,path]] of Object.entries(cases)){
  const html=readFileSync(dir+'/'+lang+'-next-'+state+'.html','utf8')
  await page.setContent('<!doctype html><html lang="'+lang+'" class="'+theme+'"><head><meta charset="utf-8"><title>Next useful action</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+readFileSync(css,'utf8')+'</style></head><body>'+html+'</body></html>')
  const header=page.locator('header');await expect(header.getByRole('link')).toHaveCount(1)
  await expect(header.getByRole('link',{name:copy.nextStep[label],exact:true})).toHaveAttribute('href','/'+lang+'/dashboard/fixture-client'+path)
  if(state==='unknown'&&MONITOR_VISIBLE)await expect(header).toContainText(copy.daily.unknown)
  if(state==='paused'&&MONITOR_VISIBLE)await expect(header).toContainText((lang==='en'?en:zh).runProgress.availabilityReasons.paused)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([])
 }
})
