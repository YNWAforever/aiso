import {describe,it,expect,vi,afterEach} from 'vitest'
vi.mock('server-only',()=>({}))
const fixture=vi.hoisted(()=>({writes:[] as unknown[][]}))
vi.mock('@/lib/db',()=>{
  const sql=(strings:TemplateStringsArray,...values:unknown[])=>{
    const text=strings.join('?')
    if(text.includes('as classification_attempt_id'))return Promise.resolve([{id:'saved-item',accepted_attempt_id:'saved-provider-attempt',
      classification_fence:1,classification_attempt_id:'analysis-attempt',raw_answer:'Frozen Brand is terrible.',brand:{name:'Frozen Brand',competitors:[]}}])
    if(text.includes('with accepted as')){fixture.writes.push(values);return Promise.resolve([{id:'saved-item'}])}
    return Promise.resolve([])
  }
  Object.assign(sql,{transaction:(queries:Promise<unknown>[])=>Promise.all(queries)})
  return {db:()=>sql}
})
import {classifySavedAnswers} from '@/lib/pulse/runs/classification'
import {coerceAnalysis} from '@/lib/pulse/analysis-fallback'
afterEach(()=>{vi.useRealTimers();fixture.writes.length=0})
describe('saved-answer classification budget',()=>{
  it('records failed before an ignored 45-second classifier can finish; late result cannot write',async()=>{
    vi.useFakeTimers();vi.setSystemTime(0)
    const classifier=vi.fn(async(input:{answer:string;brandName:string})=>new Promise<NonNullable<ReturnType<typeof coerceAnalysis>>>(resolve=>
      setTimeout(()=>resolve(coerceAnalysis({brand_mentioned:true,sentiment:'negative',competitors_mentioned:[]},input.answer,input.brandName)!),45_000)))
    const operation=classifySavedAnswers({accountId:'account',clientId:'client'},'original-run',45_000,classifier)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(await operation).toBe(1)
    expect(classifier).toHaveBeenCalledWith({answer:'Frozen Brand is terrible.',brandName:'Frozen Brand',competitors:[]})
    expect(fixture.writes).toHaveLength(1)
    expect(fixture.writes[0]).toContain('failed')
    expect(fixture.writes[0]).toContain('unknown')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(fixture.writes).toHaveLength(1)
  })
})
