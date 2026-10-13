import {test,expect,type Page} from '@playwright/test'
import {readFileSync} from 'node:fs'
import {parsePromptCsv,previewPromptRows,type PromptBatchRow} from '@/lib/prompts/bulk'
import type{AuditLoopData}from'../fixtures/audit-loop'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

async function fixture(page:Page,lang:'en'|'zh-HK'){
 const dir=process.env.AISO_AUDIT_LOOP_HTML_DIR
 if(!dir)throw new Error('Actual audit-loop component fixtures are required')
 const data=JSON.parse(readFileSync(dir+'/data.json','utf8')) as AuditLoopData
 data.prompts=data.prompts.slice(0,8)
 const messages=lang==='en'?en:zh,js=readFileSync(dir+'/fixture.js','utf8'),css=readFileSync(dir+'/build.css','utf8')
 await page.route('**/*',route=>route.abort())
 await page.route('https://bulk-recovery.fixture/',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><html lang="'+lang+'"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body><div id="root"></div><script id="fixture-props" type="application/json">'+JSON.stringify({mode:'bulk',data,lang,messages}).replace(/</g,'\\u003c')+'</script><script>'+js+'</script></body></html>'}))
 return{data,copy:messages.pulse}
}
for(const lang of ['en','zh-HK'] as const){
 test('mixed CSV gives actionable mutually exclusive counts without applying '+lang,async({page})=>{
  const{data,copy}=await fixture(page,lang);let writes=0
  const rows=data.prompts as PromptBatchRow[],version='a'.repeat(32)
  await page.route('**/api/dashboard/clients/*/prompts/bulk',route=>{
   if(route.request().method()==='GET')return route.fulfill({json:{prompts:rows,version,recent:{}}})
   const body=route.request().postDataJSON()
   if(body.mode==='preview')return route.fulfill({json:{...previewPromptRows(rows,parsePromptCsv(body.csv)),version}})
   writes++;return route.fulfill({status:500,json:{}})
  })
  await page.goto('https://bulk-recovery.fixture/')
  await page.getByText(copy.qb_bulk_title,{exact:true}).click()
  await page.getByRole('textbox',{name:copy.qb_bulk_csv,exact:true}).fill(readFileSync('docs/remediation/2026-10-12/source/synthetic-mixed.csv','utf8'))
  await page.getByRole('button',{name:copy.qb_bulk_preview_csv,exact:true}).click()
  await expect(page.getByText(lang==='zh-HK'?'共 3 列：1 列可套用、1 列重複、1 列無效。':'3 rows: 1 applicable, 1 duplicate, 1 invalid.',{exact:true})).toBeVisible()
  await expect(page.getByText(lang==='zh-HK'?'套用後預計有 9 條啟用問題；目前尚未套用。':'Projected 9 active questions after applying; nothing has been applied yet.',{exact:true})).toBeVisible()
  await expect(page.getByRole('alert')).toContainText(lang==='zh-HK'?'刪除重複列或修改問題文字':'Remove the duplicate row or change its question')
  await expect(page.getByRole('alert')).toContainText('category_query')
  await expect(page.getByRole('button',{name:copy.qb_bulk_confirm,exact:true})).toBeDisabled()
  expect(writes).toBe(0);expect(rows).toHaveLength(8)
  const download=page.getByRole('link',{name:lang==='zh-HK'?'下載 CSV 範例':'Download sample CSV',exact:true})
  await expect(download).toHaveAttribute('download','aiso-question-sample.csv')
 })
 test('invalid market explains uppercase HK and keeps the whole batch blocked '+lang,async({page})=>{
  const{data,copy}=await fixture(page,lang),rows=data.prompts as PromptBatchRow[],version='a'.repeat(32)
  await page.route('**/api/dashboard/clients/*/prompts/bulk',route=>{
   if(route.request().method()==='GET')return route.fulfill({json:{prompts:rows,version,recent:{}}})
   return route.fulfill({json:{...previewPromptRows(rows,parsePromptCsv(route.request().postDataJSON().csv)),version}})
  })
  await page.goto('https://bulk-recovery.fixture/');await page.getByText(copy.qb_bulk_title,{exact:true}).click()
  await page.getByRole('textbox',{name:copy.qb_bulk_csv,exact:true}).fill(readFileSync('docs/remediation/2026-10-12/source/synthetic-invalid-market.csv','utf8'))
  await page.getByRole('button',{name:copy.qb_bulk_preview_csv,exact:true}).click()
  await expect(page.getByRole('alert')).toContainText(lang==='zh-HK'?'使用大寫 HK（香港）':'Use uppercase HK (Hong Kong)')
  await expect(page.getByRole('button',{name:copy.qb_bulk_confirm,exact:true})).toBeDisabled()
 })
 for(const outcome of ['success','conflict','lost-response','pending'] as const){
  test('corrected batch '+outcome+' preserves intent and version '+lang,async({page})=>{
   const{data,copy}=await fixture(page,lang);let rows=data.prompts as PromptBatchRow[],version='a'.repeat(32),writes=0,posts=0
   const intents:string[]=[],saved=new Map<string,unknown>(),csv='question,category,language,market,is_active\nNew synthetic question,brand_query,'+lang+',HK,true'
   await page.route('**/api/dashboard/clients/*/prompts/bulk',route=>{
    if(route.request().method()==='GET')return route.fulfill({json:{prompts:rows,version,recent:{}}})
    const body=route.request().postDataJSON()
    if(body.mode==='preview')return route.fulfill({json:{...previewPromptRows(rows,parsePromptCsv(body.csv)),version}})
    posts++;intents.push(body.intentKey)
    if(outcome==='conflict')return route.fulfill({status:409,json:{error:'PROMPT_VERSION_CONFLICT'}})
    if(outcome==='pending')return route.fulfill({status:503,json:{error:'PROMPT_BATCH_PENDING'}})
    if(saved.has(body.intentKey))return route.fulfill({json:saved.get(body.intentKey)})
    writes++;rows=[...rows,...body.changes];version='b'.repeat(32)
    const result={updatedIds:body.changes.map((r:PromptBatchRow)=>r.id),activeCount:9,version};saved.set(body.intentKey,result)
    return outcome==='lost-response'?route.abort('failed'):route.fulfill({json:result})
   })
   await page.goto('https://bulk-recovery.fixture/');await page.getByText(copy.qb_bulk_title,{exact:true}).click()
   const input=page.getByRole('textbox',{name:copy.qb_bulk_csv,exact:true}),prepare=page.getByRole('button',{name:copy.qb_bulk_preview_csv,exact:true})
   await input.fill(csv);await prepare.click()
   const save=page.getByRole('button',{name:copy.qb_bulk_confirm,exact:true});await expect(save).toBeEnabled()
   await save.evaluate(el=>{(el as HTMLButtonElement).click();(el as HTMLButtonElement).click()})
   await expect.poll(()=>posts).toBe(1)
   if(outcome==='conflict'){
    await expect(page.getByRole('alert')).toHaveText(copy.qb_bulk_conflict)
    await expect(save).toHaveCount(0);await expect(input).toHaveValue(csv)
    expect(writes).toBe(0);expect(rows).toHaveLength(8)
   }else if(outcome==='lost-response'||outcome==='pending'){
    await expect(page.getByRole('alert')).toHaveText(copy.qb_bulk_unknown)
    await expect(input).toBeDisabled();await expect(prepare).toBeDisabled()
    await expect(page.getByText(lang==='zh-HK'?'套用後預計有 9 條啟用問題；目前尚未套用。':'Projected 9 active questions after applying; nothing has been applied yet.',{exact:true})).toHaveCount(0)
    expect(posts).toBe(1)
    if(outcome==='lost-response'){
     await save.click();await expect(save).toHaveCount(0)
     expect(posts).toBe(2);expect(new Set(intents).size).toBe(1);expect(writes).toBe(1);expect(rows).toHaveLength(9)
     await expect(input).toBeEnabled()
     await input.fill(csv.replace('New synthetic question','Another synthetic question'))
     await prepare.click();await expect(save).toBeEnabled()
     expect(writes).toBe(1)
    }else expect(writes).toBe(0)
   }else{
    await expect(save).toHaveCount(0);expect(writes).toBe(1);expect(rows).toHaveLength(9)
   }
  })
 }
}
