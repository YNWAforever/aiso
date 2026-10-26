import { createHash } from 'node:crypto'
import { normalizeCitationUrl, registrableDomain } from '@/lib/citations/normalize'
import { readSearchEvidence,type Grounding } from '@/lib/pulse/grounding'
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
  const grounding:Grounding|null=['none','web','native'].includes(String(row.grounding))?row.grounding as Grounding:null
  return { id:String(row.id),runId:String(row.run_id),promptId:String(row.prompt_id),question:String(snapshot.question??''),locale:typeof snapshot.language==='string'?snapshot.language:null,market:typeof snapshot.market==='string'?snapshot.market:null,
    monitoring,platform:String(row.platform),model:typeof row.actual_model==='string'?row.actual_model:null,requestedModel:typeof row.requested_model==='string'?row.requested_model:null,
    observedAt:observed,grounding,searchEvidence:readSearchEvidence(row.search_evidence,grounding),answerExcerpt:answer.slice(0,2000),answerDigest:createHash('sha256').update(answer).digest('hex'),answerPresence,
    citationsRecorded:recorded,citations,ownedCitations,citationShare:recorded ? (citations.length ? ownedCitations/citations.length : 0) : null,
    firstCitationPosition:first<0?null:first+1,citationOrder:'provider_annotation_order',competitorNames,
    sentiment:classified && answerPresence===true && ['positive','neutral','negative'].includes(String(classification.sentiment)) ? String(classification.sentiment) : 'unknown',
    recommendation:['recommended','excluded','neutral'].includes(String(review.recommendation))?String(review.recommendation):'unknown',
    accuracy:['accurate','inaccurate'].includes(String(review.accuracy))?String(review.accuracy):'unknown',risk:['low','medium','high'].includes(String(review.risk))?String(review.risk):'unknown',
    review:row.review??null,method:'visibility-observation.v1' }
}
export type VisibilityObservation = ReturnType<typeof projectVisibilityObservation>
export { buildVisibilityReport } from './metrics'
