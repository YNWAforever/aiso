import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'

const provider=vi.hoisted(()=>({reply:'',fails:false}))
vi.mock('@/lib/openrouter',()=>({
  callOpenRouter:vi.fn(async(options:Parameters<typeof import('@/lib/openrouter').callOpenRouter>[0])=>{
    if(provider.fails)throw new Error('PRIVATE provider failure')
    options.onEvidence?.({answer:provider.reply,actualModel:'synthetic/classifier',requestId:'synthetic-request',
      promptTokens:25,completionTokens:10,costUsd:0.001,httpStatus:200})
    return provider.reply
  }),
}))
import {analyseAnswer} from '@/lib/pulse/analysis'
import {callOpenRouter} from '@/lib/openrouter'

beforeEach(()=>{provider.reply='';provider.fails=false;vi.clearAllMocks()})
afterEach(()=>vi.restoreAllMocks())

describe('Pulse classifier provider contract',()=>{
  it.each([
    {decision:{brand_mentioned:false,sentiment:'not_mentioned',competitors_mentioned:[]},answer:'Other companies are listed.',
      expected:{classificationStatus:'classified',brandMentioned:false,sentiment:'unknown',matchedText:[]}},
    {decision:{brand_mentioned:true,sentiment:'unknown',competitors_mentioned:[]},answer:'Fimmick is listed.',
      expected:{classificationStatus:'classified',brandMentioned:true,sentiment:'unknown',matchedText:['Fimmick']}},
    {decision:{brand_mentioned:null,sentiment:'unknown',competitors_mentioned:[]},answer:'Fimmick is listed.',
      expected:{classificationStatus:'fallback',brandMentioned:null,sentiment:'unknown',matchedText:['Fimmick'],diagnosticReason:'brand_identity_uncertain'}},
  ])('preserves the provider decision $decision',async({decision,answer,expected})=>{
    provider.reply=JSON.stringify(decision)
    const result=await analyseAnswer({answer,brandName:'Fimmick'})
    expect(result).toMatchObject(expected)
    expect(result.providerUsage).toEqual({requestId:'synthetic-request',model:'synthetic/classifier',promptTokens:25,completionTokens:10,costUsd:0.001})
  })
  it.each([
    'PRIVATE malformed output',
    '{"brand_mentioned":',
    '{"sentiment":"unknown","competitors_mentioned":[]}',
    '{"brand_mentioned":"false","sentiment":"unknown","competitors_mentioned":[]}',
    '{"brand_mentioned":null,"sentiment":"positive","competitors_mentioned":[]}',
  ])('diagnoses invalid provider output without exposing it: %s',async reply=>{
    provider.reply=reply
    const log=vi.spyOn(console,'error').mockImplementation(()=>{})
    const result=await analyseAnswer({answer:'Fimmick is listed.',brandName:'Fimmick'})
    expect(result).toMatchObject({classificationStatus:'fallback',brandMentioned:null,sentiment:'unknown',diagnosticReason:'invalid_classifier_output'})
    expect(result.providerUsage?.requestId).toBe('synthetic-request')
    expect(JSON.stringify(result)).not.toContain(reply)
    expect(log).not.toHaveBeenCalled()
  })
  it('rejects an affirmative provider guess without saved literal evidence',async()=>{
    provider.reply='{"brand_mentioned":true,"sentiment":"unknown","competitors_mentioned":[]}'
    expect(await analyseAnswer({answer:'Fresh pineapple juice.',brandName:'Apple'}))
      .toMatchObject({classificationStatus:'fallback',brandMentioned:null,sentiment:'unknown',matchedText:[],diagnosticReason:'invalid_classifier_output'})
  })
  it('distinguishes a provider exception from invalid classifier output',async()=>{
    provider.fails=true
    const result=await analyseAnswer({answer:'Fimmick is listed.',brandName:'Fimmick'})
    expect(result).toMatchObject({classificationStatus:'fallback',brandMentioned:null,diagnosticReason:'provider_error',providerUsage:null})
    expect(JSON.stringify(result)).not.toContain('PRIVATE')
  })
  it('does not charge the provider for an empty saved answer',async()=>{
    expect(await analyseAnswer({answer:' \n ',brandName:'Fimmick'}))
      .toMatchObject({classificationStatus:'fallback',diagnosticReason:'empty_answer',providerUsage:null})
    expect(callOpenRouter).not.toHaveBeenCalled()
  })
})
