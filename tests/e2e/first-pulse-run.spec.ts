import {test,expect,type Page} from '@playwright/test'
import {readFileSync,existsSync} from 'node:fs'
const clientId='11111111-1111-4111-8111-111111111111',runId='22222222-2222-4222-8222-222222222222'
const coverage=(classified=0,succeeded=0)=>({expected:5,succeeded,classified,failed:0,pending:5-succeeded,blocked:0,mentioned:0,status:classified===5?'completed':succeeded?'partial':'queued',coverage:succeeded/5,mentionRate:classified?0:null})
async function fixture(page:Page,lang:string){
 const dir=process.env.AISO_FIRST_PULSE_HTML_DIR;if(!dir)throw new Error('Generate the real first-pulse component fixture first')
 const css=existsSync(`${dir}/build.css`)?readFileSync(`${dir}/build.css`,'utf8'):'';const js=readFileSync(`${dir}/fixture.js`,'utf8');await page.route('**/*',route=>route.abort());await page.route(`https://first-pulse.fixture/${lang}`,route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>First monitoring fixture</title><style>${css}</style></head><body><div id="root"></div><script>${js}</script></body></html>`}))
}
for(const lang of ['en','zh-HK']){
 test(`lost response keeps intent, partial run recovers and classification controls completion in ${lang}`,async({page})=>{
  await fixture(page,lang)
  let run:Record<string,unknown>|null=null;const intents:string[]=[];let loseFirst=true
  const options=()=>({prompts:1,variants:5,expected:5,remaining:10,contextConfirmed:true,week:'2026-10-05',latest:run,legacyCurrentWeek:false,legacyObservationIds:[],search:{requested:'off'},enabled:true,nextDueAt:null})
  await page.route(`**/api/dashboard/clients/${clientId}/pulse-runs`,async route=>{
   if(route.request().method()==='GET')return route.fulfill({json:options()})
   const body=route.request().postDataJSON();intents.push(body.intentKey)
   if(loseFirst){loseFirst=false;return route.abort('failed')}
   run={id:runId,week:'2026-10-05',purpose:'canonical',coverage:coverage(1,1),reasons:['classification_pending'],retryable:true}
   return route.fulfill({status:202,json:{run,coverage:run.coverage}})
  })
  await page.goto(`https://first-pulse.fixture/${lang}`)
  const start=page.getByRole('button',{name:lang==='en'?'Start first monitoring':'開始首次監測',exact:true});await start.click();await expect(page.getByRole('alert')).toBeVisible();await page.reload();await start.click()
  await expect(page.getByRole('button',{name:lang==='en'?'Resume saved work':'繼續已保存的工作',exact:true})).toBeVisible();expect(intents).toHaveLength(2);expect(intents[0]).toBe(intents[1])
  run={...(run??{}),coverage:coverage(4,5),reasons:['classification_pending'],retryable:true};await page.reload();await expect(page.getByText(lang==='en'?'Partially complete':'部分完成',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:lang==='en'?'Start a separate retest':'建立獨立重測',exact:true})).toHaveCount(0)
  run={...(run??{}),coverage:coverage(5,5),reasons:[],retryable:false};await page.reload();await expect(page.getByRole('button',{name:lang==='en'?'Start a separate retest':'建立獨立重測',exact:true})).toBeVisible();await expect(page.getByRole('link',{name:lang==='en'?'Open answers and citations':'查看回答與引用',exact:true})).toHaveAttribute('href',new RegExp(`run=${runId}`))
  await page.setViewportSize({width:375,height:812});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
 })
 test(`leaving the page stops pending polling in ${lang}`,async({page})=>{
  await fixture(page,lang);let reads=0;await page.route(`**/api/dashboard/clients/${clientId}/pulse-runs`,route=>{reads++;return route.fulfill({json:{prompts:1,variants:5,expected:5,remaining:5,contextConfirmed:true,week:'2026-10-05',latest:{id:runId,week:'2026-10-05',coverage:coverage(),reasons:[],retryable:true},legacyObservationIds:[],search:{requested:'off'},enabled:true}})});await page.goto(`https://first-pulse.fixture/${lang}`);await expect(page.getByText(lang==='en'?'Queued':'已排隊',{exact:true})).toBeVisible();await page.goto('about:blank');const count=reads;await page.waitForTimeout(2300);expect(reads).toBe(count)
 })
}
