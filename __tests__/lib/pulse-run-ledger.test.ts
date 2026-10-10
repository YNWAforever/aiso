import {describe,it,expect} from 'vitest'
import {coverageFromCounts} from '@/lib/pulse/runs/schema'
import {modelVariantsFor,PLATFORM_KEYS} from '@/lib/openrouter'
import {projectObservedSummary} from '@/lib/pulse/observed-summary'
const counts = {expected:15,succeeded:0,failed:0,pending:15,blocked:0,classified:0,mentioned:0}
describe('T05 fixed Pulse denominators',()=>{
  it('freezes five actual API model variants per question',()=>{
    const variants=modelVariantsFor(PLATFORM_KEYS)
    expect(variants).toHaveLength(5)
    expect(new Set(variants.map(v=>v.model)).size).toBe(5)
    expect(variants.every(v=>v.model.includes('/'))).toBe(true)
  })
  it('counts five first-question failures and ten remaining items',()=>{
    expect(coverageFromCounts({...counts,failed:5,pending:10})).toMatchObject({expected:15,coverage:0,status:'partial',mentionRate:null})
  })
  it('does not present one successful answer as a complete fifteen-item run',()=>{
    expect(coverageFromCounts({...counts,succeeded:1,pending:14,classified:1,mentioned:1})).toMatchObject({status:'partial',coverage:1/15,mentionRate:1})
  })
  it('only completes a positive, wholly successful denominator',()=>{
    expect(coverageFromCounts({...counts,succeeded:15,pending:0}).status).toBe('completed')
    expect(coverageFromCounts({...counts,expected:0,pending:0})).toMatchObject({status:'blocked',coverage:null,mentionRate:null})
  })
  it('keeps blocked work and unknown classifications outside classified ratios',()=>{
    expect(coverageFromCounts({...counts,blocked:15,pending:0})).toMatchObject({status:'blocked',classified:0,mentionRate:null})
  })
  it('rejects missing failures and invalid classified denominators',()=>{
    expect(()=>coverageFromCounts({...counts,pending:14})).toThrow()
    expect(()=>coverageFromCounts({...counts,classified:1})).toThrow()
  })
  it('suppresses a 100-percent KPI from one success in a fifteen-item manifest',()=>{
    const result=projectObservedSummary([{platform:null,scan_week:'2026-09-28',total_queries:1,successful_queries:1,observed_queries:1,
      brand_mentions:1,observed_brand_mentions:1,sov_score:100,successful_platform_count:1,
      expected_items:15,succeeded_items:1,classified_items:1,pending_items:14,failed_items:0,blocked_items:0}])
    expect(result.kpi).toBeNull()
    expect(result.coverage).toMatchObject({expected:15,succeeded:1,pending:14})
  })
})
