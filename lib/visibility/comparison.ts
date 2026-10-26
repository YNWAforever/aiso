import { buildVisibilityReport,type VisibilityObservation } from './report'
type Run = {manifest:Record<string,unknown>;observations:VisibilityObservation[]}
export function compareVisibilityRuns(before:Run,after:Run) {
  const reasons:string[]=[],expected=Array.isArray(before.manifest.items)?before.manifest.items.length:0
  if(!expected)reasons.push('MANIFEST_MISSING')
  if(JSON.stringify(before.manifest.items)!==JSON.stringify(after.manifest.items))reasons.push('MANIFEST_CHANGED')
  if(before.observations.length!==expected||after.observations.length!==expected||[...before.observations,...after.observations].some(row=>row.answerPresence===null))reasons.push('COVERAGE_INCOMPLETE')
  const key=(row:VisibilityObservation)=>JSON.stringify([row.promptId,row.platform,row.requestedModel])
  const indexed=new Map(after.observations.map(row=>[key(row),row]))
  if(indexed.size!==after.observations.length||new Set(before.observations.map(key)).size!==before.observations.length)reasons.push('DUPLICATE_SAMPLE')
  for(const row of before.observations) {
    const next=indexed.get(key(row))
    if(!next||!row.model||row.model!==next.model||!row.requestedModel||row.requestedModel!==next.requestedModel)reasons.push('MODEL_UNKNOWN_OR_CHANGED')
    if(!row.locale||!row.market||row.locale!==next?.locale||row.market!==next?.market||JSON.stringify(row.monitoring)!==JSON.stringify(next?.monitoring))reasons.push('CONTEXT_UNKNOWN_OR_CHANGED')
    for(const item of [row,next]) {
      const sampling=item?.monitoring.sampling as {temperature?:unknown;samplesPerRun?:unknown;seed?:unknown}|undefined
      if(!sampling||sampling.temperature!==0.2||sampling.samplesPerRun!==1||sampling.seed!==null)reasons.push('SAMPLING_UNKNOWN_OR_CHANGED')
    }
    if(!row.observedAt||!next?.observedAt||!Number.isFinite(Date.parse(row.observedAt))||!Number.isFinite(Date.parse(next.observedAt))||Date.parse(next.observedAt)<Date.parse(row.observedAt))reasons.push('OBSERVATION_TIME_UNKNOWN')
  }
  const b=buildVisibilityReport(before.observations),a=buildVisibilityReport(after.observations)
  if(b.citationCoverage!==1||a.citationCoverage!==1)reasons.push('CITATION_COVERAGE_INCOMPLETE')
  const comparable=!reasons.length
  const summary=(report:typeof b)=>({observations:report.observations,classified:report.classified,unknown:report.unknown,answerPresence:report.answerPresence,citationShare:report.citationShare,
    citationCoverage:report.citationCoverage,firstCitationPosition:report.firstCitationPosition,brandShareOfVoice:report.brandShareOfVoice,competitorShareOfVoice:report.competitorShareOfVoice,volatility:report.volatility})
  return{comparable,reasons:[...new Set(reasons)],before:summary(b),after:summary(a),delta:{answerPresence:comparable&&a.answerPresence!==null&&b.answerPresence!==null?a.answerPresence-b.answerPresence:null,
    citationShare:comparable&&a.citationShare!==null&&b.citationShare!==null?a.citationShare-b.citationShare:null},claim:'observed_difference_only',method:'visibility-comparison.v1'}
}
