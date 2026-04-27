import Link from 'next/link'
import type { Scan } from '@/lib/types'

interface Props {
  scans: Pick<Scan, 'id' | 'domain' | 'score' | 'created_at'>[]
  lang: string
}

function scoreColor(score: number) {
  if (score >= 80) return 'text-green-600 bg-green-50'
  if (score >= 50) return 'text-yellow-600 bg-yellow-50'
  return 'text-red-600 bg-red-50'
}

export function RecentScans({ scans, lang }: Props) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
      {scans.map(scan => (
        <Link
          key={scan.id}
          href={`/${lang}/result/${scan.id}`}
          className="flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition"
        >
          <div>
            <p className="text-sm font-medium text-slate-800">{scan.domain}</p>
            <p className="text-xs text-slate-400 mt-0.5">
              {new Date(scan.created_at).toLocaleDateString()}
            </p>
          </div>
          <span className={`text-sm font-bold px-3 py-1 rounded-full ${scoreColor(scan.score)}`}>
            {Math.round(scan.score)}
          </span>
        </Link>
      ))}
    </div>
  )
}
