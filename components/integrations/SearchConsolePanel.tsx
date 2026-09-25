'use client'

import { useEffect, useState } from 'react'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'
import type { OwnerState } from '@/lib/integrations/search-console/state'
import type { MetricTotals, PanelData } from '@/lib/integrations/search-console/store'

type Copy = typeof en.searchConsole
type Verdict = { eligible: boolean; reason?: 'no_domain' | 'other_domain' | 'unverified' }
type Site = { siteUrl: string; permissionLevel: string; verdict: Verdict }
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
// (the mount effect below, and bind()'s post-write refetch) sets state itself.
async function fetchPanel(clientId: string): Promise<Payload | null> {
  const res = await fetch(`/api/dashboard/clients/${clientId}/search-console`)
  if (!res.ok) return null
  const payload = await res.json() as Payload
  // The route only calls Google, and returns a populated `properties` list,
  // when asked with `?properties=1` — the dashboard's default load must not
  // trigger a Google call on every visit. The picker only ever needs that
  // list while the brand has no eligible binding yet.
  if (payload.state.kind === 'unbound' || payload.state.kind === 'rebind') {
    const withProperties = await fetch(`/api/dashboard/clients/${clientId}/search-console?properties=1`)
    if (withProperties.ok) payload.properties = ((await withProperties.json()) as Payload).properties
  }
  return payload
}

export function SearchConsoleStateNotice({ state, lang }: { state: OwnerState; lang: string }) {
  const copy = copyFor(lang)
  const through = 'dataThrough' in state && state.dataThrough
    ? <p className="mt-1 text-xs text-muted-foreground">{copy.data_through.replace('{date}', state.dataThrough)}</p>
    : null
  if (state.kind === 'synced') return through
  return (
    <div role="status" className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-foreground">
      <p>{copy[`state_${state.kind}`]}</p>
      {through}
    </div>
  )
}

export function SearchConsolePanel({ clientId, lang }: { clientId: string; lang: string }) {
  const copy = copyFor(lang)
  const [data, setData] = useState<Payload | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    // .then() rather than awaiting inline: the setState calls that decide the
    // rendered state belong to this callback, not to fetchPanel, so the lint
    // rule above sees them where React expects them — in a callback fired
    // when the external read resolves, not synchronously in the effect body.
    fetchPanel(clientId).then(payload => {
      if (payload === null) setFailed(true)
      else setData(payload)
    }).catch(() => setFailed(true))
  }, [clientId])

  async function bind(connectionId: string, siteUrl: string) {
    await fetch(`/api/dashboard/clients/${clientId}/search-console`, {
      method: 'PUT',
      body: JSON.stringify({ connectionId, siteUrl }),
    })
    const payload = await fetchPanel(clientId)
    if (payload === null) setFailed(true)
    else setData(payload)
  }

  if (failed) return <p className="text-sm text-muted-foreground">{copy.state_temporarily_unavailable}</p>
  if (!data) return null

  const rows: Array<{ label: string } & MetricTotals> = [
    ...(data.panel.property ? [{ label: copy.whole_site, ...data.panel.property }] : []),
    ...data.panel.pages.map(p => ({ ...p, label: p.pageUrl })),
  ]
  const choosing = data.state.kind === 'unbound' || data.state.kind === 'rebind'

  return (
    <section className="mt-8 rounded-xl border border-border bg-card p-6 shadow-sm">
      <h2 className="text-lg font-bold text-foreground">{copy.panel_title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{copy.panel_caption}</p>
      <div className="mt-4"><SearchConsoleStateNotice state={data.state} lang={lang} /></div>

      {choosing && (
        <div className="mt-4 space-y-3">
          <p className="text-sm font-semibold text-foreground">{copy.choose_property}</p>
          {data.properties.filter(c => c.error === null).flatMap(c => c.sites.map(site => (
            <div key={`${c.connectionId}:${site.siteUrl}`} className="flex items-center justify-between gap-3">
              <span className="break-all text-sm text-foreground">{site.siteUrl}</span>
              {site.verdict.eligible ? (
                <button
                  type="button"
                  onClick={() => void bind(c.connectionId, site.siteUrl)}
                  className="min-h-11 shrink-0 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground"
                >
                  {copy.bind}
                </button>
              ) : (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {site.verdict.reason ? copy[`reason_${site.verdict.reason}`] : null}
                </span>
              )}
            </div>
          )))}
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
