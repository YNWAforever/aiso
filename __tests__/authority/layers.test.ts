import { describe, it, expect } from 'vitest'
import { scoreLayer1 } from '@/lib/authority/layer1-tld'
import { scoreLayer3 } from '@/lib/authority/layer3-industry'
import { scoreLayer4 } from '@/lib/authority/layer4-regional'

describe('Layer 1 — TLD scoring', () => {
  it('scores .gov as 10', () => {
    expect(scoreLayer1('nih.gov').baseScore).toBe(10)
  })
  it('scores .edu as 9', () => {
    expect(scoreLayer1('mit.edu').baseScore).toBe(9)
  })
  it('scores gov.hk pattern as 9', () => {
    expect(scoreLayer1('hkma.gov.hk').baseScore).toBe(9)
  })
  it('scores .org as 6', () => {
    expect(scoreLayer1('wikipedia.org').baseScore).toBe(6)
  })
  it('scores .com as 3', () => {
    expect(scoreLayer1('bloomberg.com').baseScore).toBe(3)
  })
  it('scores unknown TLD as 2', () => {
    expect(scoreLayer1('example.xyz').baseScore).toBe(2)
  })
})

describe('Layer 3 — Industry pack scoring', () => {
  it('scores bloomberg.com as tier1 for finance', () => {
    const r = scoreLayer3('bloomberg.com', 'finance')
    expect(r.tier).toBe('tier1')
    expect(r.score).toBe(10)
    expect(r.multiplier).toBe(1.5)
    expect(r.adjustedScore).toBe(10) // capped at 10
  })
  it('scores nih.gov as tier1 for medical', () => {
    expect(scoreLayer3('nih.gov', 'medical').tier).toBe('tier1')
  })
  it('scores bloomberg.com as other for medical (wrong industry)', () => {
    expect(scoreLayer3('bloomberg.com', 'medical').tier).toBe('other')
  })
  it('scores unknown domain as other', () => {
    expect(scoreLayer3('random-site.com', 'technology').tier).toBe('other')
  })
  it('uses medical multiplier of 2.0 correctly', () => {
    // tier2 score=7 * 2.0 = 14, capped at 10
    const r = scoreLayer3('mayoclinic.org', 'medical')
    expect(r.tier).toBe('tier2')
    expect(r.adjustedScore).toBe(10)
  })
})

describe('Layer 4 — Regional pack scoring', () => {
  it('scores scmp.com as tier2 for HK', () => {
    expect(scoreLayer4('scmp.com', 'HK').tier).toBe('tier2')
    expect(scoreLayer4('scmp.com', 'HK').score).toBe(7)
  })
  it('scores hkma.gov.hk as tier1 for HK', () => {
    expect(scoreLayer4('hkma.gov.hk', 'HK').tier).toBe('tier1')
  })
  it('scores unknown domain as other for HK', () => {
    expect(scoreLayer4('unknown-xyz.com', 'HK').tier).toBe('other')
    expect(scoreLayer4('unknown-xyz.com', 'HK').score).toBe(0)
  })
  it('scores nytimes.com as tier2 for US', () => {
    expect(scoreLayer4('nytimes.com', 'US').tier).toBe('tier2')
  })
  it('scores whitehouse.gov as tier1 for US', () => {
    expect(scoreLayer4('whitehouse.gov', 'US').tier).toBe('tier1')
  })
})
