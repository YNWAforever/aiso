import {describe,it,expect} from 'vitest'
import {projectPrimaryNextStep} from '@/lib/view-models/primary-next-step'
describe('owned primary next step',()=>{
 it('uses the actual prompt route before starting',()=>{expect(projectPrimaryNextStep({lang:'en',clientId:'c',setup:{active:0,contextConfirmed:false},daily:null}).href).toBe('/en/dashboard/c/prompts')})
 it('starts configured brands and keeps partial runs repairable',()=>{
 const input={lang:'en',clientId:'c',setup:{active:3,contextConfirmed:true},daily:null,availability:{canStart:true,reasons:[],action:'start' as const}}
 expect(projectPrimaryNextStep(input).kind).toBe('start_run')
 expect(projectPrimaryNextStep({...input,daily:{state:'partial'} as never}).href).toBe('/en/dashboard/c/observations?result=incomplete')
 expect(projectPrimaryNextStep({...input,daily:{state:'complete'} as never}).kind).toBe('review_results')
 })
 it('does not equate a setup outage with zero prompts',()=>{expect(projectPrimaryNextStep({lang:'en',clientId:'c',setup:null,daily:null}).reasonKey).toBe('unknown')})
})

describe('T33 primary action from confirmed monitoring and work state',()=>{
 const base={lang:'en',clientId:'owned',setup:{active:2,contextConfirmed:true},daily:null}
 const available={canStart:true,reasons:[],action:'start' as const}
 it('unknown monitoring never presents start',()=>expect(projectPrimaryNextStep(base)).toMatchObject({kind:'monitoring_status',labelKey:'status',reasonKey:'unknown'}))
 it('setup read failure has an unknown status action',()=>expect(projectPrimaryNextStep({...base,setup:null,availability:available})).toMatchObject({kind:'monitoring_status',reasonKey:'unknown'}))
 it('paused state remains a status while available state navigates to confirmation',()=>{expect(projectPrimaryNextStep({...base,availability:{canStart:false,reasons:['paused'],action:'wait'}})).toMatchObject({kind:'monitoring_status',reasonKey:'paused'});expect(projectPrimaryNextStep({...base,availability:available})).toMatchObject({kind:'start_run',labelKey:'start'})})
 it('pending run goes to saved progress ahead of work',()=>expect(projectPrimaryNextStep({...base,daily:{state:'pending',nextActions:[{kind:'review-pending-run',path:'/observations?run=saved#run-status'},{kind:'open-draft',path:'/opportunities?draft=private'}]} as never})).toMatchObject({kind:'review_run',href:'/en/dashboard/owned/observations?run=saved#run-status'}))
 it('partial evidence never becomes empty or new collection',()=>expect(projectPrimaryNextStep({...base,daily:{state:'partial',nextActions:[{kind:'review-classification',path:'/observations?run=saved&runStatus=unclassified'}]} as never,availability:available})).toMatchObject({kind:'review_run',href:'/en/dashboard/owned/observations?run=saved&runStatus=unclassified'}))
 it.each(['review-source','open-draft'])('saved %s work precedes complete results',kind=>expect(projectPrimaryNextStep({...base,daily:{state:'complete',nextActions:[{kind,path:kind==='review-source'?'/sources?source=s&version=v':'/opportunities?draft=d'}]} as never})).toMatchObject({kind:'review_work',labelKey:'work'}))
 it('cannot create an external or cross-client work link',()=>expect(projectPrimaryNextStep({...base,daily:{state:'complete',nextActions:[{kind:'open-draft',path:'//foreign.example/p'}]} as never})).toMatchObject({kind:'review_results',href:'/en/dashboard/owned/observations'}))
})
