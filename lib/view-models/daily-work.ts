import { coverageFromCounts,type RunCoverage } from '@/lib/pulse/runs/schema'
import type { MaintenanceSnapshot } from '@/lib/workspace/maintenance'
export type DailyWorkAction={kind:'review-failed-run'|'review-pending-run'|'review-classification'|'review-source'|'open-draft'|'review-opportunities';path:string}
export type DailyWorkSummary={coverage:RunCoverage|null;lastCompleteAt:string|null;nextDueAt:null;state:'not_configured'|'pending'|'partial'|'complete'|'failed'|'disabled'|'unknown';nextActions:DailyWorkAction[];partialReads:boolean}
export function buildDailyWorkSummary(snapshot:MaintenanceSnapshot|null):DailyWorkSummary{
 const nextActions:DailyWorkAction[]=[]
 let coverage:RunCoverage|null=null,state:DailyWorkSummary['state']='unknown'
 if(snapshot?.runRead==='ok'){
  if(snapshot.latestRun){
   const run=snapshot.latestRun
   try{coverage=coverageFromCounts(run)}catch{coverage=null}
   if(coverage&&coverage.expected){
    state=coverage.status==='completed'?(coverage.classified===coverage.expected?'complete':'partial'):coverage.status==='failed'?'failed':coverage.status==='queued'||coverage.status==='running'?'pending':'partial'
    const query=new URLSearchParams({week:run.week,run:run.id})
    if(coverage.failed||coverage.blocked){query.set('runStatus','failed');nextActions.push({kind:'review-failed-run',path:`/observations?${query}#run-status`})}
    else if(coverage.pending){query.set('runStatus','pending');nextActions.push({kind:'review-pending-run',path:`/observations?${query}#run-status`})}
    else if(coverage.classified<coverage.succeeded){query.set('runStatus','unclassified');nextActions.push({kind:'review-classification',path:`/observations?${query}#run-status`})}
   }else if(coverage)state='not_configured'
  }else if(!snapshot.eligible)state='not_configured'
 }
 if(snapshot?.awaitingSource){const query=new URLSearchParams({source:snapshot.awaitingSource.id,version:snapshot.awaitingSource.versionId});nextActions.push({kind:'review-source',path:`/sources?${query}#source-review`})}
 if(snapshot?.latestDraftId)nextActions.push({kind:'open-draft',path:`/opportunities?draft=${encodeURIComponent(snapshot.latestDraftId)}`})
 if(state==='complete'&&nextActions.length<3)nextActions.push({kind:'review-opportunities',path:'/opportunities'})
 return{coverage,state,lastCompleteAt:snapshot?.lastCompleteAt??null,nextDueAt:null,nextActions:nextActions.slice(0,3),partialReads:!snapshot||[snapshot.runRead,snapshot.sourceRead,snapshot.draftRead].includes('error')}
}
