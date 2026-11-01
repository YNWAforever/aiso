import { describe, expect, it } from 'vitest'
import { receiptFromReport, validateReceipt } from '../../scripts/a11y/studio-matrix.mjs'

const views = ['home', 'discussion', 'threads', 'documents', 'connections', 'tools']
function reportFixture() {
  const specs = []
  for (const locale of ['en', 'zh-HK']) for (const width of [1440, 900, 390]) for (const theme of ['light', 'dark']) {
    specs.push({
      title: `Studio screens ${locale} ${width} ${theme}: reflow and axe`,
      tests: [{ projectName: 'chromium', status: 'expected', results: [{ status: 'passed', attachments: views.map(view => ({
        name: 'studio-a11y-cell', contentType: 'application/json',
        body: Buffer.from(JSON.stringify({ locale, width, theme, view, axeViolations: 0, axeSerious: 0, axeCritical: 0,
          horizontalOverflowPx: 0, textBelow12px: 0, controlsBelow44px: 0, unexpectedRequests: 0 })).toString('base64'),
      })) }] }],
    })
  }
  return { config: { metadata: { privateContent: 'must not be promoted' } }, errors: [],
    stats: { expected: 12, unexpected: 0, skipped: 0, flaky: 0 }, suites: [{ suites: [{ specs }] }] }
}
const promote = report => receiptFromReport(Buffer.from(JSON.stringify(report)), Buffer.from('fixture CSS'), 'a'.repeat(40))

describe('Studio matrix receipt promotion', () => {
  it('promotes all 72 measured cells and strips unrelated report content', () => {
    const receipt = promote(reportFixture())
    expect(receipt.cells).toHaveLength(72)
    expect(receipt.reportSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(receipt.hostedNeonAuth).toBe('N/A-not-run')
    expect(JSON.stringify(receipt)).not.toMatch(/privateContent|must not be promoted/)
  })

  it.each(['unexpected', 'skipped', 'flaky'])('rejects a report with %s tests', key => {
    const report = reportFixture()
    report.stats[key] = 1
    expect(() => promote(report)).toThrow()
  })

  it('rejects missing per-view measurements even when the test passed', () => {
    const report = reportFixture()
    report.suites[0].suites[0].specs[0].tests[0].results[0].attachments.pop()
    expect(() => promote(report)).toThrow(/all six views/)
  })

  it('rejects a failed attempt and a retry instead of promoting partial proof', () => {
    const report = reportFixture()
    const test = report.suites[0].suites[0].specs[0].tests[0]
    test.results[0].status = 'failed'
    expect(() => promote(report)).toThrow(/must pass/)
    test.results.push({ ...test.results[0], status: 'passed' })
    expect(() => promote(report)).toThrow(/exactly one result/)
  })

  it('rejects duplicates that hide a missing dimension and the wrong project', () => {
    const report = reportFixture()
    const specs = report.suites[0].suites[0].specs
    specs[1] = structuredClone(specs[0])
    expect(() => promote(report)).toThrow(/duplicate or missing/)
    specs[0].tests[0].projectName = 'mobile'
    expect(() => promote(report)).toThrow(/wrong cell count/)
  })

  it.each(['axeViolations', 'axeSerious', 'axeCritical', 'horizontalOverflowPx', 'textBelow12px', 'controlsBelow44px', 'unexpectedRequests'])(
    'rejects a nonzero %s rather than storing a passing golden', metric => {
      const receipt = promote(reportFixture())
      receipt.cells[0][metric] = 1
      expect(() => validateReceipt(receipt)).toThrow(/must be zero/)
    })

  it('rejects absent measurements, malformed dimensions and extra page content', () => {
    for (const mutate of [
      cell => { delete cell.axeSerious },
      cell => { cell.width = 375 },
      cell => { cell.axeSerious = '0' },
      cell => { cell.axeCritical = -1 },
      cell => { cell.html = '<p>Private page content</p>' },
    ]) {
      const receipt = promote(reportFixture())
      mutate(receipt.cells[0])
      expect(() => validateReceipt(receipt)).toThrow()
    }
  })
})
