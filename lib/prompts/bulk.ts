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
export type PromptBatchPreview = {
  validRows: PromptBatchRow[]
  errors: PromptRowError[]
  duplicates: number[]
  activeAfter: number
  summary: { totalRows: number; applicableRows: number; duplicateRows: number; invalidRows: number }
  version: string
}

export function previewPromptRows(existing: PromptBatchRow[], rows: PromptBatchRow[]): Omit<PromptBatchPreview, 'version'> {
  const errors: PromptRowError[] = []
  const submittedIds = new Set<string>()
  const known = new Map(existing.map(row => [row.id, row]))
  const candidates: { row: PromptBatchRow; index: number }[] = []
  const key = (row: PromptBatchRow) => JSON.stringify([row.question.trim().replace(/\s+/g, ' ').toLowerCase(), row.language, row.market])

  rows.forEach((row, index) => {
    const before = errors.length
    const fail = (field: string, code: string) => errors.push({ row: index + 1, field, code })
    if (!row || typeof row !== 'object') { fail('row', 'INVALID_ROW'); return }
    if (row.id && (!known.has(row.id) || submittedIds.has(row.id))) fail('id', 'INVALID_OWNED_ID')
    if (row.id) submittedIds.add(row.id)
    if (typeof row.question !== 'string' || !row.question.trim() || row.question.trim().length > 500) fail('question', 'INVALID_QUESTION')
    if (!isPromptCategory(row.category)) fail('category', 'INVALID_CATEGORY')
    if (!isPromptLanguage(row.language)) fail('language', 'INVALID_LANGUAGE')
    if (!isPromptMarket(row.market)) fail('market', 'MARKET_REQUIRED')
    if (typeof row.is_active !== 'boolean') fail('is_active', 'INVALID_ACTIVE')
    if (errors.length === before) candidates.push({ row: { ...row, question: row.question.trim() }, index: index + 1 })
  })

  const invalidRows = new Set(errors.map(error => error.row)).size
  const duplicateIndices = new Set<number>()
  // A rejected update restores its original question. Re-check until no accepted
  // row conflicts with a restored original; valid simultaneous swaps still work.
  let changed = true
  while (changed) {
    changed = false
    const accepted = candidates.filter(candidate => !duplicateIndices.has(candidate.index))
    const replaced = new Set(accepted.map(candidate => candidate.row.id).filter(Boolean))
    const seen = new Set(existing.filter(row => !replaced.has(row.id)).map(key))
    for (const candidate of accepted) {
      const identity = key(candidate.row)
      if (seen.has(identity)) {
        duplicateIndices.add(candidate.index)
        changed = true
      } else seen.add(identity)
    }
  }
  const duplicates = [...duplicateIndices].sort((a, b) => a - b)
  for (const row of duplicates) errors.push({ row, field: 'question', code: 'DUPLICATE_PROMPT' })
  const validRows = candidates.filter(candidate => !duplicateIndices.has(candidate.index)).map(candidate => candidate.row)
  const replaced = new Set(validRows.map(row => row.id).filter(Boolean))
  const after = [...existing.filter(row => !replaced.has(row.id)), ...validRows]
  if (after.length > MAX_PROMPTS) errors.push({ row: 0, field: 'rows', code: 'PROMPT_LIMIT_REACHED' })
  errors.sort((a, b) => a.row - b.row)
  return {
    validRows, errors, duplicates, activeAfter: after.filter(row => row.is_active).length,
    summary: { totalRows: rows.length, applicableRows: validRows.length, duplicateRows: duplicates.length, invalidRows },
  }
}
