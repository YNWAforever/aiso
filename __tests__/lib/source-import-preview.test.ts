import { expect, it } from 'vitest'
import { previewSourceImport } from '@/lib/sources/import-preview'
import { mergePreviewRetry } from '@/lib/sources/preview-state'
it('retry_invalid_csv_rows_preserves_valid_rows',()=>{
 const csv=Array.from({length:200},(_,i)=>`Question ${i},${i===199?'':'Answer'}`).join('\n')
 const preview=previewSourceImport({csv})
 expect(preview).toMatchObject({validCount:199,invalidCount:1,contentHash:null})
 const retried=previewSourceImport({rows:preview.rows.filter(row=>row.errorCode!==null).map(row=>({...row,answer:'Corrected'}))})
 const full=mergePreviewRetry(preview,retried)
 expect(full.rows).toHaveLength(200)
 expect(full.validCount).toBe(200)
 expect(full.rows[0]).toEqual(preview.rows[0])
 expect(previewSourceImport({rows:full.rows})).toMatchObject({validCount:200,invalidCount:0,contentHash:expect.stringMatching(/^[a-f0-9]{64}$/)})
})
it('reports blank, overlong, extra-column and duplicate rows without dropping them',()=>{
 const result=previewSourceImport({csv:`Hours?,a\nHours?,b\n,\nq4,${'x'.repeat(4001)}\nq5,a,extra`})
 expect(result.rows.map(row=>row.errorCode)).toEqual([null,'SOURCE_DUPLICATE_QUESTION','SOURCE_QUESTION_INVALID','SOURCE_ANSWER_INVALID','SOURCE_CSV_COLUMNS_INVALID'])
 expect(result.rows[1].duplicateOf).toBe(1)
})
it('keeps formula text safe and catches cross-retry duplicates and invalid retry membership',()=>{
 const previous=previewSourceImport({csv:'q,=SUM(1)\nq2,'})
 expect(previous.rows[0].entry?.answer).toBe("'=SUM(1)")
 const retry=previewSourceImport({rows:[{rowNumber:2,question:'q',answer:'new'}]})
 expect(mergePreviewRetry(previous,retry).rows[1]).toMatchObject({entry:null,errorCode:'SOURCE_DUPLICATE_QUESTION',duplicateOf:1})
 expect(()=>mergePreviewRetry(previous,previewSourceImport({rows:[{rowNumber:1,question:'q',answer:'new'}]}))).toThrow('SOURCE_PREVIEW_INVALID')
 expect(()=>previewSourceImport({csv:Array.from({length:201},(_,index)=> `Question ${index},answer`).join('\n')})).toThrow('SOURCE_ENTRIES_LIMIT')
})
