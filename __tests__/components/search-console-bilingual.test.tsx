import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'
import { GoogleConnectionsPanel } from '@/components/integrations/GoogleConnectionsPanel'
import { SearchConsoleStateNotice } from '@/components/integrations/SearchConsolePanel'
import type { OwnerState } from '@/lib/integrations/search-console/state'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }))

const STATES: OwnerState[] = [
  { kind: 'unbound' },
  { kind: 'awaiting_first_sync' },
  { kind: 'synced', dataThrough: '2026-09-20' },
  { kind: 'reconnect', dataThrough: '2026-09-18' },
  { kind: 'access_lost', dataThrough: null },
  { kind: 'retrying', dataThrough: '2026-09-18' },
  { kind: 'rebind', dataThrough: null },
  { kind: 'paused_plan', dataThrough: '2026-09-18' },
  { kind: 'temporarily_unavailable', dataThrough: null },
]

const render = (state: OwnerState, lang: 'en' | 'zh-HK') =>
  renderToStaticMarkup(<SearchConsoleStateNotice state={state} lang={lang} />)

describe.each([['en', en], ['zh-HK', zhHK]] as const)('%s', (lang, messages) => {
  it.each(STATES)('renders $kind as a sentence, never blank', state => {
    const markup = render(state, lang)
    expect(markup.replace(/<[^>]+>/g, '').trim().length).toBeGreaterThan(0)
    if (state.kind !== 'synced') {
      expect(markup).toContain(messages.searchConsole[`state_${state.kind}` as keyof typeof messages.searchConsole])
    }
    if ('dataThrough' in state && state.dataThrough) expect(markup).toContain(state.dataThrough)
  })
})

it('says something different in each language for the same state', () => {
  const state: OwnerState = { kind: 'reconnect', dataThrough: null }
  expect(render(state, 'en')).not.toBe(render(state, 'zh-HK'))
})

describe.each(['en', 'zh-HK'] as const)('connections panel at touch size (%s)', lang => {
  it('gives every control a 44px minimum height', () => {
    const markup = renderToStaticMarkup(
      <GoogleConnectionsPanel
        lang={lang}
        entitled
        notice="scope_missing"
        connections={[{ id: 'g', googleEmail: 'o@example.com', status: 'needs_reconnect', scopes: [], createdAt: 'x' }]}
      />,
    )
    const controls = markup.match(/<(button|a)\b[^>]*>/g) ?? []
    expect(controls.length).toBeGreaterThanOrEqual(2)
    for (const control of controls) expect(control).toContain('min-h-11')
  })
})
