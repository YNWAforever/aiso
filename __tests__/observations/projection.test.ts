import { describe, expect, it } from 'vitest'

import { projectObservation } from '@/lib/observations/schema'
import type { PulseSourceRow, Question } from '@/lib/observations/types'

const row: PulseSourceRow = {
  id: '00000000-0000-4000-8000-000000000001',
  prompt_id: null,
  question: 'Recorded question',
  platform: 'chatgpt',
  scan_week: '2026-09-01',
  created_at: null,
  raw_answer: '  ',
  brand_mentioned: false,
}

describe('projectObservation', () => {
  it('projects unavailable legacy evidence without leaking the raw answer', () => {
    const dto = projectObservation(row, null)
    expect(dto).toMatchObject({
      question: 'Recorded question',
      result: 'incomplete',
      hasAnswer: false,
      brandMentioned: false,
      collectedAt: null,
      recordedAt: null,
      model: null,
      market: null,
      currentPrompt: null,
      limitations: [
        'model-unrecorded',
        'market-unrecorded',
        'collection-time-unrecorded',
        'answer-unavailable',
      ],
    })
    expect(dto).not.toHaveProperty('raw_answer')
  })

  it.each(['', ' ', '\t', '\n', '\r\n', '\v', '\f'])('treats PostgreSQL space-only answers as incomplete', rawAnswer => {
    expect(projectObservation({ ...row, raw_answer: rawAnswer }, null)).toMatchObject({
      hasAnswer: false,
      result: 'incomplete',
    })
  })

  it('treats a nonbreaking space as content, matching the PostgreSQL POSIX predicate', () => {
    expect(projectObservation({ ...row, raw_answer: '\u00a0', brand_mentioned: true }, null)).toMatchObject({
      hasAnswer: true,
      result: 'success',
    })
  })

  it('marks nullable classification as unavailable', () => {
    expect(projectObservation({ ...row, raw_answer: 'answer', brand_mentioned: null }, null)).toMatchObject({
      brandMentioned: null,
      result: 'incomplete',
      limitations: expect.arrayContaining(['classification-unavailable']),
    })
  })

  it('keeps the recorded question while labelling the linked current prompt separately', () => {
    const currentPrompt: Question = {
      id: '00000000-0000-4000-8000-000000000002',
      question: 'Edited current question',
      category: 'commercial',
      language: 'en',
      isActive: null,
    }
    const dto = projectObservation({ ...row, prompt_id: currentPrompt.id, raw_answer: 'answer' }, currentPrompt)
    expect(dto.question).toBe('Recorded question')
    expect(dto.currentPrompt).toEqual(currentPrompt)
    expect(dto.promptId).toBe(currentPrompt.id)
  })

  it('drops a mismatched current prompt link', () => {
    const currentPrompt: Question = {
      id: '00000000-0000-4000-8000-000000000002',
      question: 'Unrelated prompt',
      category: null,
      language: null,
      isActive: false,
    }
    expect(projectObservation({ ...row, prompt_id: '00000000-0000-4000-8000-000000000003' }, currentPrompt).currentPrompt).toBeNull()
  })

  it('lowercases projected UUID values', () => {
    const upperId = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'
    const currentPrompt: Question = {
      id: upperId,
      question: 'Current prompt',
      category: null,
      language: null,
      isActive: true,
    }
    expect(projectObservation({ ...row, id: upperId, prompt_id: upperId }, currentPrompt)).toMatchObject({
      id: upperId.toLowerCase(),
      promptId: upperId.toLowerCase(),
      currentPrompt: { id: upperId.toLowerCase() },
    })
  })

  it('preserves a valid recorded timestamp and treats malformed legacy dates as unavailable', () => {
    const exact = '2026-09-01T10:11:12.123456+00:00'
    expect(projectObservation({ ...row, created_at: exact }, null).recordedAt).toBe(exact)
    expect(projectObservation({ ...row, created_at: 'legacy-bad-date' }, null).recordedAt).toBeNull()
  })
})
