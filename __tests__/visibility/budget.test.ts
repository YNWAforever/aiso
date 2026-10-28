import { describe,expect,it } from 'vitest'
import { boundVisibilityResponse } from '@/lib/visibility/budget'
import { projectVisibilityObservation,buildVisibilityReport } from '@/lib/visibility/report'
describe('bounded visibility wire evidence',()=>{
 it('reduces the oldest evidence, updates measurement denominators and marks limits without mutating the source',()=>{
  const newest=projectVisibilityObservation({id:'new',raw_answer:'x'.repeat(2000),snapshot:{},classification_status:'classified',classification:{brandMentioned:true},provider_citations:[]},{domain:'example.com',competitors:[]})
  const oldest={...newest,id:'old',answerPresence:false}
  const source={observations:[newest,oldest],report:buildVisibilityReport([newest,oldest]),drafts:[],jobs:[],coverage:{limitReached:false}}
  const oneSize=Buffer.byteLength(JSON.stringify({...source,observations:[newest],report:buildVisibilityReport([newest]),coverage:{limitReached:true,responseLimited:true}}))
  const bounded=boundVisibilityResponse(source,oneSize+10)
  expect(bounded.observations.map(row=>row.id)).toEqual(['new'])
  expect(bounded.report.answerPresence).toBe(1)
  expect(bounded.coverage).toMatchObject({limitReached:true,responseLimited:true})
  expect(source.observations).toHaveLength(2);expect(source.report.answerPresence).toBe(0.5)
 })
})
