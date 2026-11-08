import { describe, it, expect } from 'vitest'
import { parseOnboardingInput, parseSeedPrompts } from '@/lib/onboarding/schema'
import { MAX_COMPETITORS, MAX_NAME_LENGTH } from '@/lib/competitors/limits'
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

const withCompetitors = (competitors: unknown[], brandName = 'Brand') => parseOnboardingInput({ brandName, competitors })
it('accepts the shared competitor cap', () => {
  expect(withCompetitors(Array.from({ length: MAX_COMPETITORS }, (_, i) => `Rival ${i}`)).competitors).toHaveLength(MAX_COMPETITORS)
})
it('refuses one competitor beyond the shared cap', () => {
  expect(() => withCompetitors(Array.from({ length: MAX_COMPETITORS + 1 }, (_, i) => `Rival ${i}`))).toThrow('COMPETITORS_INVALID')
})
it('refuses a competitor name past the shared length', () => {
  expect(() => withCompetitors(['x'.repeat(MAX_NAME_LENGTH + 1)])).toThrow('COMPETITORS_INVALID')
})
it('NFC-normalises and de-duplicates competitors case/width-insensitively, keeping the first spelling', () => {
  expect(withCompetitors([' Acme ', 'ACME', 'ＡＣＭＥ', 'Cafe\u0301']).competitors).toEqual(['Acme', 'Café'])
})
it('refuses the brand itself as a competitor', () => {
  expect(() => withCompetitors([' acme '], 'Acme')).toThrow('COMPETITORS_INVALID')
})

const withDomains = (competitors: string[], competitorDomains: unknown) =>
  parseOnboardingInput({ brandName: 'Brand', competitors, competitorDomains })
it('normalises competitor websites keyed to their competitor', () => {
  expect(withDomains(['Acme', 'Globex'], [
    { name: 'acme', domain: 'https://www.Acme.com/pricing' },
    { name: 'Globex', domain: 'globex.example' },
  ]).competitorDomains).toEqual([
    { name: 'Acme', domain: 'acme.com' },
    { name: 'Globex', domain: 'globex.example' },
  ])
})
it('accepts competitors without websites', () => {
  expect(parseOnboardingInput({ brandName: 'Brand', competitors: ['Acme'] }).competitorDomains).toEqual([])
})
it.each([
  [[{ name: 'Unknown', domain: 'unknown.example' }]],
  [[{ name: 'Acme', domain: 'not a domain' }]],
  [[{ name: 'Acme', domain: 'https://127.0.0.1' }]],
  [[{ name: 'Acme', domain: '   ' }]],
  [[{ name: 'Acme', domain: 'a.example' }, { name: 'ACME', domain: 'b.example' }]],
  [[42]],
])('refuses an unusable competitor website %j', competitorDomains => {
  expect(() => withDomains(['Acme'], competitorDomains)).toThrow('COMPETITORS_INVALID')
})

