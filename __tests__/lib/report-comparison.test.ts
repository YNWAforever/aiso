import { describe, expect, it } from 'vitest'
import {
  compareReportEvidence,
  normalizeReportDomain,
  selectPreviousReportScan,
  type ReportScanInput,
} from '@/lib/reports/comparison'

const current: ReportScanInput = {
  accountId: 'account-a',
  domain: 'www.Example.com',
  createdAt: '2026-07-20T12:00:00.000Z',
  score: 71,
  grade: 'B',
  results: { c1_robots: { status: 'pass' }, c2_llms_txt: { status: 'warn' } },
}

describe('report comparison', () => {
  it('normalizes HTTP(S) domains to lower-case hostnames without www', () => {
    expect(normalizeReportDomain('Example.COM/path')).toBe('example.com')
    expect(normalizeReportDomain('https://WWW.Example.com:443/path')).toBe('example.com')
    expect(normalizeReportDomain('https://user:pass@example.com')).toBeNull()
    expect(normalizeReportDomain('ftp://example.com')).toBeNull()
    expect(normalizeReportDomain('https://127.0.0.1')).toBeNull()
  })

  it('selects the nearest earlier usable scan for the same account and normalized domain only', () => {
    const selected = selectPreviousReportScan(current, [
      { ...current, createdAt: '2026-07-19T12:00:00.000Z', score: 68 },
      { ...current, createdAt: '2026-07-18T12:00:00.000Z', score: 65 },
      { ...current, createdAt: '2026-07-21T12:00:00.000Z', score: 99 },
      { ...current, accountId: 'account-b', createdAt: '2026-07-19T23:00:00.000Z', score: 99 },
      { ...current, domain: 'other.example', createdAt: '2026-07-19T23:00:00.000Z', score: 99 },
      { ...current, createdAt: '2026-07-19T23:00:00.000Z', score: Number.NaN },
    ])

    expect(selected?.createdAt).toBe('2026-07-19T12:00:00.000Z')
  })

  it('uses baseline when there is no eligible earlier scan', () => {
    expect(selectPreviousReportScan(current, [{ ...current, createdAt: '2026-07-21T12:00:00.000Z' }])).toBeNull()
  })

  it('classifies supported check changes without treating missing evidence as zero', () => {
    expect(compareReportEvidence(
      { c1_robots: { status: 'pass' }, c2_llms_txt: { status: 'fail' }, c3_bot_access: { status: 'warn' }, c4_structured_data: { status: 'pass' } },
      { c1_robots: { status: 'fail' }, c2_llms_txt: { status: 'pass' }, c3_bot_access: { status: 'warn' }, c5_extractability: { status: 'pass' } },
    )).toEqual({
      comparisonState: 'comparable',
      changes: expect.arrayContaining([
        expect.objectContaining({ key: 'c1_robots', kind: 'improved' }),
        expect.objectContaining({ key: 'c2_llms_txt', kind: 'regressed' }),
        expect.objectContaining({ key: 'c3_bot_access', kind: 'unchanged' }),
        expect.objectContaining({ key: 'c4_structured_data', kind: 'added_coverage' }),
        expect.objectContaining({ key: 'c5_extractability', kind: 'lost_coverage' }),
      ]),
    })
  })

  it('returns data gaps for missing values and rejects structurally incompatible evidence', () => {
    expect(compareReportEvidence(
      { c1_robots: { status: 'pass' }, c2_llms_txt: null },
      { c1_robots: { status: 'pass' }, c2_llms_txt: { status: 'warn' } },
    )).toMatchObject({ comparisonState: 'comparable', changes: expect.arrayContaining([expect.objectContaining({ key: 'c2_llms_txt', kind: 'data_gap' })]) })
    expect(compareReportEvidence({ c1_robots: { status: 'unknown' } }, { c1_robots: { status: 'pass' } }))
      .toEqual({ comparisonState: 'not_comparable', changes: [] })
  })
})
