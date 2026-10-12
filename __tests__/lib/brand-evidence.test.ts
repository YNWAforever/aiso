import {expect,it}from'vitest'
import{validateBrandEvidence}from'@/lib/onboarding/brand-evidence'
it('matches only exact normalized page quotes and recognized fields',()=>{
 const page='Cafe\u0301 Studio\n  teaches design. 香港工作室提供設計。'
 expect(validateBrandEvidence(page,[{field:'brandName',quote:'Café Studio'},{field:'description',quote:'teaches\n design.'},{field:'industry',quote:'fabricated authority'},{field:'password',quote:'Café Studio'},null])).toEqual([{field:'brandName',quote:'Café Studio'},{field:'description',quote:'teaches design.'}])
})
it('limits quote size, total retained quotes, and never treats blank/source-only values as evidence',()=>{
 const page=Array.from({length:8},(_,i)=>'Fact'+i).join(' ')
 const candidates=Array.from({length:8},(_,i)=>({field:'description',quote:'Fact'+i}))
 expect(validateBrandEvidence(page,candidates)).toHaveLength(6)
 expect(validateBrandEvidence('a'.repeat(241),[{field:'description',quote:'a'.repeat(241)},{field:'brandName',quote:'   '}])).toEqual([])
 expect(validateBrandEvidence(page,{field:'description',quote:'Fact0'})).toEqual([])
})
