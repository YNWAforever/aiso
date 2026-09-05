import { describe, expect, it } from 'vitest'

// No suppression needed: the .mjs carries JSDoc types, so tsc resolves this
// import and checks the call sites below against them.
import { selectPrunableBranches } from '../../scripts/prune-preview-branches.mjs'

/**
 * Selection is tested as a pure function with `now` injected, so these cases
 * never touch the Neon API and never depend on the clock.
 *
 * The production cases are the ones that matter. A cleanup job that can delete
 * the production branch is worse than no cleanup job, and that mistake is not
 * recoverable — which is why it is a separate condition rather than something
 * implied by the name prefix.
 */
const NOW = new Date('2026-09-05T12:00:00Z').getTime()
const PRODUCTION = 'br-square-mountain-az6f82vi'
const opts = { now: NOW, productionBranchId: PRODUCTION }

describe('selectPrunableBranches', () => {
  it('never returns the production branch, however old', () => {
    const branches = [{ id: PRODUCTION, name: 'production', created_at: '2020-01-01T00:00:00Z' }]
    expect(selectPrunableBranches(branches, opts)).toEqual([])
  })

  it('never returns the production branch even when it is named like a preview', () => {
    // The id check must not depend on the name check.
    const branches = [{ id: PRODUCTION, name: 'preview-999', created_at: '2020-01-01T00:00:00Z' }]
    expect(selectPrunableBranches(branches, opts)).toEqual([])
  })

  it('never returns a branch whose name is not a preview', () => {
    const branches = [{ id: 'br-x', name: 'staging', created_at: '2020-01-01T00:00:00Z' }]
    expect(selectPrunableBranches(branches, opts)).toEqual([])
  })

  it('returns a preview branch past its TTL', () => {
    const branches = [{ id: 'br-old', name: 'preview-123', created_at: '2026-09-05T09:00:00Z' }]
    expect(selectPrunableBranches(branches, opts).map((b) => b.id)).toEqual(['br-old'])
  })

  it('leaves a preview branch inside its TTL', () => {
    const branches = [{ id: 'br-new', name: 'preview-124', created_at: '2026-09-05T11:30:00Z' }]
    expect(selectPrunableBranches(branches, opts)).toEqual([])
  })

  it('treats a branch exactly at the TTL boundary as not yet prunable', () => {
    // Exactly NOW minus the 2h default. Pinned because an off-by-one here
    // silently changes which branches survive a sweep.
    const branches = [{ id: 'br-edge', name: 'preview-125', created_at: '2026-09-05T10:00:00Z' }]
    expect(selectPrunableBranches(branches, opts)).toEqual([])
  })

  it('ignores a branch whose created_at will not parse, rather than deleting it', () => {
    // Fail closed: an unreadable timestamp must not read as "infinitely old".
    const branches = [{ id: 'br-bad', name: 'preview-126', created_at: 'not-a-date' }]
    expect(selectPrunableBranches(branches, opts)).toEqual([])
  })

  it('selects only the prunable branches from a mixed list', () => {
    const branches = [
      { id: PRODUCTION, name: 'production', created_at: '2020-01-01T00:00:00Z' },
      { id: 'br-old', name: 'preview-1', created_at: '2026-09-05T08:00:00Z' },
      { id: 'br-new', name: 'preview-2', created_at: '2026-09-05T11:59:00Z' },
      { id: 'br-stg', name: 'staging', created_at: '2020-01-01T00:00:00Z' },
    ]
    expect(selectPrunableBranches(branches, opts).map((b) => b.id)).toEqual(['br-old'])
  })

  it('honours an explicit ttlMs', () => {
    const branches = [{ id: 'br-x', name: 'preview-127', created_at: '2026-09-05T11:50:00Z' }]
    expect(
      selectPrunableBranches(branches, { ...opts, ttlMs: 5 * 60 * 1000 }).map((b) => b.id),
    ).toEqual(['br-x'])
  })

  it('refuses to run without a production branch id', () => {
    // The guard must not be skippable by omitting its input.
    const branches = [{ id: 'br-old', name: 'preview-1', created_at: '2020-01-01T00:00:00Z' }]
    expect(() => selectPrunableBranches(branches, { now: NOW })).toThrow(/productionBranchId/)
  })
})
