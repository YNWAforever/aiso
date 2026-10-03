import {describe,it,expect} from 'vitest'
import {buildDailyWorkSummary} from '@/lib/view-models/daily-work'
import type {MaintenanceSnapshot} from '@/lib/workspace/maintenance'
const snapshot=(overrides:Partial<MaintenanceSnapshot>={}):MaintenanceSnapshot=>({eligible:true,ledgerEnabled:true,runRead:'ok',sourceRead:'ok',draftRead:'ok',latestRun:null,lastCompleteAt:null,awaitingSource:null,latestDraftId:null,...overrides})
describe('daily work uses complete recorded counts without inventing scheduling evidence',()=>{
 it('distinguishes Free empty state, unavailable ledger and unknown paid schedule',()=>{
  expect(buildDailyWorkSummary(snapshot({eligible:false})).state).toBe('not_configured')
  expect(buildDailyWorkSummary(snapshot()).state).toBe('unknown')
  expect(buildDailyWorkSummary(null)).toMatchObject({state:'unknown',coverage:null,nextDueAt:null,partialReads:true})
 })
 it('does not count collected unknown classifications as complete',()=>{
  const result=buildDailyWorkSummary(snapshot({latestRun:{id:'run',week:'2026-09-28',expected:15,succeeded:15,failed:0,pending:0,blocked:0,classified:13,mentioned:1}}))
  expect(result).toMatchObject({state:'partial',nextDueAt:null})
  expect(result.nextActions[0]).toMatchObject({kind:'review-classification'})
 })
 it('keeps confirmed exact-version and draft actions when the run read fails',()=>{
  const result=buildDailyWorkSummary(snapshot({runRead:'error',awaitingSource:{id:'source',versionId:'v1'},latestDraftId:'draft'}))
  expect(result).toMatchObject({state:'unknown',partialReads:true})
  expect(result.nextActions.map(a=>a.kind)).toEqual(['review-source','open-draft'])
  expect(result.nextActions[0].path).toContain('version=v1')
 })
 it('rejects inconsistent denominators and caps actions at three',()=>{
  const result=buildDailyWorkSummary(snapshot({latestRun:{id:'run',week:'2026-09-28',expected:15,succeeded:13,failed:0,pending:0,blocked:0,classified:12,mentioned:0},awaitingSource:{id:'s',versionId:'v'},latestDraftId:'d'}))
  expect(result.coverage).toBeNull();expect(result.state).toBe('unknown');expect(result.nextActions.length).toBeLessThanOrEqual(3)
 })
})
