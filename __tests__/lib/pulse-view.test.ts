import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks=vi.hoisted(()=>({calls:[] as {text:string;values:unknown[]}[],failure:'',rows:[] as Record<string,unknown>[]}))
vi.mock('server-only',()=>({}))
vi.mock('@/lib/db',()=>({db:()=>async(strings:TemplateStringsArray,...values:unknown[])=>{
 const text=strings.join('?');mocks.calls.push({text,values});if(mocks.failure&&text.includes(mocks.failure))throw new Error('offline')
 if(text.includes('from clients')&&!text.includes('join'))return values.includes('account-a')?[{id:'11111111-1111-4111-8111-111111111111',brand_name:'Acme'}]:[]
 if(text.includes('with recent_weeks'))return mocks.rows
 return []
}}))
import {loadOwnedPulse} from '@/lib/workspace/load-owned-pulse'
import {buildPulseView} from '@/lib/view-models/pulse'
const row=(week:string,platform:string|null=null)=>({scan_week:week,platform,total_queries:2,observed_queries:2,successful_queries:2,observed_brand_mentions:0,brand_mentions:0,sov_score:0,successful_platform_count:1})
const load=()=>loadOwnedPulse({clientId:'11111111-1111-4111-8111-111111111111',profile:{account_id:'account-a'}})
beforeEach(()=>{mocks.calls=[];mocks.failure='';mocks.rows=[]})
describe('owned Pulse observations',()=>{
 it('checks ownership before every other read',async()=>{expect(await loadOwnedPulse({clientId:'11111111-1111-4111-8111-111111111111',profile:{account_id:'foreign'}})).toBeNull();expect(mocks.calls).toHaveLength(1);expect(mocks.calls[0].values).toEqual(['11111111-1111-4111-8111-111111111111','foreign'])})
 it('binds every query to tenant and client without agent/provider/write work',async()=>{await load();expect(mocks.calls).toHaveLength(4);for(const call of mocks.calls){expect(call.values).toContain('11111111-1111-4111-8111-111111111111');expect(call.values).toContain('account-a');expect(call.text).not.toMatch(/\b(insert|update|delete)\b|agent_/i)}})
 it('fails authoritative ownership closed and optional observations independently',async()=>{mocks.failure='from clients';await expect(load()).rejects.toThrow();mocks.failure='with recent_weeks';expect(buildPulseView((await load())!).observations.state).toBe('error')})
 it('retains genuine zero but invalid denominator becomes a gap',async()=>{mocks.rows=[row('2026-08-03'),{...row('2026-08-10'),successful_queries:0},row('2026-08-17')];const dto=buildPulseView((await load())!);expect(dto.observations.series[0].points.map(p=>p.sov)).toEqual([0,null,0])})
 it('fills wholly missing weeks with gaps and keeps per-platform validity independent',async()=>{mocks.rows=[row('2026-08-03'),row('2026-08-17'),row('2026-08-03','gemini'),{...row('2026-08-17','gemini'),observed_brand_mentions:1}];const dto=buildPulseView((await load())!);expect(dto.observations.series.find(s=>s.platform==='gemini')?.points.map(p=>p.sov)).toEqual([0,null,null]);expect(dto.observations.series[0].points.map(p=>p.sov)).toEqual([0,null,0])})
 it('latest raw-only week is unavailable and raw answers never enter DTO',async()=>{mocks.rows=[row('2026-08-03'),{scan_week:'2026-08-10',platform:null,total_queries:null,raw_answer:'SECRET'}];const dto=buildPulseView((await load())!);expect(dto.observations.latestKpi).toBeNull();expect(dto.observations.latestWeek).toBe('2026-08-10');expect(JSON.stringify(dto)).not.toContain('SECRET')})
 it('bounds chart expansion to forty weeks',async()=>{mocks.rows=[row('2020-08-03'),row('2026-08-03')];expect(buildPulseView((await load())!).observations.series[0].points.length).toBeLessThanOrEqual(40)})
})

it('rejects malformed identifiers without querying',async()=>{expect(await loadOwnedPulse({clientId:'not-a-uuid',profile:{account_id:'account-a'}})).toBeNull();expect(mocks.calls).toHaveLength(0)})
