import { describe, expect, it, vi } from 'vitest'
import type { NeonQueryFunction } from '@neondatabase/serverless'
import type { AlertNotificationInput } from '@/lib/alerts/evaluate'
import { createNeonAlertStore } from '@/lib/alerts/neon-store'

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

describe('createNeonAlertStore', () => {
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
      throw new Error(`unexpected SQL: ${text}`)
    })

    const snapshot = await createNeonAlertStore(sql).loadSnapshot()
    const configSqlCalls = calls.filter(call => call.text.toLowerCase().includes('from public.alert_configs'))

    expect(snapshot.configs).toHaveLength(1001)
    expect(configSqlCalls).toHaveLength(3)
    expect(configSqlCalls.every(call => call.params.length > 0)).toBe(true)
    expect(configSqlCalls[0].params).toContain(1000)
    expect(configSqlCalls[1].params).toContain('alert-1000')
  })

  it('normalizes numeric scores, preserves null scores, and joins Neon Auth email deterministically', async () => {
    const { sql, calls } = makeSql(({ text }) => {
      const normalized = text.toLowerCase()
      if (normalized.includes('from public.alert_configs')) return [configRow()]
      if (normalized.includes('from public.pulse_weekly_summary')) {
        return [
          { client_id: 'client-1', scan_week: '2026-08-08', sov_score: '41.5' },
          { client_id: 'client-1', scan_week: '2026-08-01', sov_score: null },
        ]
      }
      if (normalized.includes('from public.profiles')) {
        return [{ account_id: 'account-1', email: 'owner@example.com' }]
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

  it('propagates weekly snapshot read failures', async () => {
    const { sql } = makeSql(({ text }) => {
      if (text.toLowerCase().includes('from public.alert_configs')) return [configRow()]
      if (text.toLowerCase().includes('from public.pulse_weekly_summary')) {
        throw new Error('snapshot unavailable')
      }
      return []
    })

    await expect(createNeonAlertStore(sql).loadSnapshot()).rejects.toThrow('snapshot unavailable')
  })
})
