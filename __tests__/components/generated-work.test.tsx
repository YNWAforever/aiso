import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'
import { beforeEach, expect, it, vi } from 'vitest'
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { FixPackClient } from '@/components/FixPackClient'
import { FixPackBlock } from '@/components/FixPackBlock'
import { AgentSection } from '@/components/dashboard/AgentSection'
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, locale: null as null | 'en' | 'zh-HK' }))
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState(initial: unknown) { const i=hooks.cursor++; if(!(i in hooks.slots))hooks.slots[i]=initial; return [hooks.slots[i],(next:unknown)=>{hooks.slots[i]=typeof next==='function'?next(hooks.slots[i]):next}] },
  useRef(initial:unknown) { const i=hooks.cursor++; if(!(i in hooks.slots))hooks.slots[i]={current:initial}; return hooks.slots[i] },
  useEffect:()=>undefined,
}))
vi.mock('next-intl',async original=>{
 const actual=await original<typeof import('next-intl')>()
 return {...actual,useTranslations:(namespace:'generatedWork'|'dashboard'|'alertFeedback')=>hooks.locale
  ? actual.createTranslator({locale:hooks.locale,messages:hooks.locale==='en'?en:zhHK,namespace})
  : (key:string)=>key}
})
type Element=ReactElement<{children?:ReactNode;onClick?:()=>Promise<void>}>
function nodes(node:ReactNode):Element[]{return Children.toArray(node).flatMap(n=>isValidElement(n)?[n as Element,...nodes((n as Element).props.children)]:[])}
function mount(component:()=>ReactElement){
 const render=()=>{hooks.cursor=0;return component()}
 return {html:()=>renderToStaticMarkup(render()),click:async()=>{const button=nodes(render()).find(n=>n.type==='button');expect(button).toBeDefined();await button!.props.onClick!()}}
}
const props={scanId:'owned-scan',fixCta:'Generate',fixSubtitle:'Create files',copyLabel:'Copy',copiedLabel:'Copied'}
const pack={llms_txt:'draft llms',robots_patch:'draft robots',faq_schema:'draft faq'}
beforeEach(()=>{hooks.locale=null;hooks.slots=[];hooks.cursor=0;vi.stubGlobal('fetch',vi.fn());vi.stubGlobal('navigator',{clipboard:{writeText:vi.fn()}})})
it.each([401,404,500])('does not display failed HTTP%s as generated work and offers retry',async status=>{
 vi.mocked(fetch).mockResolvedValue({ok:false,status,json:async()=>({error:'PRIVATE ERROR'})} as Response)
 const view=mount(()=>FixPackClient(props));await view.click()
 expect(view.html()).toContain('generationFailed');expect(view.html()).toContain('retry');expect(view.html()).not.toContain('PRIVATE ERROR');expect(view.html()).not.toContain('<pre')
})
it.each(['network','json','malformed'])('recovers from %s failure rather than sticking pending',async failure=>{
 if(failure==='network')vi.mocked(fetch).mockRejectedValue(new Error('offline'))
 else vi.mocked(fetch).mockResolvedValue({ok:true,json:async()=>{if(failure==='json')throw new Error('invalid');return {llms_txt:4}}} as Response)
 const view=mount(()=>FixPackClient(props));await view.click()
 expect(view.html()).toContain('generationFailed');expect(view.html()).not.toContain('disabled=""')
 vi.mocked(fetch).mockResolvedValue({ok:true,json:async()=>pack} as Response);await view.click()
 expect(view.html()).toContain('draftNotice');expect(view.html()).toContain('draft llms')
 expect(fetch).toHaveBeenLastCalledWith('/api/fix',expect.objectContaining({body:JSON.stringify({scanId:'owned-scan'})}))
})
it('shows pending state and prevents duplicate generation until completed',async()=>{
 let finish!:(response:Response)=>void;vi.mocked(fetch).mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
 const view=mount(()=>FixPackClient(props));const pending=view.click()
 expect(view.html()).toContain('generating');expect(view.html()).toContain('disabled=""');await view.click();expect(fetch).toHaveBeenCalledTimes(1)
 finish({ok:true,json:async()=>pack} as Response);await pending;expect(view.html()).toContain('draftNotice')
})
it('reports failed clipboard writes without copied success, then permits retry',async()=>{
 vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('denied')).mockResolvedValueOnce()
 const view=mount(()=>FixPackBlock({title:'llms.txt',content:'draft',copyLabel:'Copy',copiedLabel:'Copied'}));await view.click()
 expect(view.html()).toContain('copyFailed');expect(view.html()).not.toContain('Copied');await view.click();expect(view.html()).toContain('Copied')
})
it.each([null,'unknown'])('makes unavailable agent state %s explicit without revealing children',status=>{
 const html=renderToStaticMarkup(<AgentSection status={status}>PRIVATE CHILDREN</AgentSection>);expect(html).toContain('unavailable');expect(html).not.toContain('PRIVATE CHILDREN')
})
it.each(['pending','running'])('describes %s without claiming any provider is running',status=>{
 const html=renderToStaticMarkup(<AgentSection status={status}>PRIVATE CHILDREN</AgentSection>);expect(html).toContain(status);expect(html).not.toMatch(/GPT-4o|Claude|Gemini|Sonar|PRIVATE CHILDREN/)
})
it('labels completed agent output as generated suggestions',()=>{expect(renderToStaticMarkup(<AgentSection status="complete">Suggestions</AgentSection>)).toContain('draftNotice')})

it('isolates pending and completed generated work when the scan changes', async () => {
 let finish!:(response:Response)=>void
 vi.mocked(fetch).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
 let scanId='scan-a';const view=mount(()=>FixPackClient({...props,scanId}))
 const first=view.click();scanId='scan-b'
 expect(view.html()).not.toContain('generating');expect(view.html()).not.toContain('draft llms')
 vi.mocked(fetch).mockResolvedValueOnce({ok:true,json:async()=>({...pack,llms_txt:'scan B draft'})} as Response)
 await view.click();expect(view.html()).toContain('scan B draft')
 finish({ok:true,json:async()=>pack} as Response);await first
 expect(view.html()).toContain('scan B draft');expect(view.html()).not.toContain('draft llms')
 scanId='scan-c';expect(view.html()).not.toContain('scan B draft');expect(view.html()).toContain('Generate')
})

it.each(['en','zh-HK'] as const)('renders actual %s draft and failure copy', async locale => {
 hooks.locale=locale
 const copy=(locale==='en'?en:zhHK).generatedWork
 const view=mount(()=>FixPackClient({...props,fixCta:copy.packCta,fixSubtitle:copy.draftNotice}))
 vi.mocked(fetch).mockRejectedValueOnce(new Error('PRIVATE FAILURE'))
 await view.click();expect(view.html()).toContain(copy.generationFailed);expect(view.html()).toContain(copy.retry)
 vi.mocked(fetch).mockResolvedValueOnce({ok:true,json:async()=>pack} as Response)
 await view.click();expect(view.html()).toContain(copy.draftNotice);expect(view.html()).toContain(copy.storageNotice)
 expect(view.html()).not.toContain('PRIVATE FAILURE')
 hooks.slots=[]
 const block=mount(()=>FixPackBlock({title:'llms.txt',content:'draft',copyLabel:'Copy',copiedLabel:'Copied'}))
 vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('denied'))
 await block.click();expect(block.html()).toContain(copy.copyFailed)
 expect(renderToStaticMarkup(<AgentSection status={null}>Hidden</AgentSection>)).toContain(copy.unavailable)
})
