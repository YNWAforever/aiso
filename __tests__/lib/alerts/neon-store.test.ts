import { describe, expect, it, vi } from 'vitest'
import type { NeonQueryFunction } from '@neondatabase/serverless'
import type { AlertNotificationInput } from '@/lib/alerts/evaluate'
import { createNeonAlertStore } from '@/lib/alerts/neon-store'

// Pin a positive-offset zone before the Date-valued fixture below is
// constructed: at TZ=UTC (CI's default) a toISOString() implementation and a
// local-components one agree exactly, so without this pin the regression
// test that fixture exists for would pass green against either -- same gap
// __tests__/lib/iso-date.test.ts pins TZ to close.
process.env.TZ = 'Asia/Hong_Kong'

type SqlCall = { text: string; params: unknown[] }
type SqlResponder = (call: SqlCall) => unknown[] | Promise<unknown[]>

function makeSql(respond: SqlResponder) {
  const calls: SqlCall[] = []
  const sql = vi.fn(async (strings: TemplateStringsArray, ...params: unknown[]) => {
    const text = strings.reduce(
      (result, part, index) => `${result}${part}${index < params.length ? `$${index + 1}` : ''}`,
      '',
    )
    const call = { text, params }
    calls.push(call)
    return respond(call)
  }) as unknown as NeonQueryFunction<false, false>

  return { sql, calls }
}

function configRow(id = 'alert-1') {
  return {
    id,
    client_id: 'client-1',
    enabled_sov: true,
    sov_threshold: 50,
    enabled_wow: true,
    wow_threshold: 10,
    notify_email: true,
    notify_inapp: true,
    created_at: null,
    updated_at: null,
    joined_client_id: 'client-1',
    joined_brand_name: 'Acme',
    joined_account_id: 'account-1',
  }
}

function notification(): AlertNotificationInput {
  return {
    account_id: 'account-1',
    client_id: 'client-1',
    type: 'sov_threshold',
    title: 'SoV alert',
    message: 'Current score is below threshold.',
    read: false,
    scan_week: '2026-08-08',
  }
}

function deliveryKey() {
  return {
    client_id: 'client-1',
    type: 'sov_threshold' as const,
    scan_week: '2026-08-08',
    recipient: 'owner@example.com',
  }
}

describe('createNeonAlertStore', () => {
  it('runs under the pinned timezone the date assertions depend on', () => {
    // If this fails, process.env.TZ above did not take effect -- Node worker
    // threads ignore a runtime mutation, so under Vitest's `threads` pool the
    // pin is a no-op and the Date-fixture test below silently degrades to the
    // UTC-blind version this file was written to catch. -480 is UTC+8.
    expect(new Date(2026, 7, 10).getTimezoneOffset()).toBe(-480)
  })

  it('pages config rows at 1000 using the last returned id', async () => {
    let configCalls = 0
    const { sql, calls } = makeSql(({ text }) => {
      const normalized = text.toLowerCase()
      if (normalized.includes('from public.alert_configs')) {
        configCalls += 1
        if (configCalls === 1) {
          return Array.from({ length: 1000 }, (_, index) => configRow(`alert-${index + 1}`))
        }
        if (configCalls === 2) return [configRow('alert-1001')]
        return []
      }
      if (normalized.includes('from public.pulse_weekly_summary')) {
        return [{ client_id: 'client-1', scan_week: '2026-08-08', sov_score: '40' }]
      }
      if (normalized.includes('from public.profiles')) {
        return [{ account_id: 'account-1', email: 'owner@example.com' }]
      }
      if (normalized.includes('current_scan_week')) {
        return [{ current_scan_week: '2026-08-08' }]
      }
      throw new Error(`unexpected SQL: ${text}`)
    })

    const snapshot = await createNeonAlertStore(sql).loadSnapshot()
    const configSqlCalls = calls.filter(call => call.text.toLowerCase().includes('from public.alert_configs'))

    expect(snapshot.configs).toHaveLength(1001)
    expect(configSqlCalls).toHaveLength(3)
    expect(configSqlCalls.every(call => call.params.length > 0)).toBe(true)
    expect(configSqlCalls[0].params).toContain(1000)
    expect(configSqlCalls[1].params).toContain('alert-1000')
    expect(configSqlCalls[0].text).toMatch(/ORDER BY\s+ac\.id\s+ASC/i)
    expect(configSqlCalls[1].text).toMatch(/ac\.id\s*>\s*\$\d+/i)
    expect(configSqlCalls[1].text).toMatch(/ORDER BY\s+ac\.id\s+ASC/i)
  })

  it('normalizes numeric scores, preserves null scores, and joins Neon Auth email deterministically', async () => {
    let configCalls = 0
    const { sql, calls } = makeSql(({ text }) => {
      const normalized = text.toLowerCase()
      if (normalized.includes('from public.alert_configs')) {
        configCalls += 1
        return configCalls === 1 ? [configRow()] : []
      }
      if (normalized.includes('from public.pulse_weekly_summary')) {
        return [
          { client_id: 'client-1', scan_week: '2026-08-08', sov_score: '41.5' },
          { client_id: 'client-1', scan_week: '2026-08-01', sov_score: null },
        ]
      }
      if (normalized.includes('from public.profiles')) {
        return [{ account_id: 'account-1', email: 'owner@example.com' }]
      }
      if (normalized.includes('current_scan_week')) {
        return [{ current_scan_week: '2026-08-08' }]
      }
      throw new Error(`unexpected SQL: ${text}`)
    })

    const snapshot = await createNeonAlertStore(sql).loadSnapshot()
    const weeklySql = calls.find(call => call.text.toLowerCase().includes('from public.pulse_weekly_summary'))
    const profileSql = calls.find(call => call.text.toLowerCase().includes('from public.profiles'))

    expect(snapshot.weeksByClient['client-1']).toEqual([
      { client_id: 'client-1', scan_week: '2026-08-08', sov_score: 41.5 },
      { client_id: 'client-1', scan_week: '2026-08-01', sov_score: null },
    ])
    expect(snapshot.emailsByAccount).toEqual({ 'account-1': 'owner@example.com' })
    expect(weeklySql?.text).toMatch(/DISTINCT ON\s*\(summary\.client_id,\s*summary\.scan_week\)/i)
    expect(weeklySql?.text).toMatch(/created_at DESC NULLS LAST,\s*summary\.id DESC/i)
    expect(profileSql?.text).toMatch(/neon_auth\."user"/i)
    expect(profileSql?.text).toMatch(/DISTINCT ON\s*\(p\.account_id\)/i)
  })

  it('normalizes a driver-supplied Date scan_week to its local ISO day', async () => {
    // The Date-valued fixture is the point, not incidental: the HTTP driver
    // returns scan_week as a string already, so every other fixture in this
    // file that uses a plain string cannot exercise the Date branch of
    // isoDate() at all -- reverting lib/alerts/neon-store.ts to the old
    // `toISOString()` ternary would leave this whole file green without it.
    let configCalls = 0
    const { sql } = makeSql(({ text }) => {
      const normalized = text.toLowerCase()
      if (normalized.includes('from public.alert_configs')) {
        configCalls += 1
        return configCalls === 1 ? [configRow()] : []
      }
      if (normalized.includes('from public.pulse_weekly_summary')) {
        return [{ client_id: 'client-1', scan_week: new Date(2026, 7, 10), sov_score: '40' }]
      }
      if (normalized.includes('from public.profiles')) {
        return [{ account_id: 'account-1', email: 'owner@example.com' }]
      }
      if (normalized.includes('current_scan_week')) {
        return [{ current_scan_week: '2026-08-10' }]
      }
      throw new Error(`unexpected SQL: ${text}`)
    })

    const snapshot = await createNeonAlertStore(sql).loadSnapshot()

    expect(snapshot.weeksByClient['client-1'][0].scan_week).toBe('2026-08-10')
  })

  it('uses the notification conflict target and treats the insert as a no-op result', async () => {
    const { sql, calls } = makeSql(() => [])

    await createNeonAlertStore(sql).upsertNotification(notification())

    expect(calls).toHaveLength(1)
    expect(calls[0].text).toMatch(
      /ON CONFLICT\s*\(client_id,\s*type,\s*scan_week\)\s*DO NOTHING/i,
    )
    expect(calls[0].params).toEqual(expect.arrayContaining([
      'account-1',
      'client-1',
      'sov_threshold',
      'SoV alert',
      'Current score is below threshold.',
      false,
      '2026-08-08',
    ]))
  })

  it('reads the current scan week from Postgres rather than the app clock', async () => {
    // Every other writer and reader derives the week in SQL
    // (lib/pulse/schedule.ts:56, :68; lib/pulse/summary.ts WEEK_START_SQL).
    // Deriving it from new Date() here would create a second definition of
    // "this week" that disagrees whenever the app server's timezone differs
    // from the database's -- and this value decides whether a client's alert
    // is evaluated at all.
    // A Date fixture, not a string: the HTTP driver returns date columns as
    // strings already, so a string fixture here cannot exercise the Date
    // branch of isoDate() at all -- see the neighbouring Date-fixture test
    // above for why that gap matters.
    const isWeekQuery = (text: string) => /date_trunc\('week', now\(\)\)/.test(text)

    const { sql, calls } = makeSql(call =>
      isWeekQuery(call.text) ? [{ current_scan_week: new Date(2026, 7, 10) }] : [],
    )

    const snapshot = await createNeonAlertStore(sql).loadSnapshot()

    expect(snapshot.currentScanWeek).toBe('2026-08-10')
    expect(calls.some(call => isWeekQuery(call.text))).toBe(true)
  })

  it('propagates weekly snapshot read failures', async () => {
    let configCalls = 0
    const { sql } = makeSql(({ text }) => {
      const normalized = text.toLowerCase()
      if (normalized.includes('from public.alert_configs')) {
        configCalls += 1
        return configCalls === 1 ? [configRow()] : []
      }
      if (normalized.includes('from public.pulse_weekly_summary')) {
        throw new Error('snapshot unavailable')
      }
      // Must resolve, not fall through to the empty default: this test's
      // failure has to come from loadWeeklyRows, not from loadCurrentScanWeek
      // rejecting in the earlier Promise.all, which would abort loadSnapshot
      // before loadWeeklyRows is ever called.
      if (normalized.includes('current_scan_week')) {
        return [{ current_scan_week: '2026-08-10' }]
      }
      return []
    })

    await expect(createNeonAlertStore(sql).loadSnapshot()).rejects.toThrow('snapshot unavailable')
  })

  it('throws rather than defaulting to an empty current scan week when the query returns no row', async () => {
    // If this ever fell back to '' instead, the staleness guard's
    // `latest.scan_week !== snapshot.currentScanWeek` comparison would treat
    // every client as stale -- fired: 0, with nothing in emailFailures or
    // notificationFailures to flag it, so evaluationStatus would still return
    // 200. Throwing here surfaces the outage as a loud 500 instead.
    let configCalls = 0
    const { sql } = makeSql(({ text }) => {
      const normalized = text.toLowerCase()
      if (normalized.includes('from public.alert_configs')) {
        configCalls += 1
        return configCalls === 1 ? [configRow()] : []
      }
      if (normalized.includes('current_scan_week')) return []
      return []
    })

    await expect(createNeonAlertStore(sql).loadSnapshot()).rejects.toThrow(
      '[alerts] could not read the current scan week from Postgres',
    )
  })
})

describe('email delivery ledger', () => {
  it('claims a delivery by inserting, and reports the insert happened', async () => {
    const { sql, calls } = makeSql(() => [{ id: 'delivery-1' }])

    const claimed = await createNeonAlertStore(sql).claimEmailDelivery(deliveryKey())

    expect(claimed).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0].text).toMatch(
      /ON CONFLICT\s*\(client_id,\s*type,\s*scan_week\)\s*DO NOTHING/i,
    )
    // RETURNING is what makes the claim observable: without it the driver
    // reports nothing and a re-run cannot tell a fresh insert from a no-op.
    expect(calls[0].text).toMatch(/RETURNING id/i)
    expect(calls[0].params).toEqual([
      'client-1',
      'sov_threshold',
      '2026-08-08',
      'owner@example.com',
    ])
  })

  it('reports no claim when the row already exists', async () => {
    // ON CONFLICT DO NOTHING returns zero rows, which is the whole dedupe
    // signal — this is the case that must stop a second email going out.
    const { sql, calls } = makeSql(() => [])

    const claimed = await createNeonAlertStore(sql).claimEmailDelivery(deliveryKey())

    expect(claimed).toBe(false)
    expect(calls).toHaveLength(1)
  })

  it('releases a claim by deleting exactly that week row', async () => {
    const { sql, calls } = makeSql(() => [])

    await createNeonAlertStore(sql).releaseEmailDelivery(deliveryKey())

    expect(calls).toHaveLength(1)
    expect(calls[0].text).toMatch(/DELETE FROM public\.alert_email_deliveries/i)
    expect(calls[0].params).toEqual(['client-1', 'sov_threshold', '2026-08-08'])
  })
})
