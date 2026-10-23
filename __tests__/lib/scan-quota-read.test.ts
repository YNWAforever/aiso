import { beforeEach, describe, expect, it, vi } from 'vitest'

const { sql } = vi.hoisted(() => ({ sql: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: () => sql }))

import { AUTHENTICATED_BASIC_SCAN_LIMIT, readAuthenticatedScanQuota } from '@/lib/security/authenticated-scan-quota'

describe('readAuthenticatedScanQuota', () => {
  beforeEach(() => { sql.mockReset() })
  it('reads this month for this account only, and never writes', async () => {
    sql.mockResolvedValue([{ request_count: 2 }])
    expect(await readAuthenticatedScanQuota('acct-1')).toEqual({ limit: AUTHENTICATED_BASIC_SCAN_LIMIT, remaining: AUTHENTICATED_BASIC_SCAN_LIMIT - 2 })
    const [strings, ...values] = sql.mock.calls[0] as [TemplateStringsArray, ...unknown[]]
    const text = strings.join('?')
    expect(values).toEqual(['acct-1'])
    expect(text).toMatch(/^\s*select request_count from authenticated_scan_monthly_usage/)
    expect(text).not.toMatch(/insert|update|delete/i)
  })
  it('treats no row as nothing used and never goes below zero', async () => {
    sql.mockResolvedValueOnce([])
    expect((await readAuthenticatedScanQuota('a')).remaining).toBe(AUTHENTICATED_BASIC_SCAN_LIMIT)
    sql.mockResolvedValueOnce([{ request_count: 9 }])
    expect((await readAuthenticatedScanQuota('a')).remaining).toBe(0)
  })
})
