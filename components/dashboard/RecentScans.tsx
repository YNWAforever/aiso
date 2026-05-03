import Link from 'next/link'
import type { Scan } from '@/lib/types'

interface Props {
  scans: Pick<Scan, 'id' | 'domain' | 'score' | 'created_at'>[]
  lang: string
  clientId?: string
}

export function RecentScans({ scans, lang, clientId }: Props) {
  return (
    <div className="rounded-xl border border-dash-border bg-dash-surface divide-y divide-dash-border">
      {scans.map(scan => {
        const href = clientId
          ? `/${lang}/dashboard/${clientId}?step=results&scanId=${scan.id}`
          : `/${lang}/result/${scan.id}`

        return (
          <Link
            key={scan.id}
            href={href}
            className="flex items-center justify-between px-5 py-3.5 hover:bg-dash-elevated transition-colors"
          >
            <div>
              <p className="text-sm font-medium text-dash-text">{scan.domain}</p>
              <p className="text-[11px] text-dash-muted font-mono mt-0.5">
                {new Date(scan.created_at).toLocaleDateString()}
              </p>
            </div>
            <span className={`text-xs font-bold px-2.5 py-1 rounded-full border font-mono ${
              scan.score >= 80
                ? 'bg-success/10 text-success border-success/20'
                : scan.score >= 50
                  ? 'bg-warning/10 text-warning border-warning/20'
                  : 'bg-destructive/10 text-destructive border-destructive/20'
            }`}>
              {Math.round(scan.score)}
            </span>
          </Link>
        )
      })}
    </div>
  )
}
