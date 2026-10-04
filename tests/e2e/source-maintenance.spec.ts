import { test,expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import AxeBuilder from '@axe-core/playwright'
import { sourcePageFixture } from '../../__tests__/components/source-maintenance-fixtures'
import { previewSourceImport } from '../../lib/sources/import-preview'
import en from '../../messages/en.json'
import zh from '../../messages/zh-HK.json'

for(const lang of ['en','zh-HK']){
 const copy=(lang==='en'?en:zh).sources
 test(`T04 successful import identifies the acknowledged source key and version in ${lang}`,async({page})=>{
  const dir=process.env.AISO_SOURCES_HTML_DIR,css=process.env.AISO_SOURCES_CSS_PATH
  if(!dir||!css)throw new Error('Source fixture paths required')
  await page.route('**/*',route=>route.abort())
  await page.route(`https://sources.fixture/${lang}`,route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><html lang="${lang}"><head><title>Source approval identity</title><style>${readFileSync(css,'utf8')}</style></head><body>${readFileSync(`${dir}/${lang}-default.html`,'utf8')}<script>${readFileSync(`${dir}/fixture.js`,'utf8')}</script></body></html>`}))
  await page.route('**/api/clients/*/sources/import-preview',route=>route.fulfill({json:{...previewSourceImport(route.request().postDataJSON()),expectedLatestVersion:1}}))
  await page.route('**/api/clients/*/sources',route=>route.fulfill({status:200,json:{result:'unchanged',approval:'approved',source:{sourceKey:'canonical-key',latestVersion:3}}}))
  await page.goto(`https://sources.fixture/${lang}`);await page.waitForFunction(()=>Boolean((window as Window&{c9cFixtureReady?:boolean}).c9cFixtureReady))
  await page.getByLabel(copy.import.label,{exact:true}).fill('Shared source label')
  await page.getByLabel(copy.import.key,{exact:false}).fill('Canonical-Key')
  await page.getByLabel(copy.import.question,{exact:true}).fill('Same question')
  await page.getByLabel(copy.import.answer,{exact:true}).fill('Same answer')
  await page.getByRole('checkbox',{name:copy.import.approve,exact:false}).check()
  await page.getByRole('button',{name:copy.import.submit,exact:true}).click()
  const status=page.locator('[aria-live="polite"]')
  await expect(status).toHaveText(`${copy.import.savedVersion.replace('{key}','canonical-key').replace('{version}','3')} ${copy.actions.approved}`)
  await expect(status).not.toContainText('Canonical-Key')
 })
 test(`T04 reviewed approval identifies its persisted source in ${lang}`,async({page})=>{
  const dir=process.env.AISO_SOURCES_HTML_DIR,css=process.env.AISO_SOURCES_CSS_PATH
  if(!dir||!css)throw new Error('Source fixture paths required')
  const sourceId='00000000-0000-4000-8000-000000000001',versionId='00000000-0000-4000-8000-000000000002',key='reviewed-key',hash='a'.repeat(64)
  const source={id:sourceId,sourceKey:key,label:'Reviewed source',latestVersion:3,agentUseAllowed:false,revokedAt:null,current:{id:versionId,versionNumber:3,contentHash:hash,approvedAt:null,entries:[{question:'Review question',answer:'Review answer'}]}}
  await page.route('**/*',route=>route.abort())
  await page.route(`https://sources.fixture/${lang}`,route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><html lang="${lang}"><head><title>Reviewed approval identity</title><style>${readFileSync(css,'utf8')}</style></head><body>${readFileSync(`${dir}/${lang}-default.html`,'utf8')}<script>${readFileSync(`${dir}/fixture.js`,'utf8')}</script></body></html>`}))
  await page.route('**/api/clients/*/sources?*',route=>{
   const data=sourcePageFixture()
   const entry={...data.pack.entries[0],id:sourceId,label:source.label,sourceKey:key,usability:'awaiting-approval',agentUseAllowed:false,versionId,versionNumber:3,contentHash:hash}
   return route.fulfill({json:{...data,nextCursor:null,pack:{...data.pack,entries:[entry]}}})
  })
  await page.route(`**/sources/${sourceId}`,route=>route.fulfill({json:{source}}))
  await page.route(`**/sources/${sourceId}/versions/${versionId}/approve`,route=>{
   expect(route.request().postDataJSON()).toEqual({expectedLatestVersion:3,expectedContentHash:hash})
   return route.fulfill({json:{source:{...source,current:{...source.current,approvedAt:'2026-10-04T00:00:00Z'}}}})
  })
  await page.goto(`https://sources.fixture/${lang}`);await page.waitForFunction(()=>Boolean((window as Window&{c9cFixtureReady?:boolean}).c9cFixtureReady))
  await page.getByLabel(copy.pagination.filter).selectOption('awaiting-approval')
  await page.getByRole('button',{name:copy.actions.reviewVersion,exact:true}).click()
  const review=page.getByRole('region',{name:copy.actions.reviewVersion,exact:true})
  await expect(review).toContainText(key)
  await expect(review).toContainText('Review answer')
  await review.getByRole('button',{name:copy.actions.approveVersion,exact:true}).click()
  await expect(page.locator('[aria-live="polite"]')).toHaveText(`${copy.import.savedVersion.replace('{key}',key).replace('{version}','3')} ${copy.actions.approved}`)
  await expect(review).toHaveCount(0)
 })
 test(`T17 paste and submitted metadata stay fixed while importing in ${lang}`,async({page},testInfo)=>{
  const dir=process.env.AISO_SOURCES_HTML_DIR,css=process.env.AISO_SOURCES_CSS_PATH
  if(!dir||!css)throw new Error('Source fixture paths required')
  await page.route('**/*',route=>route.abort())
  await page.route(`https://sources.fixture/${lang}`,route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><html lang="${lang}"><head><title>Pending import</title><style>${readFileSync(css,'utf8')}</style></head><body>${readFileSync(`${dir}/${lang}-default.html`,'utf8')}<script>${readFileSync(`${dir}/fixture.js`,'utf8')}</script></body></html>`}))
  let release:()=>void=()=>{}
  const wait=new Promise<void>(resolve=>{release=resolve})
  await page.route('**/api/clients/*/sources/import-preview',async route=>{
    await wait;return route.fulfill({json:{...previewSourceImport(route.request().postDataJSON()),expectedLatestVersion:0}})
  })
  await page.route('**/api/clients/*/sources',route=>route.fulfill({status:201,json:{result:'created'}}))
  await page.goto(`https://sources.fixture/${lang}`);await page.waitForFunction(()=>Boolean((window as Window&{c9cFixtureReady?:boolean}).c9cFixtureReady))
  await page.getByLabel(copy.import.label,{exact:true}).fill('Synthetic pending')
  await page.getByLabel(copy.import.key,{exact:false}).fill('pending')
  await page.getByLabel(copy.import.question,{exact:true}).fill('Submitted question')
  await page.getByLabel(copy.import.answer,{exact:true}).fill('Submitted answer')
  await page.evaluate(()=>{
   const form=document.querySelector('form')!
   form.addEventListener('submit',()=>{
    const started=performance.now()
    const observer=new MutationObserver(()=>{
     if(form.querySelector('fieldset')?.disabled){
      ;(window as Window&{sourcePendingMs?:number}).sourcePendingMs=performance.now()-started
      observer.disconnect()
     }
    })
    observer.observe(form,{attributes:true,childList:true,subtree:true})
   },{once:true,capture:true})
  })
  await page.getByRole('button',{name:copy.import.submit,exact:true}).click()
  await expect(page.getByRole('button',{name:copy.import.submitting,exact:true})).toBeDisabled({timeout:1000})
  const submissionToPendingMs=await page.evaluate(()=>(window as Window&{sourcePendingMs?:number}).sourcePendingMs)
  expect(submissionToPendingMs).toBeLessThanOrEqual(1000)
  await testInfo.attach('source-pending-timing',{body:JSON.stringify({lang,submissionToPendingMs,limitMs:1000,scope:'actual DOM submit event to pending mutation; component renderer; intercepted request; synthetic fixture'}),contentType:'application/json'})
  for(const label of [copy.import.label,copy.import.question,copy.import.answer])await expect(page.getByLabel(label,{exact:true})).toBeDisabled()
  await expect(page.getByRole('button',{name:copy.import.add,exact:true})).toBeDisabled()
  release();await expect(page.getByRole('button',{name:copy.import.submit,exact:true})).toBeEnabled()
  await expect(page.getByLabel(copy.import.question,{exact:true})).toHaveValue('')
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([])
 })
 test(`T12 source pages and filters reach all 201 in ${lang}`,async({page})=>{
  const dir=process.env.AISO_SOURCES_HTML_DIR,css=process.env.AISO_SOURCES_CSS_PATH
  if(!dir||!css)throw new Error('Source fixture paths required')
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message))
  await page.route('**/*',route=>route.abort())
  await page.route(`https://sources.fixture/${lang}`,route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>Sources</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${readFileSync(css,'utf8')}</style></head><body>${readFileSync(`${dir}/${lang}-default.html`,'utf8')}<script>${readFileSync(`${dir}/fixture.js`,'utf8')}</script></body></html>`}))
  const requests:string[]=[]
  await page.route('**/api/clients/*/sources?*',route=>{
   const url=new URL(route.request().url());requests.push(url.search)
   return route.fulfill({json:sourcePageFixture(Number(url.searchParams.get('cursor')?.replace('page-','')??0),url.searchParams.get('filter')??'all')})
  })
  await page.goto(`https://sources.fixture/${lang}`);await page.waitForFunction(()=>Boolean((window as Window&{c9cFixtureReady?:boolean}).c9cFixtureReady))
  await expect(page.getByRole('heading',{name:/^Source \d+$/})).toHaveCount(50)
  for(let i=0;i<4;i++)await page.getByRole('button',{name:copy.pagination.more,exact:true}).click()
  await expect(page.getByRole('heading',{name:/^Source \d+$/})).toHaveCount(201)
  expect(requests).toHaveLength(4)
  await page.getByLabel(copy.pagination.filter).selectOption('revoked')
  await expect(page.getByRole('heading',{name:/^Source \d+$/})).toHaveCount(0)
  expect(requests.at(-1)).not.toContain('cursor=')
  await page.getByLabel(copy.pagination.filter).selectOption('all')
  await expect(page.getByRole('heading',{name:/^Source \d+$/})).toHaveCount(50)
  await page.route('**/api/clients/*/sources?*',route=>route.fulfill({status:409,json:{error:'SOURCE_PAGE_CHANGED'}}))
  await page.getByRole('button',{name:copy.pagination.more,exact:true}).click()
  await expect(page.getByRole('alert')).toHaveText(copy.errors.SOURCE_PAGE_CHANGED)
  expect(errors).toEqual([])
 })
 test(`T12 CSV retries only invalid rows and imports all 200 in ${lang}`,async({page})=>{
  const dir=process.env.AISO_SOURCES_HTML_DIR,css=process.env.AISO_SOURCES_CSS_PATH
  if(!dir||!css)throw new Error('Source fixture paths required')
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message))
  await page.route('**/*',route=>route.abort())
  await page.route(`https://sources.fixture/${lang}`,route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>Sources</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${readFileSync(css,'utf8')}</style></head><body>${readFileSync(`${dir}/${lang}-default.html`,'utf8')}<script>${readFileSync(`${dir}/fixture.js`,'utf8')}</script></body></html>`}))
  const previews:Record<string,unknown>[]=[];let imports=0
  await page.route('**/api/clients/*/sources/import-preview',route=>{
   const body=route.request().postDataJSON();previews.push(body)
   return route.fulfill({json:{...previewSourceImport(body),expectedLatestVersion:3}})
  })
  await page.route('**/api/clients/*/sources',route=>{
   imports++;const body=route.request().postDataJSON()
   expect(body.entries).toHaveLength(200);expect(body.entries[0]).toEqual({question:'Question 0',answer:'Answer'});expect(body.entries[199].answer).toBe('Corrected')
   expect(body).toMatchObject({expectedLatestVersion:3,previewRowCount:200,approve:false})
   return route.fulfill(imports===1?{status:409,json:{error:'SOURCES_CONFLICT'}}:{status:201,json:{result:'version-added'}})
  })
  await page.goto(`https://sources.fixture/${lang}`);await page.waitForFunction(()=>Boolean((window as Window&{c9cFixtureReady?:boolean}).c9cFixtureReady))
  await page.getByLabel(copy.import.label,{exact:true}).fill('Synthetic CSV')
  await page.getByLabel(copy.import.key,{exact:false}).fill('synthetic-csv')
  await page.getByLabel(copy.import.method,{exact:false}).selectOption('csv')
  await page.getByRole('textbox',{name:copy.import.methods.csv,exact:false}).fill(Array.from({length:200},(_,i)=>`Question ${i},${i===199?'':'Answer'}`).join('\n'))
  await expect(page.getByRole('button',{name:copy.import.submit,exact:true})).toBeDisabled()
  await page.getByRole('button',{name:copy.import.preview,exact:true}).click()
  const preview=page.getByRole('region',{name:copy.import.preview})
  await expect(preview.getByText(copy.errors.SOURCE_ANSWER_INVALID)).toBeVisible()
  await preview.getByLabel(copy.import.answer,{exact:true}).fill('Corrected')
  await preview.getByRole('button',{name:copy.import.retryRows}).click()
  await expect(page.getByRole('button',{name:copy.import.submit,exact:true})).toBeEnabled()
  expect(previews[1].rows).toEqual([{rowNumber:200,question:'Question 199',answer:'Corrected'}])
  expect(previews[1]).not.toHaveProperty('csv')
  await page.getByRole('button',{name:copy.import.submit,exact:true}).click()
  await expect(page.getByRole('alert')).toHaveText(copy.errors.SOURCES_CONFLICT)
  await expect(preview.locator('li')).toHaveCount(200)
  expect(imports).toBe(1)
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([])
  await page.screenshot({path:`${dir}/${lang}-csv.png`,fullPage:false})
  expect(errors).toEqual([])
 })
}
