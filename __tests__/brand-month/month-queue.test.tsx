import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MonthQueue, type MonthQueueCopy } from '@/components/brand-month/MonthQueue'
import type { QueueRow } from '@/lib/brand-month/queue-rules'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

const copyFrom = (m: typeof en.monthQueue): MonthQueueCopy => ({ title: m.title, brand: m.brand, approvals: m.approvals, editsUnverified: m.edits_unverified,
  sends: m.sends, pulse: m.pulse, searchConsole: m.search_console, monthRecord: m.month_record, overdue: m.overdue, notEnabled: m.not_enabled,
  notConnected: m.not_connected, stale: m.stale, recorded: m.recorded, notRecorded: m.not_recorded, none: m.none, allClear: m.all_clear })
const base: QueueRow = { clientId: 'c', brandName: 'B', approvalsWaiting: 0, editsUnverified: 0, monthSends: 0, nearCap: false, activeQuestions: 0,
  lastPulseWeek: null, pulseOverdue: false, searchConsole: 'not_connected', lastSync: null, snapshotsPending: false }
const text = (html: string) => html.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|')
const render = (rows: QueueRow[], lang: 'en' | 'zh-HK' = 'en') => renderToStaticMarkup(<MonthQueue lang={lang} rows={rows} sendCap={10}
  monthHref={id => `/en/dashboard/${id}/month`} copy={copyFrom(lang === 'en' ? en.monthQueue : zh.monthQueue)} />)

describe('MonthQueue', () => {
  it('puts brands that need something first and names every state', () => {
    const t = text(render([
      { ...base, clientId: 'a', brandName: 'Alpha' },
      { ...base, clientId: 'z', brandName: 'Zeta', approvalsWaiting: 2, monthSends: 8, nearCap: true, activeQuestions: 5, pulseOverdue: true,
        searchConsole: 'stale', snapshotsPending: true },
    ]))
    expect(t.indexOf('Zeta')).toBeLessThan(t.indexOf('Alpha'))
    expect(t).toContain('|Zeta|2|0|8 / 10|Overdue|Stale|Not recorded|')
    expect(t).toContain('|Alpha|0|0|0 / 10|Not enabled|Not connected|Recorded|')
    expect(t).not.toContain('Nothing waiting')
  })

  it('links every brand to its month page and says so when nothing is waiting', () => {
    const html = render([{ ...base, clientId: 'a', brandName: 'Alpha', activeQuestions: 3, lastPulseWeek: '2026-10-26', searchConsole: 'ok', lastSync: '2026-11-05T01:00:00Z' }])
    expect(html).toContain('href="/en/dashboard/a/month"')
    expect(text(html)).toContain('|Alpha|0|0|0 / 10|Oct 26|Nov 5|Recorded|')
    expect(text(html)).toContain('Nothing waiting this month.')
  })

  it('uses the zh-HK honesty vocabulary', () => {
    const t = text(render([base], 'zh-HK'))
    expect(t).toContain('未啟用'); expect(t).toContain('未連接')
  })
})
