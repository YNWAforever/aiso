import type {DailyWorkSummary} from './daily-work'
export type PrimaryNextStep={kind:'create_brand'|'confirm_prompts'|'start_run'|'review_results'|'review_opportunity';labelKey:'configure'|'start'|'repair'|'results'|'opportunities'|'review';href:string;reasonKey?:'unknown'}
export function projectPrimaryNextStep({lang,clientId,setup,daily}:{lang:string;clientId?:string;setup:{active:number;contextConfirmed:boolean}|null;daily:DailyWorkSummary|null}):PrimaryNextStep{
 if(!clientId)return{kind:'create_brand',labelKey:'configure',href:`/${lang}/onboarding`}
 const base=`/${lang}/dashboard/${clientId}`
 if(!setup)return{kind:'start_run',labelKey:'review',href:base+'?step=monitor#first-monitoring',reasonKey:'unknown'}
 if(!setup.contextConfirmed||setup.active===0)return{kind:'confirm_prompts',labelKey:'configure',href:base+'/prompts'}
 if(daily?.state==='complete')return{kind:'review_results',labelKey:'results',href:base+'/observations'}
 if(daily&&['partial','failed','pending'].includes(daily.state))return{kind:'start_run',labelKey:'repair',href:base+'?step=monitor#first-monitoring'}
 return{kind:'start_run',labelKey:'start',href:base+'?step=monitor#first-monitoring'}
}
