import { describe, it, expect } from 'vitest'
import { parseOnboardingInput, parseSeedPrompts } from '@/lib/onboarding/schema'
describe('persistent onboarding input and provider validation', () => {
  it('derives a stable legacy intent from normalized brand and domain', () => {
    expect(parseOnboardingInput({brandName:' Synthetic ',domain:'synthetic.test'}).intentKey)
      .toBe(parseOnboardingInput({brandName:'synthetic',domain:'synthetic.test'}).intentKey)
  })
  it('deduplicates generated questions and drops invalid categories before writing', () => {
    const valid={category:'brand_query',question:'Synthetic question?',language:'en'}
    expect(parseSeedPrompts(JSON.stringify([valid, valid, {...valid,category:'invented'}, {...valid,question:''}]))).toEqual([valid])
  })
  it.each(['{}','not JSON','[]','[{"category":"invented","question":"q"}]'])('fails an unusable provider response %s', raw => {
    expect(()=>parseSeedPrompts(raw)).toThrow()
  })
  it('bounds a seed to 24 actual validated prompts', () => {
    expect(parseSeedPrompts(JSON.stringify(Array.from({length:100},(_,i)=>({category:'brand_query',question:`Question ${i}`,language:'en'}))))).toHaveLength(24)
  })
})
