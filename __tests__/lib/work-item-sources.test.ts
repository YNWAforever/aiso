import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ sql: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ db: () => mocks.sql }))

import { listLiveSources } from '@/lib/work-items/sources'

beforeEach(() => { vi.clearAllMocks() })

describe('listLiveSources', () => {
  it('returns the sources of one item, in opportunity-key order', async () => {
    mocks.sql.mockResolvedValue([
      { id: 's1', opportunity_key: 'a', source_kind: 'scan-check', source_id: 'x',
        rule_version: 'scan-check-gap.v1', check_key: 'c9_meta_desc',
        evidence_fingerprint: 'f'.repeat(64), evidence_snapshot: { kind: 'scan-check' } },
    ])

    const sources = await listLiveSources('account-1', 'client-1', 'item-1')

    expect(sources).toHaveLength(1)
    expect(sources[0]!.opportunityKey).toBe('a')
    expect(sources[0]!.snapshot).toEqual({ kind: 'scan-check' })
  })

  it('scopes the read to the account and client in the statement itself', async () => {
    mocks.sql.mockResolvedValue([])
    await listLiveSources('account-1', 'client-1', 'item-1')

    const values = mocks.sql.mock.calls[0]!.slice(1)
    expect(values).toContain('account-1')
    expect(values).toContain('client-1')
    expect(values).toContain('item-1')
  })

  it('filters on withdrawn_at is null in the statement text', async () => {
    mocks.sql.mockResolvedValue([])
    await listLiveSources('account-1', 'client-1', 'item-1')

    // The mock cannot distinguish a live row from a withdrawn one -- it returns
    // whatever it is told to -- so the only place this reader's "live" promise
    // can be checked at all is the SQL text itself. Without this clause the
    // query would compile and every other case here would still pass, but a
    // withdrawn source would come back as if it were still attached to the
    // item, which is exactly the state 051's partial unique indexes exist to
    // let go stale (withdraw, then let a different item claim the same
    // opportunity_key).
    const strings = mocks.sql.mock.calls[0]![0] as unknown as string[]
    expect(strings.join(' ')).toContain('withdrawn_at is null')
  })

  it('keeps a null check_key null rather than stringifying it', async () => {
    mocks.sql.mockResolvedValue([
      { id: 's2', opportunity_key: 'b', source_kind: 'pulse-metric', source_id: 'y',
        rule_version: 'pulse-brand-absent.v1', check_key: null,
        evidence_fingerprint: 'f'.repeat(64), evidence_snapshot: { kind: 'pulse-metric' } },
    ])

    const sources = await listLiveSources('account-1', 'client-1', 'item-1')

    // Every other field in the DTO is coerced with String(...), and
    // String(null) is the three-character string "null", not the value null.
    // check_key is the one field among them that is genuinely nullable (a
    // pulse-metric or agent-recommendation source always has a null
    // check_key by the rule_source_check constraint in 051), so a dto() that
    // reused the same String(...) coercion for every column would silently
    // turn "no check" into a truthy string that reads as if one existed.
    expect(sources[0]!.checkKey).toBeNull()
  })
})
