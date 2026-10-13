import en from '../../messages/en.json'
import zh from '../../messages/zh-HK.json'
import {DIRECTORY_VIEWS} from '../../lib/admin/directory-schema'
import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFileSync } from 'node:fs'
async function fixture(page: Page, lang: string) {
  const dir = process.env.AISO_ADMIN_HTML_DIR
  if (!dir) throw new Error('AISO_ADMIN_HTML_DIR is required')
  const js = readFileSync(`${dir}/fixture.js`, 'utf8'), css = readFileSync(`${dir}/build.css`, 'utf8')
  await page.route('**/*', route => route.abort())
  await page.route(`https://admin.fixture/${lang}`, route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>Admin component fixture</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><main><div id="root"></div></main><script>${js}</script></body></html>` }))
}
for (const lang of ['en', 'zh-HK']) {
  test(`admin sees a bounded page and account drilldowns (${lang})`, async ({ page }, testInfo) => {
    await fixture(page, lang)
    await page.route('**/api/admin/directory?*', route => route.fulfill({ json: { view: 'users', page: 1, hasMore: true, rows: [{ id: 'synthetic-user', account_id: '11111111-1111-4111-8111-111111111111', name: 'Synthetic Owner', email: 'owner@example.test', role: 'member', status: 'active', created_at: '2026-10-11T00:00:00Z' }] } }))
    await page.goto(`https://admin.fixture/${lang}`)
    await expect(page.getByText('owner@example.test')).toBeVisible()
    await expect(page.getByRole('heading', { name: lang === 'en' ? 'Data structure check' : '資料結構檢查' })).toBeVisible()
    await page.getByText(lang === 'en' ? 'Affected features and technical details' : '受影響功能及技術詳情', { exact: true }).click()
    await expect(page.getByText('pulse_runs.purpose', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: lang === 'en' ? 'Next' : '下一頁', exact: true })).toHaveAttribute('href', /page=2/)
    await expect(page.getByRole('link', { name: /11111111/ })).toHaveAttribute('href', /accountId=11111111/)
    expect((await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa']).analyze()).violations).toEqual([])
    expect(await page.evaluate(() => document.body.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('admin-schema-health.png'), fullPage: true })
  })
  test(`admin data outage retries without showing an empty success (${lang})`, async ({ page }) => {
    await fixture(page, lang)
    let requests = 0
    await page.route('**/api/admin/directory?*', route => { requests++; return route.fulfill(requests === 1 ? { status: 503, json: { error: 'DIRECTORY_UNAVAILABLE' } } : { json: { view: 'users', page: 1, hasMore: false, rows: [] } }) })
    await page.goto(`https://admin.fixture/${lang}`)
    await expect(page.getByRole('alert')).toBeVisible()
    await page.getByRole('button', { name: lang === 'en' ? 'Retry' : '重試', exact: true }).click()
    await expect(page.getByText(lang === 'en' ? 'No records match this selection.' : '沒有符合此篩選的記錄。')).toBeVisible()
    expect(requests).toBe(2)
  })
}

const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222'
async function switchQuery(page:Page,query:{view:string;page:number;q:string;accountId:string|null}){
 await page.evaluate(query=>(window as unknown as{aisoAdminQuery:(query:unknown)=>void}).aisoAdminQuery(query),query)
}
for(const lang of ['en','zh-HK'])test('T27 changing account hides previous rows while new result is loading '+lang,async({page})=>{
 await fixture(page,lang);let release:()=>void=()=>{};const delayed=new Promise<void>(resolve=>{release=resolve})
 await page.route('**/api/admin/directory?*',async route=>{
  const id=new URL(route.request().url()).searchParams.get('accountId')
  if(id===b)await delayed
  await route.fulfill({json:{view:'users',page:1,hasMore:false,rows:[{id:id??a,account_id:id??a,name:id===b?'B private user':'A private user'}]}})
 })
 await page.goto('https://admin.fixture/'+lang);await expect(page.getByText('A private user')).toBeVisible()
 await switchQuery(page,{view:'users',page:1,q:'',accountId:b})
 await expect(page.getByText('A private user')).toHaveCount(0)
 await expect(page.getByRole('status').filter({hasText:(lang==='en'?en:zh).adminDirectory.loading})).toBeVisible()
 release();await expect(page.getByText('B private user')).toBeVisible()
})

for(const lang of ['en','zh-HK'])for(const view of DIRECTORY_VIEWS)test('T27 '+view+' 26 records search scope and pagination '+lang,async({page})=>{
 await fixture(page,lang)
 const rows=Array.from({length:26},(_,i)=>{
  const account=i===0?a:i===1?b:'00000000-0000-4000-8000-'+String(i).padStart(12,'0')
  return{id:view==='accounts'?account:view+'-'+i,account_id:view==='accounts'?account:i%2?b:a,name:'Needle'+i,brand:'Needle'+i,domain:'Needle'+i+'.test',email:'synthetic-'+i+'@example.test',role:'member',status:'active',category:'brand_query',language:'en',market:'HK',active:true,mentioned:null,score:null,week:'2026-10-05',excerpt:'Saved fixture answer',kind:'facts',version:1,created_at:'2026-10-13',updated_at:'2026-10-13',token:'never-render-secret'}
 })
 await page.route('**/api/admin/directory?*',route=>{
  const query=new URL(route.request().url()).searchParams,scope=query.get('accountId'),q=query.get('q')??'',pageNumber=Number(query.get('page'))
  const selection=rows.filter(r=>(!scope||r.account_id===scope)&&r.name.toLowerCase().includes(q.toLowerCase()))
  return route.fulfill({json:{view:query.get('view'),page:pageNumber,rows:selection.slice((pageNumber-1)*25,pageNumber*25),hasMore:pageNumber*25<selection.length}})
 })
 await page.goto('https://admin.fixture/'+lang);await switchQuery(page,{view,page:1,q:'',accountId:null})
 const body=page.locator('tbody');await expect(body.locator('tr')).toHaveCount(25)
 const first=await body.locator('tr td:first-child').allTextContents()
 await expect(page.getByRole('link',{name:(lang==='en'?en:zh).adminDirectory.next,exact:true})).toHaveAttribute('href',/page=2/)
 await switchQuery(page,{view,page:2,q:'',accountId:null});await expect(body.locator('tr')).toHaveCount(1)
 const second=await body.locator('tr td:first-child').allTextContents();expect(new Set([...first,...second]).size).toBe(26)
 await expect(page.getByRole('navigation',{name:(lang==='en'?en:zh).adminDirectory.datasets}).locator('a').first()).toHaveAttribute('href',/page=1/)
 await switchQuery(page,{view,page:1,q:'',accountId:a});await expect(body.locator('tr')).toHaveCount(view==='accounts'?1:13)
 await switchQuery(page,{view,page:1,q:'',accountId:b});await expect(body.locator('tr')).toHaveCount(view==='accounts'?1:13)
 await switchQuery(page,{view,page:1,q:'Needle25',accountId:null});await expect(body.locator('tr')).toHaveCount(1)
 await expect(page.locator('#admin-search')).toHaveValue('Needle25');await expect(body).toContainText('Needle25')
 await switchQuery(page,{view,page:1,q:'',accountId:null});await expect(body.locator('tr')).toHaveCount(25);await expect(page.locator('#admin-search')).toHaveValue('')
 await expect(page.locator('body')).not.toContainText('never-render-secret')
})
for(const lang of ['en','zh-HK']){
 test('T27 uncancellable stale response cannot overwrite new tenant '+lang,async({page})=>{
  await fixture(page,lang);let release:()=>void=()=>{};const gate=new Promise<void>(r=>{release=r});let startedA=false
  await page.route('**/api/admin/directory?*',async route=>{
   const scope=new URL(route.request().url()).searchParams.get('accountId');if(scope===a){startedA=true;await gate}
   return route.fulfill({json:{view:'users',page:1,hasMore:false,rows:[{id:scope??'initial',account_id:scope,name:scope===a?'Late A':scope===b?'Current B':'Initial'}]}})
  })
  await page.goto('https://admin.fixture/'+lang);await expect(page.getByText('Initial',{exact:true})).toBeVisible()
  await page.evaluate(()=>{const original=window.fetch;window.fetch=(input,init)=>original(input,{...init,signal:undefined})}) // synthetic transport cannot cancel; product controller still fences responses
  await switchQuery(page,{view:'users',page:1,q:'',accountId:a});await expect.poll(()=>startedA).toBe(true);await switchQuery(page,{view:'users',page:1,q:'',accountId:b})
  await expect(page.getByText('Current B',{exact:true})).toBeVisible();const late=page.waitForResponse(response=>new URL(response.url()).searchParams.get('accountId')===a);release();await (await late).finished()
  await expect(page.getByText('Late A',{exact:true})).toHaveCount(0)
  await expect(page.getByText('Current B',{exact:true})).toBeVisible()
 })
 test('T27 schema three states remain limited diagnostics '+lang,async({page})=>{
  await fixture(page,lang);await page.route('**/api/admin/directory?*',r=>r.fulfill({json:{view:'users',page:1,hasMore:false,rows:[]}}))
  await page.goto('https://admin.fixture/'+lang);const copy=(lang==='en'?en:zh).adminDirectory.schemaHealth
  const section=page.getByRole('region',{name:copy.title})
  for(const status of ['columns_present','attention','unavailable'] as const){
   await page.evaluate(status=>(window as unknown as{aisoAdminHealth:(h:unknown)=>void}).aisoAdminHealth({status,checkedAt:'2026-10-13T00:00:00Z',checks:status==='attention'?[{key:'monitoring',missing:['pulse_runs.purpose']}]:[]}),status)
   await expect(section).toContainText(copy[status]);await expect(section).toContainText(copy.scope)
   if((await section.locator('details').getAttribute('open'))===null)await section.locator('summary').click()
   await expect(section.locator('time')).toBeVisible();await expect(section.locator('time')).toHaveText('2026-10-13T00:00:00Z');await expect(section.locator('button')).toHaveCount(0)
  }
 })
 test('T27 denied differs from empty data and safely rereads on retry '+lang,async({page})=>{
  await fixture(page,lang);let reads=0;await page.route('**/api/admin/directory?*',r=>{reads++;return r.fulfill({status:403,json:{error:'Forbidden'}})})
  await page.goto('https://admin.fixture/'+lang);const copy=(lang==='en'?en:zh).adminDirectory
  await expect(page.getByRole('alert')).toContainText(copy.denied);await expect(page.getByText(copy.empty,{exact:true})).toHaveCount(0)
  await page.getByRole('button',{name:copy.retry,exact:true}).click();await expect.poll(()=>reads).toBe(2);await expect(page.getByRole('alert')).toContainText(copy.denied)
 })
}
