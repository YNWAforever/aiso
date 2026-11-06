import {it,expect} from 'vitest'
import {parsePromptCsv,previewPromptRows} from '@/lib/prompts/bulk'
it('parses quoted commas, newlines, escaped quotes and BOM',()=>{const rows=parsePromptCsv('\ufeffquestion,category,language,market,is_active\r\n"A, B\nC ""quote""",brand_query,en,HK,true');expect(rows[0].question).toBe('A, B\nC "quote"')})
it('validates every row and refuses duplicates and limits',()=>{const row={question:'Unique',category:'brand_query',language:'en',market:'HK',is_active:true};expect(previewPromptRows([],Array.from({length:24},(_,i)=>({...row,question:'q'+i,is_active:i<10}))).errors).toEqual([]);expect(previewPromptRows([],[row,row]).duplicates).toEqual([2]);expect(previewPromptRows([],Array.from({length:51},(_,i)=>({...row,question:'q'+i}))).errors.some(e=>e.code==='PROMPT_LIMIT_REACHED')).toBe(true);expect(previewPromptRows([],[{...row,language:'fake',market:'',question:' '}]).errors.length).toBeGreaterThan(0)})

import { readFileSync } from 'node:fs'
const existing=Array.from({length:8},(_,i)=>({id:'owned-'+i,question:'Existing question '+i,category:'brand_query',language:'zh-HK',market:'HK',is_active:true}))
it('classifies original mixed CSV mutually exclusively and projects only its applicable row',()=>{
 const rows=parsePromptCsv(readFileSync('docs/remediation/2026-10-12/source/synthetic-mixed.csv','utf8'))
 const preview=previewPromptRows(existing,rows)
 expect(preview.summary).toEqual({totalRows:3,applicableRows:1,duplicateRows:1,invalidRows:1})
 expect(preview.validRows).toHaveLength(1)
 expect(preview.duplicates).toEqual([2])
 expect(preview.activeAfter).toBe(9)
 expect(preview.errors.map(e=>e.code)).toEqual(expect.arrayContaining(['DUPLICATE_PROMPT','INVALID_CATEGORY']))
 expect(existing).toHaveLength(8)
})
it('keeps the existing active question when its proposed update is invalid',()=>{
 const row={...existing[0],question:' ',category:'fake',market:'hk',is_active:false}
 const preview=previewPromptRows(existing,[row])
 expect(preview.summary).toEqual({totalRows:1,applicableRows:0,duplicateRows:0,invalidRows:1})
 expect(preview.errors).toHaveLength(3)
 expect(preview.activeAfter).toBe(8)
})
it('restores a rejected duplicate update before evaluating dependent new rows',()=>{
 const base=[existing[0],existing[1]]
 const changes=[{...existing[0],question:existing[1].question},{...existing[0],id:undefined}]
 const preview=previewPromptRows(base,changes)
 expect(preview.validRows).toEqual([])
 expect(preview.duplicates).toEqual([1,2])
 expect(preview.activeAfter).toBe(2)
 expect(preview.summary).toEqual({totalRows:2,applicableRows:0,duplicateRows:2,invalidRows:0})
})
it('allows simultaneous valid owned-question swaps without duplicate additions',()=>{
 const base=[existing[0],existing[1]]
 const preview=previewPromptRows(base,[{...existing[0],question:existing[1].question},{...existing[1],question:existing[0].question}])
 expect(preview.errors).toEqual([])
 expect(preview.validRows).toHaveLength(2)
 expect(preview.activeAfter).toBe(2)
})

it('caps active questions at the weekly budget but always lets an over-budget brand pause its way down',()=>{
  const row={question:'q',category:'category_query',language:'en',market:'HK',is_active:true}
  const many=(n:number,active=true)=>Array.from({length:n},(_,i)=>({...row,question:'q'+i,is_active:active}))
  expect(previewPromptRows([],many(10)).errors).toEqual([])
  expect(previewPromptRows([],many(11)).errors).toEqual([{row:0,field:'is_active',code:'ACTIVE_LIMIT_REACHED'}])
  expect(previewPromptRows(many(10),[{...row,question:'new'}]).errors.map(e=>e.code)).toEqual(['ACTIVE_LIMIT_REACHED'])
  expect(previewPromptRows(many(10),[{...row,question:'new',is_active:false}]).errors).toEqual([])
  const over=many(24).map((r,i)=>({...r,id:'p'+i}))
  expect(previewPromptRows(over,[{...over[0],is_active:false}]).errors).toEqual([])
  expect(previewPromptRows(over,[{...row,question:'new'}]).errors.map(e=>e.code)).toEqual(['ACTIVE_LIMIT_REACHED'])
})
