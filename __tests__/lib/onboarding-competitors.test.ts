import { describe, expect, it } from 'vitest'
import { MAX_COMPETITORS, MAX_NAME_LENGTH } from '@/lib/competitors/limits'
import { addCompetitorNames, competitorKey, mergeSuggestedCompetitors, splitCompetitorInput } from '@/lib/onboarding/competitors'

describe('splitCompetitorInput', () => {
  it('splits a pasted list on ASCII and full-width commas and newlines', () => {
    expect(splitCompetitorInput(' Semrush, Ahrefs，Moz\nSE Ranking , '))
      .toEqual(['Semrush', 'Ahrefs', 'Moz', 'SE Ranking'])
  })
  it('returns an empty list for blank input', () => {
    expect(splitCompetitorInput(' , ，\n ')).toEqual([])
  })
})

describe('competitorKey', () => {
  it('folds width and case so one brand compares as one', () => {
    expect(competitorKey(' ＡＣＭＥ ')).toBe(competitorKey('acme'))
  })
})

describe('addCompetitorNames', () => {
  it('adds a pasted list, trimming and NFC-normalising each name', () => {
    expect(addCompetitorNames([], ' Cafe\u0301 , Ogilvy ', 'Brand').competitors).toEqual(['Café', 'Ogilvy'])
  })
  it('keeps the first spelling of a case/width-insensitive duplicate', () => {
    expect(addCompetitorNames([], 'Acme, ACME, ＡＣＭＥ', 'Brand').competitors).toEqual(['Acme'])
  })
  it('does not add the brand itself', () => {
    expect(addCompetitorNames([], 'ＡＣＭＥ', 'Acme')).toEqual({ competitors: [], problem: 'brand' })
  })
  it('refuses a name past the shared limit without adding the rest of the paste', () => {
    const existing = ['Rival 1']
    expect(addCompetitorNames(existing, `Rival 2, ${'x'.repeat(MAX_NAME_LENGTH + 1)}`, 'Brand'))
      .toEqual({ competitors: existing, problem: 'too_long' })
  })
  it('stops at the shared cap and reports it', () => {
    const existing = Array.from({ length: MAX_COMPETITORS - 1 }, (_, i) => `Rival ${i}`)
    const result = addCompetitorNames(existing, 'Last, Extra', 'Brand')
    expect(result.competitors).toHaveLength(MAX_COMPETITORS)
    expect(result.competitors.at(-1)).toBe('Last')
    expect(result.problem).toBe('limit')
  })
  it('ignores an add that is already present', () => {
    expect(addCompetitorNames(['Acme'], 'acme', 'Brand')).toEqual({ competitors: ['Acme'], problem: null })
  })
})

describe('mergeSuggestedCompetitors', () => {
  it('adds confirmed proposals with their websites', () => {
    expect(mergeSuggestedCompetitors([], [
      { name: 'Semrush', domain: 'semrush.com' },
      { name: 'Ahrefs', domain: null },
    ], 'Brand')).toEqual({ competitors: ['Semrush', 'Ahrefs'], domains: { Semrush: 'semrush.com' } })
  })
  it('attaches a website to a competitor the member already typed', () => {
    expect(mergeSuggestedCompetitors(['acme'], [{ name: 'ACME', domain: 'acme.com' }], 'Brand'))
      .toEqual({ competitors: ['acme'], domains: { acme: 'acme.com' } })
  })
  it('never proposes the brand itself and never exceeds the shared cap', () => {
    expect(mergeSuggestedCompetitors([], [{ name: 'brand', domain: 'brand.com' }], 'Brand').competitors).toEqual([])
    const existing = Array.from({ length: 10 }, (_, i) => `Rival ${i}`)
    expect(mergeSuggestedCompetitors(existing, [{ name: 'Extra', domain: 'extra.example' }], 'Brand').competitors).toHaveLength(10)
  })
})
