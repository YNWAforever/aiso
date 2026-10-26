import { createHash } from 'node:crypto'
import { normalizeCitationUrl, registrableDomain } from '@/lib/citations/normalize'
type Row = Record<string, unknown>
type Competitor = { id?:string; name:string; domains:string[]; aliases:string[] }
export type VisibilityContext = { domain:string; competitors:Competitor[] }
const record = (value:unknown):Row => value && typeof value==='object' && !Array.isArray(value) ? value as Row : {}
const fold = (value:string) => value.normalize('NFKC').toLowerCase()
const owned = (host:string,domain:string) => host===domain || host.endsWith('.'+domain)
export function projectVisibilityObservation(row: Row, context: VisibilityContext) {
  const snapshot = record(row.snapshot), monitoring = record(snapshot.monitoring), classification = record(row.classification), review = record(row.review)
  const classified = row.classification_status==='classified'
  const answerPresence = classified && typeof classification.brandMentioned==='boolean' ? classification.brandMentioned : null
  const configured = context.competitors.filter(competitor=>!Array.isArray(monitoring.competitorIds) || !monitoring.competitorIds.length || monitoring.competitorIds.includes(competitor.id))
  const named = Array.isArray(classification.competitorsMentioned) ? classification.competitorsMentioned.filter((value):value is string=>typeof value==='string').map(fold) : []
  const competitorNames = classified ? configured.filter(competitor=>[competitor.name,...competitor.aliases].some(name=>named.includes(fold(name)))).map(competitor=>competitor.name) : []
  const recorded = Array.isArray(row.provider_citations), seen = new Set<string>()
  const citations = (recorded ? row.provider_citations as unknown[] : []).flatMap(value=>{
    const url = normalizeCitationUrl(record(value).url)
    if (!url || seen.has(url)) return []
    seen.add(url)
    const host = new URL(url).hostname, domain = registrableDomain(host), isOwned = owned(host,context.domain)
    return [{url,domain,owned:isOwned,competitor:configured.find(competitor=>competitor.domains.some(domain=>owned(host,domain)))?.name ?? null}]
  })
  const first = citations.findIndex(citation=>citation.owned), ownedCitations = citations.filter(citation=>citation.owned).length
  const answer = typeof row.raw_answer==='string' ? row.raw_answer : ''
  const observed = row.finished_at instanceof Date ? row.finished_at.toISOString() : typeof row.finished_at==='string' ? row.finished_at : null
  return { id:String(row.id),runId:String(row.run_id),promptId:String(row.prompt_id),question:String(snapshot.question??''),locale:snapshot.language??null,market:snapshot.market??null,
    monitoring,platform:String(row.platform),model:typeof row.actual_model==='string'?row.actual_model:null,requestedModel:typeof row.requested_model==='string'?row.requested_model:null,
    observedAt:observed,answerExcerpt:answer.slice(0,2000),answerDigest:createHash('sha256').update(answer).digest('hex'),answerPresence,
    citationsRecorded:recorded,citations,ownedCitations,citationShare:recorded ? (citations.length ? ownedCitations/citations.length : 0) : null,
    firstCitationPosition:first<0?null:first+1,citationOrder:'provider_annotation_order',competitorNames,
    sentiment:classified && answerPresence===true && ['positive','neutral','negative'].includes(String(classification.sentiment)) ? String(classification.sentiment) : 'unknown',
    recommendation:['recommended','excluded','neutral'].includes(String(review.recommendation))?String(review.recommendation):'unknown',
    accuracy:['accurate','inaccurate'].includes(String(review.accuracy))?String(review.accuracy):'unknown',risk:['low','medium','high'].includes(String(review.risk))?String(review.risk):'unknown',
    review:row.review??null,method:'visibility-observation.v1' }
}
export type VisibilityObservation = ReturnType<typeof projectVisibilityObservation>
export function buildVisibilityReport(observations: VisibilityObservation[]) {
  const classified = observations.filter(row=>row.answerPresence!==null), named = classified.filter(row=>row.answerPresence===true).length
  const recorded = observations.filter(row=>row.citationsRecorded), totalCitations = recorded.reduce((sum,row)=>sum+row.citations.length,0), ownedCitations = recorded.reduce((sum,row)=>sum+row.ownedCitations,0)
  const names = new Map<string,number>(), domains = new Map<string,{domain:string;answers:number;platforms:Set<string>}>(), groups = new Map<string,VisibilityObservation[]>()
  for (const row of observations) {
    for (const name of row.competitorNames) names.set(name,(names.get(name)??0)+1)
    for (const domain of new Set(row.citations.filter(citation=>!citation.owned).map(citation=>citation.domain))) {
      const source=domains.get(domain)??{domain,answers:0,platforms:new Set<string>()};source.answers++;source.platforms.add(row.platform);domains.set(domain,source)
    }
    if (row.model && row.observedAt) {
      const key=JSON.stringify([row.promptId,row.question,row.locale,row.market,row.platform,row.model,row.monitoring])
      groups.set(key,[...(groups.get(key)??[]),row])
    }
  }
  let transitions=0,changes=0
  for (const group of groups.values()) {
    group.sort((a,b)=>String(a.observedAt).localeCompare(String(b.observedAt))||a.id.localeCompare(b.id))
    for (let i=1;i<group.length;i++) if (group[i-1].answerPresence!==null && group[i].answerPresence!==null) { transitions++; if(group[i-1].answerPresence!==group[i].answerPresence) changes++ }
  }
  const mentions=named+[...names.values()].reduce((sum,count)=>sum+count,0)
  return { observations:observations.length,classified:classified.length,unknown:observations.length-classified.length,answerPresence:classified.length?named/classified.length:null,
    citationShare:recorded.length?(totalCitations?ownedCitations/totalCitations:0):null,citationCoverage:observations.length?recorded.length/observations.length:null,
    firstCitationPosition:recorded.filter(row=>row.firstCitationPosition!==null).length?recorded.reduce((sum,row)=>sum+(row.firstCitationPosition??0),0)/recorded.filter(row=>row.firstCitationPosition!==null).length:null,
    competitorShareOfVoice:[...names].sort(([a],[b])=>a.localeCompare(b)).map(([name,count])=>({name,mentions:count,share:mentions?count/mentions:null})),
    brandShareOfVoice:mentions?named/mentions:null,volatility:transitions?changes/transitions:null,volatilityComparisons:transitions,
    recommendation:observations.filter(row=>row.recommendation==='recommended').length,exclusion:observations.filter(row=>row.recommendation==='excluded').length,
    accuracyReviewed:observations.filter(row=>row.accuracy!=='unknown').length,riskReviewed:observations.filter(row=>row.risk!=='unknown').length,
    trustedSources:[...domains.values()].sort((a,b)=>b.answers-a.answers||a.domain.localeCompare(b.domain)).slice(0,50).map(source=>({...source,platforms:[...source.platforms].sort(),authority:'fimmick-recurrence-heuristic.v1'})),
    gaps:observations.filter(row=>row.citationsRecorded&&row.citations.length>0&&row.ownedCitations===0).map(row=>({observationId:row.id,promptId:row.promptId,question:row.question,domains:[...new Set(row.citations.map(citation=>citation.domain))],targetUrl:row.monitoring.targetUrl??null})),
    method:'visibility-report.v1',limitations:['api-answer-sample-not-consumer-ranking','provider-annotation-order','review-required-for-accuracy-recommendation-risk','association-not-causation'] }
}
