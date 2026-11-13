import { describe, expect, it } from 'vitest'
import { readMonitoringOptions, readMonitoringRun } from '@/lib/pulse/runs/read-view'
const id = '22222222-2222-4222-8222-222222222222'
const run = { id, week: '2026-11-09', purpose: 'canonical', retryable: false, reasons: [], coverage: { expected: 5, succeeded: 5, failed: 0, pending: 0, blocked: 0, classified: 5, mentioned: 0, status: 'completed' } }
const options = { prompts: 1, variants: 5, expected: 5, remaining: 10, week: '2026-11-09', contextConfirmed: true, enabled: false, legacyObservationIds: [], search: { requested: 'off' }, latest: run }
describe('monitoring read boundary', () => {
  it('preserves confirmed counts and recomputes bounded rates', () => {
    expect(readMonitoringOptions(options).latest?.coverage).toMatchObject({ succeeded: 5, coverage: 1, mentionRate: 0 })
    expect(readMonitoringOptions(options).enabled).toBe(false)
  })
  it.each(['prompts', 'variants', 'expected', 'remaining', 'enabled', 'contextConfirmed', 'week', 'legacyObservationIds', 'search'])('rejects unknown %s rather than displaying zero', key => {
    expect(() => readMonitoringOptions({ ...options, [key]: null })).toThrow()
  })
  it('refuses inconsistent workload, malformed records and invalid run references', () => {
    for (const patch of [{ expected: 6 }, { latest: {} }, { currentCanonicalId: 'foreign/path' }, { legacyObservationIds: [null] }, { models: [null] }]) expect(() => readMonitoringOptions({ ...options, ...patch })).toThrow()
  })
  it('does not call a partially classified answer set complete', () => {
    expect(() => readMonitoringRun({ ...run, coverage: { ...run.coverage, classified: 4 } })).toThrow()
    expect(readMonitoringRun({ ...run, coverage: { ...run.coverage, classified: 4, status: 'partial' } }).coverage.status).toBe('partial')
  })
  it('accepts an active running lease without inventing completed work', () => {
    const coverage = { expected: 5, succeeded: 0, failed: 0, pending: 5, blocked: 0, classified: 0, mentioned: 0, status: 'running' }
    expect(readMonitoringRun({ ...run, retryable: true, coverage }).coverage).toMatchObject({ status: 'running', mentionRate: null })
  })
  it('rejects counts exceeding expected work and unknown classifications', () => {
    for (const patch of [{ succeeded: 6 }, { mentioned: 6 }, { classified: null }, { status: 'invented' }]) expect(() => readMonitoringRun({ ...run, coverage: { ...run.coverage, ...patch } })).toThrow()
  })
})
