import Link from 'next/link'
import { BarChart2 } from 'lucide-react'
import type { Portfolio } from '@/lib/view-models/portfolio'
import { formatScanDate } from '@/components/dashboard/RecentScans'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'

type Props = { client: Portfolio['clients'][number]; lang: string }
export function BrandCard({client,lang}: Props) {
  const copy = (lang === 'zh-HK' ? zhHK : en).portfolio
  const visibility = client.visibility
  return <Link href={`/${lang}/dashboard/${client.id}`} className="group block h-full min-w-0 rounded-xl border border-border bg-card p-5 transition-colors hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2">
    <div className="mb-3 flex items-start justify-between gap-3"><BarChart2 aria-hidden="true" className="size-5 shrink-0 text-primary-accessible" />{client.industry && <span className="break-words text-xs text-muted-foreground">{client.industry}</span>}</div>
    <h3 className="break-words text-base font-semibold text-foreground">{client.brand_name}</h3>
    {client.domain && <p className="mt-1 break-words text-xs text-muted-foreground">{client.domain}</p>}
    <div className="mt-4 border-t border-border pt-3">
      <p className="text-xs font-semibold text-muted-foreground">{copy.visibility}</p>
      {visibility.state === 'ready' && visibility.data ? <p className="mt-2 text-2xl font-bold text-foreground">{visibility.data.sovScore}%</p> : <p className="mt-2 text-sm text-muted-foreground">{visibility.state === 'error' ? copy.visibilityError : copy.visibilityEmpty}</p>}
      <p className="mt-2 text-xs text-muted-foreground">{copy.observedAt}: {formatScanDate(visibility.observedAt,lang)}</p>
      <p className="mt-1 text-xs text-muted-foreground">{copy.freshnessUnknown}</p>
    </div>
  </Link>
}
