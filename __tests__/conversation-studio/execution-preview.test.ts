import { describe, expect, it } from 'vitest'
import { buildExecutionPreview } from '@/lib/conversation-studio/execution-preview'

const base = { clientId: 'brand-1', sourceStatus: 'bound' as const, prompt: 'Explain my visibility', live: true, platforms: ['gemini-flash', 'gpt-4o'] }

describe('buildExecutionPreview', () => {
  it('lists the reads a saved turn will make', () => {
    const preview = buildExecutionPreview(base)
    expect(preview).toEqual({ savesTurn: true, readsSearchDemand: true, readsPublicPage: false, liveAnswers: 2 })
  })

  it('only promises public-page reading for an explicit URL', () => {
    expect(buildExecutionPreview({ ...base, prompt: 'Review https://example.com/pricing for gaps' }).readsPublicPage).toBe(true)
  })

  it('never promises Search Console data for an unbound source', () => {
    expect(buildExecutionPreview({ ...base, sourceStatus: 'unbound' }).readsSearchDemand).toBe(false)
    expect(buildExecutionPreview({ ...base, sourceStatus: 'reconnect' }).readsSearchDemand).toBe(false)
  })

  it('promises no live answers when live is off, exhausted, or has no platform', () => {
    expect(buildExecutionPreview({ ...base, live: false }).liveAnswers).toBe(0)
    expect(buildExecutionPreview({ ...base, liveExhausted: true }).liveAnswers).toBe(0)
    expect(buildExecutionPreview({ ...base, platforms: [] }).liveAnswers).toBe(0)
  })

  it('promises nothing billable or external for a staff view', () => {
    expect(buildExecutionPreview({ ...base, staffView: true })).toEqual({ savesTurn: false, readsSearchDemand: false, readsPublicPage: false, liveAnswers: 0 })
  })
})
