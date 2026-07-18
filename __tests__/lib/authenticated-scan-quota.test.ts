import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  AUTHENTICATED_BASIC_SCAN_LIMIT,
  consumeAuthenticatedScanQuota,
  type DurableAuthenticatedScanCounter,
} from '@/lib/security/authenticated-scan-quota'

describe('authenticated scan quota', () => {
  it('consumes the durable Basic allowance using the authenticated account id', async () => {
    const counter: DurableAuthenticatedScanCounter = vi.fn().mockResolvedValue({
      allowed: true,
      remaining: 2,
      resetAt: 1_788_192_000,
    })

    const decision = await consumeAuthenticatedScanQuota('account-1', counter)

    expect(decision).toEqual({ allowed: true, remaining: 2, resetAt: 1_788_192_000 })
    expect(counter).toHaveBeenCalledWith('account-1', AUTHENTICATED_BASIC_SCAN_LIMIT)
    expect(AUTHENTICATED_BASIC_SCAN_LIMIT).toBe(3)
  })

  it('propagates counter failures so callers fail closed', async () => {
    const counter: DurableAuthenticatedScanCounter = vi.fn().mockRejectedValue(new Error('database unavailable'))

    await expect(consumeAuthenticatedScanQuota('account-1', counter)).rejects.toThrow('database unavailable')
  })

  it('documents migration 025 as a release prerequisite for authenticated scans', () => {
    const readme = readFileSync('README.md', 'utf8')

    expect(readme).toContain('supabase/migrations/025_authenticated_scan_quotas.sql')
    expect(readme).toMatch(/before (?:releasing|enabling) authenticated scans/i)
  })

  it('ships a private durable calendar-month counter in migration 025', () => {
    const migration = readFileSync('supabase/migrations/025_authenticated_scan_quotas.sql', 'utf8')

    expect(migration).toContain('authenticated_scan_monthly_usage')
    expect(migration).toMatch(/primary key\s*\(account_id,\s*month_start\)/i)
    expect(migration).toMatch(/references accounts\s*\(id\)\s*on delete cascade/i)
    expect(migration).toMatch(/enable row level security/i)
    expect(migration).toMatch(/revoke all .* anon, authenticated, service_role/i)
  })
})
