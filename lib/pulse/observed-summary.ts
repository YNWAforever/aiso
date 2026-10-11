import { isoDate } from '@/lib/iso-date'
import type { ClientOverview, PulseWeeklySummary } from '@/lib/types'
export type PulseDisplayState = 'not_configured'|'empty'|'pending'|'partial'|'complete'|'failed'|'blocked'|'error'
export type PulseCoverageView = {expected:number|null;recorded:number;collected:number;classified:number;mentioned:number;collectionRate:number|null;classificationRate:number|null;mentionRate:number|null;provenance:'ledger'|'legacy'|'mixed'}
export type ObservedPulseSummary = {summary:PulseWeeklySummary[];kpi:ClientOverview['pulseKpi'];latestWeek:string|null;state?:PulseDisplayState;coverage?:PulseCoverageView|null}
function count(value:unknown):number|null {if((typeof value!=='number'&&typeof value!=='string')||value==='')return null;const n=Number(value);return Number.isSafeInteger(n)&&n>=0?n:null}
/** Raw classified observations define sample rates; only a ledger defines the expected run size. */
export function projectObservedSummary(rows:Record<string,unknown>[]):ObservedPulseSummary {
 const ordered=rows.map((row):Record<string,unknown>&{scan_week:string}=>({...row,scan_week:isoDate(row.scan_week as string|Date|null,'')})).filter(row=>row.scan_week).sort((a,b)=>a.scan_week.localeCompare(b.scan_week))
 const latestWeek=ordered.at(-1)?.scan_week??null
 const a=ordered.find(row=>row.scan_week===latestWeek&&row.platform===null) as Record<string,unknown>|undefined
 const expected=a?.mixed_legacy===true?null:count(a?.expected_items),recorded=count(a?.observed_queries),collected=count(a?.collected_queries),classified=count(a?.successful_queries),mentioned=count(a?.observed_brand_mentions)
 const coherent=recorded!==null&&collected!==null&&classified!==null&&mentioned!==null&&classified<=collected&&collected<=recorded&&mentioned<=classified
 const coverage:PulseCoverageView|null=coherent?{expected,recorded:recorded!,collected:collected!,classified:classified!,mentioned:mentioned!,collectionRate:expected&&count(a?.succeeded_items)!==null?count(a?.succeeded_items)!/expected:null,classificationRate:collected!>0?classified!/collected!:null,mentionRate:classified!>0?mentioned!/classified!:null,provenance:a?.mixed_legacy===true?'mixed':expected===null?'legacy':'ledger'}:null
 const pending=count(a?.pending_items),failed=count(a?.failed_items),blocked=count(a?.blocked_items),succeeded=count(a?.succeeded_items)
 const rollupConsistent=(!a||a.total_queries==null||count(a.total_queries)===recorded)&&(!a||a.brand_mentions==null||count(a.brand_mentions)===mentioned)
 const valid=!!coverage&&rollupConsistent
 let state:PulseDisplayState=!a?'empty':!valid?'partial':coverage!.recorded===0?'empty':coverage!.classified===coverage!.recorded?'complete':'partial'
 if(a?.mixed_legacy===true)state='partial'
 if(expected!==null){if(pending&&recorded===0)state='pending';else if(blocked===expected)state='blocked';else if(failed===expected&&succeeded===0)state='failed';else if(succeeded!==expected||classified!==expected)state='partial'}
 const platforms=count(a?.successful_platform_count)
 const kpi=valid&&coverage!.mentionRate!==null&&latestWeek&&platforms!==null&&platforms>0?{sovScore:100*coverage!.mentionRate,brandMentions:coverage!.mentioned,totalQueries:coverage!.classified,platformCount:platforms,scanWeek:latestWeek}:null
 const summary=ordered.filter(row=>row.total_queries!=null).map(row=>({...row})) as unknown as PulseWeeklySummary[]
 return {summary,kpi,latestWeek,state,coverage}
}
