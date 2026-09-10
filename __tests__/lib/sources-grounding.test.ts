import { describe, expect, it } from 'vitest'
import {
  assertPermitted,
  citationsOf,
  groundQuestion,
  groundQuestions,
  normalizeQuestion,
} from '@/lib/sources/grounding'
import type { SourceDto } from '@/lib/sources/schema'

/**
 * A grounded draft says the customer's approved words, or says nothing.
 *
 * The two failures guarded against here are opposites, and both are worse than
 * abstaining: answering from a source nobody permitted, and answering a question
 * no source actually covers. The second is the seductive one — a fuzzy match
 * would produce a confident answer with a citation, which reads as verified
 * precisely when it is wrong.
 */

function source(over: Partial<SourceDto> & { entries?: { question: string; answer: string }[] } = {}): SourceDto {
  const { entries, ...rest } = over
  const base: SourceDto = {
    id: 'src-1',
    sourceKey: 'brand-facts',
    kind: 'facts',
    label: 'Brand facts',
    agentUseAllowed: true,
    revokedAt: null,
    latestVersion: 2,
    freshness: 'current',
    updatedAt: '2026-09-01T00:00:00.000Z',
    current: {
      id: 'ver-1',
      versionNumber: 2,
      contentHash: 'a'.repeat(64),
      importMethod: 'paste',
      originRef: null,
      importedAt: '2026-09-01T00:00:00.000Z',
      approvedAt: '2026-09-01T00:00:00.000Z',
      entries: entries ?? [{ question: 'What are your hours?', answer: '9am to 6pm, Monday to Friday.' }],
    },
  }
  return { ...base, ...rest }
}

describe('answering from approved text', () => {
  it('quotes the approved answer verbatim and cites the exact version', () => {
    expect(groundQuestion([source()], 'What are your hours?')).toEqual({
      state: 'grounded',
      question: 'What are your hours?',
      answer: '9am to 6pm, Monday to Friday.',
      citation: {
        sourceId: 'src-1', sourceKey: 'brand-facts', versionNumber: 2,
        contentHash: 'a'.repeat(64), entryIndex: 0,
      },
    })
  })

  it('never rewrites the approved text', () => {
    // A paraphrase of an approved fact is not the approved fact, and the approved
    // fact is what a human signed off.
    const answer = '  Sugar content follows the approved product label.  '
    const result = groundQuestion([source({ entries: [{ question: 'Sugar?', answer }] })], 'Sugar?')

    expect(result.state).toBe('grounded')
    expect((result as { answer: string }).answer).toBe(answer)
  })

  it('matches past case, spacing and trailing punctuation', () => {
    const sources = [source({ entries: [{ question: 'What are your HOURS', answer: '9 to 6' }] })]

    expect(groundQuestion(sources, '  what   are your hours?  ').state).toBe('grounded')
  })

  it.each(['營業時間是甚麼？', '營業時間是甚麼'])('normalises CJK punctuation in %s', question => {
    const sources = [source({ entries: [{ question: '營業時間是甚麼', answer: '早上九點至下午六點' }] })]

    expect(groundQuestion(sources, question).state).toBe('grounded')
  })

  it('cites the entry index, so an edit to a different entry is traceable', () => {
    const sources = [source({ entries: [
      { question: 'Do you deliver?', answer: 'Yes' },
      { question: 'What are your hours?', answer: '9 to 6' },
    ] })]

    const result = groundQuestion(sources, 'What are your hours?')

    expect((result as { citation: { entryIndex: number } }).citation.entryIndex).toBe(1)
  })
})

describe('abstaining rather than inventing', () => {
  it('abstains when no source covers the question', () => {
    // The seductive failure: a fuzzy match would answer this confidently, with a
    // citation, and be wrong.
    expect(groundQuestion([source()], 'Do you ship to Singapore?')).toEqual({
      state: 'abstained', question: 'Do you ship to Singapore?', reason: 'no-supporting-source',
    })
  })

  it('abstains when there are no permitted sources at all', () => {
    expect(groundQuestion([], 'What are your hours?')).toEqual({
      state: 'abstained', question: 'What are your hours?', reason: 'no-permitted-sources',
    })
  })

  it('will not match a merely similar question', () => {
    const sources = [source({ entries: [{ question: 'What are your opening hours on Sunday?', answer: 'Closed' }] })]

    // Similar, and not the same question. Answering "Closed" to "what are your
    // hours" would be a wrong answer wearing a citation.
    expect(groundQuestion(sources, 'What are your hours?').state).toBe('abstained')
  })

  it('refuses to choose between two approved sources that disagree', () => {
    const a = source({ id: 'src-1', sourceKey: 'facts-a', entries: [{ question: 'Hours?', answer: '9 to 6' }] })
    const b = source({ id: 'src-2', sourceKey: 'facts-b', entries: [{ question: 'Hours?', answer: '10 to 7' }] })

    const result = groundQuestion([a, b], 'Hours?')

    // Picking one silently would present a single customer-approved fact as if it
    // were the only one. A human resolves this.
    expect(result.state).toBe('abstained')
    expect((result as { reason: string }).reason).toBe('conflicting-sources')
    expect((result as { conflicts: { sourceKey: string }[] }).conflicts.map(c => c.sourceKey))
      .toEqual(['facts-a', 'facts-b'])
  })

  it('treats identical text in two sources as agreement, not conflict', () => {
    const a = source({ id: 'src-1', sourceKey: 'facts-a', entries: [{ question: 'Hours?', answer: '9 to 6' }] })
    const b = source({ id: 'src-2', sourceKey: 'facts-b', entries: [{ question: 'Hours?', answer: '9 to 6' }] })

    expect(groundQuestion([a, b], 'Hours?').state).toBe('grounded')
  })
})

describe('a source that must never reach a draft', () => {
  it.each([
    ['revoked', { revokedAt: '2026-09-02T00:00:00.000Z' } as Partial<SourceDto>, /revoked/],
    ['not permitted for agent use', { agentUseAllowed: false } as Partial<SourceDto>, /not permitted/],
    ['unapproved', { current: { ...source().current!, approvedAt: null } } as Partial<SourceDto>, /no approved version/],
  ])('throws for a %s source rather than filtering it out', (_label, over, message) => {
    // Throwing is deliberate. The caller is meant to pass listAgentUsableSources,
    // which already filters; if they did not they have a bug, and filtering here
    // would hide it while a revoked source sat one refactor from a draft.
    expect(() => groundQuestion([source(over)], 'What are your hours?')).toThrow(message)
    expect(() => assertPermitted([source(over)])).toThrow(message)
  })

  it('accepts a source that passed every gate', () => {
    expect(() => assertPermitted([source()])).not.toThrow()
  })
})

describe('citations a work version should snapshot', () => {
  it('collects only what was actually used', () => {
    const grounding = groundQuestions([source()], ['What are your hours?', 'Do you ship to Singapore?'])

    expect(grounding.map(entry => entry.state)).toEqual(['grounded', 'abstained'])
    // An abstention cites nothing, because it used nothing.
    expect(citationsOf(grounding)).toHaveLength(1)
    expect(citationsOf(grounding)[0]!.contentHash).toBe('a'.repeat(64))
  })

  it('is empty when everything abstained', () => {
    expect(citationsOf(groundQuestions([], ['a', 'b']))).toEqual([])
  })
})

describe('normalizeQuestion', () => {
  it.each([
    ['  Hello  World  ', 'hello world'],
    ['Hours?', 'hours'],
    ['營業時間？', '營業時間'],
    ['SHOUTING!!', 'shouting'],
  ])('normalises %j', (input, expected) => {
    expect(normalizeQuestion(input)).toBe(expected)
  })

  it('keeps internal punctuation, which carries meaning', () => {
    expect(normalizeQuestion('Do you deliver, locally?')).toBe('do you deliver, locally')
  })
})
