import { describe,expect,it } from 'vitest'
import { parseEnterpriseKey,parsePortalConfig,parseExecutiveSchedule,parseEnterpriseRole,parseAdapterConfig,parseAdapterObservation } from '@/lib/enterprise/input'
const id='11000000-0000-4000-8000-000000000001'
describe('enterprise bounded contracts',()=>{
 it('accepts reversible portal branding without a customer account selector',()=>{
  expect(parsePortalConfig({name:'Client portal',companyName:'Agency',primaryColor:'#aabbcc',logoUrl:null,locale:'zh-HK'})).toMatchObject({companyName:'Agency',primaryColor:'#AABBCC',locale:'zh-HK'})
  expect(()=>parsePortalConfig({name:'Portal',companyName:'Agency',primaryColor:'#ffffff',logoUrl:'javascript:alert(1)',locale:'en'})).toThrow()
 })
 it('restricts executive schedules to explicit UTC cadences and member identities',()=>{
  expect(parseExecutiveSchedule({name:'Weekly',cadence:'weekly',locale:'en',recipientIds:[id],enabled:true})).toMatchObject({cadence:'weekly',recipientIds:[id]})
  expect(()=>parseExecutiveSchedule({name:'Daily',cadence:'hourly',locale:'en',recipientIds:['ceo@example.com'],enabled:true})).toThrow()
 })
 it('requires explicit limited public API scopes and an adapter binding for writes',()=>{
  expect(parseEnterpriseKey({name:'Read integration',scopes:['outcomes:read'],adapterId:null})).toMatchObject({scopes:['outcomes:read']})
  expect(()=>parseEnterpriseKey({name:'Unbound write',scopes:['adapter:write'],adapterId:null})).toThrow()
  expect(()=>parseEnterpriseKey({name:'Admin',scopes:['*'],adapterId:null,accountId:id})).toThrow()
 })
 it('cannot grant an owner or approver through enterprise roles',()=>{
  expect(parseEnterpriseRole({profileId:id,role:'manager',expectedRevision:0,requestId:id,reason:'Approved workspace administration'})).toMatchObject({role:'manager'})
  for(const role of ['owner','approver','platform_admin'])expect(()=>parseEnterpriseRole({profileId:id,role,expectedRevision:0,requestId:id,reason:'Requested'})).toThrow()
 })
 it('registers metadata contracts without accepting executable adapter code or unsafe fetch URLs',()=>{
  expect(parseAdapterConfig({name:'Own connector',model:'custom/model-v1',temperature:0.2})).toMatchObject({model:'custom/model-v1',temperature:0.2})
  expect(()=>parseAdapterConfig({name:'Unsafe',model:'custom/model',temperature:0.2,script:'process.env.SECRET'})).toThrow()
 })
 it('bounds connector answers and timestamps while retaining multiline evidence',()=>{
  const input={eventId:id,runId:id,promptId:id,observedAt:new Date().toISOString(),actualModel:'custom/model',answer:'A retained\nanswer',citations:[{url:'https://example.com/a'}]}
  expect(parseAdapterObservation(input).answer).toContain('\n')
  expect(parseAdapterObservation({...input,citations:null}).citations).toBeNull()
  expect(()=>parseAdapterObservation({...input,answer:'x'.repeat(6001)})).toThrow()
  expect(()=>parseAdapterObservation({...input,observedAt:'not-a-date'})).toThrow()
 })
})
