import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'
import {beforeEach,expect,it,vi} from 'vitest'
import {Children,isValidElement,type ReactElement,type ReactNode} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {resolveCommercialEntitlement} from '@/lib/tier'
import type {Scan,AgentProgress,AgentCompetitor} from '@/lib/types'
import {ImproveStep} from '@/components/dashboard/ImproveStep'
import {AgentSection} from '@/components/dashboard/AgentSection'

const hooks=vi.hoisted(()=>({slots:[] as unknown[],cursor:0,locale:'en' as 'en'|'zh-HK',clientId:'client-a',refresh:vi.fn()}))
vi.mock('react',async original=>({...await original<typeof import('react')>(),
  useState(initial:unknown){const i=hooks.cursor++;if(!(i in hooks.slots))hooks.slots[i]=typeof initial==='function'?initial():initial;return[hooks.slots[i],(next:unknown)=>{hooks.slots[i]=typeof next==='function'?next(hooks.slots[i]):next}]},
  useRef(initial:unknown){const i=hooks.cursor++;if(!(i in hooks.slots))hooks.slots[i]={current:initial};return hooks.slots[i]},
  useEffect(effect:()=>unknown){effect()},
}))
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:hooks.refresh}),useParams:()=>({clientId:hooks.clientId})}))
vi.mock('next-intl',async original=>{const actual=await original<typeof import('next-intl')>();return{...actual,
  useTranslations:(namespace:'dashboard'|'generatedWork')=>actual.createTranslator({locale:hooks.locale,messages:hooks.locale==='en'?en:zhHK,namespace})}})

const features=resolveCommercialEntitlement({plan:'enterprise',status:'active',stripe_subscription_id:'sub'}).features
const check={status:'warn' as const,message:'Not evaluated by this render fixture'}
const baseScan:Scan={id:'scan-a',url:'https://example.com',domain:'example.com',score:30,
  results:{c1_robots:check,c2_llms_txt:check,c3_bot_access:check,c4_structured_data:check,c5_extractability:check},
  account_id:'account-a',agent_status:null,created_at:'2026-10-15'}
const recommendation={id:'rec',scan_id:'scan-a',platform:'gpt4o',category:'content',priority:'high' as const,recommendation:'Saved review action',impact_score:4,created_at:'2026-10-15'}
const receipt={version:1,producer:'native-improve.v1',token:'saved-token',state:'complete',fingerprint:'fingerprint',startedAt:'2026-10-15T00:00:00Z',leaseUntil:'2026-10-15T00:01:00Z',providerStarted:true,
  outcomes:{recommendations:'available',progress:'unavailable',competitors:'unavailable'},counts:{recommendations:1,progress:0,competitors:0},reasons:{progress:'no-classified-observations',competitors:'no-sourced-competitor-evidence'},sourceCheckIds:['c1_robots'],
  recommendationBasis:[{checkId:'c1_robots',assessment:'warn',action:'Review the saved crawler access check.',source:{scanId:'scan-a',checkId:'c1_robots'},limitations:['no-page-or-provider-excerpts','sampled-single-page']}]}
function response(scanId='scan-a',state='complete',status=200){return{ok:status<400,status,json:async()=>({scanId,state,generation:{...receipt,state}})} as Response}
type Element=ReactElement<{children?:ReactNode;onClick?:()=>Promise<void>;disabled?:boolean}>
function nodes(node:ReactNode):Element[]{return Children.toArray(node).flatMap(n=>isValidElement(n)?[n as Element,...nodes((n as Element).props.children)]:[])}
function mount(getScan:()=>Scan=()=>baseScan){
  const render=()=>{hooks.cursor=0;return ImproveStep({scan:getScan(),features,recommendations:[],progress:[],competitors:[]})}
  return{html:()=>renderToStaticMarkup(render()),click:async()=>{const button=nodes(render()).find(n=>n.type==='button');expect(button).toBeDefined();await button!.props.onClick!()}}
}
beforeEach(()=>{hooks.slots=[];hooks.cursor=0;hooks.locale='en';hooks.clientId='client-a';hooks.refresh.mockReset();vi.stubGlobal('fetch',vi.fn())})

it('generates only after an explicit click for the same selected scan',async()=>{
  vi.mocked(fetch).mockResolvedValue(response())
  const view=mount();view.html();expect(fetch).not.toHaveBeenCalled()
  await view.click()
  expect(fetch).toHaveBeenCalledWith('/api/clients/client-a/agents/generate',expect.objectContaining({method:'POST',body:JSON.stringify({scanId:'scan-a'})}))
  expect(hooks.refresh).toHaveBeenCalledTimes(1)
})
it('prevents duplicate clicks and retains the original scan intent while running',async()=>{
  let finish!:(result:Response)=>void
  vi.mocked(fetch).mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
  const view=mount(),pending=view.click();pending.catch(()=>{});expect(view.html()).toContain('disabled=""');await view.click();expect(fetch).toHaveBeenCalledTimes(1)
  finish(response());await pending
})
it.each(['network','json','http','wrong-scan'])('recovers safely from %s and retries the same scan identity',async failure=>{
  if(failure==='network')vi.mocked(fetch).mockRejectedValueOnce(new Error('PRIVATE'))
  else vi.mocked(fetch).mockResolvedValueOnce({ok:failure!=='http',status:failure==='http'?503:200,json:async()=>{if(failure==='json')throw new Error('PRIVATE');return failure==='wrong-scan'?{scanId:'foreign-scan',state:'complete'}:{error:'PRIVATE'}}} as Response)
  const view=mount();await view.click();expect(view.html()).toContain(en.generatedWork.error);expect(view.html()).not.toContain('PRIVATE');expect(view.html()).not.toContain('disabled=""')
  vi.mocked(fetch).mockResolvedValueOnce(response());await view.click();expect(hooks.refresh).toHaveBeenCalledTimes(1)
  const bodies=vi.mocked(fetch).mock.calls.map(call=>JSON.parse(String(call[1]?.body)));expect(bodies).toEqual([{scanId:'scan-a'},{scanId:'scan-a'}])
})
it('keeps scan B state when a late response for scan A arrives',async()=>{
  let finish!:(result:Response)=>void;let scan=baseScan
  vi.mocked(fetch).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
  const view=mount(()=>scan),first=view.click();first.catch(()=>{});scan={...baseScan,id:'scan-b'}
  expect(view.html()).not.toContain('disabled=""')
  vi.mocked(fetch).mockResolvedValueOnce(response('scan-b','running',202));await view.click()
  finish(response());await first
  expect(view.html()).toContain(en.generatedWork.running);expect(hooks.refresh).toHaveBeenCalledTimes(1)
})
it.each(['running','error'] as const)('checks a saved %s provider boundary using the same idempotent scan endpoint',async state=>{
  vi.mocked(fetch).mockResolvedValueOnce(response('scan-a','error',409))
  const view=mount(()=>({...baseScan,agent_status:state,results:{...baseScan.results,_agent_generation:{...receipt,state,leaseUntil:'2020-01-01T00:00:00Z'}}}))
  await view.click()
  expect(fetch).toHaveBeenCalledWith('/api/clients/client-a/agents/generate',expect.objectContaining({method:'POST',body:JSON.stringify({scanId:'scan-a'})}))
  expect(view.html()).toContain(en.generatedWork.error);expect(view.html()).not.toContain(en.generatedWork.running)
})
it('only refreshes completed saved work',async()=>{
  const view=mount(()=>({...baseScan,agent_status:'complete',results:{...baseScan.results,_agent_generation:receipt}}))
  await view.click();expect(fetch).not.toHaveBeenCalled();expect(hooks.refresh).toHaveBeenCalledTimes(1)
})
it.each(['pending','running','error',null])('keeps saved output visible under %s',status=>{
  expect(renderToStaticMarkup(<AgentSection status={status} hasOutput>Saved review action</AgentSection>)).toContain('Saved review action')
})
it.each(['en','zh-HK'] as const)('shows honest native section receipts and actual %s translations',locale=>{
  hooks.locale=locale;hooks.cursor=0
  const html=renderToStaticMarkup(ImproveStep({scan:{...baseScan,agent_status:'complete',results:{...baseScan.results,_agent_generation:receipt}},features,recommendations:[recommendation],progress:[],competitors:[]}))
  const copy=(locale==='en'?en:zhHK).generatedWork
  expect(html).toContain('Saved review action');expect(html).toContain(copy.progressUnavailable);expect(html).toContain(copy.competitorsUnavailable);expect(html).toContain(copy.improveDraftNotice)
  expect(html).toContain(copy.websiteDraftsTitle);expect(html).not.toContain('>gpt4o<')
  expect(html).toContain('Review the saved crawler access check.');expect(html).toContain('c1_robots');expect(html).toContain(copy.basisNoExcerpts);expect(html).toContain(copy.basisSinglePage)
  expect(html).toContain('?step=results&amp;scanId=scan-a')
  expect(html).not.toContain('native-improve.v1');expect(html).not.toContain('no-sourced-competitor-evidence')
})
it.each((['en','zh-HK'] as const).flatMap(locale=>['gpt4o','gpt-4o','gemini-flash','perplexity-sonar-pro'].map(platform=>({locale,platform}))))('shows $platform sample denominator and limitations in $locale without attributing improvement',({locale,platform})=>{
  hooks.locale=locale;hooks.cursor=0
  const progress=[{id:'p',scan_id:'scan-a',platform,metric:'observed_mention_rate',current_value:40,previous_value:null,delta:null,created_at:'2026-10-15'}]
  const sampleReceipt={...receipt,outcomes:{...receipt.outcomes,progress:'available'},counts:{...receipt.counts,progress:1},progressSamples:[{platform,week:'2026-10-12',classified:5,mentioned:2}]}
  const html=renderToStaticMarkup(ImproveStep({scan:{...baseScan,agent_status:'complete',results:{...baseScan.results,_agent_generation:sampleReceipt}},features,recommendations:[recommendation],progress,competitors:[]}))
  expect(html).toContain('2 / 5');expect(html).toContain('2026-10-12');expect(html).toContain((locale==='en'?en:zhHK).generatedWork.progressSampleNotice)
  expect(html).not.toContain('+40');expect(html).not.toContain('100%')
})
it('withholds recommendation evidence from a different scan',()=>{
  hooks.cursor=0
  const foreign={...receipt,recommendationBasis:[{...receipt.recommendationBasis[0],action:'FOREIGN ACTION',source:{scanId:'foreign-scan',checkId:'c1_robots'}}]}
  const html=renderToStaticMarkup(ImproveStep({scan:{...baseScan,agent_status:'complete',results:{...baseScan.results,_agent_generation:foreign}},features,recommendations:[recommendation],progress:[],competitors:[]}))
  expect(html).not.toContain('FOREIGN ACTION')
})
it('renders Neon numeric strings at the Improve boundary without toFixed failures',()=>{
  hooks.cursor=0
  const progress=[{id:'progress',scan_id:'scan-a',platform:'gpt4o',metric:'mention_rate',current_value:'12.50',previous_value:null,delta:'1.25',created_at:'2026-10-15'}] as unknown as AgentProgress[]
  const competitors=[{id:'comp',scan_id:'scan-a',platform:'gpt4o',competitor_domain:'comp.example',competitor_name:'Competitor',mention_rate:'20.50',your_rate:'12.50',gap_analysis:'Saved comparison',created_at:'2026-10-15'}] as unknown as AgentCompetitor[]
  const html=renderToStaticMarkup(ImproveStep({scan:{...baseScan,agent_status:'complete'},features,recommendations:[],progress,competitors}))
  expect(html).toContain('+1.3');expect(html).toContain('12.5');expect(html).toContain('Competitor');expect(html).not.toContain('NaN')
})
