import type { RunItemFilter,RunTroubleshooting as RunDto } from '@/lib/observations/run-troubleshooting'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'
export function RunTroubleshooting({data,lang,clientId,filter,error=false}:{data:RunDto|null;lang:string;clientId:string;filter:RunItemFilter;error?:boolean}){
 const copy=(lang==='zh-HK'?zh:en).maintenance
 const base=`/${lang}/dashboard/${encodeURIComponent(clientId)}/observations`
 const href=(selected:RunItemFilter,cursor?:string)=>`${base}?${new URLSearchParams({run:data!.runId,week:data!.week,runStatus:selected,...(cursor?{runCursor:cursor}:{})})}#run-status`
 return<section id="run-status" className="mx-auto mt-6 max-w-5xl space-y-4 rounded-xl border border-dash-border p-5"><h2 className="text-xl font-bold">{copy.runTitle}</h2>{error||!data?<p role="alert">{copy.runUnavailable}</p>:<>
  <p>{copy.runCounts.replace('{succeeded}',String(data.succeeded)).replace('{expected}',String(data.expected)).replace('{failed}',String(data.failed)).replace('{pending}',String(data.pending)).replace('{blocked}',String(data.blocked)).replace('{classified}',String(data.classified))}</p>
  <nav aria-label={copy.runFilters}>{(['all','failed','pending','unclassified'] as const).map(value=><a className="mr-3 inline-flex min-h-11 items-center underline" key={value} href={href(value)} aria-current={filter===value?'page':undefined}>{copy.filters[value]}</a>)}</nav>
  <p>{copy.runScope.replace('{shown}',String(data.items.length)).replace('{total}',String(data.total))}</p>
  <ul className="space-y-3">{data.items.map(item=><li className="rounded-lg border border-dash-border p-3" key={item.id}><p className="font-semibold whitespace-pre-wrap">{item.question}</p><p className="break-words">{item.platform} · {item.model}</p><p>{copy.itemStates[item.status as keyof typeof copy.itemStates]??copy.unknown} · {copy.classification}: {item.classification==='classified'?copy.classified:copy.unknown} · {copy.attempts}: {item.attempts}</p></li>)}</ul>
  {!data.items.length&&<p>{copy.runEmpty}</p>}{data.nextCursor&&<a className="inline-flex min-h-11 items-center underline" href={href(filter,data.nextCursor)}>{copy.moreRunItems}</a>}
 </>}</section>
}
