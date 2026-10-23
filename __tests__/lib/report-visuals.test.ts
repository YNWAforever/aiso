import { buildScanEvidence, CHECK_VERSIONS, describeEvidenceUrl } from '@/lib/scan-evidence'
import { describe, expect, it } from 'vitest'
import { buildClientReportSnapshot, type ClientReportSnapshotInput } from '@/lib/reports/snapshot'
import { parseClientReportSnapshot } from '@/lib/reports/client-dto'
import { CHECK_SLOTS } from '@/lib/result/view-model'
import type { ReportScanInput } from '@/lib/reports/types'

const evidence = (industry: string) => buildScanEvidence({
  requestedUrl: 'https://example.com', evaluatedUrl: 'https://example.com', industry, region: 'global', sitemapSource: 'fetched',
  checks: Object.fromEntries(Object.keys(CHECK_VERSIONS).map(key => [key, { collection: 'complete', assessment: key === 'c2_llms_txt' ? 'fail' : 'pass' }])),
  observations: [{ check: 'page', collection: 'complete', httpStatus: 200, target: describeEvidenceUrl('https://example.com') }],
})
const sameMethod = evidence('technology')
const otherMethod = evidence('finance')

const current: ReportScanInput = {
  accountId: 'account-a', domain: 'example.com', createdAt: '2026-07-20T12:00:00.000Z', score: 72, grade: 'B', results: { evidence: sameMethod },
}
const input: ClientReportSnapshotInput = {
  locale: 'en',
  branding: { agencyName: 'Fimmick', logoUrl: null, primaryColor: '#123456', contactLabel: null, contactUrl: null },
  client: { name: 'Example', domain: 'example.com' },
  currentScan: current,
  previousScan: null,
  recommendations: [],
}
const earlier = (day: number, score: number, scanEvidence: unknown = sameMethod, extra: Partial<ReportScanInput> = {}): ReportScanInput => ({
  ...current, createdAt: `2026-07-${String(day).padStart(2, '0')}T12:00:00.000Z`, score, results: { evidence: scanEvidence }, ...extra,
})

describe('one-page report snapshot fields', () => {
  it('freezes every check verdict from the evidence envelope, not the legacy status', () => {
    const snapshot = buildClientReportSnapshot({ ...input, currentScan: { ...current, results: { evidence: sameMethod, c2_llms_txt: { status: 'pass' } } } })
    expect(Object.keys(snapshot.checks!)).toEqual(CHECK_SLOTS.map(slot => slot.key))
    expect(snapshot.checks!.c1_robots).toBe('pass')
    expect(snapshot.checks!.c2_llms_txt).toBe('fail')
  })

  it('omits the trend when there is no earlier scored scan', () => {
    expect(buildClientReportSnapshot(input).trend).toBeUndefined()
    expect(buildClientReportSnapshot({ ...input, history: [earlier(1, 50, { checks: {} })] }).trend).toBeUndefined()
  })

  it('keeps at most eight points, oldest first, ending on the report scan', () => {
    const history = Array.from({ length: 10 }, (_, index) => earlier(index + 1, 40 + index))
    const trend = buildClientReportSnapshot({ ...input, history }).trend!
    expect(trend).toHaveLength(8)
    expect(trend.map(point => point.score)).toEqual([43, 44, 45, 46, 47, 48, 49, 72])
    expect(trend.at(-1)).toEqual({ date: current.createdAt, score: 72, comparable: true })
  })

  it('skips other domains, other accounts, later scans and failed collections', () => {
    const trend = buildClientReportSnapshot({ ...input, history: [
      earlier(10, 60),
      earlier(11, 61, sameMethod, { domain: 'other.com' }),
      earlier(12, 62, sameMethod, { accountId: 'account-b' }),
      earlier(25, 63),
    ] }).trend!
    expect(trend.map(point => point.score)).toEqual([60, 72])
  })

  it('marks a point collected a different way instead of hiding it', () => {
    const trend = buildClientReportSnapshot({ ...input, history: [earlier(10, 60), earlier(11, 65, otherMethod)] }).trend!
    expect(trend.map(point => point.comparable)).toEqual([true, false, false])
  })
})

describe('parsing the optional fields', () => {
  const built = buildClientReportSnapshot({ ...input, history: [earlier(10, 60)] })

  it('accepts a built snapshot and one from before the fields existed', () => {
    expect(parseClientReportSnapshot(JSON.parse(JSON.stringify(built)))).not.toBeNull()
    const { checks: _checks, trend: _trend, ...legacy } = built
    expect(parseClientReportSnapshot(legacy)).not.toBeNull()
  })

  it.each([
    ['an unknown check key', { checks: { ...built.checks, c99: 'pass' } }],
    ['an unknown status', { checks: { ...built.checks, c1_robots: 'cited' } }],
    ['an empty check map', { checks: {} }],
    ['a single trend point', { trend: built.trend!.slice(-1) }],
    ['a trend that does not end on the report scan', { trend: [built.trend![0], { ...built.trend![1], score: 99 }] }],
    ['a trend out of order', { trend: [...built.trend!].reverse() }],
    ['a score above 100', { trend: [{ ...built.trend![0], score: 101 }, built.trend![1]] }],
    ['a first point marked not comparable', { trend: [{ ...built.trend![0], comparable: false }, built.trend![1]] }],
  ])('rejects %s', (_name, patch) => {
    expect(parseClientReportSnapshot({ ...built, ...patch })).toBeNull()
  })
})
