import { describe, it, expect } from 'vitest'
import { parseOnboardingInput, parseSeedPrompts } from '@/lib/onboarding/schema'
describe('persistent onboarding input and provider validation', () => {
  it('derives a stable legacy intent from normalized brand and domain', () => {
    expect(parseOnboardingInput({brandName:' Synthetic ',domain:'synthetic.test'}).intentKey)
      .toBe(parseOnboardingInput({brandName:'synthetic',domain:'synthetic.test'}).intentKey)
  })
  it('deduplicates generated questions and drops invalid categories before writing', () => {
    const valid={category:'brand_query',question:'Synthetic question?',language:'en'}
    expect(parseSeedPrompts(JSON.stringify([valid, valid, {...valid,category:'invented'}, {...valid,question:''}]))).toEqual([{ ...valid, market: null }])
  })
  it.each(['{}','not JSON','[]','[{"category":"invented","question":"q"}]'])('fails an unusable provider response %s', raw => {
    expect(()=>parseSeedPrompts(raw)).toThrow()
  })
  it('bounds a seed to 24 actual validated prompts', () => {
    expect(parseSeedPrompts(JSON.stringify(Array.from({length:100},(_,i)=>({category:'brand_query',question:`Question ${i}`,language:'en'}))))).toHaveLength(24)
  })
})

it('normalizes safe domains and canonical industries without fetching them',()=>{const a=parseOnboardingInput({brandName:'Brand',domain:'https://www.example.com/path',industry:'Technology'});expect(a.domain).toBe('example.com');expect(a.industry).toBe('technology')});
it.each([42,'https://user:pass@example.com','http://localhost','https://127.0.0.1'])('rejects unsafe onboarding domain %s',domain=>expect(()=>parseOnboardingInput({brandName:'Brand',domain})).toThrow());
