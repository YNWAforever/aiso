import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MonthRecord, type MonthRecordCopy } from '@/components/brand-month/MonthRecord'
import type { MonthActivity, MonthSnapshot, SnapshotFigures } from '@/lib/brand-month/store'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

const copyFrom = (m: typeof en.month): MonthRecordCopy => ({
  title: m.title, previous: m.previous, next: m.next, allBrands: m.all_brands, delivered: m.delivered, verifiedLive: m.verified_live, selfReported: m.self_reported,
  none: m.none, figures: m.figures, opening: m.opening, closing: m.closing, notRecorded: m.not_recorded, notConnected: m.not_connected,
  scanScore: m.scan_score, shareOfVoice: m.share_of_voice, searchClicks: m.search_clicks, searchImpressions: m.search_impressions,
  activity: m.activity, workItemsOpened: m.work_items_opened, workItemsDone: m.work_items_done, siteEditsSent: m.site_edits_sent,
  receiptsCompleted: m.receipts_completed, receiptsRejected: m.receipts_rejected,
})
const EMPTY: MonthActivity = { workItemsOpened: 0, workItemsDone: 0, siteEditsSent: 0, receiptsCompleted: 0, receiptsRejected: 0, verifiedLive: [], selfReported: [] }
const opening: SnapshotFigures = { version: 1, scan: { state: 'ok', scanId: 's', score: 61, recordedAt: '2026-10-20T00:00:00Z' },
  pulse: { state: 'ok', week: '2026-10-19', platforms: [{ platform: 'gpt-4o', sovScore: 40, totalQueries: 10, brandMentions: 4 }] },
  search: { state: 'not_connected' } }
const snap = (kind: 'opening' | 'closing', figures: SnapshotFigures): MonthSnapshot => ({ kind, asOf: 'x', takenAt: 'y', figures })
const render = (over: Partial<Parameters<typeof MonthRecord>[0]> = {}) => renderToStaticMarkup(<MonthRecord lang="en" brandName="Bakery"
  monthLabel="November 2026" previousHref="/en/p" nextHref={null} snapshots={[snap('opening', opening)]} activity={EMPTY} copy={copyFrom(en.month)} {...over} />)
const text = (html: string) => html.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|')

describe('MonthRecord', () => {
  it('leads with delivery and keeps verified live and self-reported apart', () => {
    const html = render({ activity: { ...EMPTY,
      verifiedLive: [{ attestationId: 'a1', workItemId: 'w', title: 'Add FAQ schema', versionId: 'v', recordedAt: '2026-11-06T01:00:00Z', siteEditJobId: 'j' }],
      selfReported: [{ attestationId: 'a2', workItemId: 'w', title: 'Rewrote About page', versionId: 'v', recordedAt: '2026-11-07T01:00:00Z', siteEditJobId: null }] } })
    const t = text(html)
    expect(t.indexOf('Delivered')).toBeLessThan(t.indexOf('Opening and closing'))
    expect(t).toMatch(/Verified live\|Add FAQ schema\|Nov 6\|Self-reported\|Rewrote About page\|Nov 7/)
  })

  it('says why a value is missing instead of showing zero', () => {
    const t = text(render())
    expect(t).toContain('|Scan score|61|Not recorded|')
    expect(t).toContain('|Share of voice · ChatGPT|40%|Not recorded|')
    expect(t).toContain('|Search clicks (28 days)|Not connected|Not recorded|')
    expect(t).toMatch(/Verified live\|None\|Self-reported\|None/)
    const none = text(render({ snapshots: [snap('opening', { version: 1, scan: { state: 'none' }, pulse: { state: 'none' },
      search: { state: 'none', from: '2026-10-04', through: '2026-10-31' } })] }))
    expect(none).toContain('|Scan score|None|Not recorded|')
    expect(none).toContain('|Search impressions (28 days)|None|Not recorded|')
    expect(none).not.toContain('Share of voice')
  })

  it('shows only the month links that exist, and the record action when given', () => {
    const html = render({ recordAction: <button>Record now</button> })
    expect(html).toContain('href="/en/p"')
    expect(html).not.toContain('>Next<')
    expect(html).toContain('Record now')
  })

  it('renders in zh-HK with the honesty vocabulary', () => {
    const t = text(renderToStaticMarkup(<MonthRecord lang="zh-HK" brandName="Bakery" monthLabel="2026年11月" previousHref={null} nextHref={null}
      snapshots={[snap('opening', opening)]} activity={EMPTY} copy={copyFrom(zh.month)} />))
    expect(t).toContain('未連接')
    expect(t).toContain('未記錄')
    expect(t).toContain('未有')
  })
})
