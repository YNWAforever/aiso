import { describe, expect, it } from 'vitest'
import { applyStudioReplyBudget, STUDIO_REPLY_BUDGET_BYTES } from '@/lib/conversation-studio/reply-budget'
import type { StudioObservation, StudioReply } from '@/lib/conversation-studio/types'

function observation(index: number, excerptLength = 1200): StudioObservation {
  return {
    id: `30000000-0000-4000-8000-00000000000${index}`,
    question: `Question ${index}`,
    platform: 'chatgpt',
    scanWeek: '2026-10-26',
    recordedAt: '2026-10-27T03:00:00Z',
    collectedAt: null,
    model: null,
    market: null,
    result: 'success',
    brandMentioned: true,
    excerpt: String(index).padEnd(excerptLength, 'x'),
    links: [],
    searchEvidence: { requested: 'web', execution: 'unknown', basis: 'request-only' },
  }
}

const baseReply: StudioReply = {
  status: 'evidenced',
  template: 'brief',
  observations: [observation(1), observation(2), observation(3)],
  scan: null,
  researchSteps: [{ kind: 'composeExtracts' }],
  coverage: { pulse: 'present', citations: 'missing', scan: 'missing', live: 'unsupported' },
}

const size = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length

describe('applyStudioReplyBudget', () => {
  it('leaves a reply that already fits untouched', () => {
    const result = applyStudioReplyBudget(baseReply, STUDIO_REPLY_BUDGET_BYTES)
    expect(result).toEqual({ reply: baseReply, trimmedObservations: 0, trimmedScan: false })
    const small = { ...baseReply, observations: [observation(1)] }
    expect(applyStudioReplyBudget(small, size(small))).toEqual({ reply: small, trimmedObservations: 0, trimmedScan: false })
  })

  it('trims observations from the tail until the reply fits, deterministically', () => {
    const budget = 3500
    const first = applyStudioReplyBudget(baseReply, budget)
    const second = applyStudioReplyBudget(baseReply, budget)
    expect(first.trimmedObservations).toBeGreaterThan(0)
    expect(size(first.reply)).toBeLessThanOrEqual(budget)
    expect(first).toEqual(second)
    // Never a middle record: the kept observations are a prefix of the original.
    expect(first.reply.observations).toEqual(baseReply.observations.slice(0, first.reply.observations.length))
  })

  it('becomes insufficient when the trim removes every usable observation and there is no scan', () => {
    const result = applyStudioReplyBudget(baseReply, 1200)
    expect(result.reply.observations).toEqual([])
    expect(result.reply.status).toBe('insufficient')
    expect(result.reply.researchSteps.some(step => step.kind === 'composeExtracts')).toBe(false)
  })

  it('drops the scan block only after every observation, and recomputes status from what remains', () => {
    const scan = {
      id: '40000000-0000-4000-8000-000000000009',
      recordedAt: '2026-10-27T01:00:00Z',
      evidence: {
        collection: 'complete' as const, completedPages: 1, collectedAt: '2026-10-27T00:00:00Z', limited: false,
        scannerVersion: 'fixture.v1', methodologyVersion: 'fixture.v1', pillarInputs: {},
        checks: [{ key: 'c1_robots', collection: 'complete' as const, assessment: 'pass' as const }],
      },
    }
    const withScan = { ...baseReply, scan }
    const budget = size({ ...withScan, observations: [] }) + 50
    const result = applyStudioReplyBudget(withScan, budget)
    expect(result.reply.observations).toEqual([])
    expect(result.trimmedObservations).toBe(baseReply.observations.length)
    expect(result.trimmedScan).toBe(false)
    expect(result.reply.status).toBe('evidenced')
    // A budget that cannot even hold the scan removes it last and says so.
    const tiny = applyStudioReplyBudget(withScan, 200)
    expect(tiny.reply.scan).toBeNull()
    expect(tiny.trimmedScan).toBe(true)
    expect(tiny.reply.status).toBe('insufficient')
  })
})
