import { test, expect } from '@playwright/test'
import { HomePage } from './pages/HomePage'

test.beforeEach(async({context})=>{
 await context.route('**/*',route=>{
  const url=new URL(route.request().url())
  if(url.hostname==='127.0.0.1'||url.hostname==='localhost')return route.continue()
  return route.abort()
 })
})
for(const lang of ['en','zh-HK'] as const){
 test('homepage decimal grade labels '+lang,async({page})=>{
  const home=new HomePage(page,lang);await home.goto()
  await expect(home.heading).toBeVisible()
  await expect(page.getByLabel(lang==='en'?'Grade D: score at least 50 and below 60':'評級 D：50 ≤ 分數小於 60')).toBeVisible()
 })
 for(const motion of ['no-preference','reduce'] as const){
 for(const [index,value] of [49.97,59.97,69.97,79.97,89.97,63.5,0,50,60,70,80,90,100].entries()){
 const id='e2e00000-0000-4000-a000-'+String(index+2).padStart(12,'0')
 const grade=['F','D','C','B','A','C','F','D','C','B','A','A+','A+'][index]
  test('fractional persisted fixture '+lang+' '+motion+' '+value,async({page})=>{
   await page.emulateMedia({reducedMotion:motion})
   const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
   await page.addInitScript(()=>{
    const samples:number[]=[];(window as unknown as {scoreSamples:number[]}).scoreSamples=samples
    new MutationObserver(()=>{
     const el=document.querySelector('[data-testid="score-reveal"] [aria-hidden="true"] span')
     if(el)samples.push(Number(el.textContent))
    }).observe(document,{childList:true,subtree:true,characterData:true})
   })
   await page.goto('/'+lang+'/result/'+id)
   const score=page.getByTestId('score-reveal')
   await expect(score.getByText(value+'/100',{exact:true}).and(score.locator('span'))).toBeVisible()
   await expect(score.getByText(grade+' —', {exact:false})).toBeVisible()
   await expect(score.locator('[aria-hidden="true"] span').first()).toHaveText(String(value))
   const samples=await page.evaluate(()=>(window as unknown as {scoreSamples:number[]}).scoreSamples)
   expect(samples.length).toBeGreaterThan(0);expect(Math.max(...samples)).toBeLessThanOrEqual(value)
   expect(errors).toEqual([])
   await page.evaluate(()=>{
    Object.defineProperty(navigator,'share',{configurable:true,value:async(data:ShareData)=>{(window as unknown as {shareData:ShareData}).shareData=data}})
   })
   await page.getByRole('button',{name:lang==='en'?'Share':'分享',exact:true}).click()
   const share=await page.evaluate(()=>(window as unknown as {shareData:ShareData}).shareData)
   expect(share.text).toContain(value+'/100')
   expect(share.text).toContain(lang==='en'?'('+grade+')':'（'+grade+'）')
  })
 }
}
}
