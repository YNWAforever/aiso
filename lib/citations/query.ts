import type {CitationKind} from './classify'
import type {CitationReport} from './report'
export type CitationQuery={kind?:CitationKind;domain?:string;platform?:string;promptId?:string;runId?:string;from?:string;to?:string;page:number;pageSize:number}
export type CitationPage<T>={items:T[];total:number;page:number;pageSize:number;scopeKey:string}
const kinds=['owned','competitor','editorial','review','forum','social','institutional','other']
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i
export function parseCitationQuery(params:URLSearchParams):CitationQuery{
 const q: CitationQuery={page:1,pageSize:25}
 for(const key of ['kind','domain','platform','promptId','runId','from','to'] as const){const v=params.get(key);if(v){if(v.length>253)throw new Error('INVALID_CITATION_QUERY');q[key]=v as never}}
 for(const key of ['page','pageSize'] as const){const v=params.get(key);if(v!==null){if(!/^[1-9][0-9]*$/.test(v))throw new Error('INVALID_CITATION_QUERY');q[key]=Number(v)}}
 if(!Number.isSafeInteger(q.page)||q.page>100000||q.pageSize>100||(q.kind&&!kinds.includes(q.kind))||[q.promptId,q.runId].some(v=>v&&!uuid.test(v)))throw new Error('INVALID_CITATION_QUERY')
 for(const v of [q.from,q.to])if(v&&(!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v))throw new Error('INVALID_CITATION_QUERY')
 if(q.from&&q.to&&(q.from>q.to||Date.parse(q.to)-Date.parse(q.from)>56*86400000))throw new Error('INVALID_CITATION_QUERY')
 return q
}
export function citationQueryParams(query:CitationQuery):URLSearchParams{return new URLSearchParams(Object.entries(query).filter(([,v])=>v!==undefined).map(([k,v])=>[k,String(v)]))}
export function pageCitationReport(report:CitationReport,query:CitationQuery,exportAll=false):CitationReport{
 const scopeKey=citationQueryParams({...query,page:1,pageSize:25}).toString(),page=<T,>(items:T[]):CitationPage<T>=>({items:exportAll?items:items.slice((query.page-1)*query.pageSize,query.page*query.pageSize),total:items.length,page:query.page,pageSize:query.pageSize,scopeKey})
 const domains=report.domains.filter(d=>(!query.kind||d.kind===query.kind)&&(!query.domain||d.domain===query.domain)),allowed=new Set(domains.map(d=>d.domain))
 const urls=report.urls.filter(u=>allowed.has(u.domain)&&(!query.kind||u.kind===query.kind))
 const gaps=report.gaps.filter(g=>g.domains.some(d=>allowed.has(d)))
 const pages={domains:page(domains),urls:page(urls),gaps:page(gaps)}
 return{...report,query,availableKinds:[...new Set(report.domains.map(d=>d.kind))],pages,domains:pages.domains.items,urls:pages.urls.items,gaps:pages.gaps.items,evidence:report.evidence?.filter(e=>allowed.has(e.domain)&&pages.domains.items.some(d=>d.domain===e.domain)).slice(0,500)}
}
