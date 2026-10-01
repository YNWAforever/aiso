import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'
import {
  AnalyticsStateNotice,
  ConnectionErrorNotice,
  EventChoice,
  GOOGLE_REASON_COPY,
  INELIGIBLE_REASON_COPY,
  ObservedFigures,
  PropertyRow,
  StreamList,
  StreamRow,
  WriteErrorNotice,
  classifyAnalyticsError,
  grantAnalyticsHref,
  offeredStreams,
  SaveErrorNotice,
  controlsDisabled,
  isStaleChoiceError,
  refreshedPick,
  shouldReportWriteError,
  showsObservedFigures,
  type PickerStream,
} from '@/components/integrations/AnalyticsPanel'
import type { AnalyticsOwnerState } from '@/lib/integrations/analytics/state'
import type { AnalyticsPanel } from '@/lib/integrations/analytics/store'
import { RETURN_PATH } from '@/lib/integrations/google/consent-state'
import { ObservedEnquiriesCard } from '@/components/integrations/ObservedEnquiriesCard'

type Lang = 'en' | 'zh-HK'
type Copy = Record<string, string>
const copyOf = (lang: Lang): Copy => (lang === 'zh-HK' ? zhHK : en).analytics as Copy
const LANGS = ['en', 'zh-HK'] as const

const CLIENT = '11111111-1111-4111-8111-111111111111'
const CONNECTION = '22222222-2222-4222-8222-222222222222'

// renderToStaticMarkup escapes `&` in attributes and apostrophes in text; the
// catalogue avoids apostrophes, and hrefs are decoded before being parsed.
const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&#x27;/g, "'")
const text = (markup: string) => decode(markup.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()

/** Every AnalyticsOwnerState kind, one each. */
const STATES: AnalyticsOwnerState[] = [
  { kind: 'unbound' },
  { kind: 'grant_analytics' },
  { kind: 'awaiting_first_sync' },
  { kind: 'synced', dataThrough: '2026-09-27' },
  { kind: 'repick_events' },
  { kind: 'reconnect', dataThrough: '2026-09-20' },
  { kind: 'access_lost', dataThrough: null },
  { kind: 'retrying', dataThrough: '2026-09-20' },
  { kind: 'rebind', dataThrough: null },
  { kind: 'paused_plan', dataThrough: '2026-09-20' },
  { kind: 'temporarily_unavailable', dataThrough: null },
]

const notice = (state: AnalyticsOwnerState, lang: Lang) =>
  renderToStaticMarkup(<AnalyticsStateNotice state={state} lang={lang} clientId={CLIENT} connectionId={CONNECTION} />)

describe.each(LANGS)('AnalyticsStateNotice (%s)', lang => {
  const copy = copyOf(lang)

  it('covers all eleven owner states', () => {
    expect(STATES.map(s => s.kind).sort()).toEqual([
      'access_lost', 'awaiting_first_sync', 'grant_analytics', 'paused_plan', 'rebind', 'reconnect',
      'repick_events', 'retrying', 'synced', 'temporarily_unavailable', 'unbound',
    ])
  })

  it.each(STATES)('renders $kind with its own copy', state => {
    const markup = notice(state, lang)
    expect(copy[`state_${state.kind}`]?.trim().length).toBeGreaterThan(0)
    expect(decode(markup)).toContain(copy[`state_${state.kind}`])
  })

  it('gives every state a different sentence', () => {
    const sentences = STATES.map(s => copy[`state_${s.kind}`])
    expect(new Set(sentences).size).toBe(STATES.length)
  })

  it('links grant_analytics to the analytics consent for this connection, returning to this page', () => {
    const markup = notice({ kind: 'grant_analytics' }, lang)
    const href = decode(markup.match(/href="([^"]+)"/)?.[1] ?? '')
    expect(href).toContain('scope=analytics')
    const url = new URL(href, 'https://aiso.test')
    expect(url.pathname).toBe('/api/integrations/google/start')
    expect(url.searchParams.get('scope')).toBe('analytics')
    expect(url.searchParams.get('connection')).toBe(CONNECTION)
    expect(url.searchParams.get('return')).toBe(`/${lang}/dashboard/${CLIENT}/assets`)
    expect(decode(markup)).toContain(copy.grant_analytics)
    expect(markup).toMatch(/<a [^>]*min-h-11/)
  })

  it.each([
    { kind: 'reconnect', dataThrough: null },
    { kind: 'access_lost', dataThrough: null },
  ] as AnalyticsOwnerState[])('links $kind to Google connections in Settings', state => {
    const markup = notice(state, lang)
    expect(markup).toContain(`href="/${lang}/dashboard/settings#google"`)
    expect(decode(markup)).toContain(copy.manage_in_settings)
    expect(markup).toMatch(/<a [^>]*min-h-11/)
  })

  it.each(STATES.filter(s => !['reconnect', 'access_lost', 'grant_analytics'].includes(s.kind)))(
    'sends no one anywhere for $kind', state => {
      expect(notice(state, lang)).not.toContain('href=')
    },
  )
})

it('says something different in each language for the same state', () => {
  expect(notice({ kind: 'repick_events' }, 'en')).not.toBe(notice({ kind: 'repick_events' }, 'zh-HK'))
})

describe('grantAnalyticsHref', () => {
  it.each(LANGS)('builds a return path the start route accepts (%s)', lang => {
    const url = new URL(grantAnalyticsHref(CONNECTION, lang, CLIENT), 'https://aiso.test')
    expect(RETURN_PATH.test(url.searchParams.get('return') ?? '')).toBe(true)
  })
})

const figures = (over: Partial<AnalyticsPanel> = {}): AnalyticsPanel => ({
  latest: { outcome: 'ok', dataThrough: '2026-09-27', ranAt: '2026-09-28T09:00:00.000Z' },
  lastGoodDataThrough: '2026-09-27',
  lastGoodDataWithheld: false,
  last28: {
    total: 37,
    bySource: { organic_search: 21, ai_assistant: 5, other: 11 },
    byEvent: [{ eventName: 'generate_lead', count: 30 }, { eventName: 'Contact_Form', count: 7 }],
  },
  owner: { leadValue: '800', closeRate: '0.25' },
  ...over,
})

const renderFigures = (panel: AnalyticsPanel, lang: Lang) =>
  decode(renderToStaticMarkup(<ObservedFigures panel={panel} lang={lang} />))

describe.each(LANGS)('ObservedFigures (%s)', lang => {
  const copy = copyOf(lang)

  it('shows the heading, the total and the three source rows', () => {
    const markup = renderFigures(figures(), lang)
    expect(markup).toContain(copy.observed_heading)
    expect(markup).toContain(copy.total_enquiries)
    expect(text(markup)).toContain(`${copy.total_enquiries} 37`)
    expect(text(markup)).toContain(`${copy.source_organic_search} 21`)
    expect(text(markup)).toContain(`${copy.source_ai_assistant} 5`)
    expect(text(markup)).toContain(`${copy.source_other} 11`)
  })

  it('shows one row per chosen event, with GA4 spelling kept', () => {
    const markup = text(renderFigures(figures(), lang))
    expect(markup).toContain('generate_lead 30')
    expect(markup).toContain('Contact_Form 7')
  })

  it('says how fresh the data is', () => {
    expect(renderFigures(figures(), lang)).toContain(copy.data_through.replace('{date}', '2026-09-27'))
  })

  it('shows zeros, not a blank, when a synced window observed no enquiries', () => {
    const markup = text(renderFigures(figures({ last28: null }), lang))
    expect(markup).toContain(`${copy.total_enquiries} 0`)
    expect(markup).toContain(`${copy.source_ai_assistant} 0`)
  })

  it('shows 0 and the window end when the last enquiry fell outside the 28 days', () => {
    // A brand whose last enquiry was 40 days ago: the last good run still dates the data.
    const zero = figures({
      lastGoodDataThrough: '2026-09-24',
      last28: { total: 0, bySource: { organic_search: 0, ai_assistant: 0, other: 0 }, byEvent: [] },
    })
    const markup = renderFigures(zero, lang)
    expect(text(markup)).toContain(`${copy.total_enquiries} 0`)
    expect(markup).toContain(copy.data_through.replace('{date}', '2026-09-24'))
  })

  it('shows the withheld note only when GA4 withheld data', () => {
    expect(renderFigures(figures(), lang)).not.toContain(copy.withheld_note)
    expect(renderFigures(figures({ lastGoodDataWithheld: true }), lang)).toContain(copy.withheld_note)
  })

  it('keeps the withheld note of the run that produced the figures after a later failed run', () => {
    // ok (withheld) then quota: the numbers on screen are still the withheld run's.
    const afterQuota = figures({
      latest: { outcome: 'quota', dataThrough: null, ranAt: '2026-09-29T09:00:00.000Z' },
      lastGoodDataWithheld: true,
    })
    expect(renderFigures(afterQuota, lang)).toContain(copy.withheld_note)
  })

  it('shows no value line when either owner figure is missing', () => {
    for (const owner of [
      { leadValue: null, closeRate: '0.25' },
      { leadValue: '800', closeRate: null },
      { leadValue: null, closeRate: null },
      { leadValue: '', closeRate: '0.25' },
    ]) {
      const markup = renderFigures(figures({ owner }), lang)
      expect(markup).not.toContain(copy.value_uses_your_figures)
      expect(markup).not.toContain('HK$')
    }
  })

  it('labels the value line as using the owner figures', () => {
    expect(renderFigures(figures(), lang)).toContain(copy.value_uses_your_figures)
  })

  it('shows a real HK$0 for a 0 lead value', () => {
    expect(renderFigures(figures({ owner: { leadValue: '0', closeRate: '0.25' } }), lang)).toContain('HK$0')
  })
})

it('computes the value line as count x close rate x lead value: HK$7,400 for 37 / 800 / 0.25 in en', () => {
  expect(renderFigures(figures(), 'en')).toContain('HK$7,400')
})

it('never calls the observed figures an estimate', () => {
  const markup = renderFigures(figures({ lastGoodDataWithheld: true }), 'en')
  expect(markup).not.toMatch(/estimat/i)
  expect(en.analytics.observed_heading).toBe('Observed enquiries')
})

it('the withheld note says the counts are a lower bound, not that data is hidden', () => {
  expect(en.analytics.withheld_note).toMatch(/lower than actual/)
})

const webStream: PickerStream = {
  streamId: '111', displayName: 'Main site', defaultUri: 'https://example.com', verdict: { eligible: true, host: 'example.com' },
}
const otherStream: PickerStream = {
  streamId: '222', displayName: 'Shop', defaultUri: 'https://shop.example.com', verdict: { eligible: false, reason: 'other_domain' },
}
// What an app stream looks like if one ever reached the client: no site URL, a non-web type.
const appStream = {
  streamId: '333', displayName: 'iOS app', defaultUri: '', type: 'IOS_APP_DATA_STREAM',
  verdict: { eligible: false, reason: 'invalid_uri' },
} as PickerStream

describe('showsObservedFigures', () => {
  it('shows the figures whenever a good run dated them, zeros included', () => {
    expect(showsObservedFigures(figures())).toBe(true)
    expect(showsObservedFigures(figures({
      last28: { total: 0, bySource: { organic_search: 0, ai_assistant: 0, other: 0 }, byEvent: [] },
    }))).toBe(true)
  })

  it('hides them with no panel, or with no good run, whatever counts came back', () => {
    expect(showsObservedFigures(null)).toBe(false)
    expect(showsObservedFigures(figures({ lastGoodDataThrough: null }))).toBe(false)
    expect(showsObservedFigures(figures({ lastGoodDataThrough: null, last28: null }))).toBe(false)
  })
})

describe('offeredStreams', () => {
  it('drops anything that is not a web stream with a site URL', () => {
    expect(offeredStreams([webStream, appStream, otherStream]).map(s => s.streamId)).toEqual(['111', '222'])
  })
})

describe.each(LANGS)('StreamList and StreamRow (%s)', lang => {
  const copy = copyOf(lang)
  const list = (selected: string | null = null, disabled = false) => decode(renderToStaticMarkup(
    <StreamList streams={[webStream, appStream, otherStream]} selected={selected} onSelect={() => {}} disabled={disabled} lang={lang} />,
  ))

  it('never renders an app stream', () => {
    const markup = list()
    expect(markup).not.toContain('iOS app')
    expect(markup).not.toContain('333')
    expect(markup).toContain('Main site')
  })

  it('offers an eligible stream with a touch-sized, stream-specific control', () => {
    const markup = list()
    expect(markup).toContain(`aria-label="${copy.use_stream}: Main site (https://example.com)"`)
    expect(markup).toMatch(/<button [^>]*min-h-11/)
    expect(markup).toContain('aria-pressed="false"')
  })

  it('shows the reason instead of a control for an ineligible stream', () => {
    const markup = decode(renderToStaticMarkup(
      <StreamRow stream={otherStream} selected={false} onSelect={() => {}} disabled={false} lang={lang} />,
    ))
    expect(markup).not.toContain('<button')
    expect(markup).toContain(copy.ineligible_other_domain)
  })

  it('marks the chosen stream and disables controls while busy', () => {
    expect(list('111')).toContain('aria-pressed="true"')
    expect(list(null, true)).toContain('disabled=""')
  })

  it('says so when no stream in the property matches the brand', () => {
    const markup = decode(renderToStaticMarkup(
      <StreamList streams={[otherStream, appStream]} selected={null} onSelect={() => {}} disabled={false} lang={lang} />,
    ))
    expect(markup).toContain(copy.no_eligible_streams)
  })
})

describe('EventChoice (language-neutral: it shows the GA4 event name as spelled)', () => {
  const render = (checked: boolean, disabled: boolean) => renderToStaticMarkup(
    <EventChoice eventName="generate_lead" checked={checked} onToggle={() => {}} disabled={disabled} />,
  )

  it('is a labelled, touch-sized checkbox named by the GA4 event', () => {
    const markup = render(false, false)
    expect(markup).toContain('type="checkbox"')
    expect(markup).toContain('generate_lead')
    expect(markup).toMatch(/<label [^>]*min-h-11/)
    expect(markup).not.toContain('checked=""')
    expect(markup).not.toContain('disabled=""')
  })

  it('reflects checked and disabled', () => {
    const markup = render(true, true)
    expect(markup).toContain('checked=""')
    expect(markup).toContain('disabled=""')
  })
})

describe.each(LANGS)('PropertyRow (%s)', lang => {
  const copy = copyOf(lang)
  it('gives each property a distinct accessible name', () => {
    const a = renderToStaticMarkup(<PropertyRow property={{ propertyId: '1', displayName: 'Brand A' }} onChoose={() => {}} pending={false} disabled={false} lang={lang} />)
    const b = renderToStaticMarkup(<PropertyRow property={{ propertyId: '2', displayName: 'Brand B' }} onChoose={() => {}} pending={false} disabled={false} lang={lang} />)
    const name = (m: string) => decode(m.match(/aria-label="([^"]*)"/)?.[1] ?? '')
    expect(name(a)).toBe(`${copy.open_property}: Brand A (1)`)
    expect(name(a)).not.toBe(name(b))
    expect(a).toContain('min-h-11')
  })

  it('shows the pending label and disables while loading', () => {
    const markup = renderToStaticMarkup(<PropertyRow property={{ propertyId: '1', displayName: 'Brand A' }} onChoose={() => {}} pending disabled lang={lang} />)
    expect(decode(markup)).toContain(copy.loading)
    expect(markup).toContain('disabled=""')
  })
})

/**
 * Every reason the route can put in `{error:'GOOGLE'|'INELIGIBLE', reason}` or
 * in `properties[].error`. The maps are typed `Record<Reason, …>` over the
 * route's own unions (AnalyticsFailure | TokenFailure, and StreamReason plus
 * the route's two literals), so a new member fails typecheck until it has copy;
 * this anchored list catches the maps shrinking.
 */
describe('reason vocabulary', () => {
  it('maps every Google reason the route can emit', () => {
    expect(Object.keys(GOOGLE_REASON_COPY).sort()).toEqual([
      'access_lost', 'config_error', 'deferred', 'google_unavailable', 'misconfigured', 'quota',
      'revoked', 'scope_missing', 'unavailable', 'vault_error',
    ])
  })

  it('maps every ineligibility reason the route can emit', () => {
    expect(Object.keys(INELIGIBLE_REASON_COPY).sort()).toEqual([
      'invalid_uri', 'no_domain', 'not_key_event', 'not_visible', 'other_domain',
    ])
  })

  it('folds the misconfigured reasons and our own vault failure into one generic copy', () => {
    expect(GOOGLE_REASON_COPY.config_error).toBe(GOOGLE_REASON_COPY.misconfigured)
    expect(GOOGLE_REASON_COPY.vault_error).toBe(GOOGLE_REASON_COPY.misconfigured)
  })

  it.each(LANGS)('has copy for every reason in %s', lang => {
    const copy = copyOf(lang)
    for (const key of [...Object.values(GOOGLE_REASON_COPY), ...Object.values(INELIGIBLE_REASON_COPY), 'error_generic']) {
      expect(copy[key]?.trim().length, key).toBeGreaterThan(0)
    }
  })

  it('translates the reasons into Traditional Chinese, not English', () => {
    const copy = copyOf('zh-HK')
    for (const key of [...Object.values(GOOGLE_REASON_COPY), ...Object.values(INELIGIBLE_REASON_COPY)]) {
      expect(copy[key]).toMatch(/[一-鿿]/)
    }
  })
})

/** Mapped by `reason`, never by HTTP status: 409, 502 and 503 all carry GOOGLE. */
describe('classifyAnalyticsError', () => {
  it.each([
    [{ error: 'GOOGLE', reason: 'revoked' }, 'error_revoked'],
    [{ error: 'GOOGLE', reason: 'scope_missing' }, 'error_scope_missing'],
    [{ error: 'GOOGLE', reason: 'access_lost' }, 'error_access_lost'],
    [{ error: 'GOOGLE', reason: 'quota' }, 'error_retry'],
    [{ error: 'GOOGLE', reason: 'unavailable' }, 'error_retry'],
    [{ error: 'GOOGLE', reason: 'google_unavailable' }, 'error_retry'],
    [{ error: 'GOOGLE', reason: 'misconfigured' }, 'error_temporarily_unavailable'],
    [{ error: 'GOOGLE', reason: 'config_error' }, 'error_temporarily_unavailable'],
    [{ error: 'GOOGLE', reason: 'vault_error' }, 'error_temporarily_unavailable'],
    [{ error: 'GOOGLE', reason: 'something_new' }, 'error_generic'],
    [{ error: 'INELIGIBLE', reason: 'not_visible' }, 'ineligible_not_visible'],
    [{ error: 'INELIGIBLE', reason: 'not_key_event' }, 'ineligible_not_key_event'],
    [{ error: 'INELIGIBLE', reason: 'other_domain' }, 'ineligible_other_domain'],
    [{ error: 'INELIGIBLE', reason: 'invalid_uri' }, 'ineligible_invalid_uri'],
    [{ error: 'INELIGIBLE', reason: 'toString' }, 'error_generic'],
    [{ error: 'Not found' }, 'error_generic'],
    [{ error: 'Bind failed' }, 'error_generic'],
    [{ error: 'Lookup failed' }, 'error_generic'],
    [null, 'error_generic'],
  ] as const)('%j -> %s', (body, expected) => {
    expect(classifyAnalyticsError(body)).toBe(expected)
  })
})

describe('shouldReportWriteError', () => {
  it('reports a failure before the write succeeded, never after', () => {
    expect(shouldReportWriteError(false)).toBe(true)
    expect(shouldReportWriteError(true)).toBe(false)
  })
})

describe.each(LANGS)('WriteErrorNotice (%s)', lang => {
  it('renders the mapped copy as an alert', () => {
    const markup = decode(renderToStaticMarkup(<WriteErrorNotice copyKey="ineligible_not_key_event" lang={lang} />))
    expect(markup).toContain('role="alert"')
    expect(markup).toContain(copyOf(lang).ineligible_not_key_event)
  })
})

// The route answers 422 INELIGIBLE not_visible / not_key_event when the stream or
// an event changed in GA4 since the picker loaded; the copy says "Refresh and
// choose again", so the notice has to offer exactly that.
describe('isStaleChoiceError', () => {
  it('is true only for the two refusals that a fresh picker can fix', () => {
    expect(isStaleChoiceError('ineligible_not_visible')).toBe(true)
    expect(isStaleChoiceError('ineligible_not_key_event')).toBe(true)
    for (const key of ['ineligible_other_domain', 'error_generic', 'error_retry', 'error_revoked'] as const) {
      expect(isStaleChoiceError(key)).toBe(false)
    }
  })
})

describe.each(LANGS)('SaveErrorNotice (%s)', lang => {
  const copy = copyOf(lang)
  const render = (copyKey: Parameters<typeof SaveErrorNotice>[0]['copyKey'], disabled = false) =>
    decode(renderToStaticMarkup(<SaveErrorNotice copyKey={copyKey} lang={lang} onRefresh={() => {}} disabled={disabled} />))

  it.each(['ineligible_not_visible', 'ineligible_not_key_event'] as const)('offers a refresh control after %s', key => {
    const markup = render(key)
    expect(markup).toContain('role="alert"')
    expect(markup).toContain(copy[key])
    expect(markup).toMatch(/<button[^>]*type="button"/)
    expect(markup).toContain(copy.refresh_choices)
    expect(markup).toContain('min-h-11')
  })

  it('disables the refresh control while something is in flight', () => {
    expect(render('ineligible_not_visible', true)).toMatch(/<button[^>]*disabled=""/)
  })

  it('offers no refresh for any other failure, which a fresh picker would not fix', () => {
    const markup = render('error_generic')
    expect(markup).toContain(copy.error_generic)
    expect(markup).not.toContain('<button')
  })
})

it('names the refresh control differently in each language', () => {
  expect(zhHK.analytics.refresh_choices).not.toBe(en.analytics.refresh_choices)
  expect(en.analytics.refresh_choices).not.toMatch(/'/)
})

describe('refreshedPick', () => {
  const selection = { connectionId: CONNECTION, propertyId: '42' }
  const load = (keyEvents: string[], streams: PickerStream[] = [webStream]) =>
    ({ ok: true as const, picker: { streams, keyEvents } })

  it('keeps the selection and the chosen events that are still key events, dropping the rest', () => {
    const prev = { selection, load: load(['a', 'b']), streamId: '111', events: ['a', 'b'] }
    expect(refreshedPick(prev, selection, load(['a']))).toEqual({
      selection, load: load(['a']), streamId: '111', events: ['a'],
    })
  })

  it('keeps an events-only re-pick on its bound stream (repick_events), even if the stream is not offered', () => {
    const prev = { selection, load: load(['a']), streamId: '999', events: ['a'] }
    expect(refreshedPick(prev, selection, load(['a']), true).streamId).toBe('999')
  })

  it('drops a chosen stream that is gone, preselecting the one eligible stream left', () => {
    const prev = { selection, load: load(['a'], [webStream, { ...webStream, streamId: '555' }]), streamId: '555', events: ['a'] }
    expect(refreshedPick(prev, selection, load(['a'], [webStream, otherStream])).streamId).toBe('111')
  })

  it('keeps the selection with the failure when the reload itself fails, so its own retry shows', () => {
    const prev = { selection, load: load(['a']), streamId: '111', events: ['a'] }
    const failed = { ok: false as const, error: 'error_retry' as const }
    expect(refreshedPick(prev, selection, failed)).toEqual({ selection, load: failed, streamId: '111', events: ['a'] })
  })
})

// Unbind and save must never be in flight together: a save landing after an
// unbind would re-create the binding the owner just removed, and an unbind
// landing after a save would delete the one they just made.
describe('controlsDisabled', () => {
  const idle = { saveBusy: false, pickerBusy: false, unbindBusy: false }

  it('leaves everything enabled when nothing is in flight', () => {
    expect(controlsDisabled(idle)).toEqual({ picker: false, unbind: false })
  })

  it('disables save and the picker while an unbind is in flight', () => {
    expect(controlsDisabled({ ...idle, unbindBusy: true }).picker).toBe(true)
  })

  it('disables unbind while a save is in flight', () => {
    expect(controlsDisabled({ ...idle, saveBusy: true })).toEqual({ picker: true, unbind: true })
  })

  it('disables the picker, but not unbind, while only the picker loads', () => {
    expect(controlsDisabled({ ...idle, pickerBusy: true })).toEqual({ picker: true, unbind: false })
  })
})

describe.each(LANGS)('ConnectionErrorNotice (%s)', lang => {
  const copy = copyOf(lang)
  const render = (error: string) => decode(renderToStaticMarkup(
    <ConnectionErrorNotice email="o@example.com" connectionId={CONNECTION} error={error} clientId={CLIENT} lang={lang} />,
  ))

  it('names the login and the per-reason message', () => {
    const markup = render('quota')
    expect(markup).toContain('o@example.com')
    expect(markup).toContain(copy.error_retry)
    expect(markup).not.toContain('href=')
  })

  it('offers the analytics grant for a login without the scope', () => {
    const markup = render('scope_missing')
    expect(markup).toContain('scope=analytics')
    expect(markup).toContain(`connection=${CONNECTION}`)
  })

  it('sends a revoked login to Settings', () => {
    expect(render('revoked')).toContain(`href="/${lang}/dashboard/settings#google"`)
  })

  it('falls back to the generic copy for an unknown reason rather than a missing key', () => {
    expect(render('something_new')).toContain(copy.error_generic)
  })
})

const renderCard = (panel: AnalyticsPanel, lang: Lang) =>
  decode(renderToStaticMarkup(<ObservedEnquiriesCard panel={panel} lang={lang} clientId={CLIENT} />))

describe.each(LANGS)('ObservedEnquiriesCard (%s)', lang => {
  const copy = copyOf(lang)

  it('shows the observed figures', () => {
    const markup = text(renderCard(figures(), lang))
    expect(markup).toContain(`${copy.total_enquiries} 37`)
    expect(markup).toContain(`${copy.source_ai_assistant} 5`)
    expect(markup).toContain('generate_lead 30')
  })

  it('has exactly one heading, the Observed one, not stacked on the figures own', () => {
    const markup = renderCard(figures(), lang)
    expect(markup.match(/<h[1-6]\b/g)).toHaveLength(1)
    expect(markup.split(copy.observed_heading)).toHaveLength(2)
  })

  it('links to the assets page of this brand, where the connection is managed', () => {
    const markup = renderCard(figures(), lang)
    const anchors = [...markup.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/g)]
    expect(anchors).toHaveLength(1)
    expect(anchors[0]![1]).toBe(`/${lang}/dashboard/${CLIENT}/assets`)
    expect(anchors[0]![2]).toBe(copy.observed_assets_link)
  })

  it('gives the link a touch-size target', () => {
    expect(renderCard(figures(), lang).match(/<a\b[^>]*>/)?.[0]).toContain('min-h-11')
  })

  it('carries the owner value line through from the panel, like the figures do', () => {
    const markup = text(renderCard(figures({ owner: { leadValue: '1000', closeRate: '0.5' } }), lang))
    expect(markup).toContain(copy.value_uses_your_figures)
  })
})

it('gives the link different words in each language', () => {
  expect(copyOf('en').observed_assets_link).not.toBe(copyOf('zh-HK').observed_assets_link)
  expect(renderCard(figures(), 'en')).not.toBe(renderCard(figures(), 'zh-HK'))
})
