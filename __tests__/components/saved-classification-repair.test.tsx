import {beforeEach,it,expect,vi} from 'vitest'
import {Children,isValidElement,type ReactElement,type ReactNode} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {RunProgress} from '@/components/pulse/RunProgress'
const hooks=vi.hoisted(()=>({slots:[] as unknown[],cursor:0}))
vi.mock('react',async original=>({...await original<typeof import('react')>(),
 useState(initial:unknown){const i=hooks.cursor++;if(!(i in hooks.slots))hooks.slots[i]=initial;return[hooks.slots[i],(next:unknown)=>{hooks.slots[i]=typeof next==='function'?next(hooks.slots[i]):next}]},
 useRef(initial:unknown){const i=hooks.cursor++;if(!(i in hooks.slots))hooks.slots[i]={current:initial};return hooks.slots[i]},useEffect:()=>undefined,
}))
type Element=ReactElement<{children?:ReactNode;onClick?:()=>Promise<void>;disabled?:boolean}>
const nodes=(node:ReactNode):Element[]=>Children.toArray(node).flatMap(n=>isValidElement(n)?[n as Element,...nodes((n as Element).props.children)]:[])
const runId='11111111-1111-4111-8111-111111111111',observation='22222222-2222-4222-8222-222222222222'
beforeEach(()=>{
 hooks.cursor=0;hooks.slots=[{prompts:8,variants:5,expected:40,remaining:1460,enabled:false,week:'2026-10-12',search:{requested:'off'},currentCanonicalId:runId,legacyObservationIds:[],availability:{action:'view_existing',canStart:false,reasons:[]}},
 {id:runId,week:'2026-10-12',purpose:'canonical',retryable:false,reasons:['classification_pending'],classificationRepairIds:[observation],coverage:{expected:40,succeeded:40,classified:32,status:'partial'}}]
 const storage=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v),removeItem:(k:string)=>storage.delete(k)})
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({classified:1,unchanged:0,failed:0})})))
})
it('offers only saved classification repair while collection is paused and submits the same run evidence once',async()=>{
 const render=()=>{hooks.cursor=0;return RunProgress({clientId:runId,lang:'en'})}
 const view=render();const repair=nodes(view).find(n=>n.type==='button'&&String(n.props.children)==='Repair saved classifications')
 expect(repair).toBeDefined();expect(repair?.props.disabled).toBeFalsy()
 const html=renderToStaticMarkup(view);expect(html).toContain('40/40');expect(html).not.toContain('Start monitoring')
 const pending=repair!.props.onClick!();await repair!.props.onClick!();await pending
 expect(fetch).toHaveBeenCalledTimes(1)
 const [url,options]=vi.mocked(fetch).mock.calls[0] as unknown as [string,{body:string}]
 expect(url).toBe(`/api/dashboard/clients/${runId}/pulse-runs/legacy-repair`)
 expect(JSON.parse(options.body)).toMatchObject({runId,observationIds:[observation]})
})
