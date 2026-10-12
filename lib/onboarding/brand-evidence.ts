import type {BrandDraftEvidence} from './brand-draft'
const fields=new Set(['brandName','description','industry'])
const normalize=(text:string)=>text.normalize('NFC').replace(/\s+/g,' ').trim()
/** A source match establishes text presence only, never the truth of a claim. */
export function validateBrandEvidence(pageText:string,candidates:unknown):BrandDraftEvidence[]{
 if(!Array.isArray(candidates))return []
 const page=normalize(pageText),out:BrandDraftEvidence[]=[],seen=new Set<string>()
 for(const candidate of candidates){
  if(!candidate||typeof candidate!=='object'||Array.isArray(candidate))continue
  const value=candidate as Record<string,unknown>
  if(typeof value.field!=='string'||!fields.has(value.field)||typeof value.quote!=='string'||value.quote.length>240)continue
  const quote=normalize(value.quote),key=value.field+'\n'+quote
  if(!quote||!page.includes(quote)||seen.has(key))continue
  out.push({field:value.field as BrandDraftEvidence['field'],quote});seen.add(key)
  if(out.length===6)break
 }
 return out
}
