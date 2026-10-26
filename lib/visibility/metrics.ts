import type { VisibilityObservation } from './report'
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
