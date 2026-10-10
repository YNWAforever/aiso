import {describe,it,expect,vi} from 'vitest'
vi.mock('@/lib/openrouter',()=>({callOpenRouter:vi.fn(async()=>{throw new Error('Synthetic outage')})}))
import {naiveAnalysis,analyseAnswer} from '@/lib/pulse/analysis'
import {coerceAnalysis} from '@/lib/pulse/analysis-fallback'

describe('uncertain Pulse classification',()=>{
  it('validated negative sentiment stays negative and never uses a character offset as rank',()=>{
    expect(coerceAnalysis({brand_mentioned:true,sentiment:'negative',competitors_mentioned:[]},'Fimmick is terrible.','Fimmick'))
      .toMatchObject({classificationStatus:'classified',brandMentioned:true,sentiment:'negative',matchedText:['Fimmick'],mentionPosition:0})
  })
  it('rejects an affirmative model guess without whole-brand literal evidence',()=>{
    expect(coerceAnalysis({brand_mentioned:true,sentiment:'positive',competitors_mentioned:[]},'Fresh pineapple juice.','Apple')).toBeNull()
  })
  it('accepts an explicit unrelated fruit decision and keeps sentiment unknown',()=>{
    expect(coerceAnalysis({brand_mentioned:false,sentiment:'not_mentioned',competitors_mentioned:[]},'An apple is a fruit.','Apple'))
      .toMatchObject({classificationStatus:'classified',brandMentioned:false,sentiment:'unknown',matchedText:[]})
  })
  it('does not infer aliases or hallucinated competitors',()=>{
    expect(coerceAnalysis({brand_mentioned:true,sentiment:'positive',competitors_mentioned:['Invisible']},'Fimmick works.','Fimmick',['Invisible']))
      .toMatchObject({competitorsMentioned:[]})
    expect(naiveAnalysis('A private alias works.','Fimmick')).toMatchObject({brandMentioned:null,matchedText:[]})
  })
  it('fallback_negative_is_unknown',()=>{
    expect(naiveAnalysis('I do not recommend Fimmick; the service was terrible.','Fimmick'))
      .toMatchObject({classificationStatus:'fallback',brandMentioned:null,sentiment:'unknown',matchedText:['Fimmick']})
  })
  it('pineapple_is_not_apple',()=>{
    const result=naiveAnalysis('Fresh pineapple juice is available.','Apple')
    expect(result.brandMentioned).not.toBe(true)
    expect(result).toMatchObject({sentiment:'unknown',matchedText:[]})
  })
  it.each([
    ['Use Cafe\u0301 for coffee.','Café',['Café']],
    ['我推薦Ａｐｐｌｅ的產品。','Apple',['Apple']],
    ['香港品牌值得考慮。','香港品牌',['香港品牌']],
    ['ApplePay and pineapple are words.','Apple',[]],
  ])('unicode_brand_match_is_explicit: %s',(answer,brand,matchedText)=>{
    expect(naiveAnalysis(answer,brand)).toMatchObject({brandMentioned:null,sentiment:'unknown',matchedText})
  })
  // Written forms an answer uses for the same name. The evidence is the span as
  // the answer wrote it, never the brand as configured.
  it.each([
    ['fimmick-aeo is a tool.','Fimmick AEO',['fimmick-aeo']],
    ['Fimmick  AEO is a tool.','Fimmick AEO',['Fimmick  AEO']],
    ['Try FimmickAEO today.','Fimmick AEO',['FimmickAEO']],
    ['Fimmick_AEO is a tool.','Fimmick AEO',['Fimmick_AEO']],
    ['Café Lux opened downtown.','Cafe Lux',['Café Lux']],
    ['Cafe Lux opened downtown.','Café Lux',['Cafe Lux']],
    ['Visit A.S. Watson today.','AS Watson',['A.S. Watson']],
    ['Visit AS Watson today.','A.S. Watson',['AS Watson']],
    ['Acme Inc. is reliable.','Acme Inc',['Acme Inc']],
    ['삼성전자는 좋다','삼성전자',['삼성전자']],
    ['ร้านกาแฟดี','ร้านกาแฟ',['ร้านกาแฟ']],
  ])('written_variants_of_one_name_match: %s',(answer,brand,matchedText)=>{
    expect(naiveAnalysis(answer,brand)).toMatchObject({matchedText})
  })
  it.each([
    ['Fimmick AEOS is different.','Fimmick AEO'],
    ['FimmickAEOTool is different.','Fimmick AEO'],
    ['A deluxe room.','Lux'],
    ['He has Watson on speed dial.','AS Watson'],
    ['Pineapple Lux is a juice.','Apple Lux'],
    // Accent folding is Latin-only: a Thai tone mark or a Hangul syllable is
    // part of the letter, so a different mark is a different name.
    ['ร้านกาแฟดี','ร้านกาแฝ'],
  ])('variant_folding_keeps_word_boundaries: %s',(answer,brand)=>{
    expect(naiveAnalysis(answer,brand)).toMatchObject({matchedText:[]})
  })
  it('a separator variant counts as literal evidence for the classifier',()=>{
    const result=coerceAnalysis({brand_mentioned:true,sentiment:'positive',competitors_mentioned:[]},'Fimmick-AEO beats AS-Watson.','Fimmick AEO',['A.S. Watson'])
    expect(result).toMatchObject({classificationStatus:'classified',matchedText:['Fimmick-AEO'],mentionPosition:0})
    expect(result?.competitorsMentioned).toContain('A.S. Watson')
  })
  it('classifier outage keeps uncertainty and literal evidence',async()=>{
    expect(await analyseAnswer({answer:'Fimmick is terrible.',brandName:'Fimmick'}))
      .toMatchObject({classificationStatus:'fallback',sentiment:'unknown',brandMentioned:null})
  })
})
