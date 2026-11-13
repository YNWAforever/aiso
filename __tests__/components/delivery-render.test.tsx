import { afterAll, describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import { DeliveryWorkspace } from '@/components/delivery/DeliveryWorkspace'
import { DeliveryHistory } from '@/components/delivery/DeliveryHistory'
import { DeliveryForm } from '@/components/delivery/DeliveryForm'
import type { DeliveryEvent } from '@/lib/delivery/types'
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
    const event = { ...deliveryEventDTO(eventRow()), kind: 'attest' as const, destination: '<script>alert(1)</script>', deliveredAt: '2026-09-07T00:00:00.000Z', note: 'Manual', provenance: 'self_reported' as const }
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

const noop = () => {}
const fields = { destination: 'Client website', deliveredAt: '2026-09-07T00:00:00', note: 'Sent approved package' }
const manual: DeliveryEvent = { ...deliveryEventDTO(eventRow()), kind: 'attest', destination: 'Manual destination', deliveredAt: '2026-09-07T00:00:00.000Z', note: 'Manual delivery note', provenance: 'self_reported' }
const verified: DeliveryEvent = { ...manual, eventId: clientId, destination: 'Live page', note: 'Live check note', provenance: 'verified_live' }
const withdrawal: DeliveryEvent = { schemaVersion: 1, eventId: version.id, versionId: version.id, contentHash: version.contentHash, actor: manual.actor, recordedAt: '2026-09-08T00:00:00.000Z', kind: 'withdraw', targetAttestationId: manual.eventId, reason: 'Correcting the delivery details' }
const controls = (html: string) => html.match(/<(?:button|input|textarea|summary)\b[^>]*>/g) ?? []

describe.each(['en', 'zh-HK'])('opt-in SME manual delivery SSR (%s)', lang => {
  const copy = (lang === 'en' ? en : zh).delivery
  it('keeps omitted and false flags identical for each legacy component', () => {
    const workspaceProps = { clientId, version, onDirtyChange: noop }
    const formProps = { version, values: fields, canAttest: true, busy: false, onChange: noop, onSubmit: noop }
    const historyProps = { events: [manual, verified, withdrawal], activeAttestationId: verified.eventId, nextCursor: 'next', busy: false, canWithdraw: true, onMore: noop, onWithdraw: noop }
    expect(render(<DeliveryWorkspace {...workspaceProps} />, lang)).toBe(render(<DeliveryWorkspace {...workspaceProps} smeCopilot={false} />, lang))
    expect(render(<DeliveryForm {...formProps} />, lang)).toBe(render(<DeliveryForm {...formProps} smeCopilot={false} />, lang))
    expect(render(<DeliveryHistory {...historyProps} />, lang)).toBe(render(<DeliveryHistory {...historyProps} smeCopilot={false} />, lang))
  })
  it('shows text first, discloses JSON only, and awaits current authority even for approved versions', () => {
    const html = render(<DeliveryWorkspace clientId={clientId} version={version} onDirtyChange={noop} smeCopilot />, lang)
    expect(html).toContain(copy.sme.title)
    expect(html).toContain(copy.sme.downloadHelp)
    expect(html).toContain(copy.sme.manualLimitation)
    expect(html.indexOf(copy.exportText)).toBeLessThan(html.indexOf(copy.exportJson))
    expect(controls(html).filter(tag => tag.startsWith('<button') && tag.includes('bg-primary'))).toHaveLength(1)
    const disclosure = html.match(/<details\b[^>]*>[\s\S]*?<\/details>/)?.[0] ?? ''
    expect(disclosure).toContain(copy.sme.technicalFormat)
    expect(disclosure).toContain(copy.exportJson)
    expect(disclosure).not.toContain('<form')
    expect(disclosure).not.toContain(copy.timeUtc)
    expect(disclosure).not.toContain('role="alert"')
    expect(html).not.toContain('<details open')
    expect(html).toContain(copy.loading)
    expect(html).not.toContain(copy.empty)
    expect(controls(html).filter(tag => tag.startsWith('<button')).every(tag => tag.includes('disabled=""'))).toBe(true)
    expect(controls(html).every(tag => tag.includes('min-h-11') && tag.includes('focus-visible:'))).toBe(true)
    expect(html).not.toContain('autoFocus')
  })
  it.each([
    { smeCopilot: false, canAttest: false }, { smeCopilot: false, canAttest: true },
    { smeCopilot: true, canAttest: false }, { smeCopilot: true, canAttest: true },
  ])('keeps fields and UTC guidance visible (SME=$smeCopilot, canAttest=$canAttest)', ({ smeCopilot, canAttest }) => {
    const html = render(<DeliveryForm version={version} values={fields} canAttest={canAttest} busy={false} onChange={noop} onSubmit={noop} smeCopilot={smeCopilot} />, lang)
    if (smeCopilot) expect(html).toContain(copy.sme.manualLimitation)
    expect(html).toContain(copy.timeUtc)
    expect(html).toContain(smeCopilot ? copy.sme.timeHelp : copy.timeHelp)
    expect(html).toContain('type="datetime-local"')
    expect(html).toContain('step="1"')
    expect(html).toContain('value="2026-09-07T00:00:00"')
    expect(html).toContain('value="Client website"')
    expect(html).toContain('Sent approved package')
    expect(html).not.toContain('<details')
    expect(html.match(/aria-describedby=/g) ?? []).toHaveLength(smeCopilot ? 2 : 0)
    expect(html.match(/<(?:input|textarea)\b[^>]*required=""/g)).toHaveLength(3)
    const submit = controls(html).find(tag => tag.startsWith('<button')) ?? ''
    expect(submit.includes('disabled=""')).toBe(!canAttest)
    expect(submit.includes('bg-primary text-primary-foreground')).toBe(smeCopilot)
    if (smeCopilot) expect(controls(html).every(tag => tag.includes('min-h-11') && tag.includes('focus-visible:'))).toBe(true)
  })
  it('keeps supplied fields readable while busy or invalid without claiming validation succeeded', () => {
    const html = render(<DeliveryForm version={version} values={{ ...fields, deliveredAt: 'invalid-time' }} canAttest={true} busy={true} onChange={noop} onSubmit={noop} smeCopilot />, lang)
    expect(html).toContain('value="invalid-time"')
    expect(html).toContain(copy.sme.timeHelp)
    expect(html.match(/readOnly=""/g)).toHaveLength(3)
    expect(controls(html).find(tag => tag.startsWith('<button'))).toContain('disabled=""')
    expect(html).not.toContain(copy.recorded)
  })
  it.each([false, true])('uses actual event provenance with neutral headings (SME=%s)', smeCopilot => {
    const html = render(<DeliveryHistory events={[manual, verified, withdrawal]} activeAttestationId={verified.eventId} nextCursor="next" busy={false} canWithdraw={true} onMore={noop} onWithdraw={noop} smeCopilot={smeCopilot} />, lang)
    const rows = html.match(/<li\b[^>]*>[\s\S]*?<\/li>/g) ?? []
    expect(rows).toHaveLength(3)
    expect(rows[0]).toContain(copy.selfReported)
    expect(rows[0]).not.toContain(copy.verifiedLive)
    expect(rows[1]).toContain(copy.verifiedLive)
    expect(rows[1]).not.toContain(copy.selfReported)
    expect(rows[2]).toContain(copy.withdrawn)
    expect(rows[2]).toContain(withdrawal.reason)
    expect(rows[2]).toContain(withdrawal.targetAttestationId)
    expect(rows[2]).not.toContain(copy.verifiedLive)
    expect(rows[2]).not.toContain(copy.selfReported)
    expect(html).toContain(copy.recordedTime)
    expect(html).toContain(copy.declaredTime)
    if (smeCopilot) {
      expect(html).toContain(copy.sme.active)
      expect(html).not.toContain(copy.active)
      expect(html).not.toContain(copy.attested)
      expect(rows[0]).toContain(copy.sme.attested)
      expect(rows[1]).toContain(copy.sme.attested)
      expect(controls(html).every(tag => tag.includes('min-h-11') && tag.includes('focus-visible:'))).toBe(true)
      expect(html).not.toContain('bg-primary')
    } else {
      expect(html).toContain(copy.active)
      expect(rows[1]).toContain(copy.attested)
    }
  })
  it.each([false, true])('does not infer provenance for an active ID outside the page (canWithdraw=%s)', canWithdraw => {
    const html = render(<DeliveryHistory events={[]} activeAttestationId={verified.eventId} nextCursor="next" busy={false} canWithdraw={canWithdraw} onMore={noop} onWithdraw={noop} smeCopilot />, lang)
    expect(html).toContain(copy.sme.active)
    expect(html).toContain(copy.sme.withdraw)
    expect(html).toContain(copy.more)
    expect(html).not.toContain(copy.selfReported)
    expect(html).not.toContain(copy.verifiedLive)
    expect(html).not.toContain(copy.empty)
    const buttons = controls(html).filter(tag => tag.startsWith('<button'))
    expect(buttons[0].includes('disabled=""')).toBe(!canWithdraw)
    expect(buttons[1]).not.toContain('disabled=""')
  })
  it('disables withdrawal and pagination while busy without dropping history', () => {
    const html = render(<DeliveryHistory events={[verified, withdrawal]} activeAttestationId={verified.eventId} nextCursor="next" busy={true} canWithdraw={true} onMore={noop} onWithdraw={noop} smeCopilot />, lang)
    expect(html).toContain(copy.verifiedLive)
    expect(html).toContain(withdrawal.reason)
    expect(controls(html).every(tag => tag.includes('disabled=""'))).toBe(true)
  })
  it('only reports empty history when there are no records, active ID, or next page', () => {
    const html = render(<DeliveryHistory events={[]} activeAttestationId={null} nextCursor={null} busy={false} canWithdraw={false} onMore={noop} onWithdraw={noop} smeCopilot />, lang)
    expect(html).toContain(copy.empty)
    expect(html).toContain(copy.noActive)
    expect(html).not.toContain('<button')
  })
})
