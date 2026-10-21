import { expect, it } from 'vitest'
import {
  parsePendingReportSave,
  parseReportSaveInput,
  parseReportSaveReadback,
  reportSaveHeaders,
} from '@/lib/reports/save-request'
import { reportSaveFixture } from '../components/report-builder-fixtures'

const id = '11111111-1111-4111-8111-111111111111'
const request = {
  reportId: 'synthetic-report', scanId: 'synthetic-scan', locale: 'en' as const,
  executiveSummary: 'Synthetic receipt summary that must match the exact original request and saved version.',
}
const expected = { requestId: id, request }
function receipt() {
  return { receipt: { ...expected, result: reportSaveFixture('en', request.executiveSummary, 2) } }
}
it('distinguishes an absent receipt, malformed read and an exact frozen saved result', () => {
  expect(parseReportSaveReadback({ receipt: null }, expected)).toEqual({ result: null })
  expect(parseReportSaveReadback({ reports: [] }, expected)).toBeNull()
  expect(parseReportSaveReadback(receipt(), expected)?.result).toMatchObject({
    report: { id: 'synthetic-report', latestVersionNumber: 2 },
    reviewArtifact: { versionId: 'synthetic-version-2', snapshot: { executiveSummary: request.executiveSummary } },
  })
})
it.each(['request-id', 'scan', 'target', 'locale', 'summary', 'version', 'snapshot', 'result-report'] as const)(
  'rejects a %s mismatch instead of accepting unrelated saved content', field => {
    const value = receipt()
    if (field === 'request-id') value.receipt.requestId = crypto.randomUUID()
    if (field === 'scan') value.receipt.request = { ...request, scanId: 'other-scan' }
    if (field === 'target') value.receipt.request = { ...request, reportId: 'other-report' }
    if (field === 'locale') value.receipt.result.reviewArtifact.snapshot.locale = 'zh-HK'
    if (field === 'summary') value.receipt.request = { ...request, executiveSummary: request.executiveSummary + ' Changed.' }
    if (field === 'version') value.receipt.result.report.latestVersionNumber = 3
    if (field === 'snapshot') value.receipt.result.reviewArtifact.snapshot.executiveSummary = request.executiveSummary + ' Wrong.'
    if (field === 'result-report') value.receipt.result.report.id = 'other-report'
    expect(parseReportSaveReadback(value, expected)).toBeNull()
  },
)
it.each([null, {}, { requestId: 'bad', request }, { requestId: id, request: { ...request, executiveSummary: 'Too short' } },
  { requestId: id, request: { ...request, executiveSummary: request.executiveSummary + '\n' } }])(
  'refuses invalid retained requests %#', value => expect(parsePendingReportSave(value)).toBeNull(),
)
it('accepts a bounded opaque fixture version while rejecting unsafe retained ids', () => {
  expect(parseReportSaveInput({ ...request, expectedLatestVersionId: 'synthetic-version-1' })).toEqual({
    ...request, expectedLatestVersionId: 'synthetic-version-1',
  })
  for (const expectedLatestVersionId of ['', ' leading', 'trailing ', 'line\nbreak', 'x'.repeat(129)]) {
    expect(parseReportSaveInput({ ...request, expectedLatestVersionId })).toBeNull()
  }
  expect(parseReportSaveInput({
    ...request, reportId: null, expectedLatestVersionId: 'synthetic-version-1',
  })).toBeNull()
})
it('preserves the legacy headers contract while requiring a valid paired request and scan identity', () => {
  const read = (headers: Record<string, string>) => reportSaveHeaders(new Request('https://fixture.invalid', { headers }))
  expect(read({})).toEqual({})
  expect(read({ 'X-Report-Request-Id': id, 'X-Report-Scan-Id': id })).toEqual({ requestId: id, scanId: id })
  expect(read({ 'X-Report-Request-Id': id, 'X-Report-Scan-Id': id,
    'X-Report-Expected-Version-Id': crypto.randomUUID() })).toEqual({
    requestId: id, scanId: id, expectedLatestVersionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
  })
  expect(() => read({ 'X-Report-Request-Id': id })).toThrow()
  expect(() => read({ 'X-Report-Scan-Id': id })).toThrow()
  expect(() => read({ 'X-Report-Request-Id': 'invalid', 'X-Report-Scan-Id': id })).toThrow()
  expect(() => read({ 'X-Report-Expected-Version-Id': crypto.randomUUID() })).toThrow()
  expect(() => read({ 'X-Report-Request-Id': id, 'X-Report-Scan-Id': id,
    'X-Report-Expected-Version-Id': 'invalid' })).toThrow()
  expect(() => read({ 'X-Report-Request-Id': id, 'X-Report-Scan-Id': id,
    'X-Report-Expected-Version-Id': 'synthetic-version-1' })).toThrow()
})
it('uses the same whitespace normalization as the saved snapshot during retained-request readback', () => {
  const raw = {
    ...expected, request: { ...request, executiveSummary: `  ${request.executiveSummary.replace('receipt summary', 'receipt   summary')}  ` },
  }
  expect(parsePendingReportSave(raw)?.request.executiveSummary).toBe(request.executiveSummary)
  expect(parseReportSaveReadback(receipt(), raw)?.result?.reviewArtifact.snapshot.executiveSummary).toBe(request.executiveSummary)
})
