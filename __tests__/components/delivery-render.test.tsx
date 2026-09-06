import { afterAll, describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import { DeliveryWorkspace } from '@/components/delivery/DeliveryWorkspace'
import { DeliveryHistory } from '@/components/delivery/DeliveryHistory'
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
    const html = render(<DeliveryWorkspace clientId={clientId} version={version} onDirtyChange={() => {}} />, lang)
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
