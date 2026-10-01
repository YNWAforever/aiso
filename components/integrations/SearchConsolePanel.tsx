'use client'

import { useEffect, useState } from 'react'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'
import type { OwnerState } from '@/lib/integrations/search-console/state'
import type { MetricTotals, PanelData } from '@/lib/integrations/search-console/store'
// Type-only: both modules are pure (no `server-only`, no DB/env access), and
// a type-only import is erased at build regardless, so re-declaring these
// shapes locally would only be redundant, not safer.
import type { BindingVerdict } from '@/lib/integrations/search-console/binding'
import type { SiteEntry } from '@/lib/integrations/search-console/client'

type Copy = typeof en.searchConsole
export type Verdict = BindingVerdict
export type Site = SiteEntry & { verdict: Verdict }
// A connection's own Google call can fail independently of the others (expired
// token, quota, misconfiguration): its `sites` come back empty and `error`
// carries the failure kind, so that one connection's properties are shown as
// unavailable rather than failing the whole picker.
type ConnectionProperties = { connectionId: string; googleEmail: string | null; sites: Site[]; error: string | null }
type Payload = { state: OwnerState; panel: PanelData; properties: ConnectionProperties[] }

const copyFor = (lang: string): Copy => (lang === 'zh-HK' ? zhHK : en).searchConsole
const pct = (n: number) => `${(n * 100).toFixed(1)}%`

// Deliberately setState-free (same idiom as app/admin/page.tsx's fetchAccounts):
// eslint's react-hooks/set-state-in-effect rule flags any function reachable
// from an effect body that itself calls a setState setter, even one only
// reached after an await, so the fetch stays a pure read and every caller
// (the mount effect below, bind()'s post-write refetch, and the retry button)
// sets state itself.
//
// `propertiesFailed` is carried alongside the payload, not folded into
// `failed`: the whole-panel state and metrics table loaded fine, only the
// second (`?properties=1`) request did not, so the picker must say so
// distinctly rather than rendering "zero eligible properties" — which would
// read as a true fact about the account rather than a fetch that failed.
async function fetchPanel(clientId: string): Promise<{ payload: Payload | null; propertiesFailed: boolean }> {
  const res = await fetch(`/api/dashboard/clients/${clientId}/search-console`)
  if (!res.ok) return { payload: null, propertiesFailed: false }
  const payload = await res.json() as Payload
  // The route only calls Google, and returns a populated `properties` list,
  // when asked with `?properties=1` — the dashboard's default load must not
  // trigger a Google call on every visit. The picker only ever needs that
  // list while the brand has no eligible binding yet.
  let propertiesFailed = false
  if (payload.state.kind === 'unbound' || payload.state.kind === 'rebind') {
    const withProperties = await fetch(`/api/dashboard/clients/${clientId}/search-console?properties=1`)
    if (withProperties.ok) payload.properties = ((await withProperties.json()) as Payload).properties
    else propertiesFailed = true
  }
  return { payload, propertiesFailed }
}

/**
 * Where an owner fixes a Google login: the Settings page's connections panel
 * (GoogleConnectionsPanel, section id "google"). A plain anchor, the same
 * choice GoogleConnectionsPanel makes for its connect link.
 */
function SettingsLink({ lang }: { lang: string }) {
  const copy = copyFor(lang)
  return (
    <a
      href={`/${lang}/dashboard/settings#google`}
      className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-primary underline underline-offset-4"
    >
      {copy.manage_in_settings}
    </a>
  )
}

/** The states whose fix lives in Settings; every other one is not the owner's to act on there. */
const FIXED_IN_SETTINGS: ReadonlySet<OwnerState['kind']> = new Set(['reconnect', 'access_lost'])

export function SearchConsoleStateNotice({ state, lang }: { state: OwnerState; lang: string }) {
  const copy = copyFor(lang)
  // `dataThrough` is rendered as the plain ISO string the server sent, the
  // same choice MembersPanel makes for its invitation dates: formatting it
  // per locale here would make the server and client render different text
  // and that hydration mismatch is not worth a nicer date.
  const through = 'dataThrough' in state && state.dataThrough
    ? <p className="mt-1 text-xs text-muted-foreground">{copy.data_through.replace('{date}', state.dataThrough)}</p>
    : null
  if (state.kind === 'synced') return through
  return (
    <div role="status" className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-foreground">
      <p>{copy[`state_${state.kind}`]}</p>
      {through}
      {FIXED_IN_SETTINGS.has(state.kind) && <SettingsLink lang={lang} />}
    </div>
  )
}

/**
 * Maps the PUT route's failure body (app/api/dashboard/clients/[clientId]/search-console/route.ts)
 * to one of a small set of catalogue keys. Pure and exported so the mapping is
 * testable without a DOM: `{error:'GOOGLE',reason:'revoked'}` -> revoked (409),
 * any other `{error:'GOOGLE',reason}` -> google (503, misconfigured/unavailable/
 * quota/forbidden), `{error:'INELIGIBLE',reason}` -> ineligible (422, covers the
 * binding-eligibility reasons and the route's own 'not_visible' race), anything
 * else (400/404/503 with no structured reason, or a network failure) -> generic.
 */
export type BindErrorKind = 'ineligible' | 'revoked' | 'google' | 'generic'

export function classifyBindError(status: number, body: unknown): BindErrorKind {
  const b = body as { error?: unknown; reason?: unknown } | null
  if (b && b.error === 'GOOGLE') return b.reason === 'revoked' ? 'revoked' : 'google'
  if (b && b.error === 'INELIGIBLE') return 'ineligible'
  return 'generic'
}

export function BindErrorNotice({ kind, lang }: { kind: BindErrorKind; lang: string }) {
  const copy = copyFor(lang)
  return <p role="alert" className="mt-2 text-sm font-medium text-destructive">{copy[`bind_error_${kind}`]}</p>
}

/**
 * Whether bind()'s catch block may set BindErrorNotice for a given failure.
 * False once the PUT itself is known to have succeeded: the write already
 * landed, so a failure in whatever runs after it (the post-write refresh)
 * must never read as "the bind failed". Pure and exported so the invariant
 * is testable without mocking fetch — reload() below is already exception-
 * safe on its own, so this is defence in depth against a future change
 * reintroducing a throw after a successful PUT.
 */
export function shouldReportBindError(putSucceeded: boolean): boolean {
  return !putSucceeded
}

/**
 * A connection's own Google listing failure (GoogleFailure, lib/integrations/google/oauth.ts).
 * Keyed per kind rather than folded into one generic message: the set is
 * small and fixed, and "reconnect" is only the right instruction for
 * revoked/forbidden — misconfigured is never the owner's to fix.
 */
export type ConnectionErrorKind = 'revoked' | 'forbidden' | 'quota' | 'misconfigured' | 'unavailable'
const CONNECTION_ERROR_KINDS: readonly ConnectionErrorKind[] = ['revoked', 'forbidden', 'quota', 'misconfigured', 'unavailable']

export function classifyConnectionError(kind: string | null): ConnectionErrorKind {
  return (CONNECTION_ERROR_KINDS as readonly string[]).includes(kind ?? '')
    ? (kind as ConnectionErrorKind)
    : 'unavailable'
}

export function ErroredConnectionsNotice({
  connections, lang,
}: { connections: Array<{ googleEmail: string | null; error: string | null }>; lang: string }) {
  const copy = copyFor(lang)
  return (
    <div role="alert" className="space-y-1 text-sm text-foreground">
      {connections.map((c, i) => (
        <p key={c.googleEmail ?? i}>
          {copy[`connection_error_${classifyConnectionError(c.error)}`].replace('{email}', c.googleEmail ?? '—')}
        </p>
      ))}
    </div>
  )
}

export function PropertiesLoadFailedNotice({ lang, onRetry }: { lang: string; onRetry?: () => void }) {
  const copy = copyFor(lang)
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 text-sm text-foreground">
      <p>{copy.properties_load_failed}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="min-h-11 shrink-0 rounded-lg border border-border px-3 text-sm"
        >
          {copy.retry}
        </button>
      )}
    </div>
  )
}

/** The account has no usable Google login at all, so there is nothing to choose from yet. */
export function NoConnectionNotice({ lang }: { lang: string }) {
  const copy = copyFor(lang)
  return (
    <div className="text-sm text-muted-foreground">
      <p>{copy.no_connection}</p>
      <SettingsLink lang={lang} />
    </div>
  )
}

/**
 * Which empty-picker sentence applies, if any. Pure and exported so the rule is
 * testable without a DOM. No connection at all is a different fact from "none
 * of your properties covers this brand": telling an owner with no Google login
 * that their properties must cover the domain sends them looking for a
 * property problem they do not have. A failed list or a connection whose own
 * call failed has its own notice, so neither sentence is shown then.
 */
export type PickerNotice = 'no_connection' | 'no_eligible'

export function pickerNotice({
  properties, propertiesFailed,
}: { properties: ConnectionProperties[]; propertiesFailed: boolean }): PickerNotice | null {
  if (propertiesFailed) return null
  if (properties.length === 0) return 'no_connection'
  if (properties.some(c => c.error !== null)) return null
  return properties.some(c => c.sites.some(s => s.verdict.eligible)) ? null : 'no_eligible'
}

export function NoEligiblePropertiesNotice({ lang }: { lang: string }) {
  const copy = copyFor(lang)
  return <p className="text-sm text-muted-foreground">{copy.no_eligible_properties}</p>
}

/**
 * One site row in the property picker. Pulled out of SearchConsolePanel so
 * the busy/disabled/aria-label logic is testable directly: SearchConsolePanel
 * itself only ever renders with data after its mount effect resolves, and
 * effects never run under renderToStaticMarkup, so a test can never reach
 * this markup through the panel itself.
 */
export function PropertySiteRow({
  site, onBind, pending, disabled, lang,
}: { site: Site; onBind: () => void; pending: boolean; disabled: boolean; lang: string }) {
  const copy = copyFor(lang)
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="break-all text-sm text-foreground">{site.siteUrl}</span>
      {site.verdict.eligible ? (
        <button
          type="button"
          onClick={onBind}
          disabled={disabled}
          aria-label={`${copy.bind}: ${site.siteUrl}`}
          className="min-h-11 shrink-0 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {pending ? copy.binding : copy.bind}
        </button>
      ) : (
        <span className="shrink-0 text-xs text-muted-foreground">
          {site.verdict.reason ? copy[`reason_${site.verdict.reason}`] : null}
        </span>
      )}
    </div>
  )
}

export function SearchConsolePanel({ clientId, lang }: { clientId: string; lang: string }) {
  const copy = copyFor(lang)
  const [data, setData] = useState<Payload | null>(null)
  const [failed, setFailed] = useState(false)
  const [propertiesFailed, setPropertiesFailed] = useState(false)
  const [bindBusy, setBindBusy] = useState<string | null>(null)
  const [bindError, setBindError] = useState<BindErrorKind | null>(null)

  useEffect(() => {
    // .then()/.catch() rather than awaiting inline: the setState calls that
    // decide the rendered state belong to this callback, not to fetchPanel,
    // so the lint rule above sees them where React expects them — in a
    // callback fired when the external read resolves, not synchronously in
    // the effect body. A rejected fetchPanel (network failure) is caught here
    // too, so it never surfaces as an unhandled rejection.
    fetchPanel(clientId).then(result => {
      if (result.payload === null) { setFailed(true); return }
      setFailed(false)
      setData(result.payload)
      setPropertiesFailed(result.propertiesFailed)
    }).catch(() => setFailed(true))
  }, [clientId])

  // Not an effect, so free to call fetchPanel + setState directly: used by
  // the post-bind refresh and the properties-load-failed retry button.
  // Exception-safe: a thrown fetch (a network failure, not just a non-2xx
  // response — fetchPanel does not catch its own network errors) falls back
  // to the `failed` panel state rather than propagating, so the retry
  // button's `void reload()` can never become an unhandled rejection, and
  // bind()'s post-write refresh can never throw into bind()'s own catch.
  async function reload() {
    try {
      const result = await fetchPanel(clientId)
      if (result.payload === null) { setFailed(true); return }
      setFailed(false)
      setData(result.payload)
      setPropertiesFailed(result.propertiesFailed)
    } catch {
      setFailed(true)
    }
  }

  async function bind(connectionId: string, siteUrl: string) {
    const key = `${connectionId}:${siteUrl}`
    setBindBusy(key)
    setBindError(null)
    let putSucceeded = false
    try {
      const res = await fetch(`/api/dashboard/clients/${clientId}/search-console`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId, siteUrl }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setBindError(classifyBindError(res.status, body))
        return
      }
      putSucceeded = true
      // reload() is exception-safe on its own (see above), so this cannot
      // actually throw today — shouldReportBindError is what guarantees a
      // refresh failure is never reported as a bind failure even if that
      // ever changes.
      await reload()
    } catch {
      if (shouldReportBindError(putSucceeded)) setBindError('generic')
    } finally {
      setBindBusy(null)
    }
  }

  if (failed) return <p className="text-sm text-muted-foreground">{copy.state_temporarily_unavailable}</p>
  if (!data) return null

  const rows: Array<{ label: string } & MetricTotals> = [
    ...(data.panel.property ? [{ label: copy.whole_site, ...data.panel.property }] : []),
    ...data.panel.pages.map(p => ({ ...p, label: p.pageUrl })),
  ]
  const choosing = data.state.kind === 'unbound' || data.state.kind === 'rebind'
  const okConnections = data.properties.filter(c => c.error === null)
  const erroredConnections = data.properties.filter(c => c.error !== null)
  const emptyNotice = choosing ? pickerNotice({ properties: data.properties, propertiesFailed }) : null

  return (
    <section className="mt-8 rounded-xl border border-border bg-card p-6 shadow-sm">
      <h2 className="text-lg font-bold text-foreground">{copy.panel_title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{copy.panel_caption}</p>
      <div className="mt-4"><SearchConsoleStateNotice state={data.state} lang={lang} /></div>

      {choosing && (
        <div className="mt-4 space-y-3">
          <p className="text-sm font-semibold text-foreground">{copy.choose_property}</p>
          {propertiesFailed && <PropertiesLoadFailedNotice lang={lang} onRetry={() => void reload()} />}
          {erroredConnections.length > 0 && <ErroredConnectionsNotice connections={erroredConnections} lang={lang} />}
          {bindError && <BindErrorNotice kind={bindError} lang={lang} />}
          {emptyNotice === 'no_connection' && <NoConnectionNotice lang={lang} />}
          {emptyNotice === 'no_eligible' && <NoEligiblePropertiesNotice lang={lang} />}
          {okConnections.flatMap(c => c.sites.map(site => {
            const key = `${c.connectionId}:${site.siteUrl}`
            return (
              <PropertySiteRow
                key={key}
                site={site}
                onBind={() => void bind(c.connectionId, site.siteUrl)}
                pending={bindBusy === key}
                disabled={bindBusy !== null}
                lang={lang}
              />
            )
          }))}
        </div>
      )}

      {rows.length > 0 && (
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-2" />
              <th>{copy.clicks}</th>
              <th>{copy.impressions}</th>
              <th>{copy.ctr}</th>
              <th>{copy.position}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.label} className="border-t border-border">
                <td className="break-all py-2 pr-3">{r.label}</td>
                <td>{r.clicks}</td>
                <td>{r.impressions}</td>
                <td>{pct(r.ctr)}</td>
                <td>{r.position.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
