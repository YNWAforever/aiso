import type { Observation, ObservationDetailDto, ObservationDetailRow, PulseSourceRow, Question } from '@/lib/observations/types'

const POSTGRES_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})[T ](?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/
const POSTGRES_SPACE_ONLY = /^[\t\n\v\f\r ]*$/

function validTimestamp(value: string): boolean {
  const match = POSTGRES_TIMESTAMP.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year === 0) return false
  const date = new Date(0)
  date.setUTCHours(0, 0, 0, 0)
  date.setUTCFullYear(year, month - 1, day)
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

export function projectObservation(row: PulseSourceRow, currentPrompt: Question | null): Observation {
  const hasAnswer = typeof row.has_answer === 'boolean'
    ? row.has_answer
    : typeof row.raw_answer === 'string' && !POSTGRES_SPACE_ONLY.test(row.raw_answer)
  const classified = row.classification_status==='classified'&&typeof row.brand_mentioned === 'boolean'
  const promptId = row.prompt_id?.toLowerCase() ?? null
  const linkedPrompt = promptId !== null && currentPrompt?.id.toLowerCase() === promptId
    ? {
        id: currentPrompt.id.toLowerCase(),
        question: currentPrompt.question,
        category: currentPrompt.category,
        language: currentPrompt.language,
        isActive: currentPrompt.isActive,
      }
    : null
  const model=typeof row.actual_model==='string'&&row.actual_model?row.actual_model:null
  const market=typeof row.market==='string'&&row.market?row.market:null
  const collectedAt=typeof row.collected_at==='string'&&validTimestamp(row.collected_at)?row.collected_at:null
  const limitations:string[]=[]
  if(!model)limitations.push('model-unrecorded')
  if(!market)limitations.push('market-unrecorded')
  if(!collectedAt)limitations.push('collection-time-unrecorded')
  if (!hasAnswer) limitations.push('answer-unavailable')
  if (!classified) limitations.push('classification-unavailable')

  return {
    id: row.id.toLowerCase(),
    sourceKind: 'pulse-metric',
    promptId,
    question: row.question,
    platform: row.platform,
    scanWeek: row.scan_week,
    recordedAt: typeof row.created_at === 'string' && validTimestamp(row.created_at) ? row.created_at : null,
    collectedAt,
    model,
    market,
    result: hasAnswer && classified ? 'success' : 'incomplete',
    hasAnswer,
    brandMentioned: classified ? row.brand_mentioned : null,
    currentPrompt: linkedPrompt,
    limitations,
  }
}

/** Only explicit public HTTP(S) text links; no fetch or provider-citation inference. */
export function textEvidenceLinks(answer:string):ObservationDetailDto['links']{
  const links=new Set<string>()
  for(const match of answer.matchAll(/https?:\/\/[^\s<>"']+/gi)){
    const candidate=match[0].replace(/[.,;:!?\])}]+$/,'')
    if(/[\\\u0000-\u0020]/.test(candidate))continue
    try{
      const url=new URL(candidate),host=url.hostname.toLowerCase()
      if(!['http:','https:'].includes(url.protocol)||url.username||url.password||!host.includes('.')
        ||/^[\d.]+$/.test(host)||host.includes(':')||/\.(?:localhost|local|internal)$/.test(host))continue
      links.add(url.href)
    }catch{/* Invalid text remains readable in the raw answer. */}
    if(links.size>=50)break
  }
  return [...links].map(url=>({url,kind:'text-link' as const}))
}
export function projectObservationDetail(row:ObservationDetailRow):ObservationDetailDto{
  const base=projectObservation(row,null)
  const status=['classified','fallback','failed'].includes(row.classification_status??'')
    ? row.classification_status as 'classified'|'fallback'|'failed':'legacy_unknown'
  const sentiment=status==='classified'&&row.brand_mentioned===true&&['positive','neutral','negative'].includes(row.sentiment??'')
    ? row.sentiment as 'positive'|'neutral'|'negative':'unknown'
  return {...base,rawAnswer:base.hasAnswer?row.raw_answer:null,promptSnapshot:row.snapshot,
    brandSnapshot:row.brand_snapshot,requestedModel:row.requested_model,collector:row.collector,
    collectorVersion:row.collector_version,providerRequestId:row.provider_request_id,
    classification:{status,method:row.classifier_method,version:row.classifier_version,brandMentioned:base.brandMentioned,
      sentiment,matchedText:Array.isArray(row.matched_text)?row.matched_text.filter((v):v is string=>typeof v==='string'):[]},
    links:base.hasAnswer?textEvidenceLinks(row.raw_answer??''):[],limitations:[...base.limitations,'provider-citations-unrecorded']}
}
