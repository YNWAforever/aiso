import type {DailyWorkSummary} from './daily-work'
import type {PulseAvailability,PulseBlockReason} from '@/lib/pulse/runs/availability'
export type PrimaryNextStep={kind:'create_brand'|'confirm_prompts'|'start_run'|'review_results'|'review_opportunity'|'monitoring_status'|'review_run'|'review_work';labelKey:'configure'|'start'|'repair'|'results'|'opportunities'|'review'|'status'|'work';href:string;reasonKey?:PulseBlockReason|'unknown'}
export function projectPrimaryNextStep({lang,clientId,setup,daily,availability}:{lang:string;clientId?:string;setup:{active:number;contextConfirmed:boolean}|null;daily:DailyWorkSummary|null;availability?:PulseAvailability|null}):PrimaryNextStep{
 if(!clientId)return{kind:'create_brand',labelKey:'configure',href:`/${lang}/onboarding`}
 const base=`/${lang}/dashboard/${clientId}`,monitor=base+'?step=monitor#first-monitoring'
 if(!setup)return{kind:'monitoring_status',labelKey:'status',href:monitor,reasonKey:'unknown'}
 if(!setup.contextConfirmed||setup.active===0)return{kind:'confirm_prompts',labelKey:'configure',href:base+'/prompts'}
 if(daily&&['pending','partial','failed'].includes(daily.state)){
  const action=daily.nextActions?.find(a=>['review-pending-run','review-failed-run','review-classification'].includes(a.kind)&&a.path.startsWith('/observations?'))
  return{kind:'review_run',labelKey:daily.state==='pending'?'review':'repair',href:action?base+action.path:daily.state==='pending'?monitor:base+'/observations?result=incomplete'}
 }
 const work=daily?.nextActions?.find(a=>(a.kind==='review-source'&&a.path.startsWith('/sources?'))||(a.kind==='open-draft'&&a.path.startsWith('/opportunities?')))
 if(work)return{kind:'review_work',labelKey:'work',href:base+work.path}
 if(daily?.state==='complete')return{kind:'review_results',labelKey:'results',href:base+'/observations'}
 if(availability?.canStart)return{kind:'start_run',labelKey:'start',href:monitor}
 return{kind:'monitoring_status',labelKey:'status',href:monitor,reasonKey:availability?.reasons[0]??'unknown'}
}
