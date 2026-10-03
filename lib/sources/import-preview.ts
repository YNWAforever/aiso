import { MAX_ENTRIES,SourceInputError,parseSourceEntries,parseSourceCsvRows,hashSourceContent,buildSourceContent,type SourceEntry } from './schema'
export type PreviewRow={rowNumber:number;question:string;answer:string;entry:SourceEntry|null;errorCode:string|null;duplicateOf:number|null}
export type PreviewRows={rows:PreviewRow[];validCount:number;invalidCount:number;contentHash:string|null}
export function previewSourceImport(input:{csv:string}|{rows:{rowNumber:number;question:string;answer:string}[]}):PreviewRows{
 if(!input||!('csv'in input)&&!Array.isArray(input.rows))throw new SourceInputError('SOURCE_PREVIEW_INVALID')
 const raw='csv'in input?parseSourceCsvRows(input.csv).map(({rowNumber,cells})=>({rowNumber,question:cells[0]??'',answer:cells[1]??'',columns:cells.length})):input.rows.map(row=>({...row,columns:2}))
 if(!Array.isArray(raw)||raw.length<1||raw.length>MAX_ENTRIES)throw new SourceInputError('SOURCE_ENTRIES_LIMIT')
 const numbers=new Set<number>(),questions=new Map<string,number>()
 const rows=raw.map(row=>{
  if(!row||!Number.isSafeInteger(row.rowNumber)||row.rowNumber<1||row.rowNumber>MAX_ENTRIES+1||numbers.has(row.rowNumber)||typeof row.question!=='string'||typeof row.answer!=='string')throw new SourceInputError('SOURCE_PREVIEW_INVALID')
  numbers.add(row.rowNumber)
  let entry:SourceEntry|null=null,errorCode:string|null=null,duplicateOf:number|null=null
  try{
   if(row.columns!==2)throw new SourceInputError('SOURCE_CSV_COLUMNS_INVALID')
   entry=parseSourceEntries([{question:row.question,answer:row.answer}])[0]
   const key=entry.question.normalize('NFC').trim().toLocaleLowerCase('en')
   duplicateOf=questions.get(key)??null
   if(duplicateOf!==null){errorCode='SOURCE_DUPLICATE_QUESTION';entry=null}else questions.set(key,row.rowNumber)
  }catch(error){errorCode=error instanceof SourceInputError?error.code:'SOURCE_PREVIEW_INVALID'}
  return{rowNumber:row.rowNumber,question:row.question,answer:row.answer,entry,errorCode,duplicateOf}
 })
 const valid=rows.filter(row=>row.entry!==null)
 return{rows,validCount:valid.length,invalidCount:rows.length-valid.length,contentHash:rows.length===valid.length?hashSourceContent(buildSourceContent(valid.map(row=>row.entry!))):null}
}
