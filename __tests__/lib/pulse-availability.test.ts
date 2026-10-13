import{describe,it,expect}from'vitest'
import{derivePulseAvailability,type PulseAvailabilityInput}from'@/lib/pulse/runs/availability'
const base:PulseAvailabilityInput={enabled:true,variants:5,prompts:2,contextConfirmed:true,remaining:10,expected:10,currentCanonicalId:null,legacyCurrentWeek:false}
describe('T31 Pulse availability',()=>{
 it('permits only a complete available workload',()=>expect(derivePulseAvailability(base)).toEqual({canStart:true,reasons:[],action:'start'}))
 it.each([['paused',{enabled:false},'wait'],['no_models',{variants:0,expected:0},'wait'],['no_prompts',{prompts:0,expected:0},'edit_prompts'],['context_missing',{contextConfirmed:false},'edit_prompts'],['quota_exceeded',{remaining:9},'wait'],['existing_run',{currentCanonicalId:'saved'},'view_existing'],['legacy_review_required',{legacyCurrentWeek:true},'view_existing']] as const)('%s blocks start with an effective next action',(reason,patch,action)=>expect(derivePulseAvailability({...base,...patch})).toEqual({canStart:false,reasons:[reason],action}))
 it('keeps all reasons with existing evidence first',()=>expect(derivePulseAvailability({...base,enabled:false,variants:0,prompts:0,contextConfirmed:false,remaining:0,currentCanonicalId:'saved',legacyCurrentWeek:true})).toEqual({canStart:false,reasons:['paused','no_models','no_prompts','context_missing','quota_exceeded','existing_run','legacy_review_required'],action:'view_existing'}))
 it('missing context takes precedence over paused/quota',()=>expect(derivePulseAvailability({...base,enabled:false,contextConfirmed:false,remaining:0})).toMatchObject({canStart:false,action:'edit_prompts'}))
})
