import Link from 'next/link'
import type { Scan } from '@/lib/types'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'

type Props = {
  scans: (Pick<Scan, 'id'|'domain'|'score'|'created_at'> & {grade?: string|null})[]
  lang: string
  clientId?: string
}
export function formatScanDate(value: string|null|undefined, lang: string): string {
  const date = value ? new Date(value) : null
  if (!date || !Number.isFinite(date.getTime())) return (lang === 'zh-HK' ? zhHK : en).portfolio.dateUnknown
  return new Intl.DateTimeFormat(lang === 'zh-HK' ? 'zh-HK' : 'en-US', {year:'numeric',month:'short',day:'numeric',timeZone:'UTC'}).format(date)
}
export function RecentScans({ scans, lang, clientId }: Props) {
  const copy = (lang === 'zh-HK' ? zhHK : en).portfolio
  return <div>
    <p className="mb-2 text-xs text-muted-foreground">{copy.dateZone}</p>
    <div className="divide-y divide-border rounded-xl border border-border bg-card">
      {scans.map(scan => {
        const href = clientId ? `/${lang}/dashboard/${clientId}/result/${scan.id}` : `/${lang}/result/${scan.id}`
        const validDate = Boolean(scan.created_at) && Number.isFinite(Date.parse(scan.created_at))
        return <Link key={scan.id} href={href} className="flex min-h-11 items-center justify-between gap-3 px-4 py-4 hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2">
          <div className="min-w-0 break-words">
            <p className="text-sm font-semibold text-foreground">{scan.domain}</p>
            <p className="mt-1 text-xs text-muted-foreground">{validDate ? <time dateTime={scan.created_at}>{formatScanDate(scan.created_at,lang)}</time> : copy.dateUnknown}</p>
          </div>
          <div className="shrink-0 text-right text-sm font-semibold text-foreground"><p>{scan.score} / 100</p>{scan.grade && <p className="mt-1 text-xs text-muted-foreground">{copy.grade}: {scan.grade}</p>}</div>
        </Link>
      })}
    </div>
  </div>
}
