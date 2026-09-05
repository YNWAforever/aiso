import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'
import { beforeEach, expect, it, vi } from 'vitest'
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AlertsTab } from '@/components/pulse/AlertsTab'
const hooks=vi.hoisted(()=>({slots:[] as unknown[],cursor:0,locale:null as null|'en'|'zh-HK',effects:[] as (()=>unknown)[]}))
vi.mock('react',async original=>({...await original<typeof import('react')>(),
 useState(initial:unknown){const i=hooks.cursor++;if(!(i in hooks.slots))hooks.slots[i]=initial;return[hooks.slots[i],(next:unknown)=>{hooks.slots[i]=typeof next==='function'?next(hooks.slots[i]):next}]},
 useRef(initial:unknown){const i=hooks.cursor++;if(!(i in hooks.slots))hooks.slots[i]={current:initial};return hooks.slots[i]},
 useEffect(fn:()=>unknown,deps:unknown[]){const i=hooks.cursor++;const old=hooks.slots[i] as unknown[]|undefined;if(!old||deps.some((v,j)=>v!==old[j])){hooks.effects.push(fn);hooks.slots[i]=deps}},
}))
vi.mock('next-intl',async original=>{
 const actual=await original<typeof import('next-intl')>()
 return {...actual,useTranslations:(namespace:'generatedWork'|'dashboard'|'alertFeedback')=>hooks.locale
  ? actual.createTranslator({locale:hooks.locale,messages:hooks.locale==='en'?en:zhHK,namespace})
  : (key:string)=>key}
})
vi.mock('@/components/ui/button',()=>({Button:(props:object)=><button {...props}/>}))
type Node=ReactElement<{children?:ReactNode;onClick?:()=>Promise<void>}>
function nodes(node:ReactNode):Node[]{return Children.toArray(node).flatMap(n=>isValidElement(n)?[n as Node,...nodes((n as Node).props.children)]:[])}
const config={client_id:'owned',enabled_sov:true,sov_threshold:0,enabled_wow:false,wow_threshold:10,notify_email:true,notify_inapp:true}
function mount(){let clientId='owned';const render=()=>{hooks.cursor=0;return AlertsTab({clientId})};return{setClient(next:string){clientId=next},html:()=>renderToStaticMarkup(render()),async settle(){render();for(const fn of hooks.effects.splice(0))fn();await new Promise(resolve=>setTimeout(resolve,0))},async save(){const n=nodes(render()).find(n=>typeof n.props.onClick==='function'&&renderToStaticMarkup(<>{n.props.children}</>).includes(hooks.locale?(hooks.locale==='en'?en:zhHK).dashboard.alerts_save:'alerts_save'));expect(n).toBeDefined();await n!.props.onClick!()},async retry(){const n=nodes(render()).find(n=>typeof n.props.onClick==='function'&&renderToStaticMarkup(<>{n.props.children}</>).includes(hooks.locale?(hooks.locale==='en'?en:zhHK).alertFeedback.retry:'retry'));expect(n).toBeDefined();await n!.props.onClick!()}}}
beforeEach(()=>{hooks.locale=null;hooks.slots=[];hooks.cursor=0;hooks.effects=[];vi.stubGlobal('fetch',vi.fn())})
const ok=()=>({ok:true,json:async()=>({config})}) as Response
it.each(['http','network','malformed'])('does not claim saved after %s write failure and allows retry',async kind=>{
 vi.mocked(fetch).mockResolvedValueOnce(ok())
 const view=mount();await view.settle()
 if(kind==='network')vi.mocked(fetch).mockRejectedValueOnce(new Error('private'))
 else vi.mocked(fetch).mockResolvedValueOnce({ok:kind!=='http',json:async()=>({})} as Response)
 await view.save();expect(view.html()).toContain('saveFailed');expect(view.html()).not.toContain('alerts_saved');expect(view.html()).not.toContain('private')
 vi.mocked(fetch).mockResolvedValueOnce(ok());await view.save();expect(view.html()).toContain('alerts_saved')
})
it('shows safe failed load and retries instead of rendering no config',async()=>{
 vi.mocked(fetch).mockRejectedValueOnce(new Error('PRIVATE_DATABASE_DETAIL'))
 const view=mount();await view.settle();expect(view.html()).toContain('loadFailed');expect(view.html()).not.toContain('PRIVATE_DATABASE_DETAIL')
 vi.mocked(fetch).mockResolvedValueOnce(ok());await view.retry();await view.settle();expect(view.html()).toContain('alerts_conditions')
})
it('does not accept a missing config as a successful empty render',async()=>{
 vi.mocked(fetch).mockResolvedValueOnce({ok:true,json:async()=>({config:null})} as Response);const view=mount();await view.settle();expect(view.html()).toContain('loadFailed')
})
it('gives threshold inputs accessible labels and switches named checked states',async()=>{
 vi.mocked(fetch).mockResolvedValueOnce(ok());const view=mount();await view.settle();const html=view.html()
 expect(html).toContain('role="switch"');expect(html).toContain('aria-checked="true"');expect(html).toContain('aria-label="alerts_sov_title"');expect(html).toContain('min="0"')
})

it('rejects a config belonging to another client', async () => {
 vi.mocked(fetch).mockResolvedValueOnce({ok:true,json:async()=>({config:{...config,client_id:'foreign'}})} as Response)
 const view=mount();await view.settle();expect(view.html()).toContain('loadFailed')
})
it('prevents duplicate writes and disables changes while saving', async () => {
 vi.mocked(fetch).mockResolvedValueOnce(ok());const view=mount();await view.settle()
 let resolve!: (value:Response)=>void
 vi.mocked(fetch).mockImplementationOnce(()=>new Promise<Response>(done=>{resolve=done}))
 const first=view.save();expect(view.html()).toContain('alerts_saving');expect(view.html()).toContain('disabled=""')
 // A retained click handler can fire twice before React paints the disabled control.
 const pendingNodes=nodes((()=>{hooks.cursor=0;return AlertsTab({clientId:'owned'})})())
 const button=pendingNodes.find(n=>typeof n.props.onClick==='function'&&renderToStaticMarkup(<>{n.props.children}</>).includes('alerts_saving'))!
 await button.props.onClick!();expect(fetch).toHaveBeenCalledTimes(2)
 resolve(ok());await first;expect(view.html()).toContain('alerts_saved')
})

it('exposes retry when switching clients and the new client load fails', async () => {
 vi.mocked(fetch).mockResolvedValueOnce(ok());const view=mount();await view.settle()
 view.setClient('second');vi.mocked(fetch).mockRejectedValueOnce(new Error('private'))
 await view.settle();expect(view.html()).toContain('loadFailed');expect(view.html()).not.toContain('alerts_loading')
 vi.mocked(fetch).mockResolvedValueOnce({ok:true,json:async()=>({config:{...config,client_id:'second'}})} as Response)
 await view.retry();await view.settle();expect(view.html()).toContain('alerts_conditions')
 expect(fetch).toHaveBeenLastCalledWith('/api/dashboard/clients/second/alerts')
})

it.each(['en','zh-HK'] as const)('renders actual %s alert controls and recoverable errors', async locale => {
 hooks.locale=locale
 const copy=locale==='en'?en:zhHK
 vi.mocked(fetch).mockRejectedValueOnce(new Error('PRIVATE FAILURE'))
 const view=mount();await view.settle()
 expect(view.html()).toContain(copy.alertFeedback.loadFailed);expect(view.html()).toContain(copy.alertFeedback.retry)
 vi.mocked(fetch).mockResolvedValueOnce(ok());await view.retry();await view.settle()
 expect(view.html()).toContain(`aria-label="${copy.dashboard.alerts_sov_title}"`)
 expect(view.html()).toContain(copy.dashboard.alerts_email)
 vi.mocked(fetch).mockResolvedValueOnce({ok:false} as Response);await view.save()
 expect(view.html()).toContain(copy.alertFeedback.saveFailed);expect(view.html()).not.toContain(copy.dashboard.alerts_saved)
 expect(view.html()).not.toContain('PRIVATE FAILURE')
})
