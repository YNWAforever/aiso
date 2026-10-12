import {test,expect} from '@playwright/test'
import {readFileSync} from 'node:fs'
import type {AuditLoopData} from '../fixtures/audit-loop'
import type {ObservationCopy} from '@/components/observations/copy'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

// Real compiled components with synthetic HTTP receipts; no hosted Auth/provider proof.
for(const lang of ['en','zh-HK'] as const)test('UC75 incomplete evidence to existing private work draft '+lang,async({page})=>{
 const homeDir=process.env.C8A_HTML_DIR,observationDir=process.env.C9B_HTML_DIR,workDir=process.env.AISO_AUDIT_LOOP_HTML_DIR,cssPath=process.env.C8A_CSS_PATH
 if(!homeDir||!observationDir||!workDir||!cssPath)throw Error('Prepare all real component fixtures')
 const copy=lang==='en'?en:zh,obs=JSON.parse(readFileSync(observationDir+'/'+lang+'-copy.json','utf8')) as ObservationCopy
 const data=JSON.parse(readFileSync(workDir+'/data.json','utf8')) as AuditLoopData
 const supported=data.groups[0].evidenceRefs[0],evidence=data.item.evidenceSnapshot.evidence
 if(evidence.kind!=='pulse-metric')throw Error('UC75 requires retained pulse evidence')
 data.item={...data.item,evidenceSnapshot:{...data.item.evidenceSnapshot,source:supported,evidence:{...evidence,id:supported.id}}}
 const clientId=data.clientId,unknownId='33333333-3333-4333-8333-333333333333',base='https://uc75.fixture/'+lang+'/dashboard/'+clientId
 const css=readFileSync(cssPath,'utf8'),errors:string[]=[],requests:{method:string;url:string}[]=[]
 let saved=false,writes=0
 page.on('pageerror',e=>errors.push(e.message))
 page.on('request',r=>requests.push({method:r.method(),url:r.url()}))
 await page.route('**/*',r=>r.abort())
 await page.route(base+'**',route=>{
  const url=new URL(route.request().url())
  let body:string
  if(url.pathname.endsWith('/observations'))body=readFileSync(observationDir+'/'+lang+'-default.html','utf8')+'<script>'+readFileSync(observationDir+'/observation-fixture.js','utf8')+'</script>'
  else if(url.pathname.endsWith('/opportunities')){
   const props={mode:'work',data:{...data,groups:data.groups.map(g=>({...g,savedWorkItemId:saved?data.item.id:null}))},lang,messages:copy}
   body='<div id="root"></div><script type="application/json" id="fixture-props">'+JSON.stringify(props).replaceAll('<','\\u003c')+'</script><script>'+readFileSync(workDir+'/fixture.js','utf8')+'</script>'
  }else body=readFileSync(homeDir+'/'+lang+'-uc75.html','utf8')
  return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="'+lang+'"><head><meta charset="utf-8"><title>UC75 synthetic workflow</title><style>'+css+'</style></head><body>'+body+'</body></html>'})
 })
 await page.route('**/api/clients/*/observations/'+unknownId,route=>route.fulfill({json:{observation:{id:unknownId,sourceKind:'pulse-metric',promptId:null,question:'Retained unknown answer',platform:'fixture-api',scanWeek:'2026-09-01',recordedAt:null,collectedAt:null,model:null,requestedModel:null,market:null,result:'incomplete',hasAnswer:true,brandMentioned:null,currentPrompt:null,rawAnswer:'Retained original answer; classification is unknown.',promptSnapshot:null,brandSnapshot:null,classification:{status:'legacy_unknown',method:null,version:null,brandMentioned:null,sentiment:'unknown',matchedText:[]},links:[],limitations:['model-unrecorded']}}}))
 await page.route('**/api/clients/*/work-items/groups',route=>{
  expect(route.request().method()).toBe('POST')
  const body=route.request().postDataJSON();expect(body.sources.map((s:{source:{id:string}})=>s.source.id)).toEqual(data.groups[0].evidenceRefs.map(r=>r.id));expect(body.sources.some((s:{source:{id:string}})=>s.source.id===unknownId)).toBe(false)
  expect(data.item.status).toBe('draft');expect(data.item.evidenceSnapshot.source.id).toBe(supported.id);expect(data.item.evidenceSnapshot.source.id).not.toBe(unknownId)
  writes++;saved=true;return route.fulfill({json:{item:data.item}})
 })
 await page.goto(base)
 const action=page.locator('header').getByRole('link',{name:copy.workspaceHome.nextStep.repair,exact:true})
 await expect(action).toHaveAttribute('href','/'+lang+'/dashboard/'+clientId+'/observations?run=saved#run-status')
 await action.click();await page.waitForFunction(()=>Boolean((window as Window&{observationFixtureReady?:boolean}).observationFixtureReady))
 await expect(page.getByText(obs.classificationUnknown,{exact:true}).first()).toBeVisible();await expect(page.getByText(obs.brandNotMentioned,{exact:true})).toHaveCount(0)
 await page.getByRole('button',{name:obs.viewDetails,exact:true}).click()
 const modal=page.getByRole('dialog',{name:obs.detailTitle,exact:true});await expect(modal.getByText('Retained original answer; classification is unknown.',{exact:true})).toBeVisible()
 await expect(modal.getByText(obs.classificationUnknown,{exact:true}).first()).toBeVisible();await page.keyboard.press('Escape')
 // Navigate the existing opportunity route; the fixture does not invent a new product link.
 await page.goto(base+'/opportunities')
 const refs=page.locator('details').first();await refs.locator('summary').click()
 for(const ref of data.groups[0].evidenceRefs)await expect(refs.locator('a').filter({hasText:ref.id})).toHaveAttribute('href',new RegExp('observation='+ref.id))
 await page.getByRole('button',{name:copy.opportunities.groupSave,exact:true}).click()
 await expect(page.getByRole('textbox',{name:copy.opportunities.titleField,exact:true})).toHaveValue(data.item.title)
 await expect(page.getByText(copy.opportunities.draftOnly,{exact:true}).first()).toBeVisible()
 await page.goto(base+'/opportunities');await page.getByRole('button',{name:copy.opportunities.openDraft,exact:true}).click()
 await expect(page.getByRole('textbox',{name:copy.opportunities.titleField,exact:true})).toHaveValue(data.item.title)
 expect(writes).toBe(1);expect(errors).toEqual([])
 expect(requests.filter(r=>r.method!=='GET')).toEqual([{method:'POST',url:'https://uc75.fixture/api/clients/'+clientId+'/work-items/groups'}])
})
