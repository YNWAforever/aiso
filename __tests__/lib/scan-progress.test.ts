import { describe, expect, it } from 'vitest'
import { CHECK_SLOTS } from '@/lib/result/view-model'
import { GEO_START_MS, PAGE_FETCH_MS, progressStatus } from '@/lib/result/scan-progress'

const statuses = (elapsed: number) => CHECK_SLOTS.map(slot => ({ bucket: slot.bucket, status: progressStatus(slot.key, elapsed) }))

describe('scan progress', () => {
  it('shows nothing running while the page is fetched', () => {
    expect(statuses(0).every(c => c.status === 'pending')).toBe(true)
  })

  it('runs Core and Extended together before GEO, in the engine order', () => {
    const mid = statuses(PAGE_FETCH_MS + 2000)
    expect(mid.filter(c => c.bucket !== 'geo').every(c => c.status === 'running')).toBe(true)
    expect(mid.filter(c => c.bucket === 'geo').every(c => c.status === 'pending')).toBe(true)
    expect(statuses(GEO_START_MS + 1000).every(c => c.status === 'running')).toBe(true)
  })

  it('never reports a verdict: a check is only ever pending or running', () => {
    for (const elapsed of [0, 500, 5000, 60_000]) {
      expect(new Set(statuses(elapsed).map(c => c.status)).size).toBeLessThanOrEqual(2)
      for (const c of statuses(elapsed)) expect(['pending', 'running']).toContain(c.status)
    }
  })
})
