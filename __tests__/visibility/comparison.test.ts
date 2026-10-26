import { describe,expect,it } from 'vitest'
import { compareVisibilityRuns } from '@/lib/visibility/comparison'
import { projectVisibilityObservation } from '@/lib/visibility/report'
const snapshot={question:'Which service?',language:'en',market:'HK',contextVersion:'2026-10-26.v1',monitoring:{sampling:{temperature:0.2,samplesPerRun:1,seed:null}}}
const row={id:'before',prompt_id:'query',platform:'gpt-4o',requested_model:'model',actual_model:'model',finished_at:'2026-10-25T00:00:00Z',snapshot,classification_status:'classified',classification:{brandMentioned:false},provider_citations:[]}
const before=projectVisibilityObservation({...row,run_id:'run1'},{domain:'example.com',competitors:[]})
const after=projectVisibilityObservation({...row,id:'after',run_id:'run2',finished_at:'2026-10-26T00:00:00Z',classification:{brandMentioned:true}},{domain:'example.com',competitors:[]})
const manifest={items:[{...snapshot,promptId:'query',platform:'gpt-4o',model:'model'}]}
describe('closed-loop before/after comparability',()=>{
 it('compares frozen context and complete accepted samples with a known unchanged model',()=>{
  expect(compareVisibilityRuns({manifest,observations:[before]},{manifest,observations:[after]})).toMatchObject({comparable:true,delta:{answerPresence:1},claim:'observed_difference_only'})
 })
 it.each(['coverage','model','context','sampling'])('refuses misleading deltas after %s changes',change=>{
  const b={manifest,observations:[before]},a={manifest,observations:[after]}
  if(change==='coverage')a.observations=[]
  if(change==='model')a.observations=[{...after,model:'other'}]
  if(change==='context')a.manifest={items:[{...manifest.items[0],market:'US'}]}
  if(change==='sampling')a.observations=[{...after,monitoring:{}}]
  expect(compareVisibilityRuns(b,a)).toMatchObject({comparable:false,delta:{answerPresence:null,citationShare:null}})
 })
})
