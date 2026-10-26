import Image from 'next/image'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'
import type { ExecutiveSnapshot } from '@/lib/enterprise/reports'
export function EnterpriseReportView({snapshot:s,lang}:{snapshot:ExecutiveSnapshot;lang:string}){
 const c=(lang==='zh-HK'?zhHK:en).enterpriseOS,number=(v:unknown)=>v===null||v===undefined||!Number.isFinite(Number(v))?c.unknown:new Intl.NumberFormat(lang,{maximumFractionDigits:2}).format(Number(v)),percent=(v:unknown)=>v===null||v===undefined||!Number.isFinite(Number(v))?c.unknown:new Intl.NumberFormat(lang,{style:'percent',maximumFractionDigits:1}).format(Number(v))
 const metric=(label:string,value:string)=><div className="rounded border p-3"><dt className="text-sm text-muted-foreground">{label}</dt><dd className="mt-1 text-xl font-semibold">{value}</dd></div>
 const logo=s.branding.logoUrl?.startsWith('/api/enterprise/portals/')?s.branding.logoUrl:null
 return <article className="mx-auto max-w-5xl space-y-6 p-5" style={{borderTop:`6px solid ${s.branding.primaryColor}`}}>
  <header className="space-y-2">{logo&&<Image src={logo} alt={s.branding.companyName} width={160} height={64} unoptimized className="max-h-16 w-auto object-contain"/>}<p className="font-semibold">{s.branding.companyName}</p><h1 className="text-2xl font-bold">{s.client.name} — {c.executive}</h1><p>{s.window.start} — {s.window.end} ({c.utc})</p><p className="text-sm text-muted-foreground">{s.client.domain}</p></header>
  <section className="space-y-2"><h2 className="text-xl font-semibold">{c.technical}</h2><dl className="grid gap-3 sm:grid-cols-2">{metric(c.technical,number(s.technical?.score))}{metric(c.snapshot,String(s.technical?.recordedAt??c.unknown))}{metric(c.method,`${s.technical?.method??c.unknown} / ${s.technical?.collection==='complete'?'✓':c.unknown}`)}</dl></section>
  <section className="space-y-2"><h2 className="text-xl font-semibold">{c.retrieval}</h2><p>{c.retrievalHelp}</p></section>
  <section className="space-y-3"><h2 className="text-xl font-semibold">{c.outcomes}</h2><dl className="grid gap-3 sm:grid-cols-3">{metric(c.clicks,number(s.outcomes.search?.clicks))}{metric(c.impressions,number(s.outcomes.search?.impressions))}{metric(c.position,number(s.outcomes.search?.position))}</dl>
   {s.outcomes.analyticsByCurrency.map(row=><div key={String(row.currency)}><h3 className="font-semibold">{String(row.currency)}</h3><dl className="grid gap-3 sm:grid-cols-3">{metric(c.sessions,number(row.sessions))}{metric(c.conversions,number(row.conversions))}{metric(c.revenue,number(row.revenue_minor))}</dl></div>)}
  </section>
  <section className="space-y-3"><h2 className="text-xl font-semibold">{c.ai}</h2><p>{c.verifiedSamples}: {number(s.visibility.observations)} / {number(s.visibility.availableObservations)} · {c.connectorReported}: {number(s.visibility.connectorReported.observations)}</p><dl className="grid gap-3 sm:grid-cols-3">{metric(c.answerPresence,percent(s.visibility.answerPresence))}{metric(c.citationShare,percent(s.visibility.citationShare))}{metric(c.citationCoverage,percent(s.visibility.citationCoverage))}{metric(c.firstCitation,number(s.visibility.firstCitationPosition))}{metric(c.sov,percent(s.visibility.brandShareOfVoice))}{metric(c.volatility,percent(s.visibility.volatility))}</dl>
   <h3 className="font-semibold">{c.sources}</h3><ul className="list-inside list-disc">{s.visibility.trustedSources.map(source=><li key={source.domain}>{source.domain} ({source.answers})</li>)}</ul>
  </section><section className="space-y-2 rounded border p-4"><h2 className="font-semibold">{c.limits}</h2><p>{c.limitsHelp}</p></section>
 </article>
}
