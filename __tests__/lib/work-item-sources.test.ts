import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ sql: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ db: () => mocks.sql }))

import { listLiveSources } from '@/lib/work-items/sources'

beforeEach(() => { vi.clearAllMocks() })

describe('listLiveSources', () => {
  it('maps all eight DTO fields and orders the read by opportunity_key in the statement', async () => {
    mocks.sql.mockResolvedValue([
      { id: 'id-value', opportunity_key: 'opportunity-key-value', source_kind: 'scan-check',
        source_id: 'source-id-value', rule_version: 'scan-check-gap.v1', check_key: 'c9_meta_desc',
        evidence_fingerprint: 'f'.repeat(64), evidence_snapshot: { marker: 'snapshot-value' } },
    ])

    const sources = await listLiveSources('account-1', 'client-1', 'item-1')

    // Every value above is distinct from every other, so a mis-mapped column
    // (e.g. sourceId: String(row.source_kind)) cannot coincidentally match --
    // it would fail this equality instead of slipping through unnoticed.
    expect(sources).toHaveLength(1)
    expect(sources[0]).toEqual({
      id: 'id-value',
      opportunityKey: 'opportunity-key-value',
      sourceKind: 'scan-check',
      sourceId: 'source-id-value',
      ruleVersion: 'scan-check-gap.v1',
      checkKey: 'c9_meta_desc',
      fingerprint: 'f'.repeat(64),
      snapshot: { marker: 'snapshot-value' },
    })

    // The mock returns exactly whatever it is told to regardless of the query
    // text, so it cannot itself tell an ordered result from an arbitrary one
    // -- the only place this can be checked at all is the SQL text itself.
    // Without this clause, rows come back in whatever order Postgres chooses
    // to produce them, so two requests could present a work item's sources
    // differently, and the submit path in a later task hashes these sources
    // in order -- an unordered read would make that hash unstable.
    const strings = mocks.sql.mock.calls[0]![0] as unknown as string[]
    expect(strings.join(' ')).toContain('order by opportunity_key')
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

const SOURCE = {
  opportunityKey: 'scan-check-gap.v1:scan-check:s:c9_meta_desc',
  sourceKind: 'scan-check' as const,
  sourceId: 'source-1',
  ruleVersion: 'scan-check-gap.v1',
  checkKey: 'c9_meta_desc',
  fingerprint: 'f'.repeat(64),
  snapshot: { marker: 'snapshot-value' },
}

describe('attachSource', () => {
  it('inserts the source and bumps the item revision in one statement, not two awaited calls', async () => {
    mocks.sql.mockResolvedValue([{ id: 'new-source-id' }])
    const { attachSource } = await import('@/lib/work-items/sources')

    const attached = await attachSource({ accountId: 'account-1', clientId: 'client-1', workItemId: 'item-1', source: SOURCE, actorId: 'actor-1' })

    expect(attached).toBe(true)
    // One statement, not sql.transaction([...]) or two awaited calls -- a
    // second, separate revision-bump statement would let the insert succeed
    // while the bump silently never runs (or runs unconditionally, bumping a
    // revision for an item that was never actually written to).
    expect(mocks.sql).toHaveBeenCalledTimes(1)
    const query = mocks.sql.mock.calls[0]![0].join(' ')
    expect(query).toContain('insert into work_item_sources')
    expect(query).toContain('update evidence_work_items')
    expect(query).toContain('revision = revision + 1')
  })

  it('ties the revision bump to the insert actually happening, not a separate unconditional write', async () => {
    // Would silently pass without this: an update with no `exists(...)` guard
    // would bump the revision even when the insert's WHERE matched no row --
    // an item outside this account/client would then have its revision bumped
    // by a caller who was never allowed to touch it.
    mocks.sql.mockResolvedValue([])
    const { attachSource } = await import('@/lib/work-items/sources')
    await attachSource({ accountId: 'account-1', clientId: 'client-1', workItemId: 'item-1', source: SOURCE, actorId: 'actor-1' })

    const query = mocks.sql.mock.calls[0]![0].join(' ')
    expect(query).toMatch(/exists\s*\(\s*select 1 from inserted\s*\)/)
  })

  it('scopes both the insert and the bump to this account, client and item', async () => {
    mocks.sql.mockResolvedValue([])
    const { attachSource } = await import('@/lib/work-items/sources')
    await attachSource({ accountId: 'account-1', clientId: 'client-1', workItemId: 'item-1', source: SOURCE, actorId: 'actor-1' })

    const values = mocks.sql.mock.calls[0]!.slice(1)
    expect(values.filter(value => value === 'account-1').length).toBeGreaterThanOrEqual(2)
    expect(values.filter(value => value === 'client-1').length).toBeGreaterThanOrEqual(2)
    expect(values.filter(value => value === 'item-1').length).toBeGreaterThanOrEqual(2)
  })

  it("returns false when nothing was inserted -- the item is absent or not this account/client's", async () => {
    mocks.sql.mockResolvedValue([])
    const { attachSource } = await import('@/lib/work-items/sources')

    expect(await attachSource({ accountId: 'account-1', clientId: 'client-1', workItemId: 'item-1', source: SOURCE, actorId: 'actor-1' })).toBe(false)
  })

  it('writes every source field into the insert, not a subset', async () => {
    mocks.sql.mockResolvedValue([])
    const { attachSource } = await import('@/lib/work-items/sources')
    await attachSource({ accountId: 'account-1', clientId: 'client-1', workItemId: 'item-1', source: SOURCE, actorId: 'actor-1' })

    const values = mocks.sql.mock.calls[0]!.slice(1)
    for (const value of [SOURCE.opportunityKey, SOURCE.sourceKind, SOURCE.sourceId, SOURCE.ruleVersion, SOURCE.checkKey, SOURCE.fingerprint]) {
      expect(values).toContain(value)
    }
    expect(values).toContainEqual(JSON.stringify(SOURCE.snapshot))
  })
})

describe('withdrawSource', () => {
  it('refuses to withdraw the last live source', async () => {
    // Would silently pass without the count(*) guard: an item with zero live
    // sources is a piece of work with no evidence behind it, and the
    // remaining-count check has to live inside the statement itself -- a
    // check-then-write in application code would leave a window where a
    // concurrent withdrawal of the "other" source could race this one.
    mocks.sql.mockResolvedValue([])
    const { withdrawSource } = await import('@/lib/work-items/sources')

    const withdrawn = await withdrawSource({ accountId: 'account-1', clientId: 'client-1', workItemId: 'item-1', opportunityKey: 'key-1', actorId: 'actor-1' })

    expect(withdrawn).toBe(false)
    const query = mocks.sql.mock.calls[0]![0].join(' ')
    expect(query).toContain('count(*)')
    expect(query).toMatch(/>\s*1/)
  })

  it('scopes the withdrawal to this account, client, item and opportunity key', async () => {
    mocks.sql.mockResolvedValue([])
    const { withdrawSource } = await import('@/lib/work-items/sources')
    await withdrawSource({ accountId: 'account-1', clientId: 'client-1', workItemId: 'item-1', opportunityKey: 'key-1', actorId: 'actor-1' })

    const values = mocks.sql.mock.calls[0]!.slice(1)
    expect(values).toContain('account-1')
    expect(values).toContain('client-1')
    expect(values).toContain('item-1')
    expect(values).toContain('key-1')
    expect(values).toContain('actor-1')
  })

  it('records the actor doing the withdrawing, not a null', async () => {
    mocks.sql.mockResolvedValue([{ id: 'source-1' }])
    const { withdrawSource } = await import('@/lib/work-items/sources')
    const withdrawn = await withdrawSource({ accountId: 'account-1', clientId: 'client-1', workItemId: 'item-1', opportunityKey: 'key-1', actorId: 'actor-1' })

    expect(withdrawn).toBe(true)
    const query = mocks.sql.mock.calls[0]![0].join(' ')
    expect(query).toContain('withdrawn_by')
    expect(query).not.toMatch(/withdrawn_by\s*=\s*null/)
  })

  it('returns false when nothing matched -- absent, not yours, already withdrawn, or the only source', async () => {
    mocks.sql.mockResolvedValue([])
    const { withdrawSource } = await import('@/lib/work-items/sources')

    expect(await withdrawSource({ accountId: 'account-1', clientId: 'client-1', workItemId: 'item-1', opportunityKey: 'key-1', actorId: 'actor-1' })).toBe(false)
  })
})
