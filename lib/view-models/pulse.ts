import { projectObservedSummary } from '@/lib/pulse/observed-summary'
import { isoDate } from '@/lib/iso-date'
import type { OwnedPulse } from '@/lib/workspace/load-owned-pulse'
import type { ClientOverview } from '@/lib/types'
export type PulsePoint={week:string;sov:number|null}
export type PulseView={
 client:OwnedPulse['client']
 observations:{state:'ready'|'empty'|'error';latestKpi:ClientOverview['pulseKpi'];latestWeek:string|null;series:{platform:string|null;points:PulsePoint[]}[]}
 missed:{state:'ready'|'empty'|'error';data:OwnedPulse['missed']['data']}
 prompts:{state:'ready'|'empty'|'error';data:OwnedPulse['prompts']['data']}
}
export function buildPulseView(owned:OwnedPulse):PulseView{
 const rows=owned.observations.data.map((row):Record<string,unknown>&{scan_week:string}=>({...row,scan_week:isoDate(row.scan_week as string|Date|null,'')})).filter(row=>/^\d{4}-\d{2}-\d{2}$/.test(row.scan_week)&&Number.isFinite(Date.parse(row.scan_week)))
 const dates=[...new Set(rows.map(row=>row.scan_week))].sort();const latest=dates.at(-1)??null
 const weeks=new Set(dates)
 // Include absent weekly observations explicitly; cap the displayed window to forty weeks.
 if(latest){const end=Date.parse(latest);const start=Math.max(Date.parse(dates[0]),end-39*7*86400000);for(let day=end;day>=start;day-=7*86400000)weeks.add(new Date(day).toISOString().slice(0,10));for(const week of weeks)if(Date.parse(week)<start)weeks.delete(week)}
 const ordered=[...weeks].sort().slice(-40)
 const platforms:(string|null)[]=[null,...new Set(rows.map(row=>row.platform).filter((p):p is string=>typeof p==='string'))]
 const series=platforms.map(platform=>({platform,points:ordered.map(week=>{const row=rows.find(row=>row.scan_week===week&&row.platform===platform);return{week,sov:row?projectObservedSummary([{...row,platform:null}]).kpi?.sovScore??null:null}})}))
 const state=owned.observations.status==='error'?'error':rows.length?'ready':'empty'
 return{client:owned.client,observations:{state,latestKpi:state==='error'?null:projectObservedSummary(rows).kpi,latestWeek:latest,series:state==='error'?[]:series},
 missed:{state:owned.missed.status==='error'?'error':owned.missed.data.length?'ready':'empty',data:owned.missed.data.map(row=>({platform:row.platform,question:row.question,competitors_mentioned:Array.isArray(row.competitors_mentioned)?row.competitors_mentioned:[],scan_week:isoDate(row.scan_week,'')}))},
 prompts:{state:owned.prompts.status==='error'?'error':owned.prompts.data.length?'ready':'empty',data:owned.prompts.data.map(row=>({id:row.id,question:row.question,category:row.category,language:row.language,is_active:row.is_active}))}}
}
