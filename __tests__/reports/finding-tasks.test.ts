import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ sql: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ db: () => mocks.sql }))

import { loadOwnedReportFinding } from '@/lib/reports/finding-tasks'
import { reportSnapshot } from '../components/report-builder-fixtures'

const accountId = '11111111-1111-4111-8111-111111111111'
const foreignAccountId = '99999999-9999-4999-8999-999999999999'
const clientId = '22222222-2222-4222-8222-222222222222'
const reportId = '33333333-3333-4333-8333-333333333333'
const reportVersionId = '44444444-4444-4444-8444-444444444444'
const scanId = '55555555-5555-4555-8555-555555555555'

function row() {
  return {
    id: reportVersionId,
    report_id: reportId,
    version_number: 2,
    source_scan_id: scanId,
    locale: 'en',
    snapshot: {
      ...reportSnapshot('en'),
      priorityFixes: [{
        key: 'c1_robots',
        title: 'Review crawler access',
        rationale: 'The selected report recorded a robots check failure.',
        expectedImpact: 'high',
        nextStep: 'Review the saved crawler evidence.',
      }],
    },
    created_at: '2026-10-18T09:02:00.000Z',
  }
}

const input = {
  accountId,
  clientId,
  reportVersionId,
  scanId,
  checkKey: 'c1_robots' as const,
  locale: 'en' as const,
}

describe('owned report finding lookup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('scopes the exact report version to the server-derived account and client', async () => {
    mocks.sql.mockResolvedValueOnce([row()])

    await expect(loadOwnedReportFinding(input)).resolves.toMatchObject({
      reportId,
      reportVersionId,
      reportVersionNumber: 2,
      findingKey: 'c1_robots',
    })

    const [strings, ...values] = mocks.sql.mock.calls[0]!
    const query = (strings as string[]).join('?')
    expect(query).toContain('from public.client_report_versions v')
    expect(query).toContain('v.account_id=?')
    expect(query).toContain('v.client_id=?')
    expect(query).toContain('v.id=?')
    expect(values).toEqual([accountId, clientId, reportVersionId])
  })

  it('fails closed for a foreign, stale, locale-mismatched or missing finding', async () => {
    mocks.sql.mockResolvedValueOnce([])
    await expect(loadOwnedReportFinding({ ...input, accountId: foreignAccountId })).resolves.toBeNull()

    mocks.sql.mockResolvedValueOnce([{ ...row(), source_scan_id: '66666666-6666-4666-8666-666666666666' }])
    await expect(loadOwnedReportFinding(input)).resolves.toBeNull()

    mocks.sql.mockResolvedValueOnce([{
      ...row(),
      snapshot: { ...row().snapshot, priorityFixes: [] },
    }])
    await expect(loadOwnedReportFinding(input)).resolves.toBeNull()
  })
})
