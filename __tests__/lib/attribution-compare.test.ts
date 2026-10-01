import { describe, expect, it } from 'vitest'

import { compareTarget } from '@/lib/attribution/compare'
import type { EnquiryDay, SearchDay, SourceState } from '@/lib/attribution/types'

// D = 2026-09-12  ->  before 2026-08-15..2026-09-11, after 2026-09-13..2026-10-10,
// ready on 2026-10-13.
const D = '2026-09-12'
const READY = '2026-10-13'
type Input = Parameters<typeof compareTarget>[0]

const good = (over: Partial<SourceState> = {}): SourceState => ({
  boundAt: '2026-06-01',
  coveredFrom: '2026-06-01',
  okRunDates: ['2026-10-14'],
  latestOutcome: 'ok',
  ...over,
})

const base = (over: Partial<Input> = {}): Input => ({
  day: D,
  today: '2026-10-20',
  withdrawn: false,
  schemaVersion: 1,
  measured: true,
  scope: 'page',
  search: good(),
  searchDays: [],
  enquiries: null,
  ...over,
})

const sd = (date: string, clicks: number, impressions: number, position = 5): SearchDay => ({
  date,
  clicks,
  impressions,
  position,
})
const ed = (date: string, sourceClass: EnquiryDay['sourceClass'], count: number): EnquiryDay => ({
  date,
  sourceClass,
  count,
})

describe('compareTarget status order', () => {
  it('withdrawn beats everything and carries no figures', () => {
    const r = compareTarget(
      base({ withdrawn: true, schemaVersion: 2, measured: false, search: null }),
    )
    expect(r).toEqual({ status: 'withdrawn' })
  })

  it('not_supported beats not_measured and unavailable', () => {
    const r = compareTarget(base({ schemaVersion: 2, measured: false, search: null }))
    expect(r).toEqual({ status: 'not_supported' })
  })

  it('not_measured beats unavailable', () => {
    const r = compareTarget(base({ measured: false, search: null }))
    expect(r).toEqual({ status: 'not_measured' })
  })

  it('unavailable/not_bound when the brand has no Search Console binding', () => {
    expect(compareTarget(base({ search: null }))).toEqual({
      status: 'unavailable',
      reason: 'not_bound',
    })
  })

  it('unavailable/not_bound when the state has no boundAt', () => {
    expect(compareTarget(base({ search: good({ boundAt: null }) }))).toMatchObject({
      status: 'unavailable',
      reason: 'not_bound',
    })
  })

  it('unavailable/rebound when bound after the before-window opened (D-28)', () => {
    // D-28 = 2026-08-15; one day later is a rebind, the day itself is not.
    expect(compareTarget(base({ search: good({ boundAt: '2026-08-16' }) }))).toEqual({
      status: 'unavailable',
      reason: 'rebound',
    })
    expect(compareTarget(base({ search: good({ boundAt: '2026-08-15' }) })).status).not.toBe(
      'unavailable',
    )
  })

  it('reads a boundAt timestamp as its Hong Kong date', () => {
    // 2026-08-15T16:00:00Z is 2026-08-16 in Hong Kong -> after D-28.
    expect(
      compareTarget(base({ search: good({ boundAt: '2026-08-15T16:00:00Z' }) })),
    ).toMatchObject({ status: 'unavailable', reason: 'rebound' })
    expect(
      compareTarget(base({ search: good({ boundAt: '2026-08-15T15:59:59Z' }) })).status,
    ).not.toBe('unavailable')
  })

  it('rebound beats sync_failing', () => {
    expect(
      compareTarget(
        base({ search: good({ boundAt: '2026-09-01', latestOutcome: 'failed', okRunDates: [] }) }),
      ),
    ).toMatchObject({ reason: 'rebound' })
  })

  it('unavailable/sync_failing when the latest run is not ok and no ok run reaches D+31', () => {
    expect(
      compareTarget(
        base({ search: good({ latestOutcome: 'failed', okRunDates: ['2026-10-12'] }) }),
      ),
    ).toEqual({ status: 'unavailable', reason: 'sync_failing' })
  })

  it('a failing latest run does not matter once an ok run at D+31 exists', () => {
    const r = compareTarget(
      base({ search: good({ latestOutcome: 'failed', okRunDates: ['2026-10-13'] }) }),
    )
    expect(r.status).toBe('comparable')
  })

  it('not_ready before D+31, with readyOn', () => {
    expect(compareTarget(base({ today: '2026-10-12' }))).toEqual({
      status: 'not_ready',
      readyOn: READY,
    })
  })

  it('not_ready when today is past D+31 but no ok run has reached D+31 yet', () => {
    expect(compareTarget(base({ search: good({ okRunDates: ['2026-10-12'] }) }))).toEqual({
      status: 'not_ready',
      readyOn: READY,
    })
  })

  it('is ready on D+31 itself only when the run is there too', () => {
    expect(
      compareTarget(base({ today: READY, search: good({ okRunDates: [READY] }) })).status,
    ).toBe('comparable')
    expect(compareTarget(base({ today: READY, search: good({ okRunDates: [] }) })).status).toBe(
      'not_ready',
    )
  })

  it('sync_failing beats not_ready', () => {
    expect(
      compareTarget(
        base({ today: '2026-10-01', search: good({ latestOutcome: 'failed', okRunDates: [] }) }),
      ),
    ).toMatchObject({ status: 'unavailable', reason: 'sync_failing' })
  })

  it('insufficient_history when coverage is missing entirely', () => {
    expect(compareTarget(base({ search: good({ coveredFrom: null }) }))).toEqual({
      status: 'insufficient_history',
      missingFrom: '2026-08-15',
      missingTo: '2026-09-11',
    })
  })

  it('insufficient_history names the uncovered part of the before-window', () => {
    expect(compareTarget(base({ search: good({ coveredFrom: '2026-09-01' }) }))).toEqual({
      status: 'insufficient_history',
      missingFrom: '2026-08-15',
      missingTo: '2026-08-31',
    })
  })

  it('coverage starting exactly at D-28 is enough', () => {
    expect(compareTarget(base({ search: good({ coveredFrom: '2026-08-15' }) })).status).toBe(
      'comparable',
    )
  })

  it('caps missingTo at D-1 when coverage starts after the delivery day', () => {
    expect(compareTarget(base({ search: good({ coveredFrom: '2026-10-01' }) }))).toMatchObject({
      status: 'insufficient_history',
      missingFrom: '2026-08-15',
      missingTo: '2026-09-11',
    })
  })
})

describe('search figures', () => {
  it('zero-fills days with no row and sums only the rows present', () => {
    const r = compareTarget(
      base({
        searchDays: [
          sd('2026-08-20', 10, 100),
          sd('2026-09-13', 20, 200),
          sd('2026-09-20', 30, 300),
          sd('2026-10-10', 40, 400),
        ],
      }),
    )
    expect(r.status).toBe('comparable')
    expect(r.search!.clicks).toEqual({ before: 10, after: 90, change: 80, changePct: 8 })
    expect(r.search!.impressions).toEqual({ before: 100, after: 900, change: 800, changePct: 8 })
  })

  it('ignores the delivery day and rows outside either window', () => {
    const r = compareTarget(
      base({
        searchDays: [
          sd('2026-08-14', 999, 999),
          sd(D, 999, 999),
          sd('2026-10-11', 999, 999),
          sd('2026-09-01', 5, 50),
          sd('2026-09-14', 7, 70),
        ],
      }),
    )
    expect(r.search!.clicks).toMatchObject({ before: 5, after: 7 })
  })

  it('changePct is the relative change; new when before is 0; 0 when both are 0', () => {
    const rel = compareTarget(
      base({ searchDays: [sd('2026-09-01', 140, 1000), sd('2026-09-14', 210, 1000)] }),
    )
    expect(rel.search!.clicks.changePct).toBe(0.5)

    const fresh = compareTarget(base({ searchDays: [sd('2026-09-14', 5, 50)] }))
    expect(fresh.search!.clicks).toEqual({ before: 0, after: 5, change: 5, changePct: 'new' })

    const flat = compareTarget(base({ searchDays: [] }))
    expect(flat.search!.clicks).toEqual({ before: 0, after: 0, change: 0, changePct: 0 })
  })

  it('position is impression-weighted', () => {
    const r = compareTarget(
      base({
        searchDays: [
          sd('2026-09-01', 1, 100, 2),
          sd('2026-09-02', 1, 300, 10),
          sd('2026-09-14', 1, 100, 4),
        ],
      }),
    )
    expect(r.search!.position).toEqual({ before: 8, after: 4, change: -4, changePct: null })
  })

  it('ctr is total clicks over total impressions and reports points only', () => {
    const r = compareTarget(
      base({ searchDays: [sd('2026-09-01', 10, 100), sd('2026-09-14', 30, 100)] }),
    )
    expect(r.search!.ctr.before).toBeCloseTo(0.1)
    expect(r.search!.ctr.after).toBeCloseTo(0.3)
    expect(r.search!.ctr.change).toBeCloseTo(0.2)
    expect(r.search!.ctr.changePct).toBeNull()
  })

  it('zero impressions give null ctr and position, with null change', () => {
    const r = compareTarget(base({ searchDays: [sd('2026-09-14', 0, 0, 3)] }))
    expect(r.search!.ctr).toEqual({ before: null, after: null, change: null, changePct: null })
    expect(r.search!.position).toEqual({
      before: null,
      after: null,
      change: null,
      changePct: null,
    })
    const oneSided = compareTarget(base({ searchDays: [sd('2026-09-14', 0, 100, 3)] }))
    expect(oneSided.search!.ctr).toEqual({ before: null, after: 0, change: null, changePct: null })
    expect(oneSided.search!.position).toEqual({
      before: null,
      after: 3,
      change: null,
      changePct: null,
    })
  })

  it('only a comparable target carries figures', () => {
    expect(compareTarget(base({ today: '2026-10-01' })).search).toBeUndefined()
  })
})

describe('enquiries (whole site only)', () => {
  const site = (over: Partial<Input> = {}) => base({ scope: 'site', ...over })
  const enq = (over: Partial<NonNullable<Input['enquiries']>> = {}): Input['enquiries'] => ({
    enabled: true,
    state: good(),
    days: [],
    ...over,
  })

  it('a page target never has enquiries, even when GA4 is supplied', () => {
    const r = compareTarget(base({ scope: 'page', enquiries: enq() }))
    expect(r.status).toBe('comparable')
    expect(r).not.toHaveProperty('enquiries')
  })

  it('GA4 not enabled: enquiries unavailable/not_enabled and search figures untouched', () => {
    const r = compareTarget(
      site({
        searchDays: [sd('2026-09-14', 5, 50)],
        enquiries: { enabled: false, state: null, days: [] },
      }),
    )
    expect(r.status).toBe('comparable')
    expect(r.search!.clicks.after).toBe(5)
    expect(r.enquiries).toEqual({ status: 'unavailable', reason: 'not_enabled' })
  })

  it('a site with no enquiries input at all is treated as not enabled', () => {
    expect(compareTarget(site({ enquiries: null })).enquiries).toEqual({
      status: 'unavailable',
      reason: 'not_enabled',
    })
  })

  it('enabled but no binding is not_bound', () => {
    expect(compareTarget(site({ enquiries: enq({ state: null }) })).enquiries).toEqual({
      status: 'unavailable',
      reason: 'not_bound',
    })
  })

  it('rebound, sync_failing, not_ready, insufficient_history use the same rules', () => {
    expect(
      compareTarget(site({ enquiries: enq({ state: good({ boundAt: '2026-09-01' }) }) })).enquiries,
    ).toEqual({ status: 'unavailable', reason: 'rebound' })
    expect(
      compareTarget(
        site({ enquiries: enq({ state: good({ latestOutcome: 'failed', okRunDates: [] }) }) }),
      ).enquiries,
    ).toEqual({ status: 'unavailable', reason: 'sync_failing' })
    expect(
      compareTarget(site({ enquiries: enq({ state: good({ okRunDates: ['2026-10-12'] }) }) }))
        .enquiries,
    ).toEqual({ status: 'not_ready', readyOn: READY })
    expect(
      compareTarget(site({ enquiries: enq({ state: good({ coveredFrom: '2026-09-01' }) }) }))
        .enquiries,
    ).toEqual({
      status: 'insufficient_history',
      missingFrom: '2026-08-15',
      missingTo: '2026-08-31',
    })
  })

  it('GA4 readiness is independent of Search Console readiness', () => {
    const r = compareTarget(
      site({
        search: good({ okRunDates: ['2026-10-12'] }),
        enquiries: enq({ days: [ed('2026-09-14', 'organic_search', 2)] }),
      }),
    )
    expect(r.status).toBe('not_ready')
    expect(r.enquiries!.status).toBe('comparable')
  })

  it('comparable enquiries: total and per class, zero-filled', () => {
    const r = compareTarget(
      site({
        enquiries: enq({
          days: [
            ed('2026-09-01', 'organic_search', 2),
            ed('2026-09-01', 'other', 2),
            ed('2026-09-14', 'organic_search', 3),
            ed('2026-09-15', 'organic_search', 3),
            ed('2026-09-15', 'ai_assistant', 1),
            ed('2026-08-01', 'other', 99),
          ],
        }),
      }),
    )
    expect(r.enquiries).toEqual({
      status: 'comparable',
      total: { before: 4, after: 7, change: 3, changePct: 0.75 },
      organic_search: { before: 2, after: 6, change: 4, changePct: 2 },
      ai_assistant: { before: 0, after: 1, change: 1, changePct: 'new' },
      other: { before: 2, after: 0, change: -2, changePct: -1 },
    })
  })

  it('a GA4 problem leaves the search figures exactly as they were', () => {
    const days = [sd('2026-09-01', 10, 100), sd('2026-09-14', 30, 100)]
    const alone = compareTarget(site({ searchDays: days, enquiries: enq() }))
    const broken = compareTarget(
      site({ searchDays: days, enquiries: enq({ state: good({ boundAt: '2026-09-01' }) }) }),
    )
    expect(broken.search).toEqual(alone.search)
    expect(broken.status).toBe(alone.status)
  })

  it('enquiries are not attached when search has no comparable or not_ready verdict', () => {
    expect(compareTarget(site({ search: null, enquiries: enq() }))).not.toHaveProperty(
      'enquiries',
    )
    expect(
      compareTarget(site({ search: good({ coveredFrom: null }), enquiries: enq() })),
    ).not.toHaveProperty('enquiries')
  })
})
