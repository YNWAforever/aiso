import { describe, expect, it, vi } from 'vitest'
import { GoogleApiError } from '@/lib/integrations/google/oauth'
import { VaultError } from '@/lib/integrations/google/vault'
import { syncBinding, type SyncDeps } from '@/lib/integrations/search-console/sync'
import type { DueBinding } from '@/lib/integrations/search-console/store'

const binding = (over: Partial<DueBinding> = {}): DueBinding => ({
  accountId: 'a', clientId: 'c', connectionId: 'g', siteUrl: 'sc-domain:example.com',
  boundDomain: 'example.com', currentDomain: 'example.com', backfillPending: false,
  account: { plan: 'pro', status: 'active', stripe_subscription_id: 'sub_1' } as DueBinding['account'],
  ...over,
})

function deps(over: Partial<SyncDeps> = {}): SyncDeps {
  return {
    loadSecret: vi.fn().mockResolvedValue({ status: 'active', sealed: { ciphertext: Buffer.from('x'), keyId: 'k' } }),
    open: vi.fn().mockReturnValue('1//refresh'),
    refresh: vi.fn().mockResolvedValue('ya29.access'),
    query: vi.fn().mockResolvedValue([]),
    listPages: vi.fn().mockResolvedValue([]),
    writeDaily: vi.fn().mockResolvedValue(0),
    writePageQueries: vi.fn().mockResolvedValue(0),
    markConnection: vi.fn().mockResolvedValue(undefined),
    recordRun: vi.fn().mockResolvedValue(undefined),
    today: () => '2026-09-24',
    ...over,
  }
}

describe('syncBinding', () => {
  it('skips an account below Pro without calling Google, and records it', async () => {
    const d = deps()
    expect(await syncBinding(binding({ account: { plan: 'basic', status: 'active' } as DueBinding['account'] }), d))
      .toBe('not_entitled')
    expect(d.refresh).not.toHaveBeenCalled()
    expect(d.recordRun).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'not_entitled', clearBackfill: false }))
  })

  it('skips a binding whose brand domain changed', async () => {
    const d = deps()
    expect(await syncBinding(binding({ currentDomain: 'other.com' }), d)).toBe('domain_mismatch')
    expect(d.refresh).not.toHaveBeenCalled()
  })

  it('reports a vault failure as ours, not as a revoked login', async () => {
    const d = deps({ open: vi.fn(() => { throw new VaultError('VAULT_KEY_UNKNOWN') }) })
    expect(await syncBinding(binding(), d)).toBe('vault_error')
    expect(d.markConnection).not.toHaveBeenCalled()
  })

  it('marks the connection for reconnect when the refresh token is dead', async () => {
    const d = deps({ refresh: vi.fn().mockRejectedValue(new GoogleApiError('revoked', 400)) })
    expect(await syncBinding(binding(), d)).toBe('revoked')
    expect(d.markConnection).toHaveBeenCalledWith('a', 'g', 'needs_reconnect')
  })

  it.each([
    ['forbidden', 'access_lost'],
    ['quota', 'quota'],
    ['unavailable', 'google_unavailable'],
    ['misconfigured', 'config_error'],
  ] as const)('maps a %s query failure to %s and leaves the connection alone', async (kind, outcome) => {
    const d = deps({ query: vi.fn().mockRejectedValue(new GoogleApiError(kind, 0)) })
    expect(await syncBinding(binding(), d)).toBe(outcome)
    expect(d.markConnection).not.toHaveBeenCalled()
  })

  it('does not mark the connection for a misconfigured refresh failure either', async () => {
    const d = deps({ refresh: vi.fn().mockRejectedValue(new GoogleApiError('misconfigured', 401)) })
    expect(await syncBinding(binding(), d)).toBe('config_error')
    expect(d.markConnection).not.toHaveBeenCalled()
  })

  it('logs a misconfigured refresh failure at error level with the code, and never a token', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const d = deps({ refresh: vi.fn().mockRejectedValue(new GoogleApiError('misconfigured', 401, 'invalid_client')) })
      expect(await syncBinding(binding(), d)).toBe('config_error')
      expect(spy).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ code: 'invalid_client' }))
      for (const call of spy.mock.calls) {
        for (const arg of call) {
          expect(JSON.stringify(arg)).not.toContain('1//refresh')
          expect(JSON.stringify(arg)).not.toContain('ya29.access')
        }
      }
    } finally {
      spy.mockRestore()
    }
  })

  it('fetches 90 days on backfill and 7 days otherwise', async () => {
    const first = deps()
    await syncBinding(binding({ backfillPending: true }), first)
    expect(first.query).toHaveBeenCalledWith('ya29.access', 'sc-domain:example.com',
      expect.objectContaining({ startDate: '2026-06-27', endDate: '2026-09-24', dimensions: ['date'] }))

    const routine = deps()
    await syncBinding(binding(), routine)
    expect(routine.query).toHaveBeenCalledWith('ya29.access', 'sc-domain:example.com',
      expect.objectContaining({ startDate: '2026-09-18', endDate: '2026-09-24' }))
  })

  it('writes property and page totals, keeps the top 25 queries per date, and records ok', async () => {
    const queryRows = Array.from({ length: 30 }, (_, i) =>
      ({ keys: ['2026-09-20', `q${i}`], clicks: 30 - i, impressions: 100, ctr: 0.1, position: 5 }))
    const query = vi.fn()
      .mockResolvedValueOnce([{ keys: ['2026-09-20'], clicks: 10, impressions: 200, ctr: 0.05, position: 7 }])
      .mockResolvedValueOnce([{ keys: ['2026-09-20'], clicks: 4, impressions: 50, ctr: 0.08, position: 3 }])
      .mockResolvedValueOnce(queryRows)
    const d = deps({ query, listPages: vi.fn().mockResolvedValue(['https://example.com/p']) })

    expect(await syncBinding(binding({ backfillPending: true }), d)).toBe('ok')

    expect(d.writeDaily).toHaveBeenCalledWith('a', 'c', [
      { date: '2026-09-20', scope: 'property', pageUrl: null, clicks: 10, impressions: 200, ctr: 0.05, position: 7 },
      { date: '2026-09-20', scope: 'page', pageUrl: 'https://example.com/p', clicks: 4, impressions: 50, ctr: 0.08, position: 3 },
    ])
    const written = vi.mocked(d.writePageQueries).mock.calls[0]![2]
    expect(written).toHaveLength(25)
    expect(written[0]!.query).toBe('q0')
    expect(d.recordRun).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'ok', dataThrough: '2026-09-20', clearBackfill: true,
    }))
  })

  it('calls recordRun with the siteUrl and connectionId of the binding being synced', async () => {
    const d = deps()
    await syncBinding(binding({ siteUrl: 'sc-domain:other-brand.com', boundDomain: 'other-brand.com', currentDomain: 'other-brand.com', connectionId: 'g2' }), d)
    expect(d.recordRun).toHaveBeenCalledWith(expect.objectContaining({
      siteUrl: 'sc-domain:other-brand.com', connectionId: 'g2',
    }))
  })

  it('makes only one query call for a page with zero page-total rows, and still clears its window', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([]) // property
      .mockResolvedValueOnce([]) // page-total — zero rows, so the date+query breakdown fetch is skipped entirely
    const d = deps({ query, listPages: vi.fn().mockResolvedValue(['https://example.com/p']) })

    expect(await syncBinding(binding(), d)).toBe('ok')

    expect(d.query).toHaveBeenCalledTimes(2) // property + page-total only, no third breakdown call
    expect(d.writePageQueries).toHaveBeenCalledWith('a', 'c', [], {
      startDate: '2026-09-18', endDate: '2026-09-24', pageUrls: ['https://example.com/p'],
    })
  })

  it('drops a query longer than 512 characters', async () => {
    const longQuery = 'q'.repeat(513)
    const queryRows = [
      { keys: ['2026-09-20', longQuery], clicks: 5, impressions: 10, ctr: 0.5, position: 1 },
      { keys: ['2026-09-20', 'short query'], clicks: 3, impressions: 10, ctr: 0.3, position: 2 },
    ]
    const query = vi.fn()
      .mockResolvedValueOnce([]) // property
      .mockResolvedValueOnce([{ keys: ['2026-09-20'], clicks: 1, impressions: 1, ctr: 0.1, position: 1 }]) // page-total — non-empty, so the breakdown fetch happens
      .mockResolvedValueOnce(queryRows) // page queries
    const d = deps({ query, listPages: vi.fn().mockResolvedValue(['https://example.com/p']) })

    expect(await syncBinding(binding(), d)).toBe('ok')

    const written = vi.mocked(d.writePageQueries).mock.calls[0]![2]
    expect(written).toHaveLength(1)
    expect(written[0]!.query).toBe('short query')
  })

  it('deduplicates a (date, query) pair Google returned twice across startRow pages', async () => {
    const queryRows = [
      { keys: ['2026-09-20', 'shoes'], clicks: 5, impressions: 10, ctr: 0.5, position: 1 },
      { keys: ['2026-09-20', 'shoes'], clicks: 3, impressions: 10, ctr: 0.3, position: 2 },
    ]
    const query = vi.fn()
      .mockResolvedValueOnce([]) // property
      .mockResolvedValueOnce([{ keys: ['2026-09-20'], clicks: 1, impressions: 1, ctr: 0.1, position: 1 }]) // page-total, non-empty
      .mockResolvedValueOnce(queryRows) // page queries — same (date, query) key twice
    const d = deps({ query, listPages: vi.fn().mockResolvedValue(['https://example.com/p']) })

    expect(await syncBinding(binding(), d)).toBe('ok')

    const written = vi.mocked(d.writePageQueries).mock.calls[0]![2]
    expect(written).toHaveLength(1)
    expect(written[0]).toMatchObject({ query: 'shoes', clicks: 5, impressions: 10, ctr: 0.5, position: 1 })
  })

  it('treats a cancelled Pro account as not entitled', async () => {
    const d = deps()
    expect(await syncBinding(binding({ account: { plan: 'pro', status: 'cancelled' } as DueBinding['account'] }), d))
      .toBe('not_entitled')
  })

  it('treats a missing secret row as revoked', async () => {
    const d = deps({ loadSecret: vi.fn().mockResolvedValue(null) })
    expect(await syncBinding(binding(), d)).toBe('revoked')
  })

  it('treats a needs_reconnect connection status as revoked', async () => {
    const d = deps({ loadSecret: vi.fn().mockResolvedValue({ status: 'needs_reconnect', sealed: { ciphertext: Buffer.from('x'), keyId: 'k' } }) })
    expect(await syncBinding(binding(), d)).toBe('revoked')
  })

  it('treats a null sealed token as revoked', async () => {
    const d = deps({ loadSecret: vi.fn().mockResolvedValue({ status: 'active', sealed: null }) })
    expect(await syncBinding(binding(), d)).toBe('revoked')
  })

  it('turns a non-VaultError thrown by open into internal_error', async () => {
    const d = deps({ open: vi.fn(() => { throw new Error('unexpected parse failure') }) })
    expect(await syncBinding(binding(), d)).toBe('internal_error')
  })

  it('turns a non-Google write failure into internal_error, writes the ledger row exactly once, and never logs the message or a token', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const secretMessage = 'duplicate key value violates unique constraint "x" — postgresql://user:hunter2@host/db'
      const d = deps({ writeDaily: vi.fn().mockRejectedValue(new Error(secretMessage)) })

      expect(await syncBinding(binding(), d)).toBe('internal_error')
      expect(d.recordRun).toHaveBeenCalledTimes(1)
      expect(d.recordRun).toHaveBeenCalledWith(expect.objectContaining({
        outcome: 'internal_error', rowsWritten: 0, dataThrough: null, clearBackfill: false,
      }))

      for (const call of spy.mock.calls) {
        for (const arg of call) {
          const s = JSON.stringify(arg)
          expect(s).not.toContain(secretMessage)
          expect(s).not.toContain('1//refresh')
          expect(s).not.toContain('ya29.access')
        }
      }
    } finally {
      spy.mockRestore()
    }
  })
})
