import{test,expect}from'@playwright/test'
import{readFileSync}from'node:fs'
import{openOnboardingComponent}from'../fixtures/onboarding-browser'
for(const lang of ['en','zh-HK']){
 test('T36 storage denied reload retains immutable unknown onboarding intent '+lang,async({page})=>{
  await page.addInitScript(()=>{for(const key of ['getItem','setItem','removeItem']as const)Storage.prototype[key]=()=>{throw new DOMException('Synthetic denied','SecurityError')}})
  await openOnboardingComponent(page,lang);const next=page.getByRole('button',{name:lang==='en'?'Continue':'繼續',exact:true})
  await next.click();await page.locator('#onboarding-domain').fill('storage.fixture');await next.click();await page.locator('#onboarding-language').selectOption('zh-HK');await page.locator('#onboarding-region').selectOption('TW');await next.click();await page.locator('#onboarding-description').fill('Original stored request')
  const bodies:Record<string,unknown>[]=[];await page.route('**/api/onboarding/complete',route=>{const body=route.request().postDataJSON();bodies.push(body);if(bodies.length===1)return route.abort('failed');return route.fulfill({json:{clientId:'11111111-1111-4111-8111-111111111111',progress:{brand:'ready',prompts:'ready',promptCount:24}}})})
  const submit=page.getByRole('button',{name:lang==='en'?'Go to my dashboard':'前往我的儀表板',exact:true});await submit.click();await expect(page.getByRole('alert')).toBeVisible();await page.locator('#onboarding-description').fill('Edits after lost response')
  await page.reload();await expect(page.locator('#onboarding-description')).toHaveValue('Edits after lost response')
  await submit.click();await expect(page.getByRole('button',{name:lang==='en'?'Open workspace':'開啟工作區',exact:true})).toBeVisible();expect(bodies).toHaveLength(2);expect(bodies[1]).toEqual(bodies[0]);await expect(submit).toBeDisabled()
 })
 test('T36 frozen retest workload gates quota without sending a doomed request '+lang,async({page})=>{
  const dir=process.env.AISO_FIRST_PULSE_HTML_DIR;if(!dir)throw Error('Actual Pulse fixture required')
  await page.route('**/*',r=>r.abort());await page.route('https://pulse-edge.fixture/'+lang,r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><html lang="'+lang+'"><head><meta charset="utf-8"><title>Retest availability</title><style>'+readFileSync(dir+'/build.css','utf8')+'</style></head><body><div id="root"></div><script>'+readFileSync(dir+'/fixture.js','utf8')+'</script></body></html>'}))
  let remaining=4,posts=0;const id='22222222-2222-4222-8222-222222222222'
  await page.route('**/api/dashboard/clients/*/pulse-runs',r=>{if(r.request().method()==='POST')posts++;return r.fulfill({json:{enabled:true,prompts:2,variants:5,expected:10,remaining,contextConfirmed:true,week:'2026-10-05',currentCanonicalId:id,legacyCurrentWeek:false,legacyObservationIds:[],search:{requested:'off'},latest:{id,week:'2026-10-05',purpose:'canonical',retryable:false,reasons:[],coverage:{expected:5,succeeded:5,classified:5,pending:0,failed:0,blocked:0,mentioned:0,status:'completed'}}}})})
  await page.goto('https://pulse-edge.fixture/'+lang);const retest=page.getByRole('button',{name:lang==='en'?'Start a separate retest':'建立獨立重測',exact:true})
  await expect(retest).toBeDisabled();expect(posts).toBe(0)
  remaining=5;await page.reload();await expect(retest).toBeEnabled();expect(posts).toBe(0)
 })
}

for(const lang of ['en','zh-HK']){
 test('T36 history fallback keeps synthetic A and B drafts separate '+lang,async({page})=>{
  await page.addInitScript(()=>{for(const key of ['getItem','setItem','removeItem']as const)Storage.prototype[key]=()=>{throw new DOMException('Synthetic denied','SecurityError')}})
  await openOnboardingComponent(page,lang);await page.locator('#onboarding-brand').fill('Private A draft');await page.locator('#brand-assist-url').fill('https://a.fixture/path')
  await page.evaluate(()=>(window as unknown as{aisoFixtureSwitchAccount:(id:string)=>void}).aisoFixtureSwitchAccount('synthetic-account-B'))
  await expect(page.locator('#onboarding-brand')).toHaveValue('Synthetic Brand');await expect(page.locator('#brand-assist-url')).toHaveValue('')
  await page.locator('#onboarding-brand').fill('Private B draft')
  await page.evaluate(()=>(window as unknown as{aisoFixtureSwitchAccount:(id:string)=>void}).aisoFixtureSwitchAccount('synthetic-account'))
  await expect(page.locator('#onboarding-brand')).toHaveValue('Private A draft');await expect(page.locator('#brand-assist-url')).toHaveValue('https://a.fixture/path')
 })
 test('T36 no persistent cache blocks a new create before any POST '+lang,async({page})=>{
  await page.addInitScript(()=>{for(const key of ['getItem','setItem','removeItem']as const)Storage.prototype[key]=()=>{throw new DOMException('Synthetic denied','SecurityError')};History.prototype.replaceState=()=>{throw new DOMException('Synthetic history denied','SecurityError')}})
  await openOnboardingComponent(page,lang);const next=page.getByRole('button',{name:lang==='en'?'Continue':'繼續',exact:true})
  await next.click();await next.click();await next.click();let posts=0
  await page.route('**/api/onboarding/complete',r=>{posts++;return r.abort()})
  await page.getByRole('button',{name:lang==='en'?'Go to my dashboard':'前往我的儀表板',exact:true}).click()
  await expect(page.getByRole('alert')).toContainText(lang==='en'?'cannot':'無法')
  await expect(page.getByRole('link',{name:lang==='en'?'Review saved brands':'覆核已儲存的品牌',exact:true})).toHaveAttribute('href','/'+lang+'/dashboard');expect(posts).toBe(0)
 })
}

for(const lang of ['en','zh-HK'])test('T36 paused configured monitoring offers question review '+lang,async({page})=>{
 const dir=process.env.AISO_FIRST_PULSE_HTML_DIR;if(!dir)throw Error('Actual Pulse fixture required')
 await page.route('**/*',r=>r.abort());await page.route('https://paused-edge.fixture/'+lang,r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><html lang="'+lang+'"><head><title>Paused monitoring</title><style>'+readFileSync(dir+'/build.css','utf8')+'</style></head><body><div id="root"></div><script>'+readFileSync(dir+'/fixture.js','utf8')+'</script></body></html>'}))
 await page.route('**/api/dashboard/clients/*/pulse-runs',r=>r.fulfill({json:{enabled:false,prompts:2,variants:5,expected:10,remaining:20,contextConfirmed:true,week:'2026-10-05',currentCanonicalId:null,legacyCurrentWeek:false,legacyObservationIds:[],search:{requested:'off'},latest:null}}))
 await page.goto('https://paused-edge.fixture/'+lang)
 await expect(page.getByRole('button',{name:lang==='en'?'Start first monitoring':'開始首次監測',exact:true})).toBeDisabled()
 await expect(page.getByRole('link',{name:lang==='en'?'Review tracking questions':'覆核監測問題',exact:true})).toHaveAttribute('href',/prompts$/)
})

for(const lang of ['en','zh-HK'])test('T36 unavailable status refresh is read only and never starts work '+lang,async({page})=>{
 const dir=process.env.AISO_FIRST_PULSE_HTML_DIR;if(!dir)throw Error('Actual Pulse fixture required')
 await page.route('**/*',r=>r.abort());await page.route('https://status-edge.fixture/'+lang,r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><html lang="'+lang+'"><head><title>Status recovery</title><style>'+readFileSync(dir+'/build.css','utf8')+'</style></head><body><div id="root"></div><script>'+readFileSync(dir+'/fixture.js','utf8')+'</script></body></html>'}))
 let reads=0,posts=0;await page.route('**/api/dashboard/clients/*/pulse-runs',r=>{if(r.request().method()==='POST')posts++;reads++;return r.fulfill(reads===1?{status:503,json:{error:'PULSE_UNAVAILABLE'}}:{json:{enabled:false,prompts:2,variants:5,expected:10,remaining:20,contextConfirmed:true,week:'2026-10-05',currentCanonicalId:null,legacyCurrentWeek:false,legacyObservationIds:[],search:{requested:'off'},latest:null}})})
 await page.goto('https://status-edge.fixture/'+lang);await expect(page.getByRole('alert')).toBeVisible()
 await page.getByRole('button',{name:lang==='en'?'Refresh saved status':'重新讀取已保存的狀態',exact:true}).click()
 await expect(page.getByRole('alert')).toHaveCount(0);await expect(page.getByRole('link',{name:lang==='en'?'Review tracking questions':'覆核監測問題',exact:true})).toBeVisible();expect(reads).toBe(2);expect(posts).toBe(0)
})
