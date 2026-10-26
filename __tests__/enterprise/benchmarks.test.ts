import { describe,expect,it } from 'vitest'
import { buildMarketBenchmarks } from '@/lib/enterprise/benchmarks'
const row={question:'Which service?',locale:'en',market:'HK',model:'model',sampling:{temperature:0.2,samplesPerRun:1,seed:null},context:{persona:'Buyer',intent:'comparison'},provenance:'connector_reported',citations:['https://example.com/a'],domain:'example.com',observedAt:'2026-10-26T00:00:00Z'}
describe('private context-compatible market benchmarks',()=>{
 it('compares markets within compatible question/model/context/provenance cohorts',()=>{const report=buildMarketBenchmarks([row,{...row,market:'SG',citations:['https://other.example/a']}]);expect(report.scope).toBe('within_account');expect(report.cohorts).toHaveLength(1);expect(report.cohorts[0].markets).toEqual(expect.arrayContaining([expect.objectContaining({market:'HK',citationShare:1}),expect.objectContaining({market:'SG',citationShare:0})]))})
 it('stratifies incompatible model/locale/context/sampling rather than calculating a shared delta',()=>{expect(buildMarketBenchmarks([row,{...row,market:'SG',model:'changed'},{...row,market:'US',locale:'zh-HK'}]).cohorts).toHaveLength(3)})
 it('keeps unknown citation collection distinct from a confirmed empty result',()=>{expect(buildMarketBenchmarks([{...row,citations:null}]).cohorts[0].markets[0]).toMatchObject({citationSamples:0,citationShare:null});expect(buildMarketBenchmarks([{...row,citations:[]}]).cohorts[0].markets[0]).toMatchObject({citationSamples:1,citationShare:0})})
 it('marks missing provenance/model/context as excluded unknown evidence',()=>{expect(buildMarketBenchmarks([{...row,model:null},{...row,provenance:null}])).toMatchObject({excluded:2,cohorts:[]})})
})
