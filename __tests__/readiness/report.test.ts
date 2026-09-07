import { expect, it } from 'vitest'

import { buildConfigurationReport, renderConfigurationReport } from '@/lib/readiness/report'

it('never claims production readiness even when every input check passes', () => {
  const report = buildConfigurationReport([{ id: 'config.VERCEL', status: 'pass', code: 'valid' }])
  expect(report.productionReady).toBe(false)
  expect(report.enforced).toBe(false)
  expect(report.configurationStatus).toBe('pass')
  expect(renderConfigurationReport(report)).toContain('REPORT ONLY / NOT ENFORCED')
})

it('rejects an empty check list as missing evidence', () => {
  expect(buildConfigurationReport([]).configurationStatus).toBe('unknown')
})

it('drops extra fields instead of copying them into the report', () => {
  const report = buildConfigurationReport([{ id: 'config.VERCEL', status: 'pass', code: 'valid', secret: 'report-secret-sentinel' } as never])
  expect(report.checks).toEqual([{ id: 'config.VERCEL', status: 'pass', code: 'valid' }])
  expect(JSON.stringify(report)).not.toContain('report-secret-sentinel')
})

it('gives failure precedence over unknown and unknown precedence over pass', () => {
  expect(buildConfigurationReport([{ id: 'config.VERCEL', status: 'pass', code: 'valid' }, { id: 'capability.ai', status: 'unknown', code: 'unknown' }]).configurationStatus).toBe('unknown')
  expect(buildConfigurationReport([{ id: 'config.VERCEL', status: 'pass', code: 'valid' }, { id: 'capability.ai', status: 'unknown', code: 'unknown' }, { id: 'config.DATABASE_URL', status: 'fail', code: 'missing' }]).configurationStatus).toBe('fail')
})

it('renders checks in their supplied order', () => {
  const markdown = renderConfigurationReport(buildConfigurationReport([{ id: 'capability.scheduler', status: 'pass', code: 'verified-disabled' }, { id: 'config.VERCEL', status: 'pass', code: 'valid' }]))
  expect(markdown.indexOf('capability.scheduler')).toBeLessThan(markdown.indexOf('config.VERCEL'))
})

it.each([
  { id: 'secret-id-sentinel', status: 'pass', code: 'valid' },
  { id: 'config.VERCEL', status: 'secret-status-sentinel', code: 'valid' },
  { id: 'config.VERCEL', status: 'pass', code: 'secret-code-sentinel' },
])('rejects invalid checks without exposing caller strings', (check) => {
  let error: unknown
  try {
    buildConfigurationReport([check] as never)
  } catch (caught) {
    error = caught
  }
  expect(error).toEqual(new Error('Invalid configuration check'))
  expect(String(error)).not.toContain('sentinel')
})

it.each([
  { id: 'secret-id-sentinel', status: 'pass', code: 'valid' },
  { id: 'config.VERCEL', status: 'secret-status-sentinel', code: 'valid' },
  { id: 'config.VERCEL', status: 'pass', code: 'secret-code-sentinel' },
])('rejects invalid checks in a hand-built report before rendering', (check) => {
  const report = { version: 1, kind: 'configuration-only', enforced: false, productionReady: false, configurationStatus: 'pass', checks: [check] }
  let error: unknown
  try {
    renderConfigurationReport(report as never)
  } catch (caught) {
    error = caught
  }
  expect(error).toEqual(new Error('Invalid configuration check'))
  expect(String(error)).not.toContain('sentinel')
})