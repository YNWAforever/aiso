import Link from 'next/link'
import type { Scan } from '@/lib/types'

interface Props {
  scans: Pick<Scan, 'id' | 'domain' | 'score' | 'created_at'>[]
  lang: string
}

function scoreColor(score: number) {
  if (score >= 80) return 'bg-[#22c55e15] text-[#22c55e] border-[#22c55e20]'
  if (score >= 50) return 'bg-[#f59e0b15] text-[#f59e0b] border-[#f59e0b20]'
  return 'bg-[#ef444415] text-[#ef4444] border-[#ef444420]'
}

export function RecentScans({ scans, lang }: Props) {
  return (
    <div className="rounded-xl border border-[#1e1e30] bg-[#0d0d18] divide-y divide-[#1e1e30]">
      {scans.map(scan => (
        <Link
          key={scan.id}
          href={`/${lang}/result/${scan.id}`}
          className="flex items-center justify-between px-5 py-3.5 hover:bg-[#141422] transition-colors"
        >
          <div>
            <p className="text-sm font-medium text-[#e0e0ec]">{scan.domain}</p>
            <p className="text-[11px] text-[#5c5c6e] font-mono mt-0.5">
              {new Date(scan.created_at).toLocaleDateString()}
            </p>
          </div>
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full border font-mono ${scoreColor(scan.score)}`}>
            {Math.round(scan.score)}
          </span>
        </Link>
      ))}
    </div>
  )
}
