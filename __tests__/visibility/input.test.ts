import { describe, expect, it } from 'vitest'
import { parseMonitoredQuery, parseVisibilityReview } from '@/lib/visibility/input'
const input = { promptId:'11000000-0000-4000-8000-000000000001',locale:'en',market:'HK',persona:'Buyer',intent:'comparison',funnel:'consideration',topic:'Services',targetUrl:'https://example.com/service',priority:3,branded:false,expectedAttributes:['Availability','Evidence'],competitorIds:[] }
describe('monitored query context and review contracts', () => {
  it('keeps all measurement context explicit and sampling fixed', () => {
    expect(parseMonitoredQuery(input,'example.com')).toMatchObject({ ...input,sampling:{temperature:0.2,samplesPerRun:1,seed:null,version:'visibility-sampling.v1'} })
  })
  it.each([{locale:'fr'},{market:'XX'},{intent:'anything'},{priority:0},{targetUrl:'https://foreign.example/a'},{expectedAttributes:['x'.repeat(201)]},{accountId:'foreign'}])('refuses invalid context %j', change => {
    expect(()=>parseMonitoredQuery({...input,...change},'example.com')).toThrow()
  })
  it('does not permit browser-supplied measurement or invented review enums', () => {
    expect(()=>parseVisibilityReview({observationId:input.promptId,recommendation:'recommended',accuracy:'accurate',risk:'low',notes:'Checked against source page'})).not.toThrow()
    expect(()=>parseVisibilityReview({observationId:input.promptId,recommendation:'guaranteed',accuracy:'accurate',risk:'low',notes:'x'})).toThrow()
  })
})
