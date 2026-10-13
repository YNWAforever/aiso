import { test, expect } from '@playwright/test'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

test.beforeEach(async({context})=>{
 await context.route('**/*',route=>{
  const host=new URL(route.request().url()).hostname
  return host==='127.0.0.1'||host==='localhost'?route.continue():route.abort()
 })
})
for(const lang of ['en','zh-HK'] as const)for(const theme of ['light','dark'] as const)for(const width of [375,768,1440]){
 const copy=lang==='en'?en:zh
 test('404 recovery '+lang+' '+theme+' '+width,async({page})=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme})
  const response=await page.goto('/'+lang+'/synthetic-unknown-audit-path')
  expect(response?.status()).toBe(404)
  await expect(page.getByRole('heading',{name:copy.notFound.title,exact:true})).toBeVisible()
  await page.getByRole('main').getByRole('link',{name:copy.notFound.home,exact:true}).click()
  await expect(page).toHaveURL(new RegExp('/'+lang+'$'))
 })
 test('server error retry '+lang+' '+theme+' '+width,async({page,context},testInfo)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme})
  await context.addCookies([{name:'aiso-audit-fixture-failure',value:'fail',url:'http://127.0.0.1:3000'}])
  const response=await page.goto('/'+lang+'/audit-fixture-error')
  await expect(page.getByRole('heading',{name:copy.errorPage.title,exact:true})).toBeVisible()
  await expect(page.locator('main code')).toBeVisible()
  await expect(page.getByRole('main')).not.toContainText('synthetic-private-error-marker')
  await expect(page.getByRole('main')).not.toContainText('at AuditErrorFixture')
  await context.clearCookies({name:'aiso-audit-fixture-failure'})
  await page.getByRole('button',{name:copy.errorPage.retry,exact:true}).click()
  await expect(page.getByRole('heading',{name:lang==='en'?'Fixture page recovered':'已恢復測試頁面',exact:true})).toBeVisible()
  await page.getByRole('link',{name:copy.errorPage.home,exact:true}).click()
  await expect(page).toHaveURL(new RegExp('/'+lang+'$'))
  await testInfo.attach('synthetic-server-error-response',{body:JSON.stringify({httpStatus:response?.status(),environment:'localhost_actual_Next_boundary',cleanup:'synthetic cookie cleared'}),contentType:'application/json'})
 })
}
for(const lang of ['en','zh-HK'] as const)for(const theme of ['light','dark'] as const){
 test('pricing 375px 200 percent text '+lang+' '+theme,async({page},testInfo)=>{
  await page.setViewportSize({width:375,height:900});await page.emulateMedia({colorScheme:theme})
  await page.goto('/'+lang+'/pricing')
  const original=await page.locator('body').evaluate(el=>parseFloat(getComputedStyle(el).fontSize))
  await page.addStyleTag({content:'html {font-size:200% !important}'})
  expect(await page.locator('body').evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(original*2)
  const overflow=await page.evaluate(()=>({skip:(()=>{const el=document.querySelector('a[href="#main"]');if(!el)return null;const c=getComputedStyle(el),r=el.getBoundingClientRect();return {active:el===document.activeElement,clip:c.clip,width:c.width,padding:c.padding,overflow:c.overflow,whiteSpace:c.whiteSpace,left:r.left,right:r.right}})(),viewport:innerWidth,scroll:document.documentElement.scrollWidth,texts:(()=>{const out=[];const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);while(walker.nextNode()){const node=walker.currentNode;if(node.parentElement?.closest('[role=region]'))continue;const range=document.createRange();range.selectNodeContents(node);for(const rect of range.getClientRects())if(rect.right>innerWidth||rect.left<0)out.push({tag:node.parentElement?.tagName,text:node.textContent?.trim().slice(0,70),left:rect.left,right:rect.right,classes:node.parentElement?.className});}return out})(),elements:[...document.querySelectorAll('body *')].filter(el=>el.getBoundingClientRect().right>innerWidth).map(el=>({tag:el.tagName,text:el.textContent?.trim().slice(0,90),right:el.getBoundingClientRect().right,region:el.closest('[role=region]')?.getAttribute('aria-label'),classes:el.className}))}))
  await testInfo.attach('overflow-diagnostics',{body:JSON.stringify(overflow),contentType:'application/json'})
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.viewport)
  const region=page.getByRole('region',{name:lang==='en'?'Compare paid plan features':'比較付費方案功能',exact:true})
  await expect(region).toBeVisible()
  const widths=await region.evaluate(el=>({client:el.clientWidth,scroll:el.scrollWidth}))
  expect(widths.scroll).toBeGreaterThan(widths.client)
  const skip=page.getByRole('link',{name:lang==='en'?en.nav.skip_to_main:zh.nav.skip_to_main,exact:true})
  await skip.focus();await expect(skip).toBeVisible()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 })
}
