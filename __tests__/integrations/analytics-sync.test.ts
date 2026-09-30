import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GoogleApiError } from '@/lib/integrations/google/oauth'
import { VaultError } from '@/lib/integrations/google/vault'
import { ANALYTICS_SCOPE, SEARCH_CONSOLE_SCOPE } from '@/lib/integrations/google/scopes'
import { DeadlineReachedError } from '@/lib/integrations/search-console/client'
import { AnalyticsApiError, type KeyEventRow } from '@/lib/integrations/analytics/client'
import { syncAnalyticsBinding, type AnalyticsSyncDeps } from '@/lib/integrations/analytics/sync'
import type { DueAnalyticsBinding } from '@/lib/integrations/analytics/store'

const EVENTS_CHOSEN_AT = '2026-09-20T03:04:05.678Z'

const binding = (over: Partial<DueAnalyticsBinding> = {}): DueAnalyticsBinding => ({
  accountId: 'a', clientId: 'c', connectionId: 'g', connectionStatus: 'active',
  propertyId: '123456', streamId: '987', streamHost: 'www.example.com',
  keyEvents: ['generate_lead', 'purchase'], eventsChosenAt: EVENTS_CHOSEN_AT,
  boundAt: '2026-09-01T00:00:00.000Z', backfillPending: false,
  currentDomain: 'example.com',
  account: { plan: 'pro', status: 'active', stripe_subscription_id: 'sub_1' } as DueAnalyticsBinding['account'],
  ...over,
})

const row = (over: Partial<KeyEventRow> = {}): KeyEventRow => ({
  date: '2026-09-20', eventName: 'generate_lead', source: 'google', channelGroup: 'Organic Search', count: 1, ...over,
})

function deps(over: Partial<AnalyticsSyncDeps> = {}): AnalyticsSyncDeps {
  return {
    loadSecret: vi.fn().mockResolvedValue({
      status: 'active', sealed: { ciphertext: Buffer.from('x'), keyId: 'k' }, scopes: [SEARCH_CONSOLE_SCOPE, ANALYTICS_SCOPE],
    }),
    open: vi.fn().mockReturnValue('1//refresh'),
    refresh: vi.fn().mockResolvedValue('ya29.access'),
    markConnection: vi.fn().mockResolvedValue(undefined),
    getStream: vi.fn().mockResolvedValue({ streamId: '987', displayName: 'Web', defaultUri: 'https://www.example.com' }),
    listKeyEvents: vi.fn().mockResolvedValue(['generate_lead', 'purchase']),
    report: vi.fn().mockResolvedValue({ rows: [], withheld: false }),
    replaceDailyWindow: vi.fn().mockResolvedValue(0),
    recordRun: vi.fn().mockResolvedValue(undefined),
    today: () => '2026-09-24',
    deadline: Number.POSITIVE_INFINITY,
    ...over,
  }
}

const noGoogleCalls = (d: AnalyticsSyncDeps) => {
  expect(d.loadSecret).not.toHaveBeenCalled()
  expect(d.refresh).not.toHaveBeenCalled()
  expect(d.getStream).not.toHaveBeenCalled()
  expect(d.listKeyEvents).not.toHaveBeenCalled()
  expect(d.report).not.toHaveBeenCalled()
  expect(d.replaceDailyWindow).not.toHaveBeenCalled()
}

describe('syncAnalyticsBinding', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => { errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {}) })
  afterEach(() => { errorSpy.mockRestore() })

  describe('outcomes', () => {
    it('ok: writes the aggregated counts, records the window end as the date and clears the backfill', async () => {
      const d = deps({
        report: vi.fn().mockResolvedValue({
          rows: [row({ date: '2026-09-19', count: 2 }), row({ date: '2026-09-21', eventName: 'purchase', source: 'chatgpt.com', count: 3 })],
          withheld: false,
        }),
        replaceDailyWindow: vi.fn().mockResolvedValue(2),
      })
      expect(await syncAnalyticsBinding(binding({ backfillPending: true }), d)).toBe('ok')
      expect(d.replaceDailyWindow).toHaveBeenCalledWith('a', 'c', { startDate: '2026-06-27', endDate: '2026-09-24' }, [
        { date: '2026-09-19', eventName: 'generate_lead', sourceClass: 'organic_search', count: 2 },
        { date: '2026-09-21', eventName: 'purchase', sourceClass: 'ai_assistant', count: 3 },
      ])
      expect(d.recordRun).toHaveBeenCalledTimes(1)
      expect(d.recordRun).toHaveBeenCalledWith({
        accountId: 'a', clientId: 'c', connectionId: 'g', propertyId: '123456', streamId: '987',
        // The window end the sync requested, not the newest row: GA4 omits zero-event days.
        eventsChosenAt: EVENTS_CHOSEN_AT, outcome: 'ok', rowsWritten: 2, dataThrough: '2026-09-24',
        dataWithheld: false, clearBackfill: true,
      })
    })

    // GA4's runReport omits days with no events, so "no rows" is a real answer:
    // zero enquiries through the window end. Recording null here left a brand with
    // no enquiries in awaiting_first_sync forever.
    it('ok with no rows still replaces the window with nothing, and records the window end', async () => {
      const d = deps()
      expect(await syncAnalyticsBinding(binding(), d)).toBe('ok')
      expect(d.replaceDailyWindow).toHaveBeenCalledWith('a', 'c', expect.anything(), [])
      expect(d.recordRun).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'ok', dataThrough: '2026-09-24', rowsWritten: 0 }))
    })

    it('ok whose last enquiry was 40 days ago still records the window end, not that old date', async () => {
      const d = deps({
        report: vi.fn().mockResolvedValue({ rows: [row({ date: '2026-08-15', count: 5 })], withheld: false }),
        replaceDailyWindow: vi.fn().mockResolvedValue(1),
      })
      expect(await syncAnalyticsBinding(binding({ backfillPending: true }), d)).toBe('ok')
      expect(d.recordRun).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'ok', dataThrough: '2026-09-24' }))
    })

    it('not_entitled: an account below Pro makes no Google call and is recorded', async () => {
      const d = deps()
      const basic = binding({ account: { plan: 'basic', status: 'active' } as DueAnalyticsBinding['account'] })
      expect(await syncAnalyticsBinding(basic, d)).toBe('not_entitled')
      noGoogleCalls(d)
      expect(d.recordRun).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'not_entitled', clearBackfill: false }))
    })

    it('domain_mismatch: streamStillMatches runs before any Google call', async () => {
      const d = deps()
      expect(await syncAnalyticsBinding(binding({ currentDomain: 'other.com' }), d)).toBe('domain_mismatch')
      noGoogleCalls(d)
      expect(d.recordRun).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'domain_mismatch', clearBackfill: false }))
    })

    it('domain_mismatch: a brand with no domain never syncs', async () => {
      const d = deps()
      expect(await syncAnalyticsBinding(binding({ currentDomain: null }), d)).toBe('domain_mismatch')
      noGoogleCalls(d)
    })

    it('revoked: a connection that is no longer active, without marking it again', async () => {
      const d = deps({ loadSecret: vi.fn().mockResolvedValue({ status: 'needs_reconnect', sealed: null }) })
      expect(await syncAnalyticsBinding(binding(), d)).toBe('revoked')
      expect(d.markConnection).not.toHaveBeenCalled()
      expect(d.getStream).not.toHaveBeenCalled()
    })

    it('vault_error: reported as ours, and never marks the connection', async () => {
      const d = deps({ open: vi.fn(() => { throw new VaultError('VAULT_KEY_UNKNOWN') }) })
      expect(await syncAnalyticsBinding(binding(), d)).toBe('vault_error')
      expect(d.markConnection).not.toHaveBeenCalled()
    })

    it.each([
      ['misconfigured', 'config_error'],
      ['unavailable', 'google_unavailable'],
      ['quota', 'quota'],
    ] as const)('a %s refresh failure records %s and leaves the connection alone', async (kind, outcome) => {
      const d = deps({ refresh: vi.fn().mockRejectedValue(new GoogleApiError(kind, 0)) })
      expect(await syncAnalyticsBinding(binding(), d)).toBe(outcome)
      expect(d.markConnection).not.toHaveBeenCalled()
      expect(d.getStream).not.toHaveBeenCalled()
    })

    it('deferred: a deadline already passed makes no Google call', async () => {
      const d = deps({ deadline: 1_000, now: () => 1_000 })
      expect(await syncAnalyticsBinding(binding({ backfillPending: true }), d)).toBe('deferred')
      expect(d.refresh).not.toHaveBeenCalled()
      expect(d.report).not.toHaveBeenCalled()
      expect(d.replaceDailyWindow).not.toHaveBeenCalled()
      expect(d.recordRun).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'deferred', clearBackfill: false }))
    })

    it('deferred: a deadline reached after the token stops before the stream lookup', async () => {
      let clock = 0
      const d = deps({
        refresh: vi.fn(async () => { clock = 50; return 'ya29.access' }),
        now: () => clock, deadline: 40,
      })
      expect(await syncAnalyticsBinding(binding(), d)).toBe('deferred')
      expect(d.getStream).not.toHaveBeenCalled()
    })

    it('deferred: a deadline reached inside the report writes nothing from it and keeps the backfill pending', async () => {
      const d = deps({ report: vi.fn().mockRejectedValue(new DeadlineReachedError()) })
      expect(await syncAnalyticsBinding(binding({ backfillPending: true }), d)).toBe('deferred')
      expect(d.replaceDailyWindow).not.toHaveBeenCalled()
      expect(d.recordRun).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'deferred', clearBackfill: false, dataThrough: null }))
    })

    it('passes the deadline and clock into the report', async () => {
      const now = () => 0
      const d = deps({ deadline: 9_999, now })
      await syncAnalyticsBinding(binding(), d)
      expect(d.report).toHaveBeenCalledWith('ya29.access', expect.objectContaining({ deadline: 9_999, now }))
    })

    it('access_lost: the stream is gone', async () => {
      const d = deps({ getStream: vi.fn().mockResolvedValue(null) })
      expect(await syncAnalyticsBinding(binding(), d)).toBe('access_lost')
      expect(d.report).not.toHaveBeenCalled()
      expect(d.recordRun).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'access_lost', clearBackfill: false }))
    })

    it.each([
      ['a stream re-pointed at another site', 'https://other.com'],
      ['an unparseable default URI', 'not a url'],
      ['a non-http default URI', 'ftp://www.example.com'],
      ['a default URI with a port', 'https://www.example.com:8443'],
      ['a subdomain of the brand', 'https://shop.example.com'],
      ['an empty default URI', ''],
    ])('domain_mismatch: the live stream is re-checked against the brand domain (%s)', async (_label, defaultUri) => {
      const d = deps({ getStream: vi.fn().mockResolvedValue({ streamId: '987', displayName: 'Web', defaultUri }) })
      expect(await syncAnalyticsBinding(binding({ backfillPending: true }), d)).toBe('domain_mismatch')
      expect(d.listKeyEvents).not.toHaveBeenCalled()
      expect(d.report).not.toHaveBeenCalled()
      expect(d.replaceDailyWindow).not.toHaveBeenCalled()
      expect(d.markConnection).not.toHaveBeenCalled()
      expect(d.recordRun).toHaveBeenCalledTimes(1)
      expect(d.recordRun).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'domain_mismatch', clearBackfill: false }))
    })

    it('domain_mismatch is decided before the deadline check that follows the stream lookup', async () => {
      let clock = 0
      const d = deps({
        getStream: vi.fn(async () => { clock = 50; return { streamId: '987', displayName: 'Web', defaultUri: 'https://other.com' } }),
        now: () => clock, deadline: 40,
      })
      expect(await syncAnalyticsBinding(binding(), d)).toBe('domain_mismatch')
    })

    it('accepts the apex and the www form of the live stream host', async () => {
      for (const defaultUri of ['https://example.com', 'https://www.example.com', 'HTTPS://WWW.EXAMPLE.COM/']) {
        const d = deps({ getStream: vi.fn().mockResolvedValue({ streamId: '987', displayName: 'Web', defaultUri }) })
        expect(await syncAnalyticsBinding(binding(), d)).toBe('ok')
      }
    })

    it.each([
      ['access_lost', 'access_lost'],
      ['quota', 'quota'],
      ['unavailable', 'google_unavailable'],
    ] as const)('maps an Analytics %s failure from the report to %s', async (kind, outcome) => {
      const d = deps({ report: vi.fn().mockRejectedValue(new AnalyticsApiError(kind, 0)) })
      expect(await syncAnalyticsBinding(binding(), d)).toBe(outcome)
      expect(d.markConnection).not.toHaveBeenCalled()
      expect(d.replaceDailyWindow).not.toHaveBeenCalled()
    })

    it('config_error: a misconfigured Analytics failure is logged with status and code, never a message', async () => {
      const d = deps({ report: vi.fn().mockRejectedValue(new AnalyticsApiError('misconfigured', 403, 'SERVICE_DISABLED')) })
      expect(await syncAnalyticsBinding(binding(), d)).toBe('config_error')
      expect(d.markConnection).not.toHaveBeenCalled()
      expect(errorSpy).toHaveBeenCalledWith(expect.any(String), { clientId: 'c', status: 403, code: 'SERVICE_DISABLED' })
    })

    it('internal_error: anything unclassified, logged as clientId, name and code only', async () => {
      const boom = Object.assign(new Error('postgresql://user:secret@host/db exploded'), { code: '23505', constraint: 'analytics_daily_unique' })
      const d = deps({ replaceDailyWindow: vi.fn().mockRejectedValue(boom) })
      expect(await syncAnalyticsBinding(binding({ backfillPending: true }), d)).toBe('internal_error')
      expect(errorSpy).toHaveBeenCalledWith(expect.any(String), { clientId: 'c', name: 'Error', code: '23505' })
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('secret')
      expect(d.recordRun).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'internal_error', clearBackfill: false, rowsWritten: 0 }))
    })

    it('records exactly one ledger row even when replaceDailyWindow throws', async () => {
      const d = deps({ replaceDailyWindow: vi.fn().mockRejectedValue(new Error('db down')) })
      await syncAnalyticsBinding(binding(), d)
      expect(d.recordRun).toHaveBeenCalledTimes(1)
    })

    it('records exactly one ledger row on success and on a skip', async () => {
      const ok = deps()
      await syncAnalyticsBinding(binding(), ok)
      expect(ok.recordRun).toHaveBeenCalledTimes(1)
      const skip = deps()
      await syncAnalyticsBinding(binding({ currentDomain: 'other.com' }), skip)
      expect(skip.recordRun).toHaveBeenCalledTimes(1)
    })

    it('lets a failure to write the ledger propagate rather than paper over it', async () => {
      const d = deps({ recordRun: vi.fn().mockRejectedValue(new Error('ledger down')) })
      await expect(syncAnalyticsBinding(binding(), d)).rejects.toThrow('ledger down')
    })
  })

  describe('the cross-product rule', () => {
    it('an Analytics scope_missing from the token scopes never calls markConnection', async () => {
      const d = deps({
        loadSecret: vi.fn().mockResolvedValue({ status: 'active', sealed: { ciphertext: Buffer.from('x'), keyId: 'k' }, scopes: [SEARCH_CONSOLE_SCOPE] }),
      })
      expect(await syncAnalyticsBinding(binding(), d)).toBe('scope_missing')
      expect(d.markConnection).not.toHaveBeenCalled()
      expect(d.getStream).not.toHaveBeenCalled()
      expect(d.recordRun).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'scope_missing', clearBackfill: false }))
    })

    it('treats a connection with no recorded scopes as lacking the Analytics scope', async () => {
      const d = deps({ loadSecret: vi.fn().mockResolvedValue({ status: 'active', sealed: { ciphertext: Buffer.from('x'), keyId: 'k' } }) })
      expect(await syncAnalyticsBinding(binding(), d)).toBe('scope_missing')
      expect(d.markConnection).not.toHaveBeenCalled()
    })

    it.each(['getStream', 'listKeyEvents', 'report'] as const)('an Analytics API 403 scope failure from %s never calls markConnection', async (dep) => {
      const d = deps({ [dep]: vi.fn().mockRejectedValue(new AnalyticsApiError('scope_missing', 403, 'ACCESS_TOKEN_SCOPE_INSUFFICIENT')) })
      expect(await syncAnalyticsBinding(binding(), d)).toBe('scope_missing')
      expect(d.markConnection).not.toHaveBeenCalled()
      expect(d.replaceDailyWindow).not.toHaveBeenCalled()
      expect(d.recordRun).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'scope_missing', clearBackfill: false }))
    })

    it('invalid_grant on the refresh DOES mark the connection for reconnect', async () => {
      const d = deps({ refresh: vi.fn().mockRejectedValue(new GoogleApiError('revoked', 400, 'invalid_grant')) })
      expect(await syncAnalyticsBinding(binding(), d)).toBe('revoked')
      expect(d.markConnection).toHaveBeenCalledTimes(1)
      expect(d.markConnection).toHaveBeenCalledWith('a', 'g', 'needs_reconnect')
      expect(d.getStream).not.toHaveBeenCalled()
    })

    it('a refresh forbidden is access_lost end to end, and does not mark the connection', async () => {
      const d = deps({ refresh: vi.fn().mockRejectedValue(new GoogleApiError('forbidden', 403)) })
      expect(await syncAnalyticsBinding(binding({ backfillPending: true }), d)).toBe('access_lost')
      expect(d.markConnection).not.toHaveBeenCalled()
      expect(d.getStream).not.toHaveBeenCalled()
      expect(d.recordRun).toHaveBeenCalledTimes(1)
      expect(d.recordRun).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'access_lost', clearBackfill: false }))
    })

    it('any other GoogleApiError rethrown mid-attempt is internal_error and never marks the connection', async () => {
      const d = deps({ getStream: vi.fn().mockRejectedValue(new GoogleApiError('revoked', 400, 'invalid_grant')) })
      expect(await syncAnalyticsBinding(binding(), d)).toBe('internal_error')
      expect(d.markConnection).not.toHaveBeenCalled()
      expect(errorSpy).toHaveBeenCalledWith(expect.any(String), { clientId: 'c', name: 'GoogleApiError', code: 'invalid_grant' })
    })
  })

  describe('chosen events', () => {
    it('events_missing: none of the chosen events is a key event any more, so no report is run', async () => {
      const d = deps({ listKeyEvents: vi.fn().mockResolvedValue(['sign_up']) })
      expect(await syncAnalyticsBinding(binding({ backfillPending: true }), d)).toBe('events_missing')
      expect(d.report).not.toHaveBeenCalled()
      expect(d.replaceDailyWindow).not.toHaveBeenCalled()
      expect(d.recordRun).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'events_missing', clearBackfill: false }))
    })

    it('events_missing: event names match case-sensitively, so a case-different key event does not count', async () => {
      const d = deps({ listKeyEvents: vi.fn().mockResolvedValue(['generate_lead']) })
      expect(await syncAnalyticsBinding(binding({ keyEvents: ['Generate_Lead'] }), d)).toBe('events_missing')
      expect(d.report).not.toHaveBeenCalled()
    })

    it('a partially missing list syncs only the events that are still key events', async () => {
      const d = deps({ listKeyEvents: vi.fn().mockResolvedValue(['purchase', 'sign_up']) })
      expect(await syncAnalyticsBinding(binding(), d)).toBe('ok')
      expect(d.report).toHaveBeenCalledWith('ya29.access', expect.objectContaining({ eventNames: ['purchase'] }))
    })

    it('passes the property, stream and the chosen events to the report and the lookups', async () => {
      const d = deps()
      await syncAnalyticsBinding(binding(), d)
      expect(d.getStream).toHaveBeenCalledWith('ya29.access', '123456', '987')
      expect(d.listKeyEvents).toHaveBeenCalledWith('ya29.access', '123456')
      expect(d.report).toHaveBeenCalledWith('ya29.access', expect.objectContaining({
        propertyId: '123456', streamId: '987', eventNames: ['generate_lead', 'purchase'],
      }))
    })

    it('Review Focus 4: drops a case-different name and (other), keeping only exact chosen events', async () => {
      const d = deps({
        report: vi.fn().mockResolvedValue({
          rows: [
            row({ eventName: 'generate_lead', count: 4 }),
            row({ eventName: 'Generate_Lead', count: 100 }),
            row({ eventName: '(other)', count: 50 }),
            row({ eventName: 'sign_up', count: 7 }),
          ],
          withheld: true,
        }),
        replaceDailyWindow: vi.fn().mockResolvedValue(1),
      })
      expect(await syncAnalyticsBinding(binding(), d)).toBe('ok')
      expect(d.replaceDailyWindow).toHaveBeenCalledWith('a', 'c', expect.anything(), [
        { date: '2026-09-20', eventName: 'generate_lead', sourceClass: 'organic_search', count: 4 },
      ])
    })

    it('Review Focus 4: a chosen event that is no longer a key event is dropped even if the report returns it', async () => {
      const d = deps({
        listKeyEvents: vi.fn().mockResolvedValue(['purchase']),
        report: vi.fn().mockResolvedValue({ rows: [row({ eventName: 'generate_lead' }), row({ eventName: 'purchase', count: 2 })], withheld: false }),
      })
      await syncAnalyticsBinding(binding(), d)
      expect(d.replaceDailyWindow).toHaveBeenCalledWith('a', 'c', expect.anything(), [
        { date: '2026-09-20', eventName: 'purchase', sourceClass: 'organic_search', count: 2 },
      ])
    })

    it('dataThrough is the window end whichever rows were kept or dropped', async () => {
      const d = deps({
        report: vi.fn().mockResolvedValue({ rows: [row({ date: '2026-09-18' }), row({ date: '2026-09-23', eventName: '(other)' })], withheld: false }),
      })
      await syncAnalyticsBinding(binding(), d)
      expect(d.recordRun).toHaveBeenCalledWith(expect.objectContaining({ dataThrough: '2026-09-24' }))
    })
  })

  describe('window and aggregation', () => {
    it('fetches 90 days on backfill and 7 otherwise, ending today', async () => {
      const first = deps()
      await syncAnalyticsBinding(binding({ backfillPending: true }), first)
      expect(first.report).toHaveBeenCalledWith('ya29.access', expect.objectContaining({ startDate: '2026-06-27', endDate: '2026-09-24' }))
      expect(first.replaceDailyWindow).toHaveBeenCalledWith('a', 'c', { startDate: '2026-06-27', endDate: '2026-09-24' }, [])

      const routine = deps()
      await syncAnalyticsBinding(binding(), routine)
      expect(routine.report).toHaveBeenCalledWith('ya29.access', expect.objectContaining({ startDate: '2026-09-18', endDate: '2026-09-24' }))
      expect(routine.replaceDailyWindow).toHaveBeenCalledWith('a', 'c', { startDate: '2026-09-18', endDate: '2026-09-24' }, [])
    })

    it('sums rows that share a date, event and source class, so the unique key is never violated', async () => {
      const d = deps({
        report: vi.fn().mockResolvedValue({
          rows: [
            row({ source: 'google', count: 2 }),
            row({ source: 'bing', count: 3 }),
            row({ source: 'chatgpt.com', channelGroup: 'Referral', count: 1 }),
            row({ source: 'www.perplexity.ai', channelGroup: 'Referral', count: 4 }),
            row({ source: '(direct)', channelGroup: 'Direct', count: 5 }),
            row({ source: '(not set)', channelGroup: 'Unassigned', count: 6 }),
            row({ date: '2026-09-21', source: 'google', count: 9 }),
            row({ eventName: 'purchase', source: 'google', count: 8 }),
          ],
          withheld: false,
        }),
        replaceDailyWindow: vi.fn().mockResolvedValue(5),
      })
      await syncAnalyticsBinding(binding(), d)
      const counts = vi.mocked(d.replaceDailyWindow).mock.calls[0]![3]
      const keys = counts.map(c => `${c.date}|${c.eventName}|${c.sourceClass}`)
      expect(new Set(keys).size).toBe(keys.length)
      expect(counts).toHaveLength(5)
      expect(counts).toEqual(expect.arrayContaining([
        { date: '2026-09-20', eventName: 'generate_lead', sourceClass: 'organic_search', count: 5 },
        { date: '2026-09-20', eventName: 'generate_lead', sourceClass: 'ai_assistant', count: 5 },
        { date: '2026-09-20', eventName: 'generate_lead', sourceClass: 'other', count: 11 },
        { date: '2026-09-21', eventName: 'generate_lead', sourceClass: 'organic_search', count: 9 },
        { date: '2026-09-20', eventName: 'purchase', sourceClass: 'organic_search', count: 8 },
      ]))
    })

    it('records the number of rows the store reports as written', async () => {
      const d = deps({ report: vi.fn().mockResolvedValue({ rows: [row()], withheld: false }), replaceDailyWindow: vi.fn().mockResolvedValue(1) })
      await syncAnalyticsBinding(binding(), d)
      expect(d.recordRun).toHaveBeenCalledWith(expect.objectContaining({ rowsWritten: 1 }))
    })

    it('records dataWithheld unchanged when the report says it withheld rows (thresholding or the page cap)', async () => {
      const d = deps({ report: vi.fn().mockResolvedValue({ rows: [row()], withheld: true }), replaceDailyWindow: vi.fn().mockResolvedValue(1) })
      expect(await syncAnalyticsBinding(binding(), d)).toBe('ok')
      expect(d.recordRun).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'ok', dataWithheld: true, clearBackfill: true }))
    })

    it('never sets dataWithheld or clears the backfill on a non-ok outcome', async () => {
      const d = deps({ report: vi.fn().mockRejectedValue(new AnalyticsApiError('quota', 429)) })
      await syncAnalyticsBinding(binding({ backfillPending: true }), d)
      expect(d.recordRun).toHaveBeenCalledWith(expect.objectContaining({ dataWithheld: false, clearBackfill: false }))
    })
  })
})
