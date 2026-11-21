import { describe, expect, it } from 'vitest'
import { groupObservations } from '@/lib/observations/group'
import type { Observation } from '@/lib/observations/types'

const base = {
  sourceKind: 'pulse-metric' as const,
  scanWeek: '2026-11-16',
  recordedAt: null,
  collectedAt: null,
  model: null,
  market: null,
  currentPrompt: null,
  limitations: [],
}

function item(overrides: Partial<Observation> & Pick<Observation, 'id' | 'platform'>): Observation {
  return {
    ...base,
    promptId: 'prompt-1',
    question: 'FOTOMAX 邊度有分店？',
    result: 'success',
    hasAnswer: true,
    brandMentioned: true,
    ...overrides,
  }
}

describe('groupObservations', () => {
  it('puts every platform row for one question under one group', () => {
    const groups = groupObservations([
      item({ id: '1', platform: 'ChatGPT' }),
      item({ id: '2', platform: 'Gemini', brandMentioned: false }),
      item({ id: '3', platform: 'Perplexity', brandMentioned: null, result: 'incomplete', hasAnswer: false }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      promptId: 'prompt-1',
      platforms: ['ChatGPT', 'Gemini', 'Perplexity'],
      mentioned: 1,
      notMentioned: 1,
      unknownMention: 1,
      complete: 2,
      incomplete: 1,
      answerless: 1,
    })
  })

  it('keeps two questions separate and preserves their first-seen order', () => {
    const groups = groupObservations([
      item({ id: '1', platform: 'ChatGPT', promptId: 'prompt-1' }),
      item({ id: '2', platform: 'Gemini', promptId: 'prompt-2', question: '邊間沖印店最好？' }),
      item({ id: '3', platform: 'Perplexity', promptId: 'prompt-1' }),
    ])
    expect(groups.map(group => group.question)).toEqual(['FOTOMAX 邊度有分店？', '邊間沖印店最好？'])
    expect(groups[0].items).toHaveLength(2)
  })

  it('falls back to normalised question text for legacy rows without a prompt id', () => {
    const groups = groupObservations([
      item({ id: '1', platform: 'ChatGPT', promptId: null }),
      item({ id: '2', platform: 'Gemini', promptId: null, question: '  FOTOMAX   邊度有分店？ ' }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].promptId).toBeNull()
    expect(groups[0].key).toBe('question:fotomax 邊度有分店？')
  })

  it('separates edited wording for a single prompt', () => {
    const groups = groupObservations([
      item({ id: '1', platform: 'ChatGPT', question: 'Original wording?' }),
      item({ id: '2', platform: 'Gemini', question: 'Edited wording?' }),
    ])
    expect(groups.map(group => group.question)).toEqual(['Original wording?', 'Edited wording?'])
  })

  it('returns no groups for an empty page', () => {
    expect(groupObservations([])).toEqual([])
  })
})
