import { describe, expect, it } from 'vitest'
import { traceSteps } from '@/lib/conversation-studio/trace'

describe('traceSteps', () => {
  it('lists only the reads the turn asked for, saved evidence first', () => {
    expect(traceSteps({})).toEqual([{ key: 'saved', status: 'done' }])
    expect(traceSteps({ attached: { label: 'Menu' }, gsc: { pending: true }, dfs: { error: 'STUDIO_UNAVAILABLE' }, firecrawl: {}, live: { pending: true } })).toEqual([
      { key: 'saved', status: 'done' },
      { key: 'attached', status: 'done' },
      { key: 'gsc', status: 'pending' },
      { key: 'dfs', status: 'unavailable' },
      { key: 'firecrawl', status: 'done' },
      { key: 'live', status: 'pending' },
    ])
  })

  it('never reports a pending or failed read as done', () => {
    for (const read of [{ pending: true }, { error: 'X' }, { pending: true, error: 'X' }]) {
      expect(traceSteps({ gsc: read })[1]!.status).not.toBe('done')
    }
  })
})
