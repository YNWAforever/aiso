/** Pure, offline classification safety rules. Literal evidence is not sentiment. */
export type AnswerAnalysisV2 = {
  classificationStatus:'classified'|'fallback'|'failed'|'legacy_unknown'
  method:string;version:string;brandMentioned:boolean|null
  sentiment:'positive'|'neutral'|'negative'|'unknown'
  /** Normalized literal excerpts, never consumer ranking. */
  matchedText:string[];mentionPosition:number|null;competitorsMentioned:string[]
}
// v3 (2026-10-10): separator, Latin-accent and dotted-acronym variants match.
export const ANALYSIS_VERSION='2026-10-10.v3'
const normalize=(value:string)=>value.normalize('NFKC').normalize('NFC')
const latinWord=(value:string|undefined)=>!!value&&/[\p{Script=Latin}\p{N}\p{M}_]/u.test(value)
const latin=(value:string|undefined)=>!!value&&/\p{Script=Latin}/u.test(value)
const SEPARATORS='[\\s\\-_\\u2010-\\u2015]'
const escapeRegExp=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')

/**
 * Comparison form of a text, with each folded unit's source span. Folding is
 * case, accents on Latin letters only (a Thai or Hangul mark is part of the
 * letter), and the full stops of a dotted acronym (A.S. -> AS, but Inc. keeps
 * its stop).
 */
function fold(text:string){
  const chars=[...text],starts:number[]=[],ends:number[]=[]
  let folded='',offset=0
  chars.forEach((char,index)=>{
    const at=offset;offset+=char.length
    const previous=chars[index-1],beforePrevious=chars[index-2]
    if(char==='.'&&latin(previous)&&(!beforePrevious||beforePrevious==='.'||!/[\p{L}\p{N}]/u.test(beforePrevious)))return
    const base=latin(char)?char.normalize('NFD').replace(/\p{M}/gu,''):char
    for(const unit of base.toLowerCase()){folded+=unit;for(let i=0;i<unit.length;i++){starts.push(at);ends.push(at+char.length)}}
  })
  return {folded,starts,ends}
}

/**
 * Latin word boundaries reject pineapple/ApplePay, while allowing adjacent CJK.
 * Words of a multi-word name may be joined by any separator or none
 * (Fimmick AEO = fimmick-aeo = FimmickAEO). The evidence is the answer's own
 * span, as written.
 */
export function literalBrandEvidence(answer:string,brandName:string):{text:string;position:number}|null{
  const text=normalize(answer),source=fold(text)
  const words=fold(normalize(brandName)).folded.split(new RegExp(`${SEPARATORS}+`,'u')).filter(Boolean)
  if(!words.length)return null
  const first=words[0][0],last=words.at(-1)!.at(-1)
  const pattern=new RegExp(words.map(escapeRegExp).join(`${SEPARATORS}*`),'gu')
  for(let match=pattern.exec(source.folded);match;match=pattern.exec(source.folded)){
    const index=match.index,end=index+match[0].length
    const before=source.folded[index-1],after=source.folded[end]
    if((!latinWord(first)||!latinWord(before))&&(!latinWord(last)||!latinWord(after))){
      const position=source.starts[index]
      return {text:text.slice(position,source.ends[end-1]),position}
    }
    pattern.lastIndex=index+1
  }
  return null
}
/**
 * A competitor as the matcher sees it. A plain string is a name with no
 * aliases, which is what manifests written before 061 carry. Aliases are the
 * owner's configured spellings (`competitors.aliases`), never inferred.
 */
export type CompetitorMatch=string|{name:string;aliases?:readonly string[]|null}
const refsOf=(competitors:readonly CompetitorMatch[])=>competitors
  .map(c=>typeof c==='string'?{name:c,forms:[c]}:{name:c.name,forms:[c.name,...(c.aliases??[])]})
  .filter(ref=>!!ref.name?.trim())
/** Canonical names of the competitors whose name or an alias is literally in the answer. */
const literalCompetitors=(answer:string,competitors:readonly CompetitorMatch[])=>
  refsOf(competitors).filter(ref=>ref.forms.some(form=>literalBrandEvidence(answer,form))).map(ref=>ref.name)

export function naiveAnalysis(answer:string,brandName:string,competitors:readonly CompetitorMatch[]=[]):AnswerAnalysisV2{
  const match=literalBrandEvidence(answer,brandName)
  return {classificationStatus:'fallback',method:'literal-evidence-abstention',version:ANALYSIS_VERSION,
    brandMentioned:null,sentiment:'unknown',matchedText:match?[match.text]:[],mentionPosition:match?.position??null,
    competitorsMentioned:[...new Set(literalCompetitors(answer,competitors))].slice(0,10)}
}
/** Validate classifier output against saved text; only configured aliases are used, never inferred ones. */
export function coerceAnalysis(value:unknown,answer:string,brandName:string,competitors:readonly CompetitorMatch[]=[]):AnswerAnalysisV2|null{
  if(!value||typeof value!=='object')return null
  const row=value as Record<string,unknown>
  if(typeof row.brand_mentioned!=='boolean'||!Array.isArray(row.competitors_mentioned))return null
  const allowed=['positive','neutral','negative','not_mentioned','unknown']
  if(typeof row.sentiment!=='string'||!allowed.includes(row.sentiment))return null
  const match=literalBrandEvidence(answer,brandName)
  if(row.brand_mentioned&&(!match||!['positive','neutral','negative'].includes(row.sentiment)))return null
  // A classifier-named spelling of a configured competitor is reported under
  // that competitor's canonical name, so one brand is never counted twice.
  const canonical=new Map(refsOf(competitors).flatMap(ref=>ref.forms.map(form=>[form.trim().toLowerCase(),ref.name] as const)))
  const named=row.competitors_mentioned.filter((c):c is string=>typeof c==='string'&&!!c.trim())
    .map(c=>c.trim().slice(0,120)).filter(c=>literalBrandEvidence(answer,c))
    .map(c=>canonical.get(c.toLowerCase())??c)
  return {classificationStatus:'classified',method:'openrouter-json-literal-guard',version:ANALYSIS_VERSION,
    brandMentioned:row.brand_mentioned,sentiment:row.brand_mentioned?row.sentiment as AnswerAnalysisV2['sentiment']:'unknown',
    matchedText:row.brand_mentioned&&match?[match.text]:[],mentionPosition:row.brand_mentioned?match?.position??null:null,
    competitorsMentioned:[...new Set([...named,...literalCompetitors(answer,competitors)])].slice(0,10)}
}
