import Link from 'next/link'
import type { ReactNode } from 'react'
import type { Portfolio } from '@/lib/view-models/portfolio'
import type { ActivationProgress as Progress } from '@/lib/view-models/activation-progress'
import { ActivationProgress } from '@/components/dashboard/ActivationProgress'
import { BrandCard } from '@/components/dashboard/BrandCard'
import { RecentScans } from '@/components/dashboard/RecentScans'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'

/** Pure projection rendering; the server page supplies the existing creation control. */
export function PortfolioView({portfolio,lang,creationControl,activation,firstRunScanId}: {portfolio:Portfolio;lang:string;creationControl:ReactNode;activation:Progress;firstRunScanId:string|null}) {
  const copy = (lang === 'zh-HK' ? zhHK : en).portfolio
  const {capacity,history} = portfolio
  return <main className="mx-auto w-full min-w-0 max-w-5xl space-y-8 break-words px-4 py-8 sm:px-6">
    <header><h1 className="text-2xl font-bold text-foreground">{copy.title}</h1><p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">{copy.intro}</p></header>
    <section aria-labelledby="portfolio-brands">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 id="portfolio-brands" className="text-lg font-bold text-foreground">{copy.brands}</h2>{capacity.state === 'known' && capacity.canCreate === true && <div className="[&_button]:min-h-11">{creationControl}</div>}</div>
      {capacity.state === 'unknown' ? <p className="mb-4 rounded-lg border border-border p-4 text-sm text-muted-foreground">{copy.capacityUnknown}</p> : <div className="mb-4 text-sm text-muted-foreground"><p>{copy.capacity}: {capacity.count} / {capacity.limit}</p>{capacity.canCreate === false && <><p className="mt-2">{copy.capacityLimit}</p><Link href={`/${lang}/pricing`} className="mt-1 inline-flex min-h-11 items-center font-semibold text-primary-accessible underline underline-offset-4">{copy.pricing}</Link></>}</div>}
      {portfolio.clients.length ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{portfolio.clients.map(client=><BrandCard key={client.id} client={client} lang={lang}/>)}</div> : <div className="rounded-xl border border-border bg-card p-6"><p className="text-sm text-muted-foreground">{copy.emptyBrands}</p><h3 className="mt-4 text-base font-bold text-foreground">{copy.firstRunTitle}</h3><p className="mt-2 max-w-2xl text-sm text-muted-foreground">{copy.firstRunBody}</p><Link href={firstRunScanId ? `/${lang}/onboarding?scan=${encodeURIComponent(firstRunScanId)}` : `/${lang}/onboarding`} className="mt-3 inline-flex min-h-11 items-center font-semibold text-primary-accessible underline underline-offset-4">{copy.firstRunAction}</Link></div>}
    </section>
    {/* Account-level, so it sits on the portfolio rather than inside one brand,
        and shown from the first visit: for a new owner it names the step the
        first-run link above performs, which is the one moment it is most useful. */}
    <ActivationProgress progress={activation} lang={lang}/>
    <section aria-labelledby="portfolio-history"><h2 id="portfolio-history" className="mb-4 text-lg font-bold text-foreground">{copy.history}</h2>{history.state === 'ready' && history.data ? <RecentScans scans={history.data} lang={lang}/> : <p className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">{history.state === 'error'?copy.historyError:copy.historyEmpty}</p>}</section>
  </main>
}
