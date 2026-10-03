import {test,expect} from '../../fixtures/auth'

// Read-only authenticated acceptance. Separate from synthetic component gates.
// Fixtures and sessions must belong to the approved isolated environment.
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
function ids(){
 if(process.env.AISO_UAT_ISOLATED!=='1')throw new Error('AISO_UAT_ISOLATED=1 requires an approved isolated environment; no live AUDIT fixtures are used')
 const own=process.env.AISO_UAT_CLIENT_ID,foreign=process.env.AISO_UAT_FOREIGN_CLIENT_ID
 if(!own||!foreign||!uuid.test(own)||!uuid.test(foreign)||own===foreign)throw new Error('Provide distinct approved account A/B client IDs')
 return{own,foreign}
}
for(const lang of ['en','zh-HK'] as const)for(const width of [360,390,1440]){
 test(`T16 maintenance read journey ${lang} ${width}`,async({authenticatedPage:page})=>{
  const{own,foreign}=ids();await page.setViewportSize({width,height:900})
  for(const tool of ['','/entities','/sources','/observations','/opportunities','/prompts']){
   const response=await page.goto(`/${lang}/dashboard/${own}${tool}`)
   expect(response?.status()).toBe(200);await expect(page.getByRole('heading',{level:1})).toBeVisible()
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  }
  for(const endpoint of [`/api/clients/${foreign}/entities`,`/api/clients/${foreign}/sources`,`/api/clients/${foreign}/observations`,`/api/clients/${foreign}/work-items`,`/api/dashboard/clients/${foreign}/prompts`]){
   const response=await page.request.get(endpoint);expect(response.status(),endpoint).toBe(404)
  }
 })
}
