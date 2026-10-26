'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'
type Summary = { search: { clicks: number | null; impressions: number | null } | null; analytics: { sessions: number | null; conversions: number | null } | null }
export function OutcomePreview({ clientId, lang }: { clientId: string; lang: string }) {
  const c = (lang === 'zh-HK' ? zhHK : en).outcomeIntegrations
  const [data,setData] = useState<Summary | null>(null), [failed,setFailed] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    void fetch(`/api/clients/${clientId}/outcomes/summary`, { signal: controller.signal, cache:'no-store' }).then(async response => {
      if (!response.ok) throw new Error()
      const value = await response.json()
      if (!controller.signal.aborted) setData(value)
    }).catch(() => { if (!controller.signal.aborted) setFailed(true) })
    return () => controller.abort()
  },[clientId])
  const value = (number: number | null | undefined) => number == null ? c.unknown : number.toLocaleString(lang)
  return <section className="space-y-3 rounded-xl border border-border bg-card p-5"><h2 className="font-semibold">{c.outcomes}</h2><p>{c.intro}</p>
    {failed ? <p role="alert">{c.unavailable}</p> : !data ? <p role="status">{c.loading}</p> : <p>{c.clicks}: {value(data.search?.clicks)} · {c.impressions}: {value(data.search?.impressions)} · {c.sessions}: {value(data.analytics?.sessions)} · {c.conversions}: {value(data.analytics?.conversions)}</p>}
    <p>{c.noRetrieval}</p><Link className="inline-flex min-h-11 items-center underline" href={`/${lang}/dashboard/${clientId}/outcomes`}>{c.nav}</Link>
  </section>
}
