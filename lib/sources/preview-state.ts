import type { PreviewRows } from './import-preview'
/** A retry changes only previously invalid rows; complete valid content remains in memory. */
export function mergePreviewRetry(previous:PreviewRows,retry:PreviewRows):PreviewRows{
 const allowed=new Set(previous.rows.filter(row=>row.errorCode!==null).map(row=>row.rowNumber))
 if(retry.rows.some(row=>!allowed.has(row.rowNumber))||retry.rows.length!==allowed.size)throw new Error('SOURCE_PREVIEW_INVALID')
 const replacements=new Map(retry.rows.map(row=>[row.rowNumber,row]))
 const questions=new Map(previous.rows.filter(row=>row.entry!==null).map(row=>[row.entry!.question.toLocaleLowerCase('en'),row.rowNumber]))
 const rows=previous.rows.map(row=>{
  const next=replacements.get(row.rowNumber)
  if(!next)return row
  if(next.entry){const key=next.entry.question.toLocaleLowerCase('en'),duplicateOf=questions.get(key)
   if(duplicateOf!==undefined)return{...next,entry:null,errorCode:'SOURCE_DUPLICATE_QUESTION',duplicateOf}
   questions.set(key,next.rowNumber)
  }
  return next
 })
 const validCount=rows.filter(row=>row.entry!==null).length
 return{rows,validCount,invalidCount:rows.length-validCount,contentHash:null}
}
