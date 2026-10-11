import {isPromptLanguage,isPromptMarket} from './context'
import {isPromptCategory} from './categories'
import {MAX_PROMPTS} from '@/lib/pulse/limits'
export type PromptBatchRow={id?:string;question:string;category:string;language:string;market:string|null;is_active:boolean}
export type PromptRowError={row:number;field:string;code:string}
export function parsePromptCsv(text:string):PromptBatchRow[]{
 if(text.length>65536)throw new Error('CSV_TOO_LARGE')
 const rows:string[][]=[],row:string[]=[];let cell='',quoted=false,closed=false;text=text.replace(/^\ufeff/,'')
 for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++}else{quoted=false;closed=true}}else cell+=c;continue}if(c==='"'){if(cell||closed)throw new Error('INVALID_CSV');quoted=true}else if(c===','||c==='\n'||c==='\r'){row.push(cell);cell='';closed=false;if(c!==','){if(c==='\r'&&text[i+1]==='\n')i++;rows.push([...row]);row.length=0}}else{if(closed)throw new Error('INVALID_CSV');cell+=c}}
 if(quoted)throw new Error('INVALID_CSV');if(cell||row.length){row.push(cell);rows.push(row)}
 const headers=rows.shift();if(!headers||new Set(headers).size!==headers.length||!['question','category','language','market','is_active'].every(h=>headers.includes(h))||headers.some(h=>!['id','question','category','language','market','is_active'].includes(h)))throw new Error('INVALID_CSV_HEADERS')
 return rows.filter(r=>r.some(x=>x.trim())).map(r=>{if(r.length!==headers.length)throw new Error('INVALID_CSV_COLUMNS');const v=Object.fromEntries(headers.map((h,i)=>[h,r[i]]));if(!['true','false'].includes(v.is_active))throw new Error('INVALID_ACTIVE');return{...(v.id?{id:v.id}:{}),question:v.question,category:v.category,language:v.language,market:v.market||null,is_active:v.is_active==='true'}})
}
export function previewPromptRows(existing:PromptBatchRow[],rows:PromptBatchRow[]){
 const errors:PromptRowError[]=[],duplicates:number[]=[],ids=new Set<string>(),known=new Map(existing.map(r=>[r.id,r])),key=(r:PromptBatchRow)=>JSON.stringify([r.question?.trim().replace(/\s+/g,' ').toLowerCase(),r.language,r.market])
 const validRows:PromptBatchRow[]=[],validIndices:number[]=[]
 rows.forEach((r,i)=>{const before=errors.length,err=(field:string,code:string)=>errors.push({row:i+1,field,code});if(!r||typeof r!=='object'){err('row','INVALID_ROW');return}if(r.id&&(!known.has(r.id)||ids.has(r.id)))err('id','INVALID_OWNED_ID');if(r.id)ids.add(r.id);if(typeof r.question!=='string'||!r.question.trim()||r.question.trim().length>500)err('question','INVALID_QUESTION');if(!isPromptCategory(r.category))err('category','INVALID_CATEGORY');if(!isPromptLanguage(r.language))err('language','INVALID_LANGUAGE');if(!isPromptMarket(r.market))err('market','MARKET_REQUIRED');if(typeof r.is_active!=='boolean')err('is_active','INVALID_ACTIVE');if(errors.length===before){validRows.push({...r,question:r.question.trim()});validIndices.push(i+1)}})
 const untouched=existing.filter(r=>!ids.has(r.id!)),seen=new Set(untouched.map(key));validRows.forEach((r,index)=>{const k=key(r);if(seen.has(k)){const at=validIndices[index];duplicates.push(at);errors.push({row:at,field:'question',code:'DUPLICATE_PROMPT'})}seen.add(k)})
 const after=[...untouched,...validRows];if(after.length>MAX_PROMPTS)errors.push({row:0,field:'rows',code:'PROMPT_LIMIT_REACHED'})
 return{validRows,errors,duplicates,activeAfter:after.filter(r=>r.is_active).length}
}
