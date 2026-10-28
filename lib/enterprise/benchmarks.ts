import { createHash } from 'node:crypto'
import { normalizeCitationUrl } from '@/lib/citations/normalize'
export type BenchmarkObservation={question:string;locale:string|null;market:string|null;model:string|null;sampling:unknown;context:unknown;provenance:string|null;citations:string[]|null;domain:string;observedAt:string|null;grounding?:string|null}
export function buildMarketBenchmarks(rows:BenchmarkObservation[]){
 const groups=new Map<string,{id:string;question:string;locale:string;model:string;provenance:string;sampling:unknown;context:unknown;grounding:string|null;markets:Map<string,{market:string;samples:number;citationSamples:number;citations:number;owned:number;first:string;last:string}>}>();let excluded=0
 for(const row of rows){
  if(!row.question||!row.locale||!row.market||!row.model||!row.sampling||!row.context||!row.provenance||!row.observedAt||!Number.isFinite(Date.parse(row.observedAt))){excluded++;continue}
  const signature=JSON.stringify([row.question.normalize('NFKC').trim().toLowerCase(),row.locale,row.model,row.sampling,row.context,row.provenance,row.grounding??null]),id=createHash('sha256').update(signature).digest('hex')
  let group=groups.get(id);if(!group){group={id,question:row.question,locale:row.locale,model:row.model,provenance:row.provenance,sampling:row.sampling,context:row.context,grounding:row.grounding??null,markets:new Map()};groups.set(id,group)}
  const market=group.markets.get(row.market)??{market:row.market,samples:0,citationSamples:0,citations:0,owned:0,first:row.observedAt,last:row.observedAt};market.samples++
  if(row.citations!==null)market.citationSamples++
  for(const raw of new Set(row.citations??[])){const url=normalizeCitationUrl(raw);if(!url)continue;market.citations++;const host=new URL(url).hostname;if(host===row.domain||host.endsWith('.'+row.domain))market.owned++}
  market.first=market.first<row.observedAt?market.first:row.observedAt;market.last=market.last>row.observedAt?market.last:row.observedAt;group.markets.set(row.market,market)
 }
 return{scope:'within_account',method:'market-benchmark.v1',excluded,cohorts:[...groups.values()].slice(0,100).map(group=>({...group,markets:[...group.markets.values()].sort((a,b)=>a.market.localeCompare(b.market)).map(row=>({...row,citationShare:row.citationSamples?(row.citations?row.owned/row.citations:0):null})),comparableMarkets:group.markets.size>1})),limitations:['descriptive-samples-not-causal','no-cross-account-data','locale-model-context-sampling-provenance-stratified','connector-reported-is-not-provider-verified']}
}
