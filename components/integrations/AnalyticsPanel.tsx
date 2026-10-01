'use client'

import { useEffect, useState } from 'react'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'
// Type-only: store.ts is `server-only`, but a type import is erased at build,
// the same choice SearchConsolePanel makes for its store types.
import type { AnalyticsOwnerState } from '@/lib/integrations/analytics/state'
import type { AnalyticsBinding, AnalyticsPanel as PanelData } from '@/lib/integrations/analytics/store'
import type { AnalyticsFailure } from '@/lib/integrations/analytics/client'
import type { StreamReason, StreamVerdict, WebStream } from '@/lib/integrations/analytics/binding'
import type { TokenFailure } from '@/lib/integrations/google/access'
// Runtime imports, both pure and dependency-free.
import { observedValue } from '@/lib/integrations/analytics/value'
import { SOURCE_CLASSES, type SourceClass } from '@/lib/integrations/analytics/sources'

type Copy = typeof en.analytics
type CopyKey = keyof Copy
const copyFor = (lang: string): Copy => (lang === 'zh-HK' ? zhHK : en).analytics

/** GA4 caps a binding at 20 chosen events (the route and migration 055 both check it). */
const MAX_EVENTS = 20

export type PickerStream = WebStream & { verdict: StreamVerdict }
type Picker = { streams: PickerStream[]; keyEvents: string[] }
type Property = { propertyId: string; displayName: string }
type ConnectionProperties = { connectionId: string; items: Property[]; error: string | null }
type Payload = {
  state: AnalyticsOwnerState
  binding: AnalyticsBinding | null
  panel: PanelData | null
  connections: Array<{ id: string; email: string | null; hasAnalytics: boolean }>
  properties: ConnectionProperties[]
  picker: Picker | null
}

/**
 * Every reason the route puts in `{error:'GOOGLE', reason}` or `properties[].error`.
 * Typed as a Record over the route's own unions, so a new failure kind fails
 * typecheck until it has copy. Mapped by reason, never by HTTP status: the same
 * GOOGLE body arrives as 409, 502 or 503. `config_error` and `misconfigured` are
 * the two names for "our Google setup is wrong", and `vault_error` is ours despite
 * the GOOGLE label, so all three read as one "temporarily unavailable" sentence
 * that asks nothing of the owner.
 */
export type GoogleReason = AnalyticsFailure | TokenFailure
export const GOOGLE_REASON_COPY: Record<GoogleReason, CopyKey> = {
  revoked: 'error_revoked',
  scope_missing: 'error_scope_missing',
  access_lost: 'error_access_lost',
  quota: 'error_retry',
  unavailable: 'error_retry',
  google_unavailable: 'error_retry',
  // Unreachable from the route today (it never runs out of time), but in the union.
  deferred: 'error_retry',
  misconfigured: 'error_temporarily_unavailable',
  config_error: 'error_temporarily_unavailable',
  vault_error: 'error_temporarily_unavailable',
}

/** `{error:'INELIGIBLE', reason}`: a stream verdict, or the route's own two refusals. */
export type IneligibleReason = StreamReason | 'not_visible' | 'not_key_event'
export const INELIGIBLE_REASON_COPY: Record<IneligibleReason, CopyKey> = {
  no_domain: 'ineligible_no_domain',
  other_domain: 'ineligible_other_domain',
  invalid_uri: 'ineligible_invalid_uri',
  not_visible: 'ineligible_not_visible',
  not_key_event: 'ineligible_not_key_event',
}

// Own-property lookups only: a reason of "toString" must not find Object.prototype.
const lookup = (map: Record<string, CopyKey>, reason: unknown): CopyKey | null =>
  typeof reason === 'string' && Object.hasOwn(map, reason) ? map[reason]! : null

const googleCopyKey = (reason: unknown): CopyKey => lookup(GOOGLE_REASON_COPY, reason) ?? 'error_generic'

/**
 * A failed response body to one catalogue key. Pure and exported so the mapping
 * is testable without a DOM. Anything unstructured (400, 404, our own 503s, a
 * network failure) is the generic sentence: those bodies carry no reason.
 */
export function classifyAnalyticsError(body: unknown): CopyKey {
  const b = body as { error?: unknown; reason?: unknown } | null
  if (b && b.error === 'GOOGLE') return googleCopyKey(b.reason)
  if (b && b.error === 'INELIGIBLE') return lookup(INELIGIBLE_REASON_COPY, b.reason) ?? 'error_generic'
  return 'error_generic'
}

/**
 * Once the write itself succeeded, whatever fails after it (the refresh) must
 * never read as a failed save. The same invariant as SearchConsolePanel's
 * shouldReportBindError.
 */
export function shouldReportWriteError(writeSucceeded: boolean): boolean {
  return !writeSucceeded
}

/**
 * The consent flow that adds `analytics.readonly` to one existing connection,
 * returning to this brand's assets page (a path the start route's RETURN_PATH accepts).
 */
export function grantAnalyticsHref(connectionId: string, lang: string, clientId: string): string {
  const query = new URLSearchParams({
    scope: 'analytics', connection: connectionId, return: `/${lang}/dashboard/${clientId}/assets`,
  })
  return `/api/integrations/google/start?${query}`
}

const LINK = 'mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-primary underline underline-offset-4'

function SettingsLink({ lang }: { lang: string }) {
  return <a href={`/${lang}/dashboard/settings#google`} className={LINK}>{copyFor(lang).manage_in_settings}</a>
}

function GrantLink({ connectionId, lang, clientId }: { connectionId: string; lang: string; clientId: string }) {
  return <a href={grantAnalyticsHref(connectionId, lang, clientId)} className={LINK}>{copyFor(lang).grant_analytics}</a>
}

/** The states whose fix lives in Settings. */
const FIXED_IN_SETTINGS: ReadonlySet<AnalyticsOwnerState['kind']> = new Set(['reconnect', 'access_lost'])

/**
 * One sentence per owner state. The "data up to" date is ObservedFigures' to
 * show, beside the numbers it dates, so it is not repeated here.
 */
export function AnalyticsStateNotice({
  state, lang, clientId, connectionId,
}: { state: AnalyticsOwnerState; lang: string; clientId: string; connectionId: string | null }) {
  const copy = copyFor(lang)
  const sentence = copy[`state_${state.kind}`]
  if (state.kind === 'synced') return <p className="text-xs text-muted-foreground">{sentence}</p>
  return (
    <div role="status" className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-foreground">
      <p>{sentence}</p>
      {state.kind === 'grant_analytics' && connectionId && <GrantLink connectionId={connectionId} lang={lang} clientId={clientId} />}
      {FIXED_IN_SETTINGS.has(state.kind) && <SettingsLink lang={lang} />}
    </div>
  )
}

const SOURCE_COPY: Record<SourceClass, CopyKey> = {
  organic_search: 'source_organic_search',
  ai_assistant: 'source_ai_assistant',
  other: 'source_other',
}

const EMPTY_BY_SOURCE = Object.fromEntries(SOURCE_CLASSES.map(c => [c, 0])) as Record<SourceClass, number>

function money(value: number, lang: string): string {
  return new Intl.NumberFormat(lang, { style: 'currency', currency: 'HKD', maximumFractionDigits: 0 }).format(value)
}

/**
 * The observed figures for one brand, with no effects, so they render anywhere
 * (this panel, and Task 17's card beside the Local Trust scenario). Carries its
 * own `observed_heading`, so a wrapper should not add a second one.
 *
 * Rendered only once a good run dated the figures (showsObservedFigures), so a
 * `last28` of zeros is shown as zeros (a null one, never expected then, too).
 * The value line comes only from the owner's own figures via observedValue,
 * which returns null when either is missing: nothing here does its own
 * arithmetic. `lastGoodDataWithheld` is the flag of the run that produced these
 * figures, not of the newest run: GA4 thresholded or pooled rows, or the report
 * hit its page cap, so the counts are a lower bound and the note says exactly that.
 */
export function ObservedFigures({
  panel, lang,
}: { panel: Pick<PanelData, 'lastGoodDataThrough' | 'lastGoodDataWithheld' | 'last28' | 'owner'>; lang: string }) {
  const copy = copyFor(lang)
  const total = panel.last28?.total ?? 0
  const bySource = panel.last28?.bySource ?? EMPTY_BY_SOURCE
  const byEvent = panel.last28?.byEvent ?? []
  const value = observedValue(total, panel.owner)
  return (
    <div className="mt-4">
      <h3 className="text-base font-semibold text-foreground">{copy.observed_heading}</h3>
      <table className="mt-2 w-full text-sm">
        <tbody>
          <tr>
            <th scope="row" className="py-2 pr-3 text-left font-semibold">{copy.total_enquiries}</th>
            <td className="text-right text-lg font-bold">{total}</td>
          </tr>
          <tr className="border-t border-border">
            <th scope="rowgroup" colSpan={2} className="pt-3 text-left text-xs font-semibold uppercase text-muted-foreground">{copy.by_source}</th>
          </tr>
          {SOURCE_CLASSES.map(c => (
            <tr key={c}>
              <th scope="row" className="py-1 pr-3 text-left font-normal">{copy[SOURCE_COPY[c]]}</th>
              <td className="text-right">{bySource[c] ?? 0}</td>
            </tr>
          ))}
          {byEvent.length > 0 && (
            <tr className="border-t border-border">
              <th scope="rowgroup" colSpan={2} className="pt-3 text-left text-xs font-semibold uppercase text-muted-foreground">{copy.by_event}</th>
            </tr>
          )}
          {byEvent.map(e => (
            <tr key={e.eventName}>
              <th scope="row" className="break-all py-1 pr-3 text-left font-normal">{e.eventName}</th>
              <td className="text-right">{e.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {value !== null && (
        <div className="mt-3 text-sm text-foreground">
          <p className="font-semibold">{copy.value_line.replace('{value}', money(value, lang))}</p>
          <p className="text-xs text-muted-foreground">{copy.value_uses_your_figures}</p>
        </div>
      )}
      {panel.lastGoodDataWithheld && <p role="note" className="mt-3 text-xs text-foreground">{copy.withheld_note}</p>}
      {/* The ISO date as sent, like SearchConsoleStateNotice: per-locale formatting would diverge between server and client. */}
      {panel.lastGoodDataThrough && (
        <p className="mt-1 text-xs text-muted-foreground">{copy.data_through.replace('{date}', panel.lastGoodDataThrough)}</p>
      )}
    </div>
  )
}

/**
 * Whether the observed figures are shown: exactly when a good run of the current
 * binding dated them. An `ok` run records the window end it asked for even when
 * GA4 returned no rows, so a zero total here is a real "0 observed enquiries",
 * and a panel with no good run (whatever counts came back) is "nothing yet".
 * loadObservedPanel applies the same test for the dashboard card.
 */
export function showsObservedFigures(panel: Pick<PanelData, 'lastGoodDataThrough'> | null): boolean {
  return panel !== null && panel.lastGoodDataThrough !== null
}

/**
 * Only web streams with a site URL are ever offered. The route already lists web
 * streams alone; this is the client's own guard, so an app stream (no site URL,
 * a non-web `type`) can never be rendered or chosen even if one arrived.
 */
export function offeredStreams(streams: PickerStream[]): PickerStream[] {
  return streams.filter(s => {
    const type = (s as { type?: unknown }).type
    return typeof s.defaultUri === 'string' && s.defaultUri !== '' && (type === undefined || type === 'WEB_DATA_STREAM')
  })
}

export function StreamRow({
  stream, selected, onSelect, disabled, lang,
}: { stream: PickerStream; selected: boolean; onSelect: () => void; disabled: boolean; lang: string }) {
  const copy = copyFor(lang)
  const name = stream.displayName ? `${stream.displayName} (${stream.defaultUri})` : stream.defaultUri
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="min-w-0 text-sm text-foreground">
        {stream.displayName && <span className="block font-medium">{stream.displayName}</span>}
        <span className="block break-all text-xs text-muted-foreground">{stream.defaultUri}</span>
      </span>
      {stream.verdict.eligible ? (
        <button
          type="button"
          onClick={onSelect}
          disabled={disabled}
          aria-pressed={selected}
          aria-label={`${copy.use_stream}: ${name}`}
          className={`min-h-11 shrink-0 rounded-lg px-4 text-sm font-semibold disabled:opacity-60 ${
            selected ? 'bg-primary text-primary-foreground' : 'border border-border text-foreground'
          }`}
        >
          {selected ? copy.stream_selected : copy.use_stream}
        </button>
      ) : (
        <span className="shrink-0 text-xs text-muted-foreground">{copy[INELIGIBLE_REASON_COPY[stream.verdict.reason]]}</span>
      )}
    </div>
  )
}

export function StreamList({
  streams, selected, onSelect, disabled, lang,
}: { streams: PickerStream[]; selected: string | null; onSelect: (streamId: string) => void; disabled: boolean; lang: string }) {
  const offered = offeredStreams(streams)
  return (
    <div className="space-y-2">
      {!offered.some(s => s.verdict.eligible) && (
        <p className="text-sm text-muted-foreground">{copyFor(lang).no_eligible_streams}</p>
      )}
      {offered.map(s => (
        <StreamRow
          key={s.streamId}
          stream={s}
          selected={selected === s.streamId}
          onSelect={() => onSelect(s.streamId)}
          disabled={disabled}
          lang={lang}
        />
      ))}
    </div>
  )
}

/** One key event as a checkbox, named by GA4's own (case-sensitive) spelling. */
export function EventChoice({
  eventName, checked, onToggle, disabled,
}: { eventName: string; checked: boolean; onToggle: () => void; disabled: boolean }) {
  return (
    <label className="flex min-h-11 items-center gap-3 text-sm text-foreground">
      <input type="checkbox" checked={checked} onChange={onToggle} disabled={disabled} className="h-5 w-5 shrink-0" />
      <span className="break-all">{eventName}</span>
    </label>
  )
}

export function PropertyRow({
  property, onChoose, pending, disabled, lang,
}: { property: Property; onChoose: () => void; pending: boolean; disabled: boolean; lang: string }) {
  const copy = copyFor(lang)
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="min-w-0 break-all text-sm text-foreground">
        {property.displayName} <span className="text-xs text-muted-foreground">({property.propertyId})</span>
      </span>
      <button
        type="button"
        onClick={onChoose}
        disabled={disabled}
        aria-label={`${copy.open_property}: ${property.displayName} (${property.propertyId})`}
        className="min-h-11 shrink-0 rounded-lg border border-border px-4 text-sm disabled:opacity-60"
      >
        {pending ? copy.loading : copy.open_property}
      </button>
    </div>
  )
}

/** One connection whose own Google listing failed; the others are still offered. */
export function ConnectionErrorNotice({
  email, connectionId, error, clientId, lang,
}: { email: string | null; connectionId: string; error: string | null; clientId: string; lang: string }) {
  const copy = copyFor(lang)
  const line = copy.connection_error.replace('{email}', email ?? '—').replace('{message}', copy[googleCopyKey(error)])
  return (
    <div role="alert" className="text-sm text-foreground">
      <p>{line}</p>
      {error === 'scope_missing' && <GrantLink connectionId={connectionId} lang={lang} clientId={clientId} />}
      {(error === 'revoked' || error === 'access_lost') && <SettingsLink lang={lang} />}
    </div>
  )
}

export function WriteErrorNotice({ copyKey, lang }: { copyKey: CopyKey; lang: string }) {
  return <p role="alert" className="mt-2 text-sm font-medium text-destructive">{copyFor(lang)[copyKey]}</p>
}

/**
 * The two save refusals a fresh picker fixes: the chosen stream left the property,
 * or a chosen event stopped being a key event, since the picker loaded. Their copy
 * says "Refresh and choose again", so the notice offers exactly that control.
 */
const STALE_CHOICE: ReadonlySet<CopyKey> = new Set(['ineligible_not_visible', 'ineligible_not_key_event'])

export function isStaleChoiceError(copyKey: CopyKey): boolean {
  return STALE_CHOICE.has(copyKey)
}

/** A failed save; for a stale choice, with a control that reloads the picker for the same selection. */
export function SaveErrorNotice({
  copyKey, lang, onRefresh, disabled,
}: { copyKey: CopyKey; lang: string; onRefresh: () => void; disabled: boolean }) {
  if (!isStaleChoiceError(copyKey)) return <WriteErrorNotice copyKey={copyKey} lang={lang} />
  const copy = copyFor(lang)
  return (
    <div role="alert" className="mt-2 flex flex-wrap items-center justify-between gap-3 text-sm">
      <p className="font-medium text-destructive">{copy[copyKey]}</p>
      <button
        type="button"
        onClick={onRefresh}
        disabled={disabled}
        className="min-h-11 shrink-0 rounded-lg border border-border px-3 text-sm disabled:opacity-60"
      >
        {copy.refresh_choices}
      </button>
    </div>
  )
}

/**
 * What stays disabled while something is in flight. Unbind and save are never in
 * flight together: a save landing after an unbind would re-create the binding the
 * owner just removed, and an unbind landing after a save would delete the one
 * they just made. A picker load disables the picker and save, not unbind.
 */
export function controlsDisabled(s: { saveBusy: boolean; pickerBusy: boolean; unbindBusy: boolean }): { picker: boolean; unbind: boolean } {
  return { picker: s.saveBusy || s.pickerBusy || s.unbindBusy, unbind: s.unbindBusy || s.saveBusy }
}

function RetryNotice({ message, lang, onRetry }: { message: string; lang: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 text-sm text-foreground">
      <p>{message}</p>
      <button type="button" onClick={onRetry} className="min-h-11 shrink-0 rounded-lg border border-border px-3 text-sm">
        {copyFor(lang).retry}
      </button>
    </div>
  )
}

type PickerLoad = { ok: true; picker: Picker } | { ok: false; error: CopyKey }
type Loaded = { payload: Payload | null; propertiesFailed: boolean; picker: PickerLoad | null }

const apiPath = (clientId: string) => `/api/dashboard/clients/${clientId}/analytics`

async function fetchPicker(clientId: string, connectionId: string, propertyId: string): Promise<PickerLoad> {
  const query = new URLSearchParams({ property: propertyId, connection: connectionId })
  const res = await fetch(`${apiPath(clientId)}?${query}`)
  const body = await res.json().catch(() => null) as Payload | null
  if (!res.ok) return { ok: false, error: classifyAnalyticsError(body) }
  return body?.picker ? { ok: true, picker: body.picker } : { ok: false, error: 'error_generic' }
}

/**
 * setState-free for the reason SearchConsolePanel's fetchPanel is: the effect
 * below calls it synchronously. Google is called only when the owner has
 * something to choose: the property list for `unbound` / `rebind`, and for
 * `repick_events` the bound property's events directly. The route's events-only
 * PUT keeps the stored connection and property, so offering other properties
 * there would be a control that does not do what it shows.
 */
async function fetchPanel(clientId: string): Promise<Loaded> {
  const res = await fetch(apiPath(clientId))
  if (!res.ok) return { payload: null, propertiesFailed: false, picker: null }
  const payload = await res.json() as Payload
  let propertiesFailed = false
  let picker: PickerLoad | null = null
  if (payload.state.kind === 'unbound' || payload.state.kind === 'rebind') {
    const withProperties = await fetch(`${apiPath(clientId)}?properties=1`)
    if (withProperties.ok) payload.properties = ((await withProperties.json()) as Payload).properties
    else propertiesFailed = true
  } else if (payload.state.kind === 'repick_events' && payload.binding) {
    picker = await fetchPicker(clientId, payload.binding.connectionId, payload.binding.propertyId)
  }
  return { payload, propertiesFailed, picker }
}

export type Selection = { connectionId: string; propertyId: string }
export type PickState = { selection: Selection | null; load: PickerLoad | null; streamId: string | null; events: string[] }
type View = { status: 'loading' } | { status: 'failed' } | { status: 'ready'; data: Payload; propertiesFailed: boolean }

const EMPTY_PICK: PickState = { selection: null, load: null, streamId: null, events: [] }

/** A lone eligible stream is preselected; with several, the owner chooses. */
function onlyEligible(load: PickerLoad | null): string | null {
  if (!load?.ok) return null
  const eligible = offeredStreams(load.picker.streams).filter(s => s.verdict.eligible)
  return eligible.length === 1 ? eligible[0]!.streamId : null
}

/**
 * The picker reloaded for the SAME selection after a stale-choice refusal. Unlike
 * opening a property afresh, it keeps what the owner chose where GA4 still has
 * it: the chosen events that are still key events, and the chosen stream if it is
 * still offered and eligible (else the lone eligible one, as on open). An
 * events-only re-pick (repick_events) keeps its bound stream, which that PUT never
 * sends. A failed reload keeps the choices beside the failure, whose own retry shows.
 */
export function refreshedPick(prev: PickState, selection: Selection, load: PickerLoad, eventsOnly = false): PickState {
  if (!load.ok) return { ...prev, selection, load }
  const live = new Set(load.picker.keyEvents)
  const kept = offeredStreams(load.picker.streams).some(s => s.streamId === prev.streamId && s.verdict.eligible)
  return {
    selection,
    load,
    streamId: eventsOnly || kept ? prev.streamId : onlyEligible(load),
    events: prev.events.filter(e => live.has(e)),
  }
}

// Pure, outside the component, so the mount effect and reload() share them
// without either becoming an effect dependency.
function viewFrom(result: Loaded): View {
  return result.payload ? { status: 'ready', data: result.payload, propertiesFailed: result.propertiesFailed } : { status: 'failed' }
}

function pickFrom(result: Loaded): PickState {
  const binding = result.payload?.binding
  if (result.payload?.state.kind !== 'repick_events' || !binding) return EMPTY_PICK
  const live = result.picker?.ok ? new Set(result.picker.picker.keyEvents) : new Set<string>()
  return {
    selection: { connectionId: binding.connectionId, propertyId: binding.propertyId },
    load: result.picker,
    streamId: binding.streamId,
    events: binding.keyEvents.filter(e => live.has(e)),
  }
}

export function AnalyticsPanel({ clientId, lang }: { clientId: string; lang: string }) {
  const copy = copyFor(lang)
  const [view, setView] = useState<View>({ status: 'loading' })
  const [pick, setPick] = useState<PickState>(EMPTY_PICK)
  const [pickerBusy, setPickerBusy] = useState<string | null>(null)
  const [saveBusy, setSaveBusy] = useState(false)
  const [saveError, setSaveError] = useState<CopyKey | null>(null)
  const [unbindBusy, setUnbindBusy] = useState(false)
  const [unbindError, setUnbindError] = useState(false)

  useEffect(() => {
    // Setters in the resolved callback, not the effect body (see fetchPanel).
    fetchPanel(clientId).then(result => {
      setView(viewFrom(result))
      setPick(pickFrom(result))
    }).catch(() => setView({ status: 'failed' }))
  }, [clientId])

  /** Exception-safe: a thrown refresh becomes the failed panel, never a write error. */
  async function reload() {
    try {
      const result = await fetchPanel(clientId)
      setView(viewFrom(result))
      setPick(pickFrom(result))
    } catch {
      setView({ status: 'failed' })
    }
  }

  async function openProperty(selection: Selection) {
    setPickerBusy(`${selection.connectionId}:${selection.propertyId}`)
    setSaveError(null)
    let load: PickerLoad
    try {
      load = await fetchPicker(clientId, selection.connectionId, selection.propertyId)
    } catch {
      load = { ok: false, error: 'error_generic' }
    }
    setPick({ selection, load, streamId: onlyEligible(load), events: [] })
    setPickerBusy(null)
  }

  /** After a stale-choice refusal: the same selection's streams and events, fetched again. */
  async function refreshPicker(eventsOnly: boolean) {
    const selection = pick.selection
    if (!selection) return
    setPickerBusy(`${selection.connectionId}:${selection.propertyId}`)
    setSaveError(null)
    let load: PickerLoad
    try {
      load = await fetchPicker(clientId, selection.connectionId, selection.propertyId)
    } catch {
      load = { ok: false, error: 'error_generic' }
    }
    setPick(p => refreshedPick(p, selection, load, eventsOnly))
    setPickerBusy(null)
  }

  function toggleEvent(name: string) {
    setPick(p => ({
      ...p,
      events: p.events.includes(name) ? p.events.filter(e => e !== name)
        : p.events.length >= MAX_EVENTS ? p.events : [...p.events, name],
    }))
  }

  async function save(eventsOnly: boolean) {
    // The buttons are disabled too (controlsDisabled); this also covers a stale click.
    if (!pick.selection || unbindBusy) return
    setSaveBusy(true)
    setSaveError(null)
    const body = eventsOnly
      ? { keyEvents: pick.events }
      : { ...pick.selection, streamId: pick.streamId, keyEvents: pick.events }
    let writeSucceeded = false
    try {
      const res = await fetch(apiPath(clientId), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        setSaveError(classifyAnalyticsError(await res.json().catch(() => null)))
        return
      }
      writeSucceeded = true
      await reload()
    } catch {
      if (shouldReportWriteError(writeSucceeded)) setSaveError('error_generic')
    } finally {
      setSaveBusy(false)
    }
  }

  async function unbind() {
    if (saveBusy) return
    setUnbindBusy(true)
    setUnbindError(false)
    let writeSucceeded = false
    try {
      const res = await fetch(apiPath(clientId), { method: 'DELETE' })
      if (!res.ok) { setUnbindError(true); return }
      writeSucceeded = true
      await reload()
    } catch {
      if (shouldReportWriteError(writeSucceeded)) setUnbindError(true)
    } finally {
      setUnbindBusy(false)
    }
  }

  if (view.status === 'failed') return <p className="text-sm text-muted-foreground">{copy.state_temporarily_unavailable}</p>
  if (view.status === 'loading') return null
  const { data, propertiesFailed } = view

  const kind = data.state.kind
  const choosingProperty = kind === 'unbound' || kind === 'rebind'
  const eventsOnly = kind === 'repick_events'
  const okConnections = data.properties.filter(c => c.error === null)
  const erroredConnections = data.properties.filter(c => c.error !== null)
  const emailFor = (id: string) => data.connections.find(c => c.id === id)?.email ?? null
  const noConnection = choosingProperty && !propertiesFailed && data.connections.length === 0
  const noProperties = choosingProperty && !propertiesFailed && data.connections.length > 0
    && erroredConnections.length === 0 && okConnections.every(c => c.items.length === 0)
  const panel = data.panel
  const showFigures = showsObservedFigures(panel)
  const disabled = controlsDisabled({ saveBusy, pickerBusy: pickerBusy !== null, unbindBusy })
  const busy = disabled.picker
  const loaded = pick.load?.ok ? pick.load.picker : null
  const chosenStream = loaded ? offeredStreams(loaded.streams).find(s => s.streamId === pick.streamId) : undefined
  const canSave = !busy && pick.events.length > 0 && (eventsOnly || chosenStream?.verdict.eligible === true)

  return (
    <section className="mt-8 rounded-xl border border-border bg-card p-6 shadow-sm">
      <h2 className="text-lg font-bold text-foreground">{copy.panel_title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{copy.panel_caption}</p>
      <div className="mt-4">
        <AnalyticsStateNotice state={data.state} lang={lang} clientId={clientId} connectionId={data.binding?.connectionId ?? null} />
      </div>

      {choosingProperty && (
        <div className="mt-4 space-y-3">
          <h3 className="text-sm font-semibold text-foreground">{copy.choose_property}</h3>
          {propertiesFailed && <RetryNotice message={copy.properties_load_failed} lang={lang} onRetry={() => void reload()} />}
          {erroredConnections.map(c => (
            <ConnectionErrorNotice
              key={c.connectionId}
              email={emailFor(c.connectionId)}
              connectionId={c.connectionId}
              error={c.error}
              clientId={clientId}
              lang={lang}
            />
          ))}
          {noConnection && (
            <div className="text-sm text-muted-foreground"><p>{copy.no_connection}</p><SettingsLink lang={lang} /></div>
          )}
          {noProperties && <p className="text-sm text-muted-foreground">{copy.no_properties}</p>}
          {okConnections.flatMap(c => c.items.map(property => {
            const key = `${c.connectionId}:${property.propertyId}`
            return (
              <PropertyRow
                key={key}
                property={property}
                onChoose={() => void openProperty({ connectionId: c.connectionId, propertyId: property.propertyId })}
                pending={pickerBusy === key}
                disabled={busy}
                lang={lang}
              />
            )
          }))}
        </div>
      )}

      {(choosingProperty || eventsOnly) && pick.selection && pick.load && (
        <div className="mt-6 space-y-3 border-t border-border pt-4">
          {!pick.load.ok && (
            <RetryNotice message={copy[pick.load.error]} lang={lang} onRetry={() => void openProperty(pick.selection!)} />
          )}
          {loaded && !eventsOnly && (
            <>
              <h3 className="text-sm font-semibold text-foreground">{copy.choose_stream}</h3>
              <StreamList
                streams={loaded.streams}
                selected={pick.streamId}
                onSelect={streamId => setPick(p => ({ ...p, streamId }))}
                disabled={busy}
                lang={lang}
              />
            </>
          )}
          {loaded && (
            <>
              <h3 className="text-sm font-semibold text-foreground">{copy.choose_events}</h3>
              {loaded.keyEvents.length === 0 ? (
                <p className="text-sm text-muted-foreground">{copy.no_key_events}</p>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">{copy.events_help}</p>
                  {loaded.keyEvents.map(name => {
                    const checked = pick.events.includes(name)
                    return (
                      <EventChoice
                        key={name}
                        eventName={name}
                        checked={checked}
                        onToggle={() => toggleEvent(name)}
                        disabled={busy || (!checked && pick.events.length >= MAX_EVENTS)}
                      />
                    )
                  })}
                </>
              )}
              {saveError && (
                <SaveErrorNotice
                  copyKey={saveError}
                  lang={lang}
                  onRefresh={() => void refreshPicker(eventsOnly)}
                  disabled={busy}
                />
              )}
              <button
                type="button"
                onClick={() => void save(eventsOnly)}
                disabled={!canSave}
                className="min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                {saveBusy ? copy.saving : eventsOnly ? copy.save_events : copy.save}
              </button>
            </>
          )}
        </div>
      )}

      {showFigures && panel && <ObservedFigures panel={panel} lang={lang} />}

      {data.binding && (
        <div className="mt-6 border-t border-border pt-4">
          <button
            type="button"
            onClick={() => void unbind()}
            disabled={disabled.unbind}
            className="min-h-11 rounded-lg border border-border px-4 text-sm disabled:opacity-60"
          >
            {unbindBusy ? copy.unbinding : copy.unbind}
          </button>
          {unbindError && <p role="alert" className="mt-2 text-sm font-medium text-destructive">{copy.unbind_error}</p>}
        </div>
      )}
    </section>
  )
}
