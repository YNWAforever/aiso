import {describe,it,expect} from 'vitest'
import {projectPrimaryNextStep} from '@/lib/view-models/primary-next-step'
describe('owned primary next step',()=>{
 it('uses the actual prompt route before starting',()=>{expect(projectPrimaryNextStep({lang:'en',clientId:'c',setup:{active:0,contextConfirmed:false},daily:null}).href).toBe('/en/dashboard/c/prompts')})
 it('starts configured brands and keeps partial runs repairable',()=>{
 const input={lang:'en',clientId:'c',setup:{active:3,contextConfirmed:true},daily:null}
 expect(projectPrimaryNextStep(input).kind).toBe('start_run')
 expect(projectPrimaryNextStep({...input,daily:{state:'partial'} as never}).href).toBe('/en/dashboard/c?step=monitor#first-monitoring')
 expect(projectPrimaryNextStep({...input,daily:{state:'complete'} as never}).kind).toBe('review_results')
 })
 it('does not equate a setup outage with zero prompts',()=>{expect(projectPrimaryNextStep({lang:'en',clientId:'c',setup:null,daily:null}).reasonKey).toBe('unknown')})
})
