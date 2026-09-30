import { describe, expect, it } from 'vitest'
import { AI_ASSISTANT_HOSTS, SOURCE_CLASSES, classifySource } from '@/lib/integrations/analytics/sources'

describe('SOURCE_CLASSES', () => {
  it('is exactly the three classes, in order', () => {
    expect([...SOURCE_CLASSES]).toEqual(['organic_search', 'ai_assistant', 'other'])
  })
})

describe('AI_ASSISTANT_HOSTS', () => {
  it('holds the initial host list', () => {
    expect([...AI_ASSISTANT_HOSTS]).toEqual([
      'chatgpt.com',
      'chat.openai.com',
      'openai.com',
      'perplexity.ai',
      'gemini.google.com',
      'bard.google.com',
      'copilot.microsoft.com',
      'claude.ai',
      'you.com',
      'phind.com',
      'deepseek.com',
    ])
  })
})

describe('classifySource', () => {
  it.each([
    ['chatgpt.com', 'Referral'],
    ['chat.openai.com', 'Referral'],
    ['www.perplexity.ai', 'Referral'],
    ['Perplexity.ai', 'Referral'],
    ['  PERPLEXITY.AI  ', 'Referral'],
    ['copilot.microsoft.com', 'Referral'],
    ['gemini.google.com', 'Referral'],
    ['claude.ai', 'Direct'],
  ])('%s with channel %s is ai_assistant', (source, channel) => {
    expect(classifySource(source, channel)).toBe('ai_assistant')
  })

  it('classifies AI ahead of Organic Search', () => {
    expect(classifySource('chatgpt.com', 'Organic Search')).toBe('ai_assistant')
  })

  it.each(['notchatgpt.com', 'chatgpt.com.evil.example', 'xopenai.com', 'myperplexity.ai'])(
    '%s is not an AI host',
    source => {
      expect(classifySource(source, 'Referral')).toBe('other')
    },
  )

  it('does not match a bare parent of a listed host', () => {
    expect(classifySource('google.com', 'Referral')).toBe('other')
    expect(classifySource('microsoft.com', 'Referral')).toBe('other')
  })

  it('classifies google with Organic Search as organic_search', () => {
    expect(classifySource('google', 'Organic Search')).toBe('organic_search')
  })

  it('classifies (direct) with Direct as other', () => {
    expect(classifySource('(direct)', 'Direct')).toBe('other')
  })

  it('classifies (not set) as other', () => {
    expect(classifySource('(not set)', 'Unassigned')).toBe('other')
  })

  it('matches the channel group exactly', () => {
    expect(classifySource('google', 'organic search')).toBe('other')
    expect(classifySource('bing', 'Paid Search')).toBe('other')
  })
})
