import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { buildMonthlyReportSnapshot, defaultNarrative, normalizeNarrative, parseMonthlyReportSnapshot, MONTHLY_DELIVERED_MAX, MONTHLY_OPEN_ITEMS_MAX, MONTHLY_SNAPSHOT_MAX_BYTES } from '@/lib/monthly-report/snapshot'
import { readFileSync } from 'node:fs'
import { MonthlyReportView, type MonthlyReportCopy } from '@/components/monthly-report/MonthlyReportView'
import { periodOf } from '@/lib/brand-month/period'
import type { MonthActivity, MonthSnapshot } from '@/lib/brand-month/store'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

const period = periodOf('2026-11')!
const branding = { agencyName: 'Fimmick', logoUrl: null, primaryColor: '#111827', contactLabel: null, contactUrl: null }
const delivery = (title: string, day: number) => ({ attestationId: `a${day}`, workItemId: 'w', title, versionId: `v${day}`, recordedAt: `2026-11-0${day}T01:00:00.000Z`, siteEditJobId: null })
const activity: MonthActivity = { workItemsOpened: 2, workItemsDone: 1, siteEditsSent: 1, receiptsCompleted: 1, receiptsRejected: 0,
  verifiedLive: [delivery('Add FAQ schema', 6)], selfReported: [delivery('Rewrote About page', 7)] }
const opening: MonthSnapshot = { kind: 'opening', asOf: period.start, takenAt: 'x', figures: { version: 1, scan: { state: 'none' }, pulse: { state: 'none' },
  search: { state: 'ok', from: '2026-10-04', through: '2026-10-31', days: 28, clicks: 120, impressions: 4500 } } }
const build = (over: Partial<Parameters<typeof buildMonthlyReportSnapshot>[0]> = {}) => buildMonthlyReportSnapshot({ locale: 'en', period, monthLabel: 'November 2026',
  branding, client: { name: 'Bakery', domain: 'bakery.hk' }, activity, snapshots: [opening], pulseWeeks: [], openWorkItems: [{ title: 'Add hours to llms.txt' }],
  narrative: null, now: new Date('2026-12-04T00:00:00Z'), ...over })
const copyFrom = (m: typeof en.monthlyReport): MonthlyReportCopy => ({ delivered: m.delivered, verifiedLive: m.verified_live, selfReported: m.self_reported,
  none: m.none, visibility: m.visibility, visibilityPending: m.visibility_pending,
  visibilityOpening: m.visibility_opening, visibilityClosing: m.visibility_closing, visibilityChange: m.visibility_change,
  visibilityVerdict: m.visibility_verdict, visibilityRising: m.visibility_rising, visibilityFalling: m.visibility_falling,
  visibilityPlatform: m.visibility_platform, visibilityRuleNote: m.visibility_rule_note,
  search: m.search, before: m.before, endOfMonth: m.end_of_month,
  clicks: m.clicks, impressions: m.impressions, notConnected: m.not_connected, notRecorded: m.not_recorded, nextMonth: m.next_month })
const text = (html: string) => html.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|')

describe('monthly report snapshot', () => {
  it('freezes the four sections with their sources, and records no Pulse data as not enough data rather than zero', () => {
    const s = build()
    expect(s).toMatchObject({ snapshotSchemaVersion: 2, kind: 'monthly', month: '2026-11', period: { start: period.start, end: period.end },
      branding: { agencyName: 'Fimmick', attribution: 'Powered by Fimmick AISO' },
      delivered: { verifiedLive: [{ title: 'Add FAQ schema', versionId: 'v6' }], selfReported: [{ title: 'Rewrote About page' }] },
      visibility: { state: 'not_enough_data', reason: 'no_pulse_data' },
      search: { opening: { state: 'ok', clicks: 120 }, closing: { state: 'not_recorded' } },
      nextMonth: { openWorkItems: [{ title: 'Add hours to llms.txt' }] }, executiveSummary: 'November 2026: 1 change verified live and 1 self-reported.' })
    expect(parseMonthlyReportSnapshot(JSON.parse(JSON.stringify(s)))).toEqual(s)
  })

  it('keeps the operator narrative, refuses one that is empty, too long or carries control characters', () => {
    expect(build({ narrative: '  A good month.\r\nMore next month. ' }).executiveSummary).toBe('A good month.\nMore next month.')
    expect(() => build({ narrative: '   ' })).toThrow(/Narrative/)
    expect(normalizeNarrative('x'.repeat(1201))).toBeNull()
    expect(normalizeNarrative('bad\u0007bell')).toBeNull()
    expect(normalizeNarrative(42)).toBeNull()
  })

  it('caps the delivered list and writes the default narrative in Traditional Chinese', () => {
    const many = { ...activity, verifiedLive: Array.from({ length: MONTHLY_DELIVERED_MAX + 5 }, (_, i) => delivery(`Edit ${i}`, 6)) }
    expect(build({ activity: many }).delivered.verifiedLive).toHaveLength(MONTHLY_DELIVERED_MAX)
    expect(defaultNarrative('zh-HK', '2026年11月', { verifiedLive: [], selfReported: [] })).toBe('2026年11月：已上線核實 0 項修改，自行申報 0 項。')
  })

  it('fits 098\'s size CHECK at its worst case: every list full of 160-character Traditional Chinese titles', () => {
    const title = '繁'.repeat(160)
    const full = Array.from({ length: MONTHLY_DELIVERED_MAX }, (_, i) => ({ ...delivery(title, 6), versionId: `5000000${i}-0000-4000-8000-000000000000` }))
    const s = build({ activity: { ...activity, verifiedLive: full, selfReported: full },
      openWorkItems: Array.from({ length: MONTHLY_OPEN_ITEMS_MAX }, () => ({ title })), narrative: '繁'.repeat(1200),
      branding: { ...branding, agencyName: '繁'.repeat(120), contactLabel: '繁'.repeat(80), contactUrl: 'https://agency.example/' + 'x'.repeat(2000), logoUrl: 'https://agency.example/' + 'y'.repeat(2000) } })
    const bytes = Buffer.byteLength(JSON.stringify(s), 'utf8')
    expect(bytes).toBeGreaterThan(65536)
    expect(bytes).toBeLessThan(MONTHLY_SNAPSHOT_MAX_BYTES / 2)
    expect(readFileSync('supabase/migrations/098_monthly_client_reports.sql', 'utf8')).toContain(`octet_length(snapshot::text) <= ${MONTHLY_SNAPSHOT_MAX_BYTES}`)
  })

  it('drafts for a brand that skipped its website instead of refusing the report', () => {
    // Onboarding lets a brand skip its domain, and the client name falls back to
    // it. Refusing the draft over an empty field turned a perfectly honest report
    // into a 503; control characters are still refused.
    const s = build({ client: { name: '', domain: '' } })
    expect(s.client).toEqual({ name: '', domain: '' })
    expect(() => build({ client: { name: 'Bad\u0007name', domain: '' } })).toThrow(/plain text/)
  })

  it('rejects any stored shape that is not a schema-2 monthly snapshot', () => {
    for (const bad of [null, {}, { ...build(), snapshotSchemaVersion: 1 }, { ...build(), kind: 'scan' }, { ...build(), month: '2026-13' }, { ...build(), delivered: {} }]) {
      expect(parseMonthlyReportSnapshot(bad)).toBeNull()
    }
  })
})

describe('MonthlyReportView', () => {
  it('renders delivered first, visibility held back, dated search figures, then next month', () => {
    const t = text(renderToStaticMarkup(<MonthlyReportView snapshot={build()} lang="en" copy={copyFrom(en.monthlyReport)} />))
    const order = ['Delivered this month', 'Visibility', 'Search demand', 'Next month'].map(h => t.indexOf(`|${h}|`))
    expect(order.every(i => i > 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(t).toMatch(/Verified live\|Add FAQ schema\|Nov 6\|Self-reported\|Rewrote About page\|Nov 7/)
    expect(t).toContain('|Not enough data yet.|')
    expect(t).toContain('|Before the month · Oct 4 – Oct 31|120|4,500|')
    expect(t).toContain('|End of the month|Not recorded|Not recorded|')
    expect(t).toContain('|Add hours to llms.txt|')
  })

  it('renders the movement rule verdict with the recorded figures, or says not enough data', () => {
    const pulseSnapshot = (kind: 'opening' | 'closing', sov: number): MonthSnapshot => ({
      kind, asOf: kind === 'opening' ? period.start : period.end, takenAt: 'x',
      figures: { version: 1, scan: { state: 'none' }, pulse: { state: 'ok', week: '2026-11-02', platforms: [{ platform: 'gpt-4o', sovScore: sov, totalQueries: 8, brandMentions: 1 }] },
        search: { state: 'none', from: '2026-11-01', through: '2026-11-30' } },
    })
    const weeks = ['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23'].map(week =>
      ({ platform: 'gpt-4o', week, sov: week === '2026-11-02' ? 10 : week === '2026-11-09' ? 11 : week === '2026-11-16' ? 12 : 13, answers: 8 }))
    const s = build({ snapshots: [pulseSnapshot('opening', 10), pulseSnapshot('closing', 14)], pulseWeeks: weeks })
    expect(s.visibility).toMatchObject({ state: 'recorded', platforms: [{ platform: 'gpt-4o', opening: 10, closing: 14, delta: 4, direction: 'up' }] })
    const t = text(renderToStaticMarkup(<MonthlyReportView snapshot={s} lang="en" copy={copyFrom(en.monthlyReport)} />))
    expect(t).toContain('|gpt-4o|10%|14%|+4%|Rising|')
    expect(t).toContain('at least 5 answers')
    // No Pulse weeks at all stays honest rather than drawing an empty table.
    expect(text(renderToStaticMarkup(<MonthlyReportView snapshot={build()} lang="en" copy={copyFrom(en.monthlyReport)} />))).toContain('|Not enough data yet.|')
  })

  it('uses the zh-HK honesty vocabulary', () => {
    const s = build({ locale: 'zh-HK', snapshots: [], activity: { ...activity, verifiedLive: [], selfReported: [] }, openWorkItems: [] })
    const t = text(renderToStaticMarkup(<MonthlyReportView snapshot={s} lang="zh-HK" copy={copyFrom(zh.monthlyReport)} />))
    expect(t).toContain('未有'); expect(t).toContain('未記錄'); expect(t).toContain('數據尚未足夠。')
  })
})
