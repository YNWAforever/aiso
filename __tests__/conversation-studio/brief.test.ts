import { expect, it } from 'vitest'
import { createTranslator } from 'next-intl'
import { composeBriefDraft } from '@/lib/conversation-studio/brief'
import { STUDIO_PROMPT_LIMIT } from '@/lib/conversation-studio/live-types'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

it.each(['en', 'zh-HK'])('keeps goal, selected question and honest saved-result context editable within the prompt limit in %s', locale => {
  const t = createTranslator({ locale, messages: locale === 'en' ? en : zh, namespace: 'conversationStudio' })
  for (const template of ['brief', 'competitors', null]) {
    const summary = [t('evidence.insufficient'), t(template === 'competitors' ? 'evidence.comparisonLimit' : template ? 'evidence.summaryScope' : 'evidence.questionLimit'), t('honesty.searchDemandPending')].join(' ')
    const format = (context: { goal: string; prompt: string; summary: string }) => t('briefContextPrompt', context)
    const short = { goal: 'Original goal', prompt: 'Selected follow-up question', summary }
    expect(composeBriefDraft(short, format)).toBe(format(short))
    for (const context of [
      { ...short, goal: '目標'.repeat(500), prompt: '問題'.repeat(500) },
      { ...short, goal: '😀'.repeat(500), prompt: '🚀'.repeat(500) },
      { ...short, goal: 'x'.repeat(1000) },
      { ...short, prompt: 'y'.repeat(1000) },
    ]) {
      const draft = composeBriefDraft(context, format)
      expect(draft.length).toBeLessThanOrEqual(STUDIO_PROMPT_LIMIT)
      expect(draft.isWellFormed()).toBe(true)
      expect(draft).toContain(summary) // Preserve pending/insufficient, even with long user text.
      expect(draft).toContain(context.goal.slice(0, 8))
      expect(draft).toContain(context.prompt.slice(0, 8))
      expect(draft).toContain('…')
    }
  }
})
