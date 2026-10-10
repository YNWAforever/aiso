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
  it('classifier outage keeps uncertainty and literal evidence',async()=>{
    expect(await analyseAnswer({answer:'Fimmick is terrible.',brandName:'Fimmick'}))
      .toMatchObject({classificationStatus:'fallback',sentiment:'unknown',brandMentioned:null})
  })
})
