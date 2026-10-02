import { describe, it, expect, vi } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/openrouter', () => ({ callOpenRouter: vi.fn(async () => '{}') }))
import { callOpenRouter } from '@/lib/openrouter'
import { generateOnboardingSeed } from '@/lib/onboarding/service'
import { parseOnboardingInput } from '@/lib/onboarding/schema'

import {
  PROMPT_CATEGORIES,
  isPromptCategory,
  promptCategoryLabelKey,
} from '@/lib/prompts/categories'

describe('prompt categories', () => {
  it('matches the vocabulary onboarding actually asks the model for', async () => {
    await generateOnboardingSeed(parseOnboardingInput({brandName:'Synthetic'}))
    const request = vi.mocked(callOpenRouter).mock.calls.at(-1)![0]
    const source = request.messages.map(message => message.content).join('\n')
    for (const category of PROMPT_CATEGORIES) {
      expect(source, `onboarding never asks for "${category}"`).toContain(category)
    }
    expect(JSON.stringify(request.responseFormat)).toContain('brand_query')
  })

  it('rejects the display labels the editor used to send', () => {
    // 'Brand Queries' is what AddPromptRow POSTed while the DB stored
    // 'brand_query'. Accepting it is how a fifth category gets created.
    for (const label of ['Brand Queries', 'Pain Points', 'Category Queries', 'Intent Queries']) {
      expect(isPromptCategory(label)).toBe(false)
    }
  })

  it('rejects absent and non-string values', () => {
    for (const value of [null, undefined, '', 42, {}, ['brand_query']]) {
      expect(isPromptCategory(value)).toBe(false)
    }
  })

  it('accepts every canonical category', () => {
    for (const category of PROMPT_CATEGORIES) expect(isPromptCategory(category)).toBe(true)
  })

  it('labels anything outside the vocabulary as other rather than dropping it', () => {
    // The column is nullable and unconstrained, so live rows may hold values
    // this list has never known. They must stay visible and editable.
    expect(promptCategoryLabelKey(null)).toBe('cat_other')
    expect(promptCategoryLabelKey(undefined)).toBe('cat_other')
    expect(promptCategoryLabelKey('Brand Queries')).toBe('cat_other')
    expect(promptCategoryLabelKey('brand_query')).toBe('cat_brand_query')
  })
})
