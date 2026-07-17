import { describe, expect, it } from 'vitest'
import { buildPublicResultSummary, canViewFullResult } from '@/lib/result-access'

const scan = {
  id: 'scan-1',
  account_id: null,
  domain: 'example.com',
  score: 62,
  grade: 'C',
  industry: 'technology',
  region: 'HK',
  created_at: '2026-07-16T00:00:00.000Z',
  results: {
    c1_robots: { status: 'pass', message: 'robots_ai_allowed', details: 'private raw evidence' },
    c2_llms_txt: { status: 'fail', message: 'llms_txt_missing', details: 'private remediation detail' },
  },
}

describe('result access', () => {
  it('unlocks only for the owning account', () => {
    expect(canViewFullResult('account-1', 'account-1')).toBe(true)
    expect(canViewFullResult('account-1', 'account-2')).toBe(false)
    expect(canViewFullResult(null, 'account-1')).toBe(false)
    expect(canViewFullResult('account-1', null)).toBe(false)
  })

  it('returns a teaser without the full results object', () => {
    const summary = buildPublicResultSummary(scan)
    expect(summary.domain).toBe('example.com')
    expect(summary.score).toBe(62)
    expect(summary.topIssueKey).toBe('c2_llms_txt')
    expect(summary.topIssueStatus).toBe('fail')
    expect(summary).not.toHaveProperty('results')
    expect(JSON.stringify(summary)).not.toContain('private remediation detail')
  })
})
