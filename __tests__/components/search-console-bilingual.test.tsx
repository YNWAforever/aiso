import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'
import { ConnectionRow, DisconnectErrorNotice, GoogleConnectionsPanel } from '@/components/integrations/GoogleConnectionsPanel'
import {
  BindErrorNotice,
  ErroredConnectionsNotice,
  NoEligiblePropertiesNotice,
  PropertiesLoadFailedNotice,
  PropertySiteRow,
  SearchConsoleStateNotice,
  classifyBindError,
  classifyConnectionError,
  type BindErrorKind,
} from '@/components/integrations/SearchConsolePanel'
import type { OwnerState } from '@/lib/integrations/search-console/state'

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

/**
 * classifyBindError reads the PUT route's failure body
 * (app/api/dashboard/clients/[clientId]/search-console/route.ts): 409/503
 * {error:'GOOGLE'}, 422 {error:'INELIGIBLE'}, or a bare 400/404/503/network
 * failure with no structured body.
 */
describe('classifyBindError', () => {
  it.each([
    [409, { error: 'GOOGLE', reason: 'revoked' }, 'revoked'],
    [503, { error: 'GOOGLE', reason: 'misconfigured' }, 'google'],
    [503, { error: 'GOOGLE', reason: 'unavailable' }, 'google'],
    [422, { error: 'INELIGIBLE', reason: 'not_visible' }, 'ineligible'],
    [422, { error: 'INELIGIBLE', reason: 'other_domain' }, 'ineligible'],
    [400, { error: 'connectionId and siteUrl required' }, 'generic'],
    [404, { error: 'Not found' }, 'generic'],
    [503, { error: 'Bind failed' }, 'generic'],
    [0, null, 'generic'],
  ] as const)('%s %j -> %s', (status, body, expected) => {
    expect(classifyBindError(status, body)).toBe(expected)
  })
})

describe('classifyConnectionError', () => {
  it.each([
    ['revoked', 'revoked'],
    ['forbidden', 'forbidden'],
    ['quota', 'quota'],
    ['misconfigured', 'misconfigured'],
    ['unavailable', 'unavailable'],
    ['something_unknown', 'unavailable'],
    [null, 'unavailable'],
  ] as const)('%s -> %s', (kind, expected) => {
    expect(classifyConnectionError(kind)).toBe(expected)
  })
})

const BIND_ERROR_KINDS: BindErrorKind[] = ['ineligible', 'revoked', 'google', 'generic']

describe.each(['en', 'zh-HK'] as const)('BindErrorNotice (%s)', lang => {
  it.each(BIND_ERROR_KINDS)('renders %s as a non-blank alert', kind => {
    const markup = renderToStaticMarkup(<BindErrorNotice kind={kind} lang={lang} />)
    expect(markup).toContain('role="alert"')
    expect(markup.replace(/<[^>]+>/g, '').trim().length).toBeGreaterThan(0)
    const copy = (lang === 'zh-HK' ? zhHK : en).searchConsole
    expect(markup).toContain(copy[`bind_error_${kind}` as keyof typeof copy])
  })
})

it('BindErrorNotice says something different per language for the same kind', () => {
  const render1 = renderToStaticMarkup(<BindErrorNotice kind="revoked" lang="en" />)
  const render2 = renderToStaticMarkup(<BindErrorNotice kind="revoked" lang="zh-HK" />)
  expect(render1).not.toBe(render2)
})

describe.each(['en', 'zh-HK'] as const)('ErroredConnectionsNotice (%s)', lang => {
  it('includes the email and a per-kind message for each errored connection', () => {
    const markup = renderToStaticMarkup(
      <ErroredConnectionsNotice
        lang={lang}
        connections={[
          { googleEmail: 'a@example.com', error: 'revoked' },
          { googleEmail: 'b@example.com', error: 'misconfigured' },
          { googleEmail: null, error: 'something_unmapped' },
        ]}
      />,
    )
    const copy = (lang === 'zh-HK' ? zhHK : en).searchConsole
    expect(markup).toContain('role="alert"')
    expect(markup).toContain('a@example.com')
    expect(markup).toContain('b@example.com')
    expect(markup).toContain(copy.connection_error_revoked.replace('{email}', 'a@example.com'))
    expect(markup).toContain(copy.connection_error_misconfigured.replace('{email}', 'b@example.com'))
    // Unrecognised error kinds fall back to the generic 'unavailable' copy
    // rather than dropping the connection or throwing on a missing key.
    expect(markup).toContain(copy.connection_error_unavailable.replace('{email}', '—'))
  })
})

describe.each(['en', 'zh-HK'] as const)('PropertiesLoadFailedNotice (%s)', lang => {
  it('is a non-blank alert with no retry button when none is offered', () => {
    const markup = renderToStaticMarkup(<PropertiesLoadFailedNotice lang={lang} />)
    expect(markup).toContain('role="alert"')
    expect(markup.replace(/<[^>]+>/g, '').trim().length).toBeGreaterThan(0)
    expect(markup).not.toContain('<button')
  })

  it('offers a touch-sized retry control when onRetry is given', () => {
    const markup = renderToStaticMarkup(<PropertiesLoadFailedNotice lang={lang} onRetry={() => {}} />)
    expect(markup).toContain('<button')
    expect(markup).toContain('min-h-11')
    const copy = (lang === 'zh-HK' ? zhHK : en).searchConsole
    expect(markup).toContain(copy.retry)
  })
})

describe.each(['en', 'zh-HK'] as const)('NoEligiblePropertiesNotice (%s)', lang => {
  it('is a non-blank, language-specific sentence', () => {
    const markup = renderToStaticMarkup(<NoEligiblePropertiesNotice lang={lang} />)
    const copy = (lang === 'zh-HK' ? zhHK : en).searchConsole
    expect(markup).toContain(copy.no_eligible_properties)
  })
})

describe.each(['en', 'zh-HK'] as const)('DisconnectErrorNotice (%s)', lang => {
  it('is a non-blank alert', () => {
    const markup = renderToStaticMarkup(<DisconnectErrorNotice lang={lang} />)
    expect(markup).toContain('role="alert"')
    const copy = (lang === 'zh-HK' ? zhHK : en).searchConsole
    expect(markup).toContain(copy.disconnect_error)
  })
})

// renderToStaticMarkup HTML-escapes apostrophes in text content to
// `&#x27;` (React 19; see the Task 19 commit's note on state_retrying /
// state_rebind). reason_other_domain predates this file and contains one
// ("brand's"), so this decodes rather than rephrasing catalogue copy that
// is live elsewhere.
const decodeApostrophes = (markup: string) => markup.replace(/&#x27;/g, "'")

const eligibleSite = { siteUrl: 'https://example.com/', permissionLevel: 'siteOwner', verdict: { eligible: true as const } }

describe.each(['en', 'zh-HK'] as const)('PropertySiteRow (%s)', lang => {
  it('gives the bind button a touch size and a site-specific accessible name', () => {
    const markup = renderToStaticMarkup(
      <PropertySiteRow site={eligibleSite} onBind={() => {}} pending={false} disabled={false} lang={lang} />,
    )
    expect(markup).toContain('min-h-11')
    expect(markup).toContain(`aria-label="${(lang === 'zh-HK' ? zhHK : en).searchConsole.bind}: ${eligibleSite.siteUrl}"`)
    // `disabled:opacity-60` is a Tailwind variant class, always present; the
    // actual HTML attribute is what must be absent when not disabled.
    expect(markup).not.toContain('disabled=""')
  })

  it('shows the pending label and disables the button while a bind is in flight', () => {
    const markup = renderToStaticMarkup(
      <PropertySiteRow site={eligibleSite} onBind={() => {}} pending disabled lang={lang} />,
    )
    const copy = (lang === 'zh-HK' ? zhHK : en).searchConsole
    expect(markup).toContain(copy.binding)
    expect(markup).not.toContain(`>${copy.bind}<`)
    expect(markup).toContain('disabled=""')
  })

  it('disables the button for a different in-flight bind without showing its pending label', () => {
    const markup = renderToStaticMarkup(
      <PropertySiteRow site={eligibleSite} onBind={() => {}} pending={false} disabled lang={lang} />,
    )
    const copy = (lang === 'zh-HK' ? zhHK : en).searchConsole
    expect(markup).toContain('disabled=""')
    expect(markup).toContain(`>${copy.bind}<`)
  })

  it('shows the ineligibility reason instead of a button when the site is not eligible', () => {
    const site = { ...eligibleSite, verdict: { eligible: false as const, reason: 'other_domain' as const } }
    const markup = renderToStaticMarkup(<PropertySiteRow site={site} onBind={() => {}} pending={false} disabled={false} lang={lang} />)
    const copy = (lang === 'zh-HK' ? zhHK : en).searchConsole
    expect(markup).not.toContain('<button')
    expect(decodeApostrophes(markup)).toContain(copy.reason_other_domain)
  })
})

const connection = { id: 'conn-1', googleEmail: 'owner@example.com', status: 'active' as const, scopes: [], createdAt: '2026-01-01' }
const otherConnection = { id: 'conn-2', googleEmail: 'other@example.com', status: 'active' as const, scopes: [], createdAt: '2026-01-01' }

describe.each(['en', 'zh-HK'] as const)('ConnectionRow (%s)', lang => {
  it('gives the disconnect button a touch size and a connection-specific accessible name', () => {
    const markup = renderToStaticMarkup(
      <ConnectionRow connection={connection} onDisconnect={() => {}} pending={false} disabled={false} lang={lang} />,
    )
    expect(markup).toContain('min-h-11')
    expect(markup).toContain(`aria-label="${(lang === 'zh-HK' ? zhHK : en).searchConsole.disconnect}: ${connection.googleEmail}"`)
  })

  it('two rows for two connections get distinct accessible names', () => {
    const first = renderToStaticMarkup(<ConnectionRow connection={connection} onDisconnect={() => {}} pending={false} disabled={false} lang={lang} />)
    const second = renderToStaticMarkup(<ConnectionRow connection={otherConnection} onDisconnect={() => {}} pending={false} disabled={false} lang={lang} />)
    const ariaLabel = (markup: string) => markup.match(/aria-label="([^"]*)"/)?.[1]
    expect(ariaLabel(first)).not.toBe(ariaLabel(second))
  })

  it('shows the pending label and disables the button while a disconnect is in flight', () => {
    const markup = renderToStaticMarkup(
      <ConnectionRow connection={connection} onDisconnect={() => {}} pending disabled lang={lang} />,
    )
    const copy = (lang === 'zh-HK' ? zhHK : en).searchConsole
    expect(markup).toContain(copy.disconnecting)
    expect(markup).toContain('disabled=""')
  })
})
