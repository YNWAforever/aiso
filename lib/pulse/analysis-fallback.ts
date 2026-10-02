/** Pure, offline classification safety rules. Literal evidence is not sentiment. */
export type AnswerAnalysisV2 = {
  classificationStatus:'classified'|'fallback'|'failed'|'legacy_unknown'
  method:string;version:string;brandMentioned:boolean|null
  sentiment:'positive'|'neutral'|'negative'|'unknown'
  /** Normalized literal excerpts, never consumer ranking. */
  matchedText:string[];mentionPosition:number|null;competitorsMentioned:string[]
}
export const ANALYSIS_VERSION='2026-10-03.v2'
const normalize=(value:string)=>value.normalize('NFKC').normalize('NFC')
const latinWord=(value:string|undefined)=>!!value&&/[\p{Script=Latin}\p{N}\p{M}_]/u.test(value)

/** Latin word boundaries reject pineapple/ApplePay, while allowing adjacent CJK. */
export function literalBrandEvidence(answer:string,brandName:string):{text:string;position:number}|null{
  const text=normalize(answer),brand=normalize(brandName).trim()
  if(!brand)return null
  const hay=text.toLowerCase(),needle=brand.toLowerCase()
  let start=0,index=-1
  while((index=hay.indexOf(needle,start))!==-1){
    const before=text.slice(0,index).at(-1),after=text.slice(index+brand.length)[0]
    if((!latinWord(brand[0])||!latinWord(before))&&(!latinWord(brand.at(-1))||!latinWord(after)))
      return {text:text.slice(index,index+brand.length),position:index}
    start=index+Math.max(1,needle.length)
  }
  return null
}
export function naiveAnalysis(answer:string,brandName:string,competitors:readonly string[]=[]):AnswerAnalysisV2{
  const match=literalBrandEvidence(answer,brandName)
  return {classificationStatus:'fallback',method:'literal-evidence-abstention',version:ANALYSIS_VERSION,
    brandMentioned:null,sentiment:'unknown',matchedText:match?[match.text]:[],mentionPosition:match?.position??null,
    competitorsMentioned:[...new Set(competitors.filter(c=>literalBrandEvidence(answer,c)))].slice(0,10)}
}
/** Validate classifier output against saved text; explicit private aliases are not used. */
export function coerceAnalysis(value:unknown,answer:string,brandName:string,competitors:readonly string[]=[]):AnswerAnalysisV2|null{
  if(!value||typeof value!=='object')return null
  const row=value as Record<string,unknown>
  if(typeof row.brand_mentioned!=='boolean'||!Array.isArray(row.competitors_mentioned))return null
  const allowed=['positive','neutral','negative','not_mentioned','unknown']
  if(typeof row.sentiment!=='string'||!allowed.includes(row.sentiment))return null
  const match=literalBrandEvidence(answer,brandName)
  if(row.brand_mentioned&&(!match||!['positive','neutral','negative'].includes(row.sentiment)))return null
  const named=row.competitors_mentioned.filter((c):c is string=>typeof c==='string'&&!!c.trim())
    .map(c=>c.trim().slice(0,120)).filter(c=>literalBrandEvidence(answer,c))
  return {classificationStatus:'classified',method:'openrouter-json-literal-guard',version:ANALYSIS_VERSION,
    brandMentioned:row.brand_mentioned,sentiment:row.brand_mentioned?row.sentiment as AnswerAnalysisV2['sentiment']:'unknown',
    matchedText:row.brand_mentioned&&match?[match.text]:[],mentionPosition:row.brand_mentioned?match?.position??null:null,
    competitorsMentioned:[...new Set([...named,...competitors.filter(c=>literalBrandEvidence(answer,c))])].slice(0,10)}
}
