import { afterAll, describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import { DeliveryWorkspace } from '@/components/delivery/DeliveryWorkspace'
import { DeliveryHistory } from '@/components/delivery/DeliveryHistory'
import { DeliveryForm, type DeliveryFields } from '@/components/delivery/DeliveryForm'
import { NO_MEASURE } from '@/lib/attribution/measure-choice'
import { VersionWorkspace } from '@/components/change-sets/VersionWorkspace'
import { createDeliveryExport } from '@/lib/delivery/export'
import { eventRow } from '../delivery/fixtures'
import { deliveryEventDTO } from '@/lib/delivery/dto'
import { fixtureProps, pendingProps, version, clientId } from './c9e-fixtures'
import { writeC9cFixture } from './c9c-fixture-writer'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'
vi.mock('server-only', () => ({}))
const render = (node: React.ReactNode, lang: string) => renderToString(<NextIntlClientProvider locale={lang} messages={lang === 'en' ? en : zh} timeZone="UTC">{node}</NextIntlClientProvider>)
describe('delivery rendering', () => {
  it.each(['en', 'zh-HK'])('renders the bilingual manual-delivery and UTC contract %s', lang => {
    const html = render(<DeliveryWorkspace clientId={clientId} version={version} measureOptions={null} onDirtyChange={() => {}} />, lang)
    expect(html).toContain('UTC')
    expect(html).toContain('datetime-local')
    expect(html).toContain('step="1"')
    expect(html).toContain(lang === 'en' ? 'Record manual delivery' : '記錄手動交付')
    expect(html).toContain(lang === 'en' ? 'not verified' : '未經核實')
    expect(html).not.toContain(lang === 'en' ? 'No delivery records' : '沒有交付記錄')
  })
  it.each(['en', 'zh-HK'])('retains unknown actor and escapes destination text %s', lang => {
    const event = { ...deliveryEventDTO(eventRow()), kind: 'attest' as const, destination: '<script>alert(1)</script>', deliveredAt: '2026-09-07T00:00:00.000Z', note: 'Manual' }
    const html = render(<DeliveryHistory events={[event]} activeAttestationId={event.eventId} nextCursor={null} busy={false} canWithdraw={true} onMore={() => {}} onWithdraw={() => {}} />, lang)
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
    expect(html).toContain(lang === 'en' ? 'Unknown actor' : '未知成員')
    expect(html).toContain(lang === 'en' ? 'Declared delivery time' : '申報交付時間')
    expect(html).toContain(lang === 'en' ? 'Server recorded time' : '伺服器記錄時間')
  })
})
afterAll(async () => {
  await writeC9cFixture('C9E', 'VersionWorkspace', '@/components/change-sets/VersionWorkspace', fixtureProps,
    lang => render(<VersionWorkspace {...fixtureProps} />, lang),
    { pending: { props: pendingProps, html: lang => render(<VersionWorkspace {...pendingProps} />, lang) } }, 'delivery')
  const dir = process.env.C9E_HTML_DIR
  if (dir) for (const format of ['json', 'text'] as const) writeFileSync(join(dir, `export-${format}.json`), JSON.stringify(createDeliveryExport(version, format)))
})

it('does not claim empty history when an active attestation is outside the page', () => {
  const html = render(<DeliveryHistory events={[]} activeAttestationId={version.id} nextCursor="next" busy={false} canWithdraw={true} onMore={() => {}} onWithdraw={() => {}} />, 'en')
  expect(html).not.toContain('No delivery records.')
})

const pages = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, url: `https://example.com/p${i}`, label: `Page ${i}` }))
const fields = (measure = NO_MEASURE): DeliveryFields => ({ destination: '', deliveredAt: '', note: '', measure })
const form = (measureOptions: { pages: ReturnType<typeof pages> } | null, values = fields()) =>
  <DeliveryForm clientId={clientId} version={version} values={values} canAttest busy={false} measureOptions={measureOptions} onChange={() => {}} onSubmit={() => {}} />

describe('delivery form: what to measure', () => {
  it.each([['en', en], ['zh-HK', zh]] as const)('omits the whole field when there are no measure options %s', (lang, messages) => {
    const html = render(form(null), lang)
    expect(html).not.toContain('type="radio"')
    expect(html).not.toContain('type="checkbox"')
    expect(html).not.toContain(messages.attribution.measureTitle)
  })

  it.each([['en', en], ['zh-HK', zh]] as const)('offers three choices with Do not measure selected by default %s', (lang, messages) => {
    const html = render(form({ pages: pages(2) }), lang)
    const a = messages.attribution
    for (const text of [a.measureTitle, a.measurePages, a.measureSite, a.measureNone]) expect(html).toContain(text)
    const radios = html.match(/<input[^>]*type="radio"[^>]*>/g)!
    expect(radios).toHaveLength(3)
    const checked = radios.filter(r => r.includes('checked=""'))
    expect(checked).toHaveLength(1)
    expect(checked[0]).toContain('value="none"')
  })

  it('lists each page with label, URL and a distinct accessible name only for Specific pages', () => {
    const html = render(form({ pages: pages(2) }, fields({ mode: 'page', assetIds: [pages(2)[1]!.id] })), 'en')
    const boxes = html.match(/<input[^>]*type="checkbox"[^>]*>/g)!
    expect(boxes).toHaveLength(2)
    const labels = boxes.map(b => b.match(/aria-label="([^"]*)"/)![1]!)
    expect(new Set(labels).size).toBe(2)
    expect(labels[0]).toContain('Page 0')
    expect(labels[0]).toContain('https://example.com/p0')
    expect(boxes.map(b => b.includes('checked=""'))).toEqual([false, true])
    expect(html).toContain('https://example.com/p1')
  })

  it('hides the page checkboxes until Specific pages is chosen', () => {
    expect(render(form({ pages: pages(2) }), 'en')).not.toContain('type="checkbox"')
    expect(render(form({ pages: pages(2) }, fields({ mode: 'site', assetIds: [] })), 'en')).not.toContain('type="checkbox"')
  })

  it('stops offering more pages once 20 are chosen', () => {
    const all = pages(21)
    const html = render(form({ pages: all }, fields({ mode: 'page', assetIds: all.slice(0, 20).map(p => p.id) })), 'en')
    const boxes = html.match(/<input[^>]*type="checkbox"[^>]*>/g)!
    expect(boxes.filter(b => b.includes('checked=""'))).toHaveLength(20)
    expect(boxes.filter(b => b.includes('disabled=""'))).toHaveLength(1)
    expect(boxes.find(b => b.includes('disabled=""'))).not.toContain('checked=""')
  })

  it.each([['en', en], ['zh-HK', zh]] as const)('disables Specific pages and links to the assets page when none are registered %s', (lang, messages) => {
    const html = render(form({ pages: [] }), lang)
    const specific = html.match(/<input[^>]*type="radio"[^>]*value="page"[^>]*>/)![0]
    expect(specific).toContain('disabled=""')
    expect(html).toContain(`href="/${lang}/dashboard/${clientId}/assets"`)
    expect(html).toContain(messages.attribution.assetsLink)
    expect(html).not.toContain('type="checkbox"')
  })
})

describe('the options reach the delivery form', () => {
  it('through the delivery workspace, only when supplied', () => {
    const on = render(<DeliveryWorkspace clientId={clientId} version={version} measureOptions={{ pages: pages(1) }} onDirtyChange={() => {}} />, 'en')
    const off = render(<DeliveryWorkspace clientId={clientId} version={version} measureOptions={null} onDirtyChange={() => {}} />, 'en')
    expect(on).toContain(en.attribution.measureTitle)
    expect(off).not.toContain(en.attribution.measureTitle)
  })
  it('through the version workspace', () => {
    const html = render(<VersionWorkspace {...fixtureProps} measureOptions={{ pages: pages(1) }} />, 'en')
    expect(html).toContain(en.attribution.measureTitle)
  })
})

it.each([['en', en], ['zh-HK', zh]] as const)('has a distinct message for a chosen page that is no longer registered %s', (_lang, messages) => {
  expect(messages.attribution.unknownPage).not.toBe(messages.delivery.invalid)
  expect(messages.attribution.unknownPage.length).toBeGreaterThan(10)
})
