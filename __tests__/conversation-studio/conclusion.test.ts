import { describe, expect, it } from 'vitest'
import { composeConclusion } from '@/lib/conversation-studio/conclusion'
import { composeSavedReply } from '@/lib/conversation-studio/reply'
import type { StudioEvidence, StudioReply } from '@/lib/conversation-studio/types'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'
import { savedStudioEvidence, savedStudioScan } from '../helpers/studio-evidence'

const base = savedStudioEvidence.observations[0]!
const observation = (id: string, overrides: Partial<typeof base>) => ({ ...base, id, ...overrides })
const evidence: StudioEvidence = {
  ...savedStudioEvidence,
  observations: [
    observation('a', { platform: 'chatgpt', brandMentioned: true }),
    observation('b', { platform: 'perplexity', brandMentioned: false }),
    observation('c', { platform: 'gemini', brandMentioned: true }),
    observation('d', { platform: 'gemini', result: 'failed' as never, brandMentioned: null }), // not classified
  ],
  scan: { ...savedStudioScan!, evidence: { ...savedStudioScan!.evidence, checks: [
    { key: 'c1', collection: 'complete', assessment: 'fail' }, { key: 'c2', collection: 'complete', assessment: 'warn' },
    { key: 'c3', collection: 'complete', assessment: 'pass' }, { key: 'c4', collection: 'failed', assessment: 'fail' }, // not complete: not counted
  ] as never } },
}

describe('composeConclusion', () => {
  it('pulse leads with counted mentions over classified answers only, and names the uncounted', () => {
    const conclusion = composeConclusion(composeSavedReply('', 'pulse', evidence))
    expect(conclusion.headline).toEqual({ key: 'pulseMentions', values: { mentioned: 2, classified: 3 } })
    expect(conclusion.findings).toEqual([
      { key: 'pulsePlatforms', values: { platforms: 'chatgpt · gemini · perplexity' } },
      { key: 'pulseUnclassified', values: { count: 1 } },
    ])
  })

  it('brief counts only completed scan checks', () => {
    const conclusion = composeConclusion(composeSavedReply('', 'brief', evidence))
    expect(conclusion.headline).toEqual({ key: 'scanNeedsWork', values: { fail: 1, warn: 1 } })
    expect(conclusion.findings[0]).toEqual({ key: 'scanPassing', values: { pass: 1, assessed: 3 } })
  })

  it('competitors always says comparison is pending verification first', () => {
    expect(composeConclusion(composeSavedReply('', 'competitors', evidence)).headline.key).toBe('competitorsUnverified')
  })

  it('states absence instead of a zero when nothing can be counted', () => {
    const empty: StudioEvidence = { ...evidence, observations: [], scan: null }
    expect(composeConclusion(composeSavedReply('', 'pulse', empty)).headline.key).toBe('pulseNone')
    expect(composeConclusion(composeSavedReply('', 'brief', empty)).headline.key).toBe('scanNone')
    expect(composeConclusion(composeSavedReply('anything', null, empty)).headline.key).toBe('questionNone')
    expect(composeConclusion(composeSavedReply('', 'opportunity', empty)).headline.key).toBe('opportunityNone')
  })

  it('a free question reports how many saved answers matched', () => {
    expect(composeConclusion(composeSavedReply('sourdough', null, evidence)).headline).toEqual({ key: 'questionMatched', values: { count: 4 } })
  })

  it('every key it can emit exists in both locales', () => {
    const keys = new Set<string>()
    const replies: StudioReply[] = [null, 'pulse', 'brief', 'report', 'competitors', 'opportunity'].flatMap(template => [
      composeSavedReply('sourdough', template as never, evidence), composeSavedReply('', template as never, { ...evidence, observations: [], scan: null }),
    ])
    for (const reply of replies) {
      const c = composeConclusion(reply)
      for (const line of [c.headline, ...c.findings]) keys.add(line.key)
    }
    for (const messages of [en, zh]) for (const key of keys) expect(messages.conversationStudio.conclusion, key).toHaveProperty(key)
  })
})
