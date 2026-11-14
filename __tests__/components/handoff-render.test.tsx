import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import { HandoffPanel, HandoffPanelView } from '@/components/site-edit/HandoffPanel'
import { freezeReview } from '@/lib/change-sets/validation'
import { parseVersionDetail } from '@/lib/change-sets/read-view'
import { createDeliveryExport } from '@/lib/delivery/export'
import type { VersionDetail } from '@/lib/change-sets/types'
import type { WorkItem } from '@/lib/work-items/schema'
import {
  acceptHandoffRead, beginHandoffMutation, beginHandoffRead, decodeHandoff, failHandoffMutation, failHandoffRead,
  handoffTimestamp, initialHandoffReadState, type HandoffReadState, type HandoffReadView,
} from '@/lib/site-edit/handoff-read-view'
import { approvedVersion, REQUEST_ID } from '../delivery/fixtures'
import { approvedMultiSourceVersion, editSpecs } from '../delivery/multi-source-fixtures'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ db: () => { throw Error('SSR must not read a database') } }))

const at = '2026-11-13T17:00:00.123456Z'
const offsetAt = '2026-11-14T01:00:00.654321+08:00'
const jobId = '123e4567-e89b-42d3-a456-426614174000'
const base = approvedVersion()
// Build a complete real V1 WorkItem WITH its edit spec before freezing. The
// unchanged base fixture supplies retained evidence, never a made-up hash/schema.
function v1Version(spec = editSpecs[0]): VersionDetail {
  const draft: WorkItem = {
    id: base.workItemId, clientId: REQUEST_ID, status: 'draft', revision: base.draftRevision,
    title: base.title, action: base.action, notes: base.notes, locale: base.locale,
    createdAt: base.submittedAt, updatedAt: base.submittedAt,
    evidenceSnapshot: base.evidenceSnapshot, editSpec: spec,
  }
  const frozen = freezeReview(draft)
  return { ...base, ...frozen.content, contentHash: frozen.contentHash, validation: frozen.validation }
}
const version = v1Version()
const removal = v1Version(editSpecs[1])
const multi = approvedMultiSourceVersion(editSpecs[2])
const noop = () => {}
function view(overrides: Partial<HandoffReadView> = {}): HandoffReadView {
  return { state: 'none', jobId: null, executorRef: null, lastEventAt: null, canSend: true, block: null,
    receipt: null, liveCheck: null, canCheck: false, checkBlock: 'not_open', ...overrides }
}
const sent = (overrides: Partial<HandoffReadView> = {}) => view({ state: 'sent', jobId, lastEventAt: at, block: 'already_sent', canSend: false, canCheck: true, checkBlock: null, ...overrides })
const checked = (overrides: Partial<NonNullable<HandoffReadView['liveCheck']>> = {}) => ({ outcome: 'found' as const, checkedAt: at, attested: false, structuredData: null, ...overrides })
function ready(handoff = view()): HandoffReadState {
  const start = beginHandoffRead(initialHandoffReadState())!
  return acceptHandoffRead(start.state, start.token, decodeHandoff({ handoff }), false)!.state
}
const render = (node: React.ReactNode, lang: string) => renderToString(<NextIntlClientProvider locale={lang} messages={lang === 'en' ? en : zh} timeZone="UTC">{node}</NextIntlClientProvider>)
const controls = (html: string) => html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? []
const primary = (html: string) => controls(html).filter(button => button.includes('bg-primary text-primary-foreground'))
const markup = (text: string) => renderToString(<>{text}</>)
beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => { throw Error('SSR must not fetch') })) })
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals() })

it('uses genuinely frozen V1/V2 specs and valid approved read DTOs', () => {
  for (const saved of [version, removal, multi]) {
    const parsed = parseVersionDetail(saved, saved.workItemId)
    expect(parsed.editSpec).toEqual(saved.editSpec)
    expect(parsed.decision?.decision).toBe('approved')
    expect(createDeliveryExport(parsed, 'json').rendererVersion).toBe(`delivery-export.v${parsed.schemaVersion}`)
  }
})

// These are render contracts over real view/state code. They do not execute
// hydrated effects, event handlers, cross-scope promises or callback integration.
describe.each(['en', 'zh-HK'])('handoff SSR contract (%s)', lang => {
  const copy = (lang === 'en' ? en : zh).siteEditHandoff
  const renderView = (state: HandoffReadState, smeCopilot = true, saved = version) => render(<HandoffPanelView version={saved} state={state} smeCopilot={smeCopilot} onSend={noop} onCheck={noop} onRefresh={noop} />, lang)

  it('keeps omitted/false legacy props identical and initial SSR read-only for V1 and V2', () => {
    for (const saved of [version, multi]) {
      const props = { clientId: REQUEST_ID, version: saved }
      const omitted = render(<HandoffPanel {...props} />, lang)
      expect(omitted).toBe(render(<HandoffPanel {...props} smeCopilot={false} onRecordedChange={noop} />, lang))
      expect(omitted).toContain(copy.title)
      expect(omitted).not.toContain(copy.sme.title)
      expect(omitted).toContain('aria-busy="true"')
      expect(omitted).not.toContain('<button')
      const sme = render(<HandoffPanel {...props} smeCopilot onRecordedChange={noop} />, lang)
      expect(sme).toContain(copy.sme.loading)
      expect(sme).toContain(copy.sme.refresh)
      expect(sme).toContain('aria-busy="true"')
      expect(controls(sme).every(button => button.includes('disabled=""'))).toBe(true)
      expect(sme).not.toContain(copy.sme.state.none)
    }
  })
  it('keeps omitted/false view flags identical for every legacy recorded state', () => {
    for (const handoff of [view(), sent(), view({ state: 'failed', jobId, lastEventAt: at }), view({ state: 'unknown', jobId, lastEventAt: at }), sent({ receipt: { status: 'completed', completedAt: at }, liveCheck: checked() })]) {
      const props = { version, state: ready(handoff), onSend: noop, onCheck: noop, onRefresh: noop }
      expect(render(<HandoffPanelView {...props} />, lang)).toBe(render(<HandoffPanelView {...props} smeCopilot={false} />, lang))
    }
  })
  it.each(['not_approved', 'superseded', 'no_edit_spec', 'not_approver', 'not_entitled', 'limit_reached', 'not_connected'] as const)('obeys fresh canSend=false for gate %s despite approved version props', block => {
    for (const sme of [false, true]) {
      const html = renderView(ready(view({ canSend: false, block })), sme)
      expect(html).toContain(markup(copy.block[block]))
      const send = controls(html).find(button => button.includes(copy.send))!
      expect(send).toContain('disabled=""')
      expect(primary(html)).toHaveLength(0)
    }
  })
  it('offers exactly one primary intentional send for a fresh eligible version, including V2', () => {
    for (const saved of [version, multi]) {
      const html = renderView(ready(), true, saved)
      expect(primary(html)).toHaveLength(1)
      expect(primary(html)[0]).toContain(copy.send)
      expect(primary(html)[0]).not.toContain('disabled=""')
      expect(html).toContain(copy.sme.refresh)
      expect(html).not.toContain(copy.live.check)
    }
  })
  it('keeps permitted handoff actions secondary while the parent has the primary step', () => {
    const read = beginHandoffRead(initialHandoffReadState())!
    const unavailable = failHandoffRead(read.state, read.token)!
    for (const state of [ready(), ready(sent()), ready(view({ state: 'unknown', jobId, lastEventAt: at })), unavailable]) {
      const normal = renderView(state)
      const secondary = render(<HandoffPanelView version={version} state={state} smeCopilot emphasize={false} onSend={noop} onCheck={noop} onRefresh={noop} />, lang)
      expect(primary(normal)).toHaveLength(1)
      expect(primary(secondary)).toHaveLength(0)
      expect(controls(secondary)).toHaveLength(controls(normal).length)
      expect(controls(secondary).filter(button => button.includes('disabled=""'))).toHaveLength(controls(normal).filter(button => button.includes('disabled=""')).length)
      expect(secondary).toContain(copy.sme.refresh)
    }
  })
  it('permits a fresh failed retry only when the server permits it', () => {
    const failed = view({ state: 'failed', jobId, lastEventAt: at })
    const allowed = renderView(ready(failed))
    expect(primary(allowed)).toHaveLength(1)
    expect(primary(allowed)[0]).toContain(copy.sme.retrySend)
    const blocked = renderView(ready({ ...failed, canSend: false, block: 'not_approver' }))
    expect(controls(blocked).find(button => button.includes(copy.sme.retrySend))).toContain('disabled=""')
    expect(primary(blocked)).toHaveLength(0)
  })
  it('makes unknown reconciliation a GET action and never renders a resend, even with canSend=true', () => {
    for (const sme of [false, true]) {
      const html = renderView(ready(view({ state: 'unknown', jobId, lastEventAt: at, canCheck: true, checkBlock: null })), sme)
      const buttons = controls(html)
      expect(buttons).toHaveLength(2)
      expect(buttons.some(button => button.includes(copy.resend) || button.includes(copy.sme.retrySend) || button.endsWith(`>${copy.send}</button>`))).toBe(false)
      expect(buttons.some(button => button.includes(copy.sme.refresh) && !button.includes('disabled=""'))).toBe(true)
      if (sme) {
        expect(html).toContain(copy.sme.state.unknown)
        expect(primary(html)).toHaveLength(1)
        expect(primary(html)[0]).toContain(copy.sme.refresh)
      }
    }
  })
  it('does not infer check permission from a sent state or completed developer claim', () => {
    for (const completed of [false, true]) for (const canCheck of [false, true]) {
      const html = renderView(ready(sent({ receipt: completed ? { status: 'completed', completedAt: at } : null, canCheck, checkBlock: canCheck ? null : 'not_open' })))
      expect(controls(html).some(button => button.includes(copy.live.check))).toBe(canCheck)
      expect(primary(html)).toHaveLength(canCheck ? 1 : 0)
      if (canCheck) expect(primary(html)[0]).toContain(copy.live.check)
      expect(controls(html).some(button => button.includes(copy.send))).toBe(false)
      if (completed) expect(html).toContain(copy.sme.receipt.completed.replace('{date}', handoffTimestamp(at)))
    }
  })
  it('stops aria-busy after unavailable reads, shows failure and enables status refresh', () => {
    const start = beginHandoffRead(initialHandoffReadState())!
    const failed = failHandoffRead(start.state, start.token)!
    for (const sme of [false, true]) {
      const html = renderView(failed, sme)
      expect(html).toContain('aria-busy="false"')
      expect(html).toContain(`role="alert">${markup(copy.errors.HANDOFF_UNAVAILABLE)}`)
      expect(html).not.toContain(copy.sme.loading)
      expect(html).not.toContain(copy.state.none)
      expect(html).not.toContain(copy.sme.state.none)
      expect(controls(html)).toHaveLength(1)
      expect(controls(html)[0]).toContain(copy.sme.refresh)
      expect(controls(html)[0]).not.toContain('disabled=""')
      if (sme) expect(primary(html)).toHaveLength(1)
    }
  })
  it('retains old observations visibly without permitting another write after an uncertain check', () => {
    const start = beginHandoffMutation(ready(sent({ receipt: { status: 'completed', completedAt: at }, liveCheck: checked() })), 'check')!
    const failed = failHandoffMutation(start.state, start.token, 'HANDOFF_UNAVAILABLE')!
    const html = renderView(failed)
    expect(html).toContain(copy.sme.historical)
    expect(html).toContain(handoffTimestamp(at))
    expect(html).toContain('aria-busy="false"')
    expect(controls(html).find(button => button.includes(copy.live.check))).toContain('disabled=""')
    expect(primary(html)).toHaveLength(1)
    expect(primary(html)[0]).toContain(copy.sme.refresh)
    expect(primary(html)[0]).not.toContain('disabled=""')
  })
  it('hides stale not-sent/failed claims and retry controls after an unconfirmed send', () => {
    for (const previous of [view(), view({ state: 'failed', jobId, lastEventAt: at })]) {
      const started = beginHandoffMutation(ready(previous), 'send')!
      const failed = failHandoffMutation(started.state, started.token, 'HANDOFF_UNAVAILABLE')!
      for (const sme of [false, true]) {
        const html = renderView(failed, sme)
        expect(controls(html)).toHaveLength(1)
        expect(controls(html)[0]).toContain(copy.sme.refresh)
        expect(html).not.toContain(copy.sme.state.none)
        expect(html).not.toContain(copy.sme.state.failed)
        expect(html).not.toContain(copy.state.none)
        expect(html).not.toContain(copy.state.failed)
        if (sme) expect(html).toContain(copy.sme.unconfirmed)
      }
    }
  })
  it('retains LIVE_CHECK_NOT_OPEN after automatic reconciliation without advising a resend', () => {
    const start = beginHandoffMutation(ready(sent()), 'check')!
    const failed = failHandoffMutation(start.state, start.token, 'LIVE_CHECK_NOT_OPEN')!
    const read = beginHandoffRead(failed)!
    const state = acceptHandoffRead(read.state, read.token, sent(), false)!.state
    const html = renderView(state)
    expect(html).toContain(`role="alert">${markup(copy.errors.LIVE_CHECK_NOT_OPEN)}`)
    expect(copy.errors.LIVE_CHECK_NOT_OPEN).not.toContain(lang === 'en' ? 'send it' : '先交由')
    expect(controls(html).some(button => button.includes(copy.resend) || button.includes(copy.sme.retrySend))).toBe(false)
  })
  it('labels send and check busy states separately and locks refresh while writing', () => {
    const sending = beginHandoffMutation(ready(), 'send')!.state
    const checking = beginHandoffMutation(ready(sent()), 'check')!.state
    const sendHtml = renderView(sending)
    const checkHtml = renderView(checking)
    expect(controls(sendHtml).some(button => button.endsWith(`>${copy.sending}</button>`))).toBe(true)
    expect(controls(checkHtml).some(button => button.endsWith(`>${copy.live.checking}</button>`))).toBe(true)
    for (const html of [sendHtml, checkHtml]) {
      expect(html).toContain('aria-busy="true"')
      expect(controls(html).every(button => button.includes('disabled=""'))).toBe(true)
    }
  })
  it('keeps server cooldown as a wait/read state without a primary mutation', () => {
    const html = renderView(ready(sent({ liveCheck: checked(), canCheck: false, checkBlock: 'too_soon' })))
    expect(html).toContain(copy.sme.cooldown)
    expect(controls(html).find(button => button.includes(copy.live.check))).toContain('disabled=""')
    expect(controls(html).find(button => button.includes(copy.sme.refresh))).not.toContain('disabled=""')
    expect(primary(html)).toHaveLength(0)
  })
  it('displays the full stored UTC timestamp and treats receipt completion as a claim even after a check', () => {
    const html = renderView(ready(sent({ receipt: { status: 'completed', completedAt: at }, liveCheck: checked({ checkedAt: '2026-11-13T17:01:00.987654Z', attested: true }) })))
    expect(html).toContain(copy.sme.receipt.completed.replace('{date}', handoffTimestamp(at)))
    expect(html).toContain('2026-11-13 17:01:00.987654 UTC')
    expect(html).toContain(copy.sme.recordedByCheck)
    expect(html).toContain(copy.sme.checkLimitation)
    expect(html).not.toContain(copy.receipt.completed.replace('{date}', '2026-11-13'))
  })
  it('shows non-UTC original offsets explicitly without falsely labelling them UTC', () => {
    const html = renderView(ready(sent({ receipt: { status: 'completed', completedAt: offsetAt }, liveCheck: checked({ checkedAt: offsetAt }) })))
    expect(html.match(/2026-11-14 01:00:00\.654321\+08:00/g)).toHaveLength(2)
    expect(html).not.toContain('UTC')
  })
  it.each(['pass', 'warn', 'fail', null] as const)('distinguishes a matched check from insertion/provenance and c4=%s', structuredData => {
    const html = renderView(ready(sent({ liveCheck: checked({ structuredData, attested: false }) })))
    expect(html).toContain(copy.sme.result.found.replace('{date}', handoffTimestamp(at)))
    expect(html).toContain(copy.sme.noNewDelivery)
    expect(html).not.toContain(copy.sme.recordedByCheck)
    expect(html).not.toContain((lang === 'en' ? en : zh).delivery.verifiedLive)
    if (structuredData) expect(html).toContain(copy.sme.structuredData[structuredData])
    expect(primary(html)).toHaveLength(0)
    expect(controls(html).find(button => button.includes(copy.live.check))).not.toContain('disabled=""')
  })
  it.each(['found', 'missing', 'fetch_failed'] as const)('describes removal outcome %s from loaded-page evidence, without inventing verification', outcome => {
    const html = renderView(ready(sent({ liveCheck: checked({ outcome }) })), true, removal)
    expect(html).toContain(copy.sme.removeResult[outcome].replace('{date}', handoffTimestamp(at)))
    expect(html).not.toContain(copy.sme.recordedByCheck)
    expect(html.includes(copy.sme.noNewDelivery)).toBe(outcome === 'missing')
    expect(primary(html)).toHaveLength(outcome === 'missing' ? 0 : 1)
  })
  it('records a removal verification only when this check actually inserted a delivery event', () => {
    const html = renderView(ready(sent({ liveCheck: checked({ outcome: 'missing', attested: true }) })), true, removal)
    expect(html).toContain(copy.sme.recordedByCheck)
    expect(html).not.toContain(copy.sme.noNewDelivery)
  })
  it('retains legacy receipt/result copy and never turns attested=false into a new verified delivery', () => {
    const html = renderView(ready(sent({ receipt: { status: 'completed', completedAt: at }, liveCheck: checked() })), false)
    expect(html).toContain(copy.receipt.completed.replace('{date}', '2026-11-13'))
    expect(html).toContain(copy.live.result.found.replace('{date}', '2026-11-13'))
    expect(html).not.toContain(copy.live.result.verified.replace('{date}', '2026-11-13'))
  })
  it('escapes references, bounds long text, keeps 44px controls and visible keyboard focus', () => {
    const html = renderView(ready(sent({ executorRef: '<script>' + 'a'.repeat(180) })))
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
    expect(html).toContain('min-w-0')
    expect(html).toContain('break-all')
    expect(controls(html).every(button => button.includes('min-h-11') && button.includes('max-w-full') && button.includes('focus-visible:'))).toBe(true)
    expect(html).not.toContain('autoFocus')
    expect(html).not.toContain('dark:') // Shared theme tokens, no hardcoded theme override.
  })
})

describe.each(['en', 'zh-HK'])('SME recovery navigation in %s', lang => {
  const copy = (lang === 'en' ? en : zh).siteEditHandoff
  const panel = (state: HandoffReadState, smeCopilot = true, onViewManualOptions?: () => void) => render(
    <HandoffPanelView version={version} state={state} smeCopilot={smeCopilot} onSend={noop} onCheck={noop} onRefresh={noop} onViewManualOptions={onViewManualOptions} />, lang,
  )
  it('links the authoritative entitlement block to the actual plan section without fetching or enabling send', () => {
    const html = panel(ready(view({ canSend: false, block: 'not_entitled' })))
    expect(html).toContain(`href="/${lang}/dashboard/settings#settings-plan"`)
    expect(html).toContain(copy.sme.viewPlan)
    expect(controls(html).find(button => button.includes(copy.send))).toContain('disabled=""')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('offers only viewing an existing manual pane, and never invokes it while rendering', () => {
    const onViewManualOptions = vi.fn()
    const state = ready(view({ canSend: false, block: 'not_connected' }))
    const html = panel(state, true, onViewManualOptions)
    const recovery = controls(html).find(button => button.includes(copy.sme.viewManualOptions))
    expect(recovery).toContain('min-h-11')
    expect(recovery).not.toContain('bg-primary')
    expect(onViewManualOptions).not.toHaveBeenCalled()
    expect(panel(state)).not.toContain(copy.sme.viewManualOptions)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('does not frame another account role as a remedy for the recorded approving-actor restriction', () => {
    const html = panel(ready(view({ canSend: false, block: 'not_approver' })), true, noop)
    expect(html).toContain(copy.block.not_approver)
    expect(html).not.toContain(copy.sme.viewPlan)
    expect(html).not.toContain(copy.sme.viewManualOptions)
    expect(html).not.toContain('settings#members')
  })
  it('hides a retained entitlement block recovery after read authority is invalidated', () => {
    const state = ready(view({ canSend: false, block: 'not_entitled' }))
    const html = panel({ ...state, authority: false, reconcileRequired: true }, true, noop)
    expect(html).not.toContain(copy.sme.viewPlan)
    expect(html).not.toContain(copy.sme.viewManualOptions)
    expect(html).toContain(copy.sme.refresh)
  })
  it('preserves an independently authorized live check for an unknown outcome while suppressing recovery', () => {
    const html = panel(ready(sent({ state: 'unknown', canSend: true, block: null })), true, noop)
    expect(controls(html).find(button => button.includes(copy.live.check))).not.toContain('disabled=""')
    expect(html).not.toContain(copy.sme.viewManualOptions)
    expect(html).not.toContain(copy.sme.viewPlan)
  })
  it('adds no recovery controls to legacy rendering', () => {
    const html = panel(ready(view({ canSend: false, block: 'not_entitled' })), false, noop)
    expect(html).not.toContain(copy.sme.viewPlan)
    expect(html).not.toContain(copy.sme.viewManualOptions)
  })
})
